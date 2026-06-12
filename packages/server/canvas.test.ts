/**
 * Canvas Server Tests
 *
 * Run: bun test packages/server/canvas.test.ts
 *
 * Boots a real server on a scratch port with a scratch data dir and
 * exercises the HTTP surface end to end, including both SSE streams.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCanvasServer, readCanvasRegistry, type CanvasServerResult } from "./canvas";
import type { CanvasFeedbackEvent, CanvasFrame } from "@plannotator/shared/canvas-store";

let tempDir: string;
let server: CanvasServerResult;
let base: string;
const ROOT = "/tmp/canvas-test-project";

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "plannotator-canvas-server-test-"));
  process.env.PLANNOTATOR_DATA_DIR = tempDir;
  // Scratch port well away from the default.
  process.env.PLANNOTATOR_CANVAS_PORT = String(29000 + Math.floor(Math.random() * 400));
  server = await startCanvasServer({ htmlContent: "<html><body>canvas-ui</body></html>" });
  base = server.url;
});

afterAll(() => {
  server.stop();
  delete process.env.PLANNOTATOR_DATA_DIR;
  delete process.env.PLANNOTATOR_CANVAS_PORT;
  rmSync(tempDir, { recursive: true, force: true });
});

async function readSSEEvents(
  res: Response,
  count: number,
  timeoutMs = 3000,
): Promise<unknown[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: unknown[] = [];
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  while (events.length < count && Date.now() < deadline) {
    const { done, value } = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((r) =>
        setTimeout(() => r({ done: true, value: undefined }), deadline - Date.now()),
      ),
    ]);
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)));
      }
    }
  }
  reader.cancel().catch(() => {});
  return events;
}

describe("canvas server", () => {
  let frameId: string;
  let projectKey: string;

  test("health + registry", async () => {
    const res = await fetch(`${base}/api/canvas/health`);
    const body = (await res.json()) as { ok: boolean; canvas: boolean; pid: number };
    expect(body.ok).toBe(true);
    expect(body.canvas).toBe(true);
    expect(body.pid).toBe(process.pid);
    expect(readCanvasRegistry()?.port).toBe(server.port);
  });

  test("serves UI at root", async () => {
    const res = await fetch(`${base}/`);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("canvas-ui");
  });

  test("create frame validates input", async () => {
    const bad = await fetch(`${base}/api/canvas/frames`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot: "relative/path", html: "<p>x</p>" }),
    });
    expect(bad.status).toBe(400);

    const noHtml = await fetch(`${base}/api/canvas/frames`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot: ROOT }),
    });
    expect(noHtml.status).toBe(400);
  });

  test("create frame → board snapshot → html endpoint", async () => {
    const res = await fetch(`${base}/api/canvas/frames`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectRoot: ROOT,
        html: "<html><body><h1>Login</h1></body></html>",
        title: "Login page",
        sessionId: "sess-1",
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { frameId: string; projectKey: string; url: string };
    frameId = created.frameId;
    projectKey = created.projectKey;
    expect(created.url).toContain(`project=${encodeURIComponent(projectKey)}`);

    const boardRes = await fetch(`${base}/api/canvas/board?project=${projectKey}`);
    const { board } = (await boardRes.json()) as { board: { frames: CanvasFrame[] } };
    expect(board.frames.length).toBe(1);
    expect(board.frames[0].title).toBe("Login page");

    const htmlRes = await fetch(`${base}/api/canvas/frames/${frameId}/html?project=${projectKey}`);
    // Must be JSON, never text/html (frame content must not execute on the app origin)
    expect(htmlRes.headers.get("content-type")).toContain("application/json");
    const htmlBody = (await htmlRes.json()) as { html: string; revision: number };
    expect(htmlBody.html).toContain("<h1>Login</h1>");
    expect(htmlBody.revision).toBe(1);
  });

  test("projects list includes the board", async () => {
    const res = await fetch(`${base}/api/canvas/projects`);
    const { projects } = (await res.json()) as { projects: { projectKey: string }[] };
    expect(projects.some((p) => p.projectKey === projectKey)).toBe(true);
  });

  test("board SSE stream receives frame.updated with htmlChanged", async () => {
    const streamRes = await fetch(`${base}/api/canvas/stream`);
    const eventsPromise = readSSEEvents(streamRes, 2); // hello + frame.updated

    const patch = await fetch(`${base}/api/canvas/frames/${frameId}?project=${projectKey}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: "<html><body><h1>Login v2</h1></body></html>" }),
    });
    const { frame } = (await patch.json()) as { frame: CanvasFrame };
    expect(frame.revision).toBe(2);

    const events = (await eventsPromise) as Array<{ type: string; htmlChanged?: boolean }>;
    expect(events[0]).toEqual({ type: "hello" });
    expect(events[1].type).toBe("frame.updated");
    expect(events[1].htmlChanged).toBe(true);
  });

  test("geometry patch does not bump revision", async () => {
    const patch = await fetch(`${base}/api/canvas/frames/${frameId}?project=${projectKey}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 120, y: 40 }),
    });
    const { frame } = (await patch.json()) as { frame: CanvasFrame };
    expect(frame.revision).toBe(2);
    expect(frame.x).toBe(120);
  });

  test("combined html+geometry+title patch bumps seq exactly once", async () => {
    const before = (await (await fetch(`${base}/api/canvas/board?project=${projectKey}`)).json()) as {
      board: { seq: number };
    };
    const patch = await fetch(`${base}/api/canvas/frames/${frameId}?project=${projectKey}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: "<p>v3</p>", x: 130, title: "Login v3" }),
    });
    const { frame } = (await patch.json()) as { frame: CanvasFrame };
    expect(frame.revision).toBe(3);
    expect(frame.title).toBe("Login v3");
    const after = (await (await fetch(`${base}/api/canvas/board?project=${projectKey}`)).json()) as {
      board: { seq: number };
    };
    expect(after.board.seq).toBe(before.board.seq + 1);
  });

  test("rejects non-loopback Host header (anti-DNS-rebinding)", async () => {
    const res = await fetch(`${base}/api/canvas/projects`, {
      headers: { Host: "evil.example.com" },
    });
    expect(res.status).toBe(403);
  });

  test("rejects traversal-shaped project keys", async () => {
    const res = await fetch(
      `${base}/api/canvas/board?project=${encodeURIComponent("../../../etc")}`,
    );
    expect(res.status).toBe(404);
    const feedback = await fetch(
      `${base}/api/canvas/feedback?project=${encodeURIComponent("../../other")}`,
    );
    const body = (await feedback.json()) as { events: unknown[] };
    expect(body.events).toEqual([]);
  });

  test("comments + dispatch → feedback snapshot and live stream", async () => {
    // Open the feedback stream before dispatching.
    const streamRes = await fetch(
      `${base}/api/canvas/feedback/stream?root=${encodeURIComponent(ROOT)}`,
    );
    const streamEvents = readSSEEvents(streamRes, 1, 4000);

    const commentRes = await fetch(
      `${base}/api/canvas/frames/${frameId}/comments?project=${projectKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: "Make the heading smaller",
          selection: { originalText: "Login v2" },
        }),
      },
    );
    expect(commentRes.status).toBe(201);

    const dispatchRes = await fetch(
      `${base}/api/canvas/frames/${frameId}/dispatch?project=${projectKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    const { event } = (await dispatchRes.json()) as { event: CanvasFeedbackEvent };
    expect(event.comments.length).toBe(1);
    expect(event.revision).toBe(3);
    expect(event.feedbackMarkdown).toContain('Feedback on: "Login v2"');

    const live = (await streamEvents) as CanvasFeedbackEvent[];
    expect(live.length).toBe(1);
    expect(live[0].frameId).toBe(frameId);

    // Pull snapshot via ?root resolution
    const pull = await fetch(`${base}/api/canvas/feedback?root=${encodeURIComponent(ROOT)}`);
    const { events } = (await pull.json()) as { events: CanvasFeedbackEvent[] };
    expect(events.length).toBe(1);

    // since filter excludes it
    const since = await fetch(
      `${base}/api/canvas/feedback?root=${encodeURIComponent(ROOT)}&since=${encodeURIComponent(events[0].dispatchedAt)}`,
    );
    const sinceBody = (await since.json()) as { events: CanvasFeedbackEvent[] };
    expect(sinceBody.events.length).toBe(0);

    // dispatch again with nothing pending → empty
    const again = await fetch(
      `${base}/api/canvas/frames/${frameId}/dispatch?project=${projectKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    expect(((await again.json()) as { empty?: boolean }).empty).toBe(true);
  });

  test("feedback stream replays history for late subscribers", async () => {
    const streamRes = await fetch(
      `${base}/api/canvas/feedback/stream?root=${encodeURIComponent(ROOT)}`,
    );
    const events = (await readSSEEvents(streamRes, 1, 2000)) as CanvasFeedbackEvent[];
    expect(events.length).toBe(1);
    expect(events[0].event).toBe("frame.feedback");
  });

  test("send-now + reply: thread round-trips over HTTP and the watch stream", async () => {
    // Fresh frame + comment.
    const created = (await (
      await fetch(`${base}/api/canvas/frames`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRoot: ROOT, html: "<p>q</p>", title: "Q" }),
      })
    ).json()) as { frameId: string };
    const comment = (await (
      await fetch(`${base}/api/canvas/frames/${created.frameId}/comments?project=${projectKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "what color?" }),
      })
    ).json()) as { comment: { id: string } };
    const commentId = comment.comment.id;

    // Watch stream from "now" to capture the reply-request.
    const sinceIso = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    const streamRes = await fetch(
      `${base}/api/canvas/feedback/stream?root=${encodeURIComponent(ROOT)}&since=${encodeURIComponent(sinceIso)}`,
    );
    const streamEvents = readSSEEvents(streamRes, 1, 4000);
    await new Promise((r) => setTimeout(r, 100));

    // Send now → reply-request event on the watch stream, comment awaiting.
    const sendRes = await fetch(
      `${base}/api/canvas/comments/${commentId}/send-now?project=${projectKey}`,
      { method: "POST" },
    );
    const sendBody = (await sendRes.json()) as { event: { event: string; commentId: string } };
    expect(sendBody.event.event).toBe("comment.reply_request");

    const live = (await streamEvents) as Array<{ event: string; commentId: string }>;
    expect(live.some((e) => e.event === "comment.reply_request" && e.commentId === commentId)).toBe(true);

    // Agent replies (fromAgent) → appended, awaiting cleared.
    const replyRes = await fetch(`${base}/api/canvas/comments/${commentId}/reply?project=${projectKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: "Claude", body: "Teal.", fromAgent: true }),
    });
    const replyBody = (await replyRes.json()) as {
      comment: { replies: { author: string; fromAgent: boolean }[]; awaitingReply?: boolean };
    };
    expect(replyBody.comment.replies.length).toBe(1);
    expect(replyBody.comment.replies[0].author).toBe("Claude");
    expect(replyBody.comment.awaitingReply).toBe(false);
  });

  test("closing a frame archives it and notifies the watch stream", async () => {
    // New frame to close, with a watch stream open to receive the event.
    const created = (await (
      await fetch(`${base}/api/canvas/frames`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRoot: ROOT, html: "<p>bye</p>", title: "Closeme" }),
      })
    ).json()) as { frameId: string };

    // Skip replayed history (earlier tests logged feedback events) so we read
    // the live close event, not a stale one.
    const sinceIso = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    const streamRes = await fetch(
      `${base}/api/canvas/feedback/stream?root=${encodeURIComponent(ROOT)}&since=${encodeURIComponent(sinceIso)}`,
    );
    const streamEvents = readSSEEvents(streamRes, 1, 4000);
    await new Promise((r) => setTimeout(r, 100));

    const closeRes = await fetch(
      `${base}/api/canvas/frames/${created.frameId}/close?project=${projectKey}`,
      { method: "POST" },
    );
    const closeBody = (await closeRes.json()) as { event: { event: string; frameId: string } };
    expect(closeBody.event.event).toBe("frame.closed");

    const live = (await streamEvents) as Array<{ event: string; frameId: string }>;
    expect(live.some((e) => e.event === "frame.closed" && e.frameId === created.frameId)).toBe(true);

    // Frame is archived (gone from the active board count).
    const board = (await (await fetch(`${base}/api/canvas/board?project=${projectKey}`)).json()) as {
      board: { frames: CanvasFrame[] };
    };
    expect(board.board.frames.find((f) => f.id === created.frameId)?.status).toBe("archived");
  });

  test("oversized html rejected with 413", async () => {
    const res = await fetch(`${base}/api/canvas/frames`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot: ROOT, html: "x".repeat(5 * 1024 * 1024 + 1) }),
    });
    expect(res.status).toBe(413);
  });

  test("ensure-board endpoint registers a project", async () => {
    const res = await fetch(`${base}/api/canvas/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: "/tmp/canvas-test-other" }),
    });
    const body = (await res.json()) as { projectKey: string; projectName: string };
    expect(body.projectName).toBe("canvas-test-other");

    const list = await fetch(`${base}/api/canvas/projects`);
    const { projects } = (await list.json()) as { projects: { projectKey: string }[] };
    expect(projects.some((p) => p.projectKey === body.projectKey)).toBe(true);
  });
});
