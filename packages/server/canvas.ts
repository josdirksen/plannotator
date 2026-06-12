/**
 * Canvas Server
 *
 * Long-running server for the agent-connected HTML canvas (docs/canvas-spec.md).
 * Unlike the plan/review/annotate servers — which live for one decision — this
 * server is a machine-wide singleton: agents in any project directory POST
 * frames to it, the UI renders project-scoped boards, and dispatched feedback
 * streams back to agents over SSE (`plannotator canvas watch`).
 *
 * Discovery is via a registry file (~/.plannotator/canvas/server.json), not a
 * well-known port: the CLI reads it, health-checks, and auto-starts a detached
 * server when none is alive.
 */

import { unlinkSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isAbsolute } from "node:path";
import {
  getCanvasDir,
  getBoard,
  getOrCreateBoard,
  listBoards,
  createFrame,
  readFrameHtml,
  applyFramePatch,
  addComment,
  updateComment,
  deleteComment,
  dispatchFrameFeedback,
  dispatchCommentReply,
  addReply,
  closeFrame,
  closeBoard,
  arrangeBoard,
  readFeedbackEvents,
  deriveProjectIdentity,
  type CanvasFrame,
  type CanvasComment,
  type CanvasFeedbackEvent,
  type CanvasReplyRequestEvent,
  type CanvasWatchEvent,
} from "@plannotator/shared/canvas-store";
import { getServerHostname, isRemoteSession } from "./remote";
import { handleFavicon } from "./shared-handlers";

const DEFAULT_CANVAS_PORT = 19434;
const MAX_FRAME_HTML_BYTES = 5 * 1024 * 1024;
const PORT_RETRIES = 10;
const HEARTBEAT_MS = 30_000;

// ---------------------------------------------------------------------------
// Registry (singleton discovery)
// ---------------------------------------------------------------------------

export interface CanvasRegistry {
  port: number;
  pid: number;
  startedAt: number;
}

function registryPath(): string {
  return join(getCanvasDir(), "server.json");
}

export function readCanvasRegistry(): CanvasRegistry | null {
  try {
    const raw = readFileSync(registryPath(), "utf-8");
    const parsed = JSON.parse(raw) as CanvasRegistry;
    if (typeof parsed.port !== "number" || typeof parsed.pid !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCanvasRegistry(registry: CanvasRegistry): void {
  mkdirSync(getCanvasDir(), { recursive: true });
  writeFileSync(registryPath(), JSON.stringify(registry, null, 2), "utf-8");
}

function clearCanvasRegistry(ownPid: number): void {
  try {
    const current = readCanvasRegistry();
    // Only remove our own registration — a newer server may have replaced us.
    if (current && current.pid === ownPid) unlinkSync(registryPath());
  } catch {
    // best effort
  }
}

export function canvasServerUrl(port: number): string {
  return `http://${getServerHostname()}:${port}`;
}

/**
 * Find a live canvas server: read the registry and health-check it.
 * A stale registry (dead pid, port reused by something else) returns null.
 */
export async function findRunningCanvasServer(): Promise<{
  port: number;
  url: string;
} | null> {
  const registry = readCanvasRegistry();
  if (!registry) return null;
  const url = canvasServerUrl(registry.port);
  try {
    const res = await fetch(`${url}/api/canvas/health`, {
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; canvas?: boolean; pid?: number };
    if (!body.ok || !body.canvas) return null;
    // Stale-registry guard: the port may have been reused by a different
    // process (even another canvas server) — the answering pid must match
    // the registration.
    if (typeof body.pid === "number" && body.pid !== registry.pid) return null;
    return { port: registry.port, url };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SSE plumbing
// ---------------------------------------------------------------------------

/** A board mutation event broadcast to connected UIs. */
export interface CanvasBoardEvent {
  type:
    | "frame.created"
    | "frame.updated"
    | "comment.created"
    | "comment.updated"
    | "comment.deleted"
    | "feedback.dispatched"
    | "board.arranged"
    | "board.cleared";
  projectKey: string;
  /** Board seq after the mutation — clients resync on gaps. */
  seq: number;
  frame?: CanvasFrame;
  /** Frame ids archived by a board.cleared event. */
  frameIds?: string[];
  /** True when the frame's HTML changed (the iframe must reload). */
  htmlChanged?: boolean;
  comment?: CanvasComment;
  commentId?: string;
  /** Comment ids included in a feedback dispatch. */
  dispatchedCommentIds?: string[];
}

interface SSESubscriber {
  controller: ReadableStreamDefaultController;
  /** Feedback subscribers filter by project; board subscribers receive all. */
  projectKey?: string;
}

function sseChunk(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

function sseResponse(
  req: Request,
  register: (controller: ReadableStreamDefaultController) => () => void,
): Response {
  let cleanup: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let done = false;
  const teardown = () => {
    if (done) return;
    done = true;
    if (heartbeat) clearInterval(heartbeat);
    cleanup?.();
  };
  const stream = new ReadableStream({
    start(controller) {
      // Flush headers immediately — fetch() on the client doesn't resolve
      // until the first bytes arrive, and a feedback stream with no history
      // would otherwise deadlock the subscriber.
      controller.enqueue(new TextEncoder().encode(`: connected\n\n`));
      cleanup = register(controller);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(`: heartbeat\n\n`));
        } catch {
          teardown();
        }
      }, HEARTBEAT_MS);
    },
    cancel() {
      teardown();
    },
  });
  // Belt and braces: enqueueing into an abandoned stream buffers rather than
  // throwing, so cancel() is the only intrinsic disconnect signal — and on
  // abrupt TCP drops Bun's abort signal is the reliable one. Without this, a
  // long-running singleton leaks a subscriber + 30s interval per dead tab.
  req.signal.addEventListener("abort", teardown);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface CanvasServerOptions {
  /** Built single-file canvas UI. */
  htmlContent: string;
  /** Port override; defaults to PLANNOTATOR_CANVAS_PORT or 19434. */
  port?: number;
  /**
   * Exit the process after /api/canvas/shutdown (set by `canvas serve`).
   * Off by default so in-process embedders/tests aren't killed.
   */
  exitOnShutdown?: boolean;
}

export interface CanvasServerResult {
  port: number;
  url: string;
  stop: () => void;
  /** True when another healthy server was already registered — this call
   *  started nothing and `port`/`url` point at the existing server. */
  deferred?: boolean;
}

/**
 * Anti-DNS-rebinding guard. Unlike the short-lived plan/review servers on
 * random ports, the canvas server is long-running on a guessable fixed port —
 * exactly the profile drive-by/rebinding attacks target. A browser that was
 * rebound to 127.0.0.1 still sends the attacker's domain in Host, so
 * rejecting non-loopback Hosts closes the hole. Skipped in remote sessions,
 * where the server is intentionally reached via a non-loopback host.
 */
function isAllowedHost(req: Request): boolean {
  if (isRemoteSession()) return true;
  const host = req.headers.get("host") ?? "";
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

export async function startCanvasServer(
  options: CanvasServerOptions,
): Promise<CanvasServerResult> {
  const { htmlContent, exitOnShutdown = false } = options;
  const envPort = parseInt(process.env.PLANNOTATOR_CANVAS_PORT || "", 10);
  const basePort = options.port ?? (Number.isFinite(envPort) ? envPort : DEFAULT_CANVAS_PORT);

  const boardSubscribers = new Set<SSESubscriber>();
  const feedbackSubscribers = new Set<SSESubscriber>();

  function broadcastBoardEvent(event: CanvasBoardEvent): void {
    const chunk = sseChunk(event);
    for (const sub of boardSubscribers) {
      try {
        sub.controller.enqueue(chunk);
      } catch {
        boardSubscribers.delete(sub);
      }
    }
  }

  function broadcastFeedback(event: CanvasWatchEvent): void {
    const chunk = sseChunk(event);
    for (const sub of feedbackSubscribers) {
      if (sub.projectKey && sub.projectKey !== event.projectKey) continue;
      try {
        sub.controller.enqueue(chunk);
      } catch {
        feedbackSubscribers.delete(sub);
      }
    }
  }

  function emitDispatched(projectKey: string, events: CanvasFeedbackEvent[]): void {
    const board = getBoard(projectKey);
    for (const event of events) {
      broadcastFeedback(event);
      broadcastBoardEvent({
        type: "feedback.dispatched",
        projectKey,
        seq: board?.seq ?? 0,
        dispatchedCommentIds: event.comments.map((c) => c.id),
        ...(board ? { frame: board.frames.find((f) => f.id === event.frameId) } : {}),
      });
    }
  }

  /** Push the updated comment to the UI, and (if present) the reply-request to
   *  the agent watch stream. Shared by send-now and reply. */
  function emitReplyRequest(
    projectKey: string,
    commentId: string,
    event: CanvasReplyRequestEvent | null,
  ): void {
    const board = getBoard(projectKey);
    const comment = board?.comments.find((c) => c.id === commentId);
    if (board && comment) {
      broadcastBoardEvent({
        type: "comment.updated",
        projectKey,
        seq: board.seq,
        comment,
      });
    }
    if (event) broadcastFeedback(event);
  }

  /** Resolve the `project` query param (a projectKey) to a board, or 400/404. */
  function requireBoard(url: URL): { board: ReturnType<typeof getBoard> } | Response {
    const projectKey = url.searchParams.get("project");
    if (!projectKey) {
      return Response.json({ error: "Missing ?project parameter" }, { status: 400 });
    }
    const board = getBoard(projectKey);
    if (!board) return Response.json({ error: "Unknown project" }, { status: 404 });
    return { board };
  }

  let server: ReturnType<typeof Bun.serve> | null = null;
  let boundPort = basePort;
  let lastError: unknown;

  for (let attempt = 0; attempt <= PORT_RETRIES; attempt++) {
    const port = basePort + attempt;
    try {
      server = Bun.serve({
        hostname: getServerHostname(),
        port,
        // SSE connections are long-lived; disable Bun's idle timeout entirely.
        idleTimeout: 0,

        async fetch(req) {
          const url = new URL(req.url);

          if (!isAllowedHost(req)) {
            return Response.json({ error: "Forbidden host" }, { status: 403 });
          }

          // --- Health ---
          if (url.pathname === "/api/canvas/health" && req.method === "GET") {
            return Response.json({ ok: true, canvas: true, pid: process.pid });
          }

          // --- UI ---
          if (url.pathname === "/" || url.pathname === "/index.html") {
            return new Response(htmlContent, { headers: { "Content-Type": "text/html" } });
          }
          if (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico") {
            return handleFavicon();
          }

          // --- Projects ---
          if (url.pathname === "/api/canvas/projects" && req.method === "GET") {
            return Response.json({ projects: listBoards() });
          }

          // --- Board snapshot ---
          if (url.pathname === "/api/canvas/board" && req.method === "GET") {
            const resolved = requireBoard(url);
            if (resolved instanceof Response) return resolved;
            return Response.json({ board: resolved.board });
          }

          // --- Create frame ---
          if (url.pathname === "/api/canvas/frames" && req.method === "POST") {
            let body: {
              projectRoot?: string;
              html?: string;
              title?: string;
              sessionId?: string;
              groupHint?: string;
              sourcePath?: string;
              suggestedSize?: { width: number; height: number };
            };
            try {
              body = await req.json();
            } catch {
              return Response.json({ error: "Invalid JSON" }, { status: 400 });
            }
            if (!body.projectRoot || !isAbsolute(body.projectRoot)) {
              return Response.json(
                { error: "projectRoot must be an absolute path" },
                { status: 400 },
              );
            }
            if (typeof body.html !== "string" || !body.html.trim()) {
              return Response.json({ error: "html is required" }, { status: 400 });
            }
            if (Buffer.byteLength(body.html, "utf-8") > MAX_FRAME_HTML_BYTES) {
              return Response.json({ error: "html exceeds 5MB limit" }, { status: 413 });
            }

            const { board, frame } = createFrame(body.projectRoot, {
              html: body.html,
              title: body.title,
              sessionId: body.sessionId,
              groupHint: body.groupHint,
              sourcePath: body.sourcePath,
              suggestedSize: body.suggestedSize,
            });
            broadcastBoardEvent({
              type: "frame.created",
              projectKey: board.projectKey,
              seq: board.seq,
              frame,
            });
            return Response.json(
              {
                frameId: frame.id,
                projectKey: board.projectKey,
                url: `${canvasServerUrl(boundPort)}/?project=${encodeURIComponent(board.projectKey)}&frame=${encodeURIComponent(frame.id)}`,
              },
              { status: 201 },
            );
          }

          // --- Frame HTML ---
          // Returned as JSON (never text/html): frame content must only ever
          // execute inside the sandboxed srcdoc iframe, not on the app origin.
          const htmlMatch = url.pathname.match(/^\/api\/canvas\/frames\/([^/]+)\/html$/);
          if (htmlMatch && req.method === "GET") {
            const resolved = requireBoard(url);
            if (resolved instanceof Response) return resolved;
            const revParam = url.searchParams.get("rev");
            const parsedRev = revParam ? parseInt(revParam, 10) : NaN;
            const rev = Number.isFinite(parsedRev) ? parsedRev : undefined;
            const html = readFrameHtml(resolved.board!.projectKey, htmlMatch[1], rev);
            if (html === null) {
              return Response.json({ error: "Frame not found" }, { status: 404 });
            }
            const frame = resolved.board!.frames.find((f) => f.id === htmlMatch[1]);
            return Response.json({ html, revision: rev ?? frame?.revision ?? 1 });
          }

          // --- Frame comments ---
          const commentsMatch = url.pathname.match(/^\/api\/canvas\/frames\/([^/]+)\/comments$/);
          if (commentsMatch) {
            const resolved = requireBoard(url);
            if (resolved instanceof Response) return resolved;
            const board = resolved.board!;
            const frameId = commentsMatch[1];

            if (req.method === "GET") {
              return Response.json({
                comments: board.comments.filter((c) => c.frameId === frameId),
              });
            }
            if (req.method === "POST") {
              let body: { body?: string; author?: string; selection?: { originalText: string } };
              try {
                body = await req.json();
              } catch {
                return Response.json({ error: "Invalid JSON" }, { status: 400 });
              }
              if (typeof body.body !== "string" || !body.body.trim()) {
                return Response.json({ error: "body is required" }, { status: 400 });
              }
              const comment = addComment(board.projectKey, frameId, {
                body: body.body,
                author: body.author,
                selection: body.selection,
              });
              if (!comment) return Response.json({ error: "Frame not found" }, { status: 404 });
              const after = getBoard(board.projectKey)!;
              broadcastBoardEvent({
                type: "comment.created",
                projectKey: board.projectKey,
                seq: after.seq,
                comment,
              });
              return Response.json({ comment }, { status: 201 });
            }
          }

          // --- Frame close (archive + notify the agent as a no-op) ---
          const closeMatch = url.pathname.match(/^\/api\/canvas\/frames\/([^/]+)\/close$/);
          if (closeMatch && req.method === "POST") {
            const resolved = requireBoard(url);
            if (resolved instanceof Response) return resolved;
            const board = resolved.board!;
            const event = closeFrame(board.projectKey, closeMatch[1]);
            if (!event) return Response.json({ error: "Frame not found" }, { status: 404 });
            const after = getBoard(board.projectKey)!;
            // Board SSE: the frame is now archived (UI removes it).
            broadcastBoardEvent({
              type: "frame.updated",
              projectKey: board.projectKey,
              seq: after.seq,
              frame: after.frames.find((f) => f.id === closeMatch[1]),
            });
            // Watch stream: tell the agent it was closed.
            broadcastFeedback(event);
            return Response.json({ event });
          }

          // --- Frame dispatch ---
          const dispatchMatch = url.pathname.match(/^\/api\/canvas\/frames\/([^/]+)\/dispatch$/);
          if (dispatchMatch && req.method === "POST") {
            const resolved = requireBoard(url);
            if (resolved instanceof Response) return resolved;
            const board = resolved.board!;
            let commentIds: string[] | undefined;
            try {
              const body = (await req.json()) as { commentIds?: string[] };
              if (Array.isArray(body.commentIds)) commentIds = body.commentIds;
            } catch {
              // empty body is fine — dispatch all unresolved
            }
            const result = dispatchFrameFeedback(board.projectKey, dispatchMatch[1], commentIds);
            if (result === null) {
              return Response.json({ error: "Frame not found" }, { status: 404 });
            }
            if ("empty" in result) return Response.json({ empty: true });
            emitDispatched(board.projectKey, [result]);
            return Response.json({ event: result });
          }

          // --- Frame patch (html revision / geometry / meta) ---
          const frameMatch = url.pathname.match(/^\/api\/canvas\/frames\/([^/]+)$/);
          if (frameMatch && req.method === "PATCH") {
            const resolved = requireBoard(url);
            if (resolved instanceof Response) return resolved;
            const board = resolved.board!;
            const frameId = frameMatch[1];
            let body: {
              html?: string;
              x?: number;
              y?: number;
              width?: number;
              height?: number;
              title?: string;
              status?: "active" | "archived";
              sizedBy?: "auto" | "user";
            };
            try {
              body = await req.json();
            } catch {
              return Response.json({ error: "Invalid JSON" }, { status: 400 });
            }

            if (typeof body.html === "string") {
              if (Buffer.byteLength(body.html, "utf-8") > MAX_FRAME_HTML_BYTES) {
                return Response.json({ error: "html exceeds 5MB limit" }, { status: 413 });
              }
            }
            if (body.sizedBy !== undefined && body.sizedBy !== "auto" && body.sizedBy !== "user") {
              delete body.sizedBy;
            }

            // One store call → one commit → one SSE event, regardless of how
            // many fields the patch combines (multi-commit patches would trip
            // the client's seq-gap resync on every request).
            const patched = applyFramePatch(board.projectKey, frameId, body);
            if (!patched) return Response.json({ error: "Frame not found" }, { status: 404 });
            const after = getBoard(board.projectKey)!;
            if (patched.moved.length > 0) {
              // Auto-fit growth pushed neighbors down — many frames changed in
              // the one commit, so resync clients like Tidy does.
              broadcastBoardEvent({
                type: "board.arranged",
                projectKey: board.projectKey,
                seq: after.seq,
              });
            } else {
              broadcastBoardEvent({
                type: "frame.updated",
                projectKey: board.projectKey,
                seq: after.seq,
                frame: patched.frame,
                htmlChanged: patched.htmlChanged,
              });
            }
            return Response.json({ frame: patched.frame });
          }

          // --- Comment patch/delete ---
          // --- Send a comment "now" (reply intent — no dots, expects a reply) ---
          const sendNowMatch = url.pathname.match(/^\/api\/canvas\/comments\/([^/]+)\/send-now$/);
          if (sendNowMatch && req.method === "POST") {
            const resolved = requireBoard(url);
            if (resolved instanceof Response) return resolved;
            const board = resolved.board!;
            const result = dispatchCommentReply(board.projectKey, sendNowMatch[1]);
            if (result === null) return Response.json({ error: "Comment not found" }, { status: 404 });
            if ("empty" in result) return Response.json({ empty: true });
            emitReplyRequest(board.projectKey, sendNowMatch[1], result);
            return Response.json({ event: result });
          }

          // --- Reply to a comment (agent via CLI, or user follow-up via UI) ---
          const replyMatch = url.pathname.match(/^\/api\/canvas\/comments\/([^/]+)\/reply$/);
          if (replyMatch && req.method === "POST") {
            const resolved = requireBoard(url);
            if (resolved instanceof Response) return resolved;
            const board = resolved.board!;
            let body: { author?: string; body?: string; fromAgent?: boolean };
            try {
              body = await req.json();
            } catch {
              return Response.json({ error: "Invalid JSON" }, { status: 400 });
            }
            if (typeof body.body !== "string" || !body.body.trim()) {
              return Response.json({ error: "body is required" }, { status: 400 });
            }
            const result = addReply(board.projectKey, replyMatch[1], {
              author: body.author ?? "",
              body: body.body,
              fromAgent: body.fromAgent === true,
            });
            if (!result) return Response.json({ error: "Comment not found" }, { status: 404 });
            emitReplyRequest(board.projectKey, replyMatch[1], result.event ?? null);
            return Response.json({ comment: result.comment });
          }

          const commentMatch = url.pathname.match(/^\/api\/canvas\/comments\/([^/]+)$/);
          if (commentMatch) {
            const resolved = requireBoard(url);
            if (resolved instanceof Response) return resolved;
            const board = resolved.board!;
            const commentId = commentMatch[1];

            if (req.method === "PATCH") {
              let body: { body?: string; resolved?: boolean };
              try {
                body = await req.json();
              } catch {
                return Response.json({ error: "Invalid JSON" }, { status: 400 });
              }
              const comment = updateComment(board.projectKey, commentId, body);
              if (!comment) return Response.json({ error: "Not found" }, { status: 404 });
              const after = getBoard(board.projectKey)!;
              broadcastBoardEvent({
                type: "comment.updated",
                projectKey: board.projectKey,
                seq: after.seq,
                comment,
              });
              return Response.json({ comment });
            }
            if (req.method === "DELETE") {
              const ok = deleteComment(board.projectKey, commentId);
              if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
              const after = getBoard(board.projectKey)!;
              broadcastBoardEvent({
                type: "comment.deleted",
                projectKey: board.projectKey,
                seq: after.seq,
                commentId,
              });
              return Response.json({ ok: true });
            }
          }

          // --- Board arrange (Tidy: reflow all frames into a grid) ---
          const arrangeMatch = url.pathname.match(/^\/api\/canvas\/projects\/([^/]+)\/arrange$/);
          if (arrangeMatch && req.method === "POST") {
            const projectKey = arrangeMatch[1];
            const board = arrangeBoard(projectKey);
            if (!board) return Response.json({ error: "Unknown project" }, { status: 404 });
            // One commit moved many frames — tell other clients to resync.
            broadcastBoardEvent({ type: "board.arranged", projectKey, seq: board.seq });
            return Response.json({ board });
          }

          // --- Board close (Clear: archive every active frame at once) ---
          const closeBoardMatch = url.pathname.match(/^\/api\/canvas\/projects\/([^/]+)\/close$/);
          if (closeBoardMatch && req.method === "POST") {
            const projectKey = closeBoardMatch[1];
            const events = closeBoard(projectKey);
            const after = getBoard(projectKey);
            // Board SSE: one event clears the lot so other UIs drop the frames.
            broadcastBoardEvent({
              type: "board.cleared",
              projectKey,
              seq: after?.seq ?? 0,
              frameIds: events.map((e) => e.frameId),
            });
            // Watch stream: notify the agent per frame (no-op informational).
            for (const event of events) broadcastFeedback(event);
            return Response.json({ closed: events.length });
          }

          // --- Board-wide dispatch ---
          const boardDispatchMatch = url.pathname.match(
            /^\/api\/canvas\/projects\/([^/]+)\/dispatch$/,
          );
          if (boardDispatchMatch && req.method === "POST") {
            const projectKey = boardDispatchMatch[1];
            const board = getBoard(projectKey);
            if (!board) {
              return Response.json({ error: "Unknown project" }, { status: 404 });
            }
            // Dispatch and broadcast frame by frame so each event carries the
            // seq of its own commit (a batch stamped with the final seq would
            // resync-then-drop on the client).
            const frameIds = new Set(
              board.comments.filter((c) => !c.dispatchedAt && !c.resolved).map((c) => c.frameId),
            );
            const events: CanvasFeedbackEvent[] = [];
            for (const id of frameIds) {
              const result = dispatchFrameFeedback(projectKey, id);
              if (result && !("empty" in result)) {
                events.push(result);
                emitDispatched(projectKey, [result]);
              }
            }
            return Response.json({ events });
          }

          // --- Feedback snapshot (pull) ---
          if (url.pathname === "/api/canvas/feedback" && req.method === "GET") {
            const projectKey = resolveProjectParam(url);
            if (!projectKey) {
              return Response.json({ error: "Missing ?project or ?root" }, { status: 400 });
            }
            const since = url.searchParams.get("since") ?? undefined;
            return Response.json({ events: readFeedbackEvents(projectKey, since) });
          }

          // --- UI board-event stream ---
          if (url.pathname === "/api/canvas/stream" && req.method === "GET") {
            return sseResponse(req, (controller) => {
              const sub: SSESubscriber = { controller };
              boardSubscribers.add(sub);
              controller.enqueue(sseChunk({ type: "hello" }));
              return () => boardSubscribers.delete(sub);
            });
          }

          // --- Agent feedback stream (canvas watch) ---
          if (url.pathname === "/api/canvas/feedback/stream" && req.method === "GET") {
            const projectKey = resolveProjectParam(url);
            if (!projectKey) {
              return Response.json({ error: "Missing ?project or ?root" }, { status: 400 });
            }
            const since = url.searchParams.get("since") ?? undefined;
            return sseResponse(req, (controller) => {
              // Replay missed events first, then go live.
              for (const event of readFeedbackEvents(projectKey, since)) {
                controller.enqueue(sseChunk(event));
              }
              const sub: SSESubscriber = { controller, projectKey };
              feedbackSubscribers.add(sub);
              return () => feedbackSubscribers.delete(sub);
            });
          }

          // --- Ensure a board exists for a root (used by `canvas` open + watch) ---
          if (url.pathname === "/api/canvas/projects" && req.method === "POST") {
            let body: { root?: string };
            try {
              body = await req.json();
            } catch {
              return Response.json({ error: "Invalid JSON" }, { status: 400 });
            }
            if (!body.root || !isAbsolute(body.root)) {
              return Response.json({ error: "root must be an absolute path" }, { status: 400 });
            }
            const board = getOrCreateBoard(body.root);
            return Response.json({
              projectKey: board.projectKey,
              projectName: board.projectName,
            });
          }

          // --- Shutdown ---
          if (url.pathname === "/api/canvas/shutdown" && req.method === "POST") {
            // stop() alone leaves the process alive until the event loop
            // drains (any surviving heartbeat interval = portless zombie);
            // the real `canvas serve` process must exit outright.
            setTimeout(() => {
              stop();
              if (exitOnShutdown) process.exit(0);
            }, 50);
            return Response.json({ ok: true });
          }

          return new Response("Not found", { status: 404 });
        },
      });
      boundPort = server.port ?? port;
      break;
    } catch (err) {
      lastError = err;
      server = null;
    }
  }

  if (!server) {
    throw new Error(
      `Failed to start canvas server: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  // Cold-start race guard: two `canvas add` invocations can both spawn a
  // server; the loser of the port race would land on basePort+1 and silently
  // overwrite the winner's registration — a permanent split-brain with two
  // live servers sharing the same boards. If a different healthy server is
  // already registered, defer to it instead of overwriting.
  const existing = await findRunningCanvasServer();
  if (existing && existing.port !== boundPort) {
    server.stop(true);
    return { port: existing.port, url: existing.url, stop: () => {}, deferred: true };
  }

  writeCanvasRegistry({ port: boundPort, pid: process.pid, startedAt: Date.now() });

  // Both racers can pass the pre-check before either writes; verify our
  // registration stuck after a short settle, and defer if we were overwritten.
  await new Promise((r) => setTimeout(r, 150));
  const settled = readCanvasRegistry();
  if (settled && settled.pid !== process.pid) {
    const winner = await findRunningCanvasServer();
    if (winner && winner.port !== boundPort) {
      server.stop(true);
      return { port: winner.port, url: winner.url, stop: () => {}, deferred: true };
    }
    // Registered server is dead/unhealthy — reclaim the registration.
    writeCanvasRegistry({ port: boundPort, pid: process.pid, startedAt: Date.now() });
  }

  const stop = () => {
    clearCanvasRegistry(process.pid);
    server!.stop(true);
  };

  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stop();
    process.exit(0);
  });

  return { port: boundPort, url: canvasServerUrl(boundPort), stop };
}

/** Resolve ?project=<key> or ?root=<absolute path> to a projectKey. */
function resolveProjectParam(url: URL): string | null {
  const projectKey = url.searchParams.get("project");
  if (projectKey) return projectKey;
  const root = url.searchParams.get("root");
  if (root && isAbsolute(root)) return deriveProjectIdentity(root).projectKey;
  return null;
}
