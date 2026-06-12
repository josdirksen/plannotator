/**
 * Canvas Store Tests
 *
 * Run: bun test packages/shared/canvas-store.test.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveProjectIdentity,
  getOrCreateBoard,
  getBoard,
  listBoards,
  createFrame,
  readFrameHtml,
  updateFrameHtml,
  updateFrameGeometry,
  updateFrameMeta,
  applyFramePatch,
  addComment,
  updateComment,
  dispatchFrameFeedback,
  dispatchBoardFeedback,
  readFeedbackEvents,
  formatFeedbackMarkdown,
  isSafeProjectKey,
  closeFrame,
  closeBoard,
  arrangeBoard,
  dispatchCommentReply,
  addReply,
} from "./canvas-store";

let tempDir: string;
let prevDataDir: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "plannotator-canvas-test-"));
  prevDataDir = process.env.PLANNOTATOR_DATA_DIR;
  process.env.PLANNOTATOR_DATA_DIR = tempDir;
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.PLANNOTATOR_DATA_DIR;
  else process.env.PLANNOTATOR_DATA_DIR = prevDataDir;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("deriveProjectIdentity", () => {
  test("stable key from root path", () => {
    const a = deriveProjectIdentity("/Users/x/work/my-app");
    const b = deriveProjectIdentity("/Users/x/work/my-app");
    expect(a.projectKey).toBe(b.projectKey);
    expect(a.projectName).toBe("my-app");
    expect(a.projectKey).toMatch(/^my-app-[0-9a-f]{8}$/);
  });

  test("same folder name, different paths → different keys", () => {
    const a = deriveProjectIdentity("/Users/x/work/app");
    const b = deriveProjectIdentity("/Users/x/other/app");
    expect(a.projectKey).not.toBe(b.projectKey);
  });
});

describe("frames", () => {
  test("create writes revision 1 html and auto-places without overlap", () => {
    const root = "/tmp/proj-a";
    const first = createFrame(root, { html: "<h1>one</h1>", title: "One" });
    const second = createFrame(root, { html: "<h1>two</h1>" });

    expect(first.frame.revision).toBe(1);
    expect(readFrameHtml(first.board.projectKey, first.frame.id)).toBe("<h1>one</h1>");
    expect(second.frame.title).toBe("Frame 2");

    // No overlap (gutter enforced)
    const f1 = first.frame;
    const f2 = second.frame;
    const overlap =
      f1.x < f2.x + f2.width &&
      f1.x + f1.width > f2.x &&
      f1.y < f2.y + f2.height &&
      f1.y + f1.height > f2.y;
    expect(overlap).toBe(false);
  });

  test("new frames flow into a grid that wraps downward, not horizontally", () => {
    const root = "/tmp/proj-grid";
    const frames = Array.from({ length: 7 }, (_, i) =>
      createFrame(root, { html: `f${i}` }).frame,
    );
    // With 7 frames the grid is ceil(sqrt(7))=3 columns → at least 3 rows used,
    // so the board is taller than a single horizontal strip.
    const distinctRows = new Set(frames.map((f) => Math.round(f.y / 100))).size;
    const distinctCols = new Set(frames.map((f) => Math.round(f.x / 100))).size;
    expect(distinctRows).toBeGreaterThanOrEqual(3);
    expect(distinctCols).toBeLessThanOrEqual(3);
    // No overlaps.
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        const a = frames[i];
        const b = frames[j];
        const overlap =
          a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlap).toBe(false);
      }
    }
  });

  test("updateFrameHtml bumps revision and keeps old revision readable", () => {
    const root = "/tmp/proj-rev";
    const { board, frame } = createFrame(root, { html: "v1" });
    const updated = updateFrameHtml(board.projectKey, frame.id, "v2");
    expect(updated?.revision).toBe(2);
    expect(readFrameHtml(board.projectKey, frame.id)).toBe("v2");
    expect(readFrameHtml(board.projectKey, frame.id, 1)).toBe("v1");
  });

  test("geometry updates don't bump revision; bad values ignored", () => {
    const root = "/tmp/proj-geo";
    const { board, frame } = createFrame(root, { html: "x" });
    const moved = updateFrameGeometry(board.projectKey, frame.id, { x: 100, y: -50, width: NaN });
    expect(moved?.x).toBe(100);
    expect(moved?.y).toBe(-50);
    expect(moved?.width).toBe(frame.width);
    expect(moved?.revision).toBe(1);
  });

  test("arrangeBoard reflows all active frames into a tidy grid", () => {
    const root = "/tmp/proj-arrange";
    const pk = deriveProjectIdentity(root).projectKey;
    const ids = Array.from({ length: 5 }, (_, i) => createFrame(root, { html: `f${i}` }).frame);
    // Scatter them far away first.
    ids.forEach((f, i) => updateFrameGeometry(pk, f.id, { x: 5000 + i * 13, y: 3000 }));

    const arranged = arrangeBoard(pk)!;
    const active = arranged.frames.filter((f) => f.status === "active");
    // Pulled back near the origin grid, ≤3 columns (ceil(sqrt(5))), no overlaps.
    const cols = new Set(active.map((f) => Math.round(f.x / 200))).size;
    expect(cols).toBeLessThanOrEqual(3);
    expect(Math.max(...active.map((f) => f.x))).toBeLessThan(5000);
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        const overlap =
          a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlap).toBe(false);
      }
    }
  });

  test("archive via updateFrameMeta", () => {
    const root = "/tmp/proj-meta";
    const { board, frame } = createFrame(root, { html: "x" });
    const archived = updateFrameMeta(board.projectKey, frame.id, { status: "archived" });
    expect(archived?.status).toBe("archived");
    expect(listBoards().find((b) => b.projectKey === board.projectKey)?.frameCount).toBe(0);
  });

  test("readFrameHtml rejects traversal-shaped ids", () => {
    const root = "/tmp/proj-trav";
    const { board } = createFrame(root, { html: "x" });
    expect(readFrameHtml(board.projectKey, "../../../etc/passwd")).toBeNull();
  });

  test("traversal-shaped project keys are rejected everywhere", () => {
    expect(isSafeProjectKey("my-app-12abcdef")).toBe(true);
    expect(isSafeProjectKey("../../../some/dir")).toBe(false);
    expect(isSafeProjectKey("a/b")).toBe(false);
    expect(isSafeProjectKey("a\\b")).toBe(false);
    expect(isSafeProjectKey("..")).toBe(false);
    expect(getBoard("../../../etc")).toBeNull();
    expect(readFeedbackEvents("../../../etc")).toEqual([]);
  });

  test("applyFramePatch combines html+geometry+meta in ONE commit", () => {
    const root = "/tmp/proj-patch";
    const { board, frame } = createFrame(root, { html: "v1" });
    const seqBefore = getBoard(board.projectKey)!.seq;
    const patched = applyFramePatch(board.projectKey, frame.id, {
      html: "v2",
      x: 50,
      title: "Renamed",
    });
    expect(patched?.htmlChanged).toBe(true);
    expect(patched?.frame.revision).toBe(2);
    expect(patched?.frame.x).toBe(50);
    expect(patched?.frame.title).toBe("Renamed");
    expect(getBoard(board.projectKey)!.seq).toBe(seqBefore + 1);
    expect(readFrameHtml(board.projectKey, frame.id)).toBe("v2");
  });

  test("geometry is clamped: huge coords bounded, tiny sizes floored", () => {
    const root = "/tmp/proj-clamp";
    const { board, frame } = createFrame(root, { html: "x" });
    const moved = updateFrameGeometry(board.projectKey, frame.id, {
      x: 1e308,
      y: -1e308,
      width: 1,
      height: 1,
    });
    expect(moved!.x).toBe(1_000_000);
    expect(moved!.y).toBe(-1_000_000);
    expect(moved!.width).toBe(50);
    expect(moved!.height).toBe(50);
  });

  test("sizedBy: auto by default, agent when --size given, user pins via patch", () => {
    const root = "/tmp/proj-sizedby";
    const { board, frame: autoFrame } = createFrame(root, { html: "a" });
    expect(autoFrame.sizedBy).toBe("auto");
    const { frame: agentFrame } = createFrame(root, {
      html: "b",
      suggestedSize: { width: 800, height: 600 },
    });
    expect(agentFrame.sizedBy).toBe("agent");

    const pinned = applyFramePatch(board.projectKey, autoFrame.id, {
      width: 700,
      height: 500,
      sizedBy: "user",
    });
    expect(pinned?.frame.sizedBy).toBe("user");
    expect(pinned?.moved).toEqual([]);
    expect(getBoard(board.projectKey)!.frames.find((f) => f.id === autoFrame.id)?.sizedBy).toBe(
      "user",
    );
  });

  test("auto-fit growth (sizedBy: auto) pushes overlapped neighbors down in one commit", () => {
    const root = "/tmp/proj-reflow";
    const { board, frame: top } = createFrame(root, { html: "top" });
    const { frame: below } = createFrame(root, { html: "below" });
    // Stack `below` directly underneath `top` in the same column.
    applyFramePatch(board.projectKey, below.id, { x: top.x, y: top.y + top.height + 48 });

    const seqBefore = getBoard(board.projectKey)!.seq;
    // Content measured much taller — auto-fit grows top into below's space.
    const grown = applyFramePatch(board.projectKey, top.id, {
      height: 1600,
      sizedBy: "auto",
    });
    expect(grown?.frame.height).toBe(1600);
    expect(grown?.frame.sizedBy).toBe("auto");
    expect(grown?.moved.map((f) => f.id)).toEqual([below.id]);
    // One commit for the whole reflow.
    expect(getBoard(board.projectKey)!.seq).toBe(seqBefore + 1);

    const after = getBoard(board.projectKey)!;
    const movedBelow = after.frames.find((f) => f.id === below.id)!;
    expect(movedBelow.y).toBeGreaterThanOrEqual(top.y + 1600);
    // No overlap remains.
    const a = after.frames.find((f) => f.id === top.id)!;
    const overlap =
      a.x < movedBelow.x + movedBelow.width &&
      a.x + a.width > movedBelow.x &&
      a.y < movedBelow.y + movedBelow.height &&
      a.y + a.height > movedBelow.y;
    expect(overlap).toBe(false);
  });

  test("a user resize never reflows neighbors", () => {
    const root = "/tmp/proj-user-no-reflow";
    const { board, frame: top } = createFrame(root, { html: "top" });
    const { frame: below } = createFrame(root, { html: "below" });
    applyFramePatch(board.projectKey, below.id, { x: top.x, y: top.y + top.height + 48 });
    const yBefore = getBoard(board.projectKey)!.frames.find((f) => f.id === below.id)!.y;

    const grown = applyFramePatch(board.projectKey, top.id, { height: 1600, sizedBy: "user" });
    expect(grown?.moved).toEqual([]);
    expect(getBoard(board.projectKey)!.frames.find((f) => f.id === below.id)!.y).toBe(yBefore);
  });
});

describe("comments + dispatch", () => {
  test("dispatch bundles unresolved comments, marks them, appends ndjson", () => {
    const root = "/tmp/proj-fb";
    const { board, frame } = createFrame(root, { html: "x", title: "Login" });
    addComment(board.projectKey, frame.id, { body: "Make CTA bigger" });
    const withSel = addComment(board.projectKey, frame.id, {
      body: "Wrong label",
      selection: { originalText: "Sign in" },
    });
    const resolved = addComment(board.projectKey, frame.id, { body: "done already" });
    updateComment(board.projectKey, resolved!.id, { resolved: true });

    const event = dispatchFrameFeedback(board.projectKey, frame.id);
    expect(event).not.toBeNull();
    if (!event || "empty" in event) throw new Error("expected event");
    expect(event.comments.length).toBe(2);
    expect(event.feedbackMarkdown).toContain('Feedback on: "Sign in"');
    expect(event.feedbackMarkdown).toContain("Make CTA bigger");

    // Comments marked dispatched
    const after = getBoard(board.projectKey)!;
    expect(after.comments.filter((c) => c.dispatchedAt).length).toBe(2);

    // NDJSON log written
    const log = readFileSync(
      join(tempDir, "canvas", "projects", board.projectKey, "feedback.ndjson"),
      "utf-8",
    );
    expect(log.trim().split("\n").length).toBe(1);

    // Second dispatch with nothing left → empty marker
    const again = dispatchFrameFeedback(board.projectKey, frame.id);
    expect(again).toEqual({ empty: true });

    // selection comment retained its anchor in the event
    expect(event.comments.find((c) => c.id === withSel!.id)?.selection?.originalText).toBe(
      "Sign in",
    );
  });

  test("board-wide dispatch covers multiple frames; since filter works", () => {
    const root = "/tmp/proj-fb2";
    const { board, frame: f1 } = createFrame(root, { html: "x", title: "A" });
    const { frame: f2 } = createFrame(root, { html: "y", title: "B" });
    addComment(board.projectKey, f1.id, { body: "c1" });
    addComment(board.projectKey, f2.id, { body: "c2" });

    const events = dispatchBoardFeedback(board.projectKey);
    expect(events.length).toBe(2);

    const all = readFeedbackEvents(board.projectKey);
    expect(all.length).toBe(2);
    const sinceLast = readFeedbackEvents(board.projectKey, all[1].dispatchedAt);
    expect(sinceLast.length).toBe(0);

    // Strictly monotonic dispatch timestamps: even same-millisecond loops
    // produce distinct dispatchedAt values, so `since` replay can never drop
    // an unseen sibling.
    expect(all[0].dispatchedAt).not.toBe(all[1].dispatchedAt);
    const sinceFirst = readFeedbackEvents(board.projectKey, all[0].dispatchedAt);
    expect(sinceFirst.length).toBe(1);
  });

  test("dispatch marks frame awaiting revision; an HTML update clears it", () => {
    const root = "/tmp/proj-await";
    const { board, frame } = createFrame(root, { html: "v1" });
    addComment(board.projectKey, frame.id, { body: "fix this" });
    const before = Date.now();
    dispatchFrameFeedback(board.projectKey, frame.id);

    let after = getBoard(board.projectKey)!.frames[0];
    expect(after.feedbackPendingRevision).toBe(1);
    expect(after.feedbackPendingRevision === after.revision).toBe(true); // awaiting
    // Timestamped so the UI can expire the indicator if no revision ever comes.
    expect(after.feedbackPendingSince).toBeGreaterThanOrEqual(before);

    updateFrameHtml(board.projectKey, frame.id, "v2");
    after = getBoard(board.projectKey)!.frames[0];
    expect(after.revision).toBe(2);
    expect(after.feedbackPendingRevision === after.revision).toBe(false); // cleared
    // The fields themselves are removed (not left stale) once a revision answers.
    expect(after.feedbackPendingRevision).toBeUndefined();
    expect(after.feedbackPendingSince).toBeUndefined();
  });

  test("awaitingReplySince: stamped on send-now, re-stamped on user follow-up, cleared by agent reply", () => {
    const root = "/tmp/proj-reply-since";
    const { board, frame } = createFrame(root, { html: "x" });
    const comment = addComment(board.projectKey, frame.id, { body: "thoughts?" })!;

    const before = Date.now();
    dispatchCommentReply(board.projectKey, comment.id);
    let c = getBoard(board.projectKey)!.comments[0];
    expect(c.awaitingReply).toBe(true);
    expect(c.awaitingReplySince).toBeGreaterThanOrEqual(before);

    // Agent reply answers the request — waiting state fully cleared.
    addReply(board.projectKey, comment.id, { author: "Claude", body: "teal", fromAgent: true });
    c = getBoard(board.projectKey)!.comments[0];
    expect(c.awaitingReply).toBe(false);
    expect(c.awaitingReplySince).toBeUndefined();

    // User follow-up re-arms it with a fresh timestamp.
    const beforeFollowUp = Date.now();
    addReply(board.projectKey, comment.id, { author: "me", body: "why teal?", fromAgent: false });
    c = getBoard(board.projectKey)!.comments[0];
    expect(c.awaitingReply).toBe(true);
    expect(c.awaitingReplySince).toBeGreaterThanOrEqual(beforeFollowUp);
  });

  test("closing/archiving a frame settles its comments (no orphaned pending state)", () => {
    const root = "/tmp/proj-settle";
    const { board, frame: closed } = createFrame(root, { html: "a" });
    const { frame: patched } = createFrame(root, { html: "b" });
    addComment(board.projectKey, closed.id, { body: "pending forever?" });
    const sentNow = addComment(board.projectKey, closed.id, { body: "reply?" })!;
    dispatchCommentReply(board.projectKey, sentNow.id); // awaitingReply
    addComment(board.projectKey, patched.id, { body: "also pending" });

    closeFrame(board.projectKey, closed.id);
    // Archive the second frame through the PATCH path (multi-select archive).
    applyFramePatch(board.projectKey, patched.id, { status: "archived" });

    const after = getBoard(board.projectKey)!;
    for (const c of after.comments) {
      expect(c.resolved).toBe(true);
      expect(c.awaitingReply ?? false).toBe(false);
      expect(c.awaitingReplySince).toBeUndefined();
    }
    // Nothing left for "Send all" to pick up.
    expect(dispatchBoardFeedback(board.projectKey)).toEqual([]);
  });

  test("closeBoard settles comments on every archived frame", () => {
    const root = "/tmp/proj-settle-board";
    const { board, frame: a } = createFrame(root, { html: "a" });
    const { frame: b } = createFrame(root, { html: "b" });
    addComment(board.projectKey, a.id, { body: "one" });
    addComment(board.projectKey, b.id, { body: "two" });

    closeBoard(board.projectKey);

    const after = getBoard(board.projectKey)!;
    expect(after.comments.every((c) => c.resolved)).toBe(true);
    expect(dispatchBoardFeedback(board.projectKey)).toEqual([]);
  });

  test("closeFrame archives the frame and logs a frame.closed watch event", () => {
    const root = "/tmp/proj-close";
    const { board, frame } = createFrame(root, { html: "x", title: "Login" });
    const event = closeFrame(board.projectKey, frame.id);
    expect(event?.event).toBe("frame.closed");
    expect(event?.feedbackMarkdown).toContain("Frame Closed: Login");
    expect(event?.feedbackMarkdown).toContain("no action");

    const after = getBoard(board.projectKey)!.frames.find((f) => f.id === frame.id);
    expect(after?.status).toBe("archived");

    // The closed event is readable from the watch log alongside feedback events.
    const events = readFeedbackEvents(board.projectKey);
    expect(events.some((e) => e.event === "frame.closed" && e.frameId === frame.id)).toBe(true);
  });

  test("send now (dispatchCommentReply) awaits a reply, sets NO dots", () => {
    const root = "/tmp/proj-sendnow";
    const { board, frame } = createFrame(root, { html: "x" });
    const c = addComment(board.projectKey, frame.id, { body: "what color should this be?" })!;

    const event = dispatchCommentReply(board.projectKey, c.id);
    expect(event).not.toBeNull();
    if (!event || "empty" in event) throw new Error("expected reply-request event");
    expect(event.event).toBe("comment.reply_request");
    expect(event.commentId).toBe(c.id);
    expect(event.feedbackMarkdown).toContain("canvas reply");

    const after = getBoard(board.projectKey)!;
    const ac = after.comments.find((x) => x.id === c.id)!;
    expect(ac.awaitingReply).toBe(true);
    expect(ac.dispatchedAt).toBeGreaterThan(0);
    // No document-revision dots for a reply request.
    expect(after.frames[0].feedbackPendingRevision).toBeUndefined();

    // Send-now is one-shot.
    expect(dispatchCommentReply(board.projectKey, c.id)).toEqual({ empty: true });
  });

  test("agent reply clears awaitingReply; user follow-up re-arms it + emits event", () => {
    const root = "/tmp/proj-thread";
    const { board, frame } = createFrame(root, { html: "x" });
    const c = addComment(board.projectKey, frame.id, { body: "thoughts?" })!;
    dispatchCommentReply(board.projectKey, c.id);

    // Agent replies → thread grows, awaiting clears, NO new event.
    const agent = addReply(board.projectKey, c.id, { author: "Claude", body: "Use teal.", fromAgent: true })!;
    expect(agent.event).toBeUndefined();
    let ac = getBoard(board.projectKey)!.comments.find((x) => x.id === c.id)!;
    expect(ac.replies?.length).toBe(1);
    expect(ac.replies?.[0].author).toBe("Claude");
    expect(ac.replies?.[0].fromAgent).toBe(true);
    expect(ac.awaitingReply).toBe(false);

    // User follow-up → re-arms awaiting + produces a reply-request event with the thread.
    const user = addReply(board.projectKey, c.id, { author: "ramos", body: "make it darker", fromAgent: false })!;
    expect(user.event?.event).toBe("comment.reply_request");
    expect(user.event?.thread.length).toBe(2); // both replies in the thread context
    ac = getBoard(board.projectKey)!.comments.find((x) => x.id === c.id)!;
    expect(ac.replies?.length).toBe(2);
    expect(ac.awaitingReply).toBe(true);

    // The reply-request events are readable from the watch log.
    const events = readFeedbackEvents(board.projectKey);
    expect(events.filter((e) => e.event === "comment.reply_request").length).toBe(2);
  });

  test("revision dispatch ignores comments already sent for a reply", () => {
    const root = "/tmp/proj-mixed";
    const { board, frame } = createFrame(root, { html: "x" });
    const replyC = addComment(board.projectKey, frame.id, { body: "reply please" })!;
    addComment(board.projectKey, frame.id, { body: "revise please" });
    dispatchCommentReply(board.projectKey, replyC.id); // sent for reply

    const event = dispatchFrameFeedback(board.projectKey, frame.id); // revision send-all
    if (!event || "empty" in event) throw new Error("expected revision event");
    // Only the non-reply comment is in the revision feedback.
    expect(event.comments.length).toBe(1);
    expect(event.comments[0].body).toBe("revise please");
  });

  test("comment body and selection text are capped", () => {
    const root = "/tmp/proj-caps";
    const { board, frame } = createFrame(root, { html: "x" });
    const comment = addComment(board.projectKey, frame.id, {
      body: "b".repeat(30_000),
      selection: { originalText: "s".repeat(5_000) },
    });
    expect(comment!.body.length).toBe(20_000);
    expect(comment!.selection!.originalText.length).toBe(2_000);
  });
});

describe("listBoards", () => {
  test("most recently updated first", () => {
    createFrame("/tmp/proj-old", { html: "x" });
    createFrame("/tmp/proj-new", { html: "y" });
    const boards = listBoards();
    expect(boards.length).toBe(2);
    expect(boards[0].updatedAt).toBeGreaterThanOrEqual(boards[1].updatedAt);
  });
});

describe("formatFeedbackMarkdown", () => {
  test("renders title, revision, anchored and frame-level comments", () => {
    const md = formatFeedbackMarkdown({ title: "Page", revision: 3 }, [
      {
        id: "1",
        frameId: "f",
        body: "note",
        selection: { originalText: "hello" },
        frameRevision: 3,
        resolved: false,
        createdAt: 0,
      },
      { id: "2", frameId: "f", body: "general", frameRevision: 3, resolved: false, createdAt: 0 },
    ]);
    expect(md).toContain("# Frame Feedback: Page (rev 3)");
    expect(md).toContain('1. Feedback on: "hello"');
    expect(md).toContain("2. Feedback on the frame");
    expect(md).toContain("> general");
  });
});
