/**
 * Canvas CLI (`plannotator canvas …`)
 *
 * Agent-facing entrypoints for the long-running canvas server
 * (docs/canvas-spec.md). All commands are HTTP clients of the singleton
 * server; the only command that *is* the server is `canvas serve`, which
 * the others auto-start detached when no healthy server is registered.
 *
 *   plannotator canvas                       open this project's board
 *   plannotator canvas open                  open (or print) the live board URL
 *   plannotator canvas add <file|-> [flags]  publish an HTML frame
 *   plannotator canvas update <id> <file|->  push a new revision
 *   plannotator canvas watch [--json]        stream feedback (agents background this)
 *   plannotator canvas feedback [--since T]  pull dispatched feedback
 *   plannotator canvas list                  list this project's frames
 *   plannotator canvas serve                 run the server in the foreground
 *   plannotator canvas stop                  stop the server
 *
 * stdout carries machine-readable payloads; status goes to stderr.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  startCanvasServer,
  findRunningCanvasServer,
} from "@plannotator/server/canvas";
import { openBrowser } from "@plannotator/server/browser";
import { deriveProjectIdentity, type CanvasWatchEvent, type CanvasFrame } from "@plannotator/shared/canvas-store";

const SERVER_START_TIMEOUT_MS = 8000;
const MAX_FRAME_HTML_BYTES = 5 * 1024 * 1024;

function projectRoot(): string {
  return resolve(process.env.PLANNOTATOR_CWD || process.cwd());
}

function browserOpenSuppressed(): boolean {
  return process.env.PLANNOTATOR_SKIP_BROWSER_OPEN === "1";
}

function usage(): void {
  console.error(
    [
      "Usage: plannotator canvas [command]",
      "",
      "  (no command)                     Open this project's board in the browser",
      "  open [--no-open]                 Open the board and print its URL (--no-open: just print)",
      "  add <file.html|-> [options]      Publish an HTML frame to this project's board",
      "      --title <title>              Frame title shown in its chrome",
      "      --session <id>               Opaque session id for provenance/clustering",
      "      --group <hint>               Cluster placement near frames with the same hint",
      "      --size <WxH>                 Suggested frame size in canvas px (e.g. 800x600)",
      "      --single-doc                 This is the only doc — open it full-screen",
      "      --no-open                    Don't open the browser on server cold start",
      "  update <frameId> <file.html|->   Publish a new revision (position preserved)",
      '  reply <commentId> --as <name> <msg>  Reply to a comment thread (msg, or - for stdin)',
      "  watch [--json] [--since <ISO>]   Stream feedback + reply requests for this project",
      "  feedback [--json] [--since <ISO>]  Pull dispatched feedback once",
      "  list [--json]                    List this project's frames",
      "  serve                            Run the canvas server in the foreground",
      "  stop                             Stop the canvas server",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

/** Resolve how to re-invoke this CLI (compiled binary vs `bun <script>`). */
function selfCommand(): { cmd: string; baseArgs: string[] } {
  const scriptPath = process.argv[1] ?? "";
  // Compiled Bun executables run from an embedded virtual filesystem.
  const isCompiled =
    scriptPath === "" || scriptPath.includes("$bunfs") || scriptPath.includes("~BUN");
  return isCompiled
    ? { cmd: process.execPath, baseArgs: [] }
    : { cmd: process.execPath, baseArgs: [scriptPath] };
}

/**
 * Find the running canvas server, or spawn one detached and wait for it to
 * become healthy. Returns the server URL plus whether this call started it.
 *
 * `allowSpawn: false` polls without ever spawning — used by `watch`'s
 * reconnect loop so a deliberate `canvas stop` isn't resurrected, and a
 * persistently failing startup doesn't fork a child every few seconds.
 */
async function ensureServer(
  options: { allowSpawn?: boolean } = {},
): Promise<{ url: string; coldStart: boolean }> {
  const allowSpawn = options.allowSpawn ?? true;
  const running = await findRunningCanvasServer();
  if (running) return { url: running.url, coldStart: false };
  if (!allowSpawn) {
    throw new Error("No canvas server running");
  }

  const { cmd, baseArgs } = selfCommand();
  const child = spawn(cmd, [...baseArgs, "canvas", "serve"], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    const found = await findRunningCanvasServer();
    if (found) return { url: found.url, coldStart: true };
  }
  throw new Error("Canvas server failed to start (timed out waiting for health check)");
}

async function ensureBoard(serverUrl: string): Promise<{ projectKey: string; projectName: string }> {
  const res = await fetch(`${serverUrl}/api/canvas/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root: projectRoot() }),
  });
  if (!res.ok) throw new Error(`Failed to register project (${res.status})`);
  return (await res.json()) as { projectKey: string; projectName: string };
}

function boardUrl(
  serverUrl: string,
  projectKey: string,
  frameId?: string,
  single?: boolean,
): string {
  const frame = frameId ? `&frame=${encodeURIComponent(frameId)}` : "";
  // `single=1` asks the browser to open this lone frame in full (focus) mode.
  // The browser still guards on the board truly having only this one frame.
  const s = single ? "&single=1" : "";
  return `${serverUrl}/?project=${encodeURIComponent(projectKey)}${frame}${s}`;
}

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

async function readHtmlInput(fileArg: string): Promise<{ html: string; sourcePath?: string }> {
  let html: string;
  let sourcePath: string | undefined;
  if (fileArg === "-") {
    html = await Bun.stdin.text();
    if (!html.trim()) throw new Error("No HTML received on stdin");
  } else {
    sourcePath = resolve(projectRoot(), fileArg);
    try {
      html = readFileSync(sourcePath, "utf-8");
    } catch {
      throw new Error(`Cannot read file: ${sourcePath}`);
    }
  }
  if (Buffer.byteLength(html, "utf-8") > MAX_FRAME_HTML_BYTES) {
    throw new Error("HTML exceeds the 5MB frame limit");
  }
  return { html, sourcePath };
}

function validateSince(since: string | undefined): string | undefined {
  if (since === undefined) return undefined;
  if (Number.isNaN(Date.parse(since))) {
    console.error(`Invalid --since value "${since}" — expected an ISO-8601 timestamp (e.g. 2026-06-10T12:00:00Z)`);
    process.exit(1);
  }
  return since;
}

function takeFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  args.splice(idx, value !== undefined && !value.startsWith("--") ? 2 : 1);
  return value && !value.startsWith("--") ? value : undefined;
}

function takeBoolFlag(args: string[], flag: string): boolean {
  const idx = args.indexOf(flag);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

function parseSize(value?: string): { width: number; height: number } | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d+)x(\d+)$/i);
  if (!match) return undefined;
  return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
}

// ---------------------------------------------------------------------------
// Feedback stream (SSE client)
// ---------------------------------------------------------------------------

async function streamFeedback(
  serverUrl: string,
  since: string | undefined,
  onEvent: (event: CanvasWatchEvent) => void,
): Promise<void> {
  const params = new URLSearchParams({ root: projectRoot() });
  if (since) params.set("since", since);
  const res = await fetch(`${serverUrl}/api/canvas/feedback/stream?${params}`);
  if (!res.ok || !res.body) throw new Error(`Feedback stream failed (${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6)) as CanvasWatchEvent;
          if (
            event?.event === "frame.feedback" ||
            event?.event === "frame.closed" ||
            event?.event === "comment.reply_request"
          ) {
            onEvent(event);
          }
        } catch {
          // skip malformed event
        }
      }
    }
  }
}

function printFeedbackEvent(event: CanvasWatchEvent, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(event));
  } else {
    console.log(event.feedbackMarkdown.trimEnd());
    console.log("\n---\n");
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runCanvasCommand(args: string[], htmlContent: string): Promise<void> {
  const sub = args[0];

  // --- serve (the server process itself) ---
  if (sub === "serve") {
    const existing = await findRunningCanvasServer();
    if (existing) {
      console.error(`Canvas server already running at ${existing.url}`);
      process.exit(0);
    }
    const server = await startCanvasServer({ htmlContent, exitOnShutdown: true });
    if (server.deferred) {
      console.error(`Canvas server already running at ${server.url}`);
      process.exit(0);
    }
    console.error(`Canvas server running at ${server.url}`);
    return; // Bun.serve keeps the process alive
  }

  // --- stop ---
  if (sub === "stop") {
    const running = await findRunningCanvasServer();
    if (!running) {
      console.error("No canvas server running.");
      process.exit(0);
    }
    await fetch(`${running.url}/api/canvas/shutdown`, { method: "POST" }).catch(() => {});
    console.error("Canvas server stopped.");
    process.exit(0);
  }

  // --- open board (no subcommand, or explicit `open`) ---
  // The explicit `open` verb exists so a user who closed the tab can get back
  // to the live board without hunting for the port. It reuses the running
  // server (cold-starts one only if none is up) and always prints the board URL
  // to stdout so it's easy to copy/script; `--no-open` prints without launching
  // a browser.
  if (sub === undefined || sub === "open") {
    const rest = args.slice(1);
    const printOnly = takeBoolFlag(rest, "--no-open");
    const { url } = await ensureServer();
    const { projectKey, projectName } = await ensureBoard(url);
    const target = boardUrl(url, projectKey);
    if (!printOnly && !browserOpenSuppressed()) {
      console.error(`Opening canvas for ${projectName}: ${target}`);
      await openBrowser(target, { isRemote: false, useGlimpse: false });
    } else {
      console.error(`Canvas for ${projectName}:`);
    }
    console.log(target); // stdout: the board URL (copy / script / reopen)
    process.exit(0);
  }

  // --- add ---
  if (sub === "add") {
    const rest = args.slice(1);
    const title = takeFlag(rest, "--title");
    const sessionId = takeFlag(rest, "--session");
    const groupHint = takeFlag(rest, "--group");
    const suggestedSize = parseSize(takeFlag(rest, "--size"));
    const noOpen = takeBoolFlag(rest, "--no-open");
    // --single-doc: this is the only doc the agent intends to publish, so open
    // it full-screen (focus mode). The browser guards on the board truly having
    // just this one frame, so it never hijacks an existing multi-frame board.
    const singleDoc = takeBoolFlag(rest, "--single-doc");
    const fileArg = rest[0];
    if (!fileArg) {
      console.error("Usage: plannotator canvas add <file.html|-> [--title T] [--session ID] [--group G] [--size WxH] [--single-doc]");
      process.exit(1);
    }

    const { html, sourcePath } = await readHtmlInput(fileArg);
    const { url, coldStart } = await ensureServer();
    const res = await fetch(`${url}/api/canvas/frames`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectRoot: projectRoot(),
        html,
        title,
        sessionId,
        groupHint,
        sourcePath,
        suggestedSize,
      }),
    });
    const body = (await res.json()) as { frameId?: string; projectKey?: string; url?: string; error?: string };
    if (!res.ok || !body.frameId) {
      console.error(`Failed to add frame: ${body.error ?? res.status}`);
      process.exit(1);
    }

    if (coldStart && !noOpen && !browserOpenSuppressed()) {
      await openBrowser(boardUrl(url, body.projectKey!, body.frameId, singleDoc), {
        isRemote: false,
        useGlimpse: false,
      });
    }
    const deepLink = singleDoc && body.url ? `${body.url}&single=1` : body.url;
    console.log(JSON.stringify({ frameId: body.frameId, projectKey: body.projectKey, url: deepLink }));
    process.exit(0);
  }

  // --- reply (agent replies to a comment in its thread) ---
  if (sub === "reply") {
    const rest = args.slice(1);
    const author = takeFlag(rest, "--as");
    const commentId = rest[0];
    // Body: remaining args joined, or stdin via `-`.
    let text = rest.slice(1).join(" ");
    if (!commentId) {
      console.error('Usage: plannotator canvas reply <commentId> --as "<name>" "<message>"   (or - for stdin)');
      process.exit(1);
    }
    if (text === "-" || (!text && rest[1] === undefined)) {
      text = (await Bun.stdin.text()).trim();
    }
    if (!text.trim()) {
      console.error("Reply message is required (as an argument or on stdin).");
      process.exit(1);
    }
    const { url } = await ensureServer({ allowSpawn: false }).catch(() => ({ url: "" }));
    if (!url) {
      console.error("No canvas server running — nothing to reply to.");
      process.exit(1);
    }
    const { projectKey } = deriveProjectIdentity(projectRoot());
    const res = await fetch(
      `${url}/api/canvas/comments/${encodeURIComponent(commentId)}/reply?project=${encodeURIComponent(projectKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: author ?? "agent", body: text, fromAgent: true }),
      },
    );
    const body = (await res.json()) as { comment?: { id: string }; error?: string };
    if (!res.ok || !body.comment) {
      console.error(`Failed to reply: ${body.error ?? res.status}`);
      process.exit(1);
    }
    console.log(JSON.stringify({ commentId: body.comment.id, replied: true }));
    process.exit(0);
  }

  // --- update ---
  if (sub === "update") {
    const frameId = args[1];
    const fileArg = args[2];
    if (!frameId || !fileArg) {
      console.error("Usage: plannotator canvas update <frameId> <file.html|->");
      process.exit(1);
    }
    const { html } = await readHtmlInput(fileArg);
    const { url } = await ensureServer();
    const { projectKey } = deriveProjectIdentity(projectRoot());
    const res = await fetch(
      `${url}/api/canvas/frames/${encodeURIComponent(frameId)}?project=${encodeURIComponent(projectKey)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html }),
      },
    );
    const body = (await res.json()) as { frame?: CanvasFrame; error?: string };
    if (!res.ok || !body.frame) {
      console.error(`Failed to update frame: ${body.error ?? res.status}`);
      process.exit(1);
    }
    console.log(JSON.stringify({ frameId: body.frame.id, revision: body.frame.revision }));
    process.exit(0);
  }

  // --- watch ---
  if (sub === "watch") {
    const rest = args.slice(1);
    const json = takeBoolFlag(rest, "--json");
    let since = validateSince(takeFlag(rest, "--since"));
    console.error(`Watching for canvas feedback in ${projectRoot()} (Ctrl-C to stop)…`);

    // Reconnect loop: survives server restarts; `since` advances with each
    // event so replays never duplicate output (dispatch timestamps are
    // strictly monotonic). Only the first connection may spawn the server —
    // reconnects poll, so `canvas stop` isn't resurrected and a broken
    // startup doesn't fork children forever.
    let firstConnect = true;
    while (true) {
      try {
        const { url } = await ensureServer({ allowSpawn: firstConnect });
        firstConnect = false;
        await ensureBoard(url);
        await streamFeedback(url, since, (event) => {
          since = event.dispatchedAt;
          printFeedbackEvent(event, json);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message !== "No canvas server running") {
          console.error(`Feedback stream interrupted (${message}); reconnecting…`);
        }
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // --- feedback (pull) ---
  if (sub === "feedback") {
    const rest = args.slice(1);
    const json = takeBoolFlag(rest, "--json");
    const since = validateSince(takeFlag(rest, "--since"));
    const { url } = await ensureServer();
    const params = new URLSearchParams({ root: projectRoot() });
    if (since) params.set("since", since);
    const res = await fetch(`${url}/api/canvas/feedback?${params}`);
    const body = (await res.json()) as { events?: CanvasWatchEvent[] };
    const events = body.events ?? [];
    if (events.length === 0) {
      console.error("No feedback events.");
      process.exit(0);
    }
    for (const event of events) printFeedbackEvent(event, json);
    process.exit(0);
  }

  // --- list ---
  if (sub === "list") {
    const json = args.includes("--json");
    const { url } = await ensureServer();
    const { projectKey } = deriveProjectIdentity(projectRoot());
    const res = await fetch(`${url}/api/canvas/board?project=${encodeURIComponent(projectKey)}`);
    if (res.status === 404) {
      console.error("No canvas board for this project yet. Add a frame with: plannotator canvas add <file.html>");
      process.exit(0);
    }
    const body = (await res.json()) as {
      board?: { frames: CanvasFrame[]; comments: { frameId: string; resolved: boolean; dispatchedAt?: number }[] };
    };
    const frames = (body.board?.frames ?? []).filter((f) => f.status === "active");
    if (json) {
      console.log(JSON.stringify(frames));
    } else if (frames.length === 0) {
      console.error("No frames on this project's board.");
    } else {
      for (const f of frames) {
        const pending = (body.board?.comments ?? []).filter(
          (c) => c.frameId === f.id && !c.resolved && !c.dispatchedAt,
        ).length;
        console.log(
          `${f.id}  rev ${f.revision}  "${f.title}"${pending ? `  (${pending} pending comment${pending > 1 ? "s" : ""})` : ""}`,
        );
      }
    }
    process.exit(0);
  }

  console.error(`Unknown canvas command: ${sub}`);
  usage();
  process.exit(1);
}
