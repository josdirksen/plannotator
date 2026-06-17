import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_TERMINAL_WS_PATH,
  type AgentTerminalAgent,
  type AgentTerminalCapability,
} from "@plannotator/shared/agent-terminal";
import { getPlannotatorDataDir } from "@plannotator/shared/data-dir";

// Bun's compiled binary exposes bundled files under /$bunfs, which Node cannot
// execute as a child process. Keep the sidecar source embedded so compiled
// binaries can materialize it to a real path before spawning Node.
// @ts-ignore - Bun import attribute for text
import nodeAgentTerminalSidecarSource from "./agent-terminal-node-sidecar.mjs" with { type: "text" };

type AgentTerminalSocketData = {
  upstream: WebSocket | null;
  pending: string[];
};

type WebTuiCore = typeof import("webtui/core");

type NodeAgentTerminalSidecar = {
  wsUrl: string;
  dispose(): void;
};

export type BunAgentTerminalBridge = {
  capability: AgentTerminalCapability;
  upgrade(req: Request, server: Bun.Server<AgentTerminalSocketData>): boolean;
  websocket: Bun.WebSocketHandler<AgentTerminalSocketData>;
  dispose(): void;
};

export async function createBunAgentTerminalBridge(args: {
  enabled: boolean;
  cwd: string;
}): Promise<BunAgentTerminalBridge> {
  if (!args.enabled) {
    return createDisabledBridge({
      enabled: false,
      reason: "not-annotate-mode",
    });
  }

  let core: WebTuiCore;
  try {
    core = await import("webtui/core");
  } catch (err) {
    return createDisabledBridge({
      enabled: false,
      reason: "webtui-unavailable",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const nodePath = Bun.which("node");
  if (!nodePath) {
    return createDisabledBridge({
      enabled: false,
      reason: "pty-unavailable",
      message: "Node.js is required for the annotate agent terminal.",
    });
  }
  const resolvedNodePath = nodePath;

  const upstreams = new Set<WebSocket>();
  let disposed = false;
  let sidecar: NodeAgentTerminalSidecar | null = null;
  let sidecarPromise: Promise<NodeAgentTerminalSidecar> | null = null;
  const capability: AgentTerminalCapability = {
    enabled: true,
    cwd: args.cwd,
    wsPath: AGENT_TERMINAL_WS_PATH,
    agents: listAgents(core),
  };

  return {
    capability,
    upgrade(req, server) {
      return server.upgrade(req, {
        data: { upstream: null, pending: [] },
      });
    },
    websocket: {
      open(ws) {
        void getSidecar().then((activeSidecar) => {
          if (disposed || ws.readyState !== WebSocket.OPEN) return;
          const upstream = new WebSocket(activeSidecar.wsUrl);
          ws.data.upstream = upstream;
          upstreams.add(upstream);

          upstream.addEventListener("open", () => {
            const queued = ws.data.pending;
            ws.data.pending = [];
            for (const payload of queued) upstream.send(payload);
          });

          upstream.addEventListener("message", (event) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(toWebSocketPayload(event.data));
            }
          });

          upstream.addEventListener("close", () => {
            upstreams.delete(upstream);
            if (ws.readyState === WebSocket.OPEN) ws.close();
          });

          upstream.addEventListener("error", () => {
            upstreams.delete(upstream);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "error", message: "Agent terminal backend failed." }));
              ws.close();
            }
          });
        }).catch((err) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "error",
              message: err instanceof Error ? err.message : String(err),
            }));
            ws.close();
          }
        });
      },
      message(ws, raw) {
        const payload = typeof raw === "string" ? raw : raw.toString("utf8");
        const upstream = ws.data.upstream;
        if (upstream?.readyState === WebSocket.OPEN) {
          upstream.send(payload);
          return;
        }
        ws.data.pending.push(payload);
      },
      close(ws) {
        ws.data.pending = [];
        const upstream = ws.data.upstream;
        ws.data.upstream = null;
        if (upstream) {
          upstreams.delete(upstream);
          upstream.close();
        }
      },
    },
    dispose() {
      disposed = true;
      for (const upstream of upstreams) upstream.close();
      upstreams.clear();
      sidecar?.dispose();
      void sidecarPromise?.then((activeSidecar) => activeSidecar.dispose()).catch(() => {});
    },
  };

  function getSidecar(): Promise<NodeAgentTerminalSidecar> {
    if (sidecar) return Promise.resolve(sidecar);
    sidecarPromise ??= startNodeAgentTerminalSidecar(args.cwd, resolvedNodePath).then((activeSidecar) => {
      if (disposed) {
        activeSidecar.dispose();
        throw new Error("Agent terminal bridge was disposed.");
      }
      sidecar = activeSidecar;
      return activeSidecar;
    }).catch((err) => {
      sidecarPromise = null;
      throw err;
    });
    return sidecarPromise;
  }
}

function createDisabledBridge(
  capability: AgentTerminalCapability,
): BunAgentTerminalBridge {
  return {
    capability,
    upgrade() {
      return false;
    },
    websocket: {
      message() {},
    },
    dispose() {},
  };
}

async function startNodeAgentTerminalSidecar(
  cwd: string,
  nodePath: string,
): Promise<NodeAgentTerminalSidecar> {
  const sidecarPath = resolveNodeAgentTerminalSidecarPath();
  const proc = Bun.spawn([nodePath, sidecarPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PLANNOTATOR_AGENT_CWD: cwd,
      PLANNOTATOR_AGENT_WS_PATH: AGENT_TERMINAL_WS_PATH,
      PLANNOTATOR_AGENT_WEBTUI_CORE_URL: resolveImportUrl("webtui/core"),
      PLANNOTATOR_AGENT_WEBTUI_SERVER_URL: resolveImportUrl("webtui/server"),
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });

  try {
    const line = await withTimeout(readFirstLine(proc.stdout), 5_000);
    const ready = JSON.parse(line) as { ok?: boolean; wsUrl?: string; error?: string };
    if (!ready.ok || !ready.wsUrl) {
      throw new Error(ready.error ?? "Agent terminal sidecar did not report a WebSocket URL.");
    }
    return {
      wsUrl: ready.wsUrl,
      dispose() {
        proc.kill();
      },
    };
  } catch (err) {
    proc.kill();
    throw err;
  }
}

function resolveNodeAgentTerminalSidecarPath(): string {
  const bundledPath = fileURLToPath(new URL("./agent-terminal-node-sidecar.mjs", import.meta.url));
  if (!isBunVirtualPath(bundledPath)) return bundledPath;

  const sidecarDir = join(getPlannotatorDataDir(), "agent-terminal");
  const sidecarPath = join(sidecarDir, "agent-terminal-node-sidecar.mjs");
  mkdirSync(sidecarDir, { recursive: true });
  writeFileSync(sidecarPath, nodeAgentTerminalSidecarSource, "utf8");
  return sidecarPath;
}

function isBunVirtualPath(path: string): boolean {
  return path.startsWith("/$bunfs/") || path.includes("\\$bunfs\\");
}

function resolveImportUrl(specifier: string): string {
  try {
    return import.meta.resolve(specifier);
  } catch {
    return specifier;
  }
}

async function readFirstLine(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) throw new Error("Agent terminal sidecar stdout was unavailable.");
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const newline = text.indexOf("\n");
      if (newline !== -1) return text.slice(0, newline).trim();
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error("Agent terminal sidecar exited before reporting ready.");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Agent terminal sidecar timed out.")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function toWebSocketPayload(data: unknown): string | ArrayBuffer {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return data;
  if (Buffer.isBuffer(data)) {
    return Uint8Array.from(data).buffer;
  }
  if (data instanceof Uint8Array) {
    return data.buffer instanceof ArrayBuffer
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : Uint8Array.from(data).buffer;
  }
  return String(data);
}

function listAgents(core: WebTuiCore): AgentTerminalAgent[] {
  return core.listBuiltInAgents().map((id) => {
    const config = core.BUILT_IN_AGENTS[id];
    return {
      id,
      name: formatAgentName(id),
      available: !!Bun.which(config.detectCommand),
    };
  });
}

function formatAgentName(id: string): string {
  const overrides: Record<string, string> = {
    amp: "Amp",
    claude: "Claude",
    codex: "Codex",
    copilot: "GitHub Copilot",
    gemini: "Gemini",
    opencode: "OpenCode",
    pi: "Pi",
  };
  if (overrides[id]) return overrides[id];
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
