/**
 * Codex provider — `codex app-server` transport (registered as "codex-sdk").
 *
 * Why this replaces the old `@openai/codex-sdk` (codex exec) provider:
 *   The SDK ran `codex exec`, a headless one-shot mode that hard-codes
 *   `approval_policy = never`. In enterprise-managed Codex environments that
 *   ban `never`, Ask AI broke (GitHub #971). `codex exec` also has no channel
 *   to ask a human for approval.
 *
 * This provider instead drives a long-lived `codex app-server` process over
 * newline-delimited JSON-RPC 2.0 (stdio). The fix for #971 is simply to OMIT
 * `approvalPolicy` at `thread/start` so Codex resolves the user's + company's
 * configured policy itself; we pin `sandbox: "read-only"` to keep Ask AI safe.
 * Codex's approval prompts arrive as server→client JSON-RPC *requests*, which
 * we surface as the existing `permission_request` AIMessage and answer through
 * the existing `respondToPermission` path (same Allow/Deny UI as Claude).
 *
 * The registry name stays "codex-sdk" (it is the persisted cookie providerId,
 * the key in agents.ts, and the UI reasoning-effort gate) — only the transport
 * changed. Implemented with node:child_process so a single file works under
 * both the Bun server and the Node (Pi) extension.
 *
 * Note: `codex app-server`'s `thread/start` has no `skipGitRepoCheck` param —
 * unlike `codex exec`, it does not gate on being inside a git repo, so the
 * #965 "Ask AI outside git repos" fix needs no special handling here.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { BaseSession } from "../base-session.ts";
import { buildEffectivePrompt, buildSystemPrompt } from "../context.ts";
import type {
  AIMessage,
  AIPermissionRequestMessage,
  AIProvider,
  AIProviderCapabilities,
  AISession,
  CodexSDKConfig,
  CreateSessionOptions,
} from "../types.ts";
import { registerProviderFactory } from "../provider.ts";
import {
  buildWindowsCommandScriptSpawnCommand,
  killWindowsProcessTree,
  resolveWindowsCommandShim,
} from "./command-path.ts";

const PROVIDER_NAME = "codex-sdk";
const DEFAULT_MODEL = "gpt-5.4";
const CLIENT_NAME = "plannotator";
/** Kill an idle app-server process after this long with no query. */
const IDLE_TIMEOUT_MS = 10 * 60_000;

const CMD_APPROVAL_METHOD = "item/commandExecution/requestApproval";
const FILE_APPROVAL_METHOD = "item/fileChange/requestApproval";

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

export type RpcMessage = Record<string, unknown>;

export type RpcClassification =
  | { kind: "response"; id: string | number }
  | { kind: "request"; id: string | number; method: string; params: RpcMessage }
  | { kind: "notification"; method: string; params: RpcMessage }
  | { kind: "unknown" };

/**
 * Classify an incoming JSON-RPC message by SHAPE (not by a `type` field):
 *   - response:     has `id`, no `method`
 *   - server request: has both `id` and `method`
 *   - notification: has `method`, no `id`
 * Client-sent ids and server-sent ids live in separate id spaces, so a message
 * carrying `method` is NEVER treated as a response to one of our requests.
 */
export function classifyRpcMessage(msg: RpcMessage): RpcClassification {
  const hasId = msg.id !== undefined && msg.id !== null;
  const hasMethod = typeof msg.method === "string";
  if (hasId && !hasMethod) {
    return { kind: "response", id: msg.id as string | number };
  }
  if (hasId && hasMethod) {
    return {
      kind: "request",
      id: msg.id as string | number,
      method: msg.method as string,
      params: (msg.params as RpcMessage) ?? {},
    };
  }
  if (hasMethod) {
    return {
      kind: "notification",
      method: msg.method as string,
      params: (msg.params as RpcMessage) ?? {},
    };
  }
  return { kind: "unknown" };
}

/**
 * Map a Codex app-server notification (`{ method, params }`) to AIMessages.
 * `sessionId` is the resolved thread id, injected into the terminal result.
 */
export function mapCodexAppServerEvent(
  notification: { method: string; params?: RpcMessage },
  sessionId: string,
): AIMessage[] {
  const method = notification.method;
  const params = notification.params ?? {};

  switch (method) {
    case "item/agentMessage/delta": {
      const delta = params.delta as string | undefined;
      return delta ? [{ type: "text_delta", delta }] : [];
    }

    case "item/started": {
      const item = params.item as RpcMessage | undefined;
      if (item?.type === "commandExecution") {
        return [{
          type: "tool_use",
          toolName: "Bash",
          toolInput: { command: (item.command as string) ?? "" },
          toolUseId: (item.id as string) ?? "",
        }];
      }
      return [];
    }

    case "item/completed": {
      const item = params.item as RpcMessage | undefined;
      if (item?.type === "commandExecution") {
        const output = (item.aggregatedOutput as string) ?? "";
        const exitCode = item.exitCode as number | undefined;
        return [{
          type: "tool_result",
          toolUseId: (item.id as string) ?? "",
          result: exitCode != null ? `${output}\n[exit code: ${exitCode}]` : output,
        }];
      }
      if (item?.type === "error") {
        return [{ type: "error", error: (item.message as string) ?? "Error" }];
      }
      // agentMessage / fileChange / reasoning: streamed via deltas or shown
      // via approvals — nothing to emit on completion.
      return [];
    }

    case "turn/completed": {
      const turn = params.turn as RpcMessage | undefined;
      const status = turn?.status as string | undefined;
      if (status === "failed") {
        const error = turn?.error as RpcMessage | undefined;
        return [{
          type: "error",
          error: (error?.message as string) ?? "Turn failed",
          code: "turn_failed",
        }];
      }
      return [{ type: "result", sessionId, success: true }];
    }

    case "error":
      return [{
        type: "error",
        error: (params.message as string) ?? "Unknown error",
        code: "codex_error",
      }];

    case "process_exited":
      return [{
        type: "error",
        error: "Codex app-server process exited unexpectedly.",
        code: "provider_error",
      }];

    // Streaming-only / informational notifications we intentionally ignore.
    case "thread/started":
    case "turn/started":
    case "turn/diff/updated":
    case "turn/plan/updated":
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryTextDelta":
    case "thread/tokenUsage/updated":
      return [];

    default:
      return [{ type: "unknown", raw: notification }];
  }
}

/**
 * Map an inbound approval REQUEST to a `permission_request` AIMessage so the
 * existing PermissionCard renders it. `requestId` correlates the user's later
 * decision back to the JSON-RPC request id.
 */
export function mapApprovalRequest(
  method: string,
  params: RpcMessage,
  requestId: string,
): AIPermissionRequestMessage {
  const toolUseId = (params.itemId as string) ?? requestId;
  const reason = params.reason as string | undefined;

  if (method === CMD_APPROVAL_METHOD) {
    return {
      type: "permission_request",
      requestId,
      toolName: "Bash",
      toolInput: {
        command: (params.command as string) ?? "",
        ...(params.cwd ? { cwd: params.cwd } : {}),
      },
      ...(reason ? { description: reason } : {}),
      toolUseId,
    };
  }

  if (method === FILE_APPROVAL_METHOD) {
    return {
      type: "permission_request",
      requestId,
      toolName: "FileChange",
      toolInput: {},
      title: reason ?? "Approve file changes",
      toolUseId,
    };
  }

  // Generic fallback for any other approval-shaped request.
  return {
    type: "permission_request",
    requestId,
    toolName: method,
    toolInput: params,
    ...(reason ? { description: reason } : {}),
    toolUseId,
  };
}

// ---------------------------------------------------------------------------
// JSON-RPC over stdio (bidirectional: responses, notifications, server requests)
// ---------------------------------------------------------------------------

type NotificationListener = (notification: { method: string; params: RpcMessage }) => void;
type RequestHandler = (method: string, id: string | number, params: RpcMessage) => void;

class CodexAppServerProcess {
  private proc: ChildProcess | null = null;
  private listeners: NotificationListener[] = [];
  private requestHandlers: RequestHandler[] = [];
  private pendingRequests = new Map<
    string,
    { resolve: (data: RpcMessage) => void; reject: (err: Error) => void }
  >();
  private nextId = 0;
  private buffer = "";
  private _alive = false;
  private startPromise: Promise<void> | null = null;

  /** Spawn + JSON-RPC initialize handshake, once. */
  start(codexPath: string, cwd: string): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.doStart(codexPath, cwd).catch((err) => {
        this.startPromise = null;
        throw err;
      });
    }
    return this.startPromise;
  }

  private async doStart(codexPath: string, cwd: string): Promise<void> {
    const commandPath = resolveWindowsCommandShim(codexPath);
    const command =
      buildWindowsCommandScriptSpawnCommand(commandPath, ["app-server"]) ?? [
        commandPath,
        "app-server",
      ];

    let proc: ChildProcess;
    try {
      const [file, ...args] = command;
      proc = spawn(file, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.handleProcessEnd(error);
      throw error;
    }

    this.proc = proc;
    proc.once("exit", () => {
      this.handleProcessEnd(new Error("Codex app-server exited unexpectedly"));
    });

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        proc.off("spawn", onSpawn);
        proc.off("error", onError);
      };
      const onSpawn = () => {
        cleanup();
        this._alive = true;
        this.readStream();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        this.handleProcessEnd(err);
        reject(err);
      };
      proc.once("spawn", onSpawn);
      proc.once("error", onError);
    });

    // JSON-RPC handshake: initialize (request) then initialized (notification).
    await this.sendAndWait({
      method: "initialize",
      params: {
        clientInfo: { name: CLIENT_NAME, title: "Plannotator", version: "1.0.0" },
      },
    });
    this.send({ method: "initialized", params: {} });
  }

  private handleProcessEnd(error: Error): void {
    if (!this.proc && this.pendingRequests.size === 0) return;
    this._alive = false;
    this.proc = null;
    for (const [, pending] of this.pendingRequests) pending.reject(error);
    this.pendingRequests.clear();
    for (const listener of this.listeners) {
      listener({ method: "process_exited", params: {} });
    }
  }

  private readStream(): void {
    if (!this.proc?.stdout) return;
    this.proc.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.replace(/\r$/, "");
        if (!trimmed) continue;
        try {
          this.routeMessage(JSON.parse(trimmed));
        } catch {
          // Ignore malformed lines.
        }
      }
    });
  }

  private routeMessage(msg: RpcMessage): void {
    const classified = classifyRpcMessage(msg);
    switch (classified.kind) {
      case "response": {
        const pending = this.pendingRequests.get(String(classified.id));
        if (!pending) return;
        this.pendingRequests.delete(String(classified.id));
        if (msg.error) {
          const err = msg.error as RpcMessage;
          pending.reject(new Error((err.message as string) ?? "RPC error"));
        } else {
          pending.resolve((msg.result as RpcMessage) ?? {});
        }
        return;
      }
      case "request": {
        for (const handler of this.requestHandlers) {
          handler(classified.method, classified.id, classified.params);
        }
        return;
      }
      case "notification": {
        for (const listener of this.listeners) {
          listener({ method: classified.method, params: classified.params });
        }
        return;
      }
      default:
        return;
    }
  }

  send(message: RpcMessage): void {
    if (!this.proc?.stdin || this.proc.stdin.destroyed) return;
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  sendAndWait(message: RpcMessage): Promise<RpcMessage> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(String(id), { resolve, reject });
      this.send({ ...message, id });
    });
  }

  /** Answer an inbound server request with a JSON-RPC result. */
  respond(id: string | number, result: RpcMessage): void {
    this.send({ id, result });
  }

  /** Answer an inbound server request with a JSON-RPC error. */
  respondError(id: string | number, message: string): void {
    this.send({ id, error: { code: -32601, message } });
  }

  onEvent(listener: NotificationListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  onRequest(handler: RequestHandler): () => void {
    this.requestHandlers.push(handler);
    return () => {
      const idx = this.requestHandlers.indexOf(handler);
      if (idx >= 0) this.requestHandlers.splice(idx, 1);
    };
  }

  get alive(): boolean {
    return this._alive;
  }

  kill(): void {
    this._alive = false;
    this.startPromise = null;
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      if (!killWindowsProcessTree(proc.pid)) proc.kill();
    }
    this.listeners.length = 0;
    this.requestHandlers.length = 0;
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error("Process killed"));
    }
    this.pendingRequests.clear();
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class CodexAppServerProvider implements AIProvider {
  readonly name = PROVIDER_NAME;
  readonly capabilities: AIProviderCapabilities = {
    fork: false, // thread/fork needs a shared thread store — out of scope
    resume: true,
    streaming: true,
    tools: true,
  };
  readonly models = [
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-5.4", label: "GPT-5.4", default: true },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
    { id: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
    { id: "gpt-5.2", label: "GPT-5.2" },
  ] as const;

  private config: CodexSDKConfig;
  private sessions = new Set<CodexAppServerSession>();

  constructor(config: CodexSDKConfig) {
    this.config = config;
  }

  async createSession(options: CreateSessionOptions): Promise<AISession> {
    const session = new CodexAppServerSession({
      systemPrompt: buildSystemPrompt(options.context),
      cwd: options.cwd ?? this.config.cwd ?? process.cwd(),
      parentSessionId: null,
      codexExecutablePath: this.config.codexExecutablePath ?? "codex",
      model: options.model ?? this.config.model ?? DEFAULT_MODEL,
      reasoningEffort: options.reasoningEffort,
      onClosed: (s) => this.sessions.delete(s),
    });
    this.sessions.add(session);
    return session;
  }

  async forkSession(): Promise<never> {
    throw new Error(
      "Codex does not support session forking. " +
        "The endpoint layer should fall back to createSession().",
    );
  }

  async resumeSession(sessionId: string): Promise<AISession> {
    const session = new CodexAppServerSession({
      systemPrompt: null, // resumed thread already carries its context
      cwd: this.config.cwd ?? process.cwd(),
      parentSessionId: null,
      codexExecutablePath: this.config.codexExecutablePath ?? "codex",
      model: this.config.model ?? DEFAULT_MODEL,
      resumeThreadId: sessionId,
      onClosed: (s) => this.sessions.delete(s),
    });
    this.sessions.add(session);
    return session;
  }

  dispose(): void {
    for (const session of this.sessions) session.dispose();
    this.sessions.clear();
  }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

interface SessionConfig {
  systemPrompt: string | null;
  cwd: string;
  parentSessionId: string | null;
  codexExecutablePath: string;
  model: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  resumeThreadId?: string;
  onClosed: (session: CodexAppServerSession) => void;
}

class CodexAppServerSession extends BaseSession {
  private config: SessionConfig;
  private process: CodexAppServerProcess | null = null;
  private threadStarted = false;
  /**
   * The thread id used on the wire for turn/start + turn/interrupt. Usually
   * equal to the client-facing `id`, but decoupled so a resume failure can
   * fall back to a fresh thread without breaking the client's session id.
   */
  private liveThreadId: string | null = null;
  private activeTurnId: string | null = null;
  /** requestId → inbound JSON-RPC request id awaiting a decision. */
  private pendingApprovals = new Map<string, string | number>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: SessionConfig) {
    super({
      parentSessionId: config.parentSessionId,
      initialId: config.resumeThreadId,
    });
    this.config = config;
    if (config.resumeThreadId) this._resolvedId = config.resumeThreadId;
  }

  async *query(prompt: string): AsyncIterable<AIMessage> {
    const started = this.startQuery();
    if (!started) {
      yield BaseSession.BUSY_ERROR;
      return;
    }
    const { gen } = started;
    this.clearIdleTimer();

    try {
      yield* this.runTurn(prompt);
    } catch (err) {
      yield {
        type: "error",
        error: err instanceof Error ? err.message : String(err),
        code: "provider_error",
      };
    } finally {
      this.endQuery(gen);
      this.scheduleIdleTimer();
    }
  }

  private async *runTurn(prompt: string): AsyncIterable<AIMessage> {
    await this.ensureThread();
    const proc = this.process;
    if (!proc || !proc.alive) {
      yield {
        type: "error",
        error:
          "Codex app-server exited during startup. Check that Codex is installed and authenticated (`codex login`).",
        code: "codex_startup_error",
      };
      return;
    }

    const effectivePrompt = buildEffectivePrompt(
      prompt,
      this.config.systemPrompt,
      this._firstQuerySent,
    );

    const queue: AIMessage[] = [];
    let resolve: (() => void) | null = null;
    let done = false;
    const push = (msg: AIMessage) => {
      queue.push(msg);
      resolve?.();
    };
    const finish = () => {
      done = true;
      resolve?.();
    };

    const unsubEvents = proc.onEvent((notif) => {
      for (const msg of mapCodexAppServerEvent(notif, this.id)) push(msg);
      if (notif.method === "turn/completed" || notif.method === "process_exited") {
        finish();
      }
    });
    const unsubRequests = proc.onRequest((method, id, params) => {
      if (method === CMD_APPROVAL_METHOD || method === FILE_APPROVAL_METHOD) {
        const requestId = String(id);
        this.pendingApprovals.set(requestId, id);
        push(mapApprovalRequest(method, params, requestId));
      } else {
        // Unsupported server request — don't hang the turn.
        proc.respondError(id, `Unsupported request: ${method}`);
      }
    });

    try {
      const res = await proc.sendAndWait({
        method: "turn/start",
        params: {
          threadId: this.liveThreadId ?? this.id,
          input: [{ type: "text", text: effectivePrompt }],
          ...(this.config.reasoningEffort && { effort: this.config.reasoningEffort }),
        },
      });
      this.activeTurnId = ((res.turn as RpcMessage | undefined)?.id as string) ?? null;
    } catch (err) {
      unsubEvents();
      unsubRequests();
      yield {
        type: "error",
        error: `Codex rejected the turn: ${err instanceof Error ? err.message : String(err)}`,
        code: "codex_turn_rejected",
      };
      return;
    }
    this._firstQuerySent = true;

    try {
      while (!done || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          await new Promise<void>((r) => {
            resolve = r;
          });
          resolve = null;
        }
      }
    } finally {
      unsubEvents();
      unsubRequests();
      this.activeTurnId = null;
      // Drop any approvals left unanswered when the turn ended (e.g. interrupted
      // or the process exited) so the map doesn't accumulate stale entries.
      this.pendingApprovals.clear();
    }
  }

  /** thread/start params — OMIT approvalPolicy so Codex resolves the user's +
   *  enterprise-managed policy itself (the #971 fix); pin a read-only sandbox. */
  private threadStartParams(): RpcMessage {
    return {
      method: "thread/start",
      params: { model: this.config.model, cwd: this.config.cwd, sandbox: "read-only" },
    };
  }

  /** Ensure a live process + an active thread (start fresh or resume). */
  private async ensureThread(): Promise<void> {
    if (this.process?.alive && this.threadStarted) return;

    if (!this.process || !this.process.alive) {
      this.process = new CodexAppServerProcess();
      await this.process.start(this.config.codexExecutablePath, this.config.cwd);
      this.threadStarted = false;
    }
    if (this.threadStarted) return;

    if (this._resolvedId) {
      // Resume an existing thread (explicit resume, or after an idle restart).
      try {
        await this.process.sendAndWait({
          method: "thread/resume",
          params: { threadId: this._resolvedId },
        });
        this.liveThreadId = this._resolvedId;
      } catch {
        // The stored rollout is unavailable — start a fresh thread on the wire
        // but keep the client-facing session id stable (history is lost, but
        // the chat keeps working).
        const res = await this.process.sendAndWait(this.threadStartParams());
        this.liveThreadId =
          ((res.thread as RpcMessage | undefined)?.id as string) ?? this._resolvedId;
      }
    } else {
      const res = await this.process.sendAndWait(this.threadStartParams());
      const threadId = (res.thread as RpcMessage | undefined)?.id as string | undefined;
      if (threadId) {
        this.resolveId(threadId);
        this.liveThreadId = threadId;
      }
    }
    this.threadStarted = true;
  }

  respondToPermission(requestId: string, allow: boolean): void {
    const id = this.pendingApprovals.get(requestId);
    if (id === undefined || !this.process) return;
    this.pendingApprovals.delete(requestId);
    this.process.respond(id, { decision: allow ? "accept" : "decline" });
  }

  abort(): void {
    // Tear down the turn cleanly: cancel outstanding approvals so Codex doesn't
    // hang, interrupt the active turn, but keep the process alive (resumable).
    if (this.process) {
      for (const [, id] of this.pendingApprovals) {
        this.process.respond(id, { decision: "cancel" });
      }
      this.pendingApprovals.clear();
      const threadId = this.liveThreadId ?? this._resolvedId;
      if (this.activeTurnId && threadId) {
        this.process.send({
          method: "turn/interrupt",
          params: { threadId, turnId: this.activeTurnId },
        });
      }
    }
    super.abort();
  }

  /** Kill the process and release the session (idle timeout, evict, dispose). */
  dispose(): void {
    this.clearIdleTimer();
    this.process?.kill();
    this.process = null;
    this.threadStarted = false;
    this.pendingApprovals.clear();
    this.config.onClosed(this);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private scheduleIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      // Kill the idle process but keep the session resumable: the next query
      // re-spawns and `thread/resume`s the persisted thread id.
      this.process?.kill();
      this.process = null;
      this.threadStarted = false;
    }, IDLE_TIMEOUT_MS);
    // Don't keep the event loop alive solely for the idle timer.
    (this.idleTimer as { unref?: () => void })?.unref?.();
  }
}

// ---------------------------------------------------------------------------
// Factory registration (same name as the old SDK provider)
// ---------------------------------------------------------------------------

registerProviderFactory(
  PROVIDER_NAME,
  async (config) => new CodexAppServerProvider(config as CodexSDKConfig),
);
