/**
 * Canvas Store
 *
 * Persistence for the agent-connected HTML canvas (see docs/canvas-spec.md).
 * Project-scoped boards live under ~/.plannotator/canvas/projects/{key}/:
 *
 *   board.json                  — frames + comments + seq counter
 *   frames/{frameId}/{rev}.html — full revision history of frame HTML
 *   feedback.ndjson             — append-only log of dispatched feedback events
 *
 * The canvas server is the single writer; the CLI talks to it over HTTP.
 * Runtime-agnostic: uses only node:fs, node:path, node:crypto.
 */

import { join } from "path";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  appendFileSync,
  existsSync,
  realpathSync,
} from "fs";
import { createHash } from "crypto";
import { getPlannotatorDataDir } from "./data-dir";
import { extractDirName } from "./project";
import {
  nextGridSlot,
  layoutMasonry,
  resolveCollisions,
  GRID_CELL_W,
  GRID_CELL_H,
} from "./canvas-layout";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CanvasFrame {
  id: string;
  title: string;
  /** Canvas coordinates (floats). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Increments on HTML updates only; geometry/title changes don't bump it. */
  revision: number;
  /** Opaque agent-supplied provenance (e.g. a session id). */
  sessionId?: string;
  /** Clusters auto-placement: frames sharing a hint land near each other. */
  groupHint?: string;
  /** Original file path passed to `canvas add`, for display. */
  sourcePath?: string;
  /**
   * Revision at which feedback was last dispatched for this frame. The frame
   * is "awaiting revision" while this equals `revision` — i.e. the user sent
   * feedback and the agent hasn't pushed a new revision yet. An HTML update
   * bumps `revision` past this value, which clears the awaiting state.
   */
  feedbackPendingRevision?: number;
  /**
   * When feedback was last dispatched (ms). Set alongside
   * `feedbackPendingRevision`, cleared with it. The UI uses this to expire
   * the awaiting-revision indicator: an agent that never comes back must not
   * leave the dots animating forever. Absent on frames dispatched before
   * this field existed — treated as already expired.
   */
  feedbackPendingSince?: number;
  /**
   * Who decided this frame's size. `auto` (default): the UI grows the frame
   * to fit its measured content height. `agent`: an explicit `--size` was
   * passed — treat as a fixed viewport, never auto-fit. `user`: the user
   * resized it by hand — pinned, never auto-fit again. Absent on frames from
   * before this field existed; treated as `auto`.
   */
  sizedBy?: "auto" | "agent" | "user";
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
}

/** One message in a comment's reply thread. The author is declared by the
 *  replier (the agent passes `--as <name>`); no identity is enforced. */
export interface CanvasReply {
  id: string;
  author: string;
  body: string;
  /** True for agent (CLI) replies, false for user (UI) replies — for styling. */
  fromAgent: boolean;
  createdAt: number;
}

export interface CanvasComment {
  id: string;
  frameId: string;
  body: string;
  author?: string;
  /** Present when the comment anchors to selected text inside the frame. */
  selection?: { originalText: string };
  /** Frame revision the comment was made against. */
  frameRevision: number;
  resolved: boolean;
  /** Set when the comment was sent (either intent). */
  dispatchedAt?: number;
  /** Reply thread (conversational "Send now" comments). */
  replies?: CanvasReply[];
  /** Sent for a reply and not yet answered. Distinct from the frame's
   *  feedbackPendingRevision (dots) — a reply is expected, not a doc change. */
  awaitingReply?: boolean;
  /** When the reply was last requested (ms) — set on send-now and re-stamped
   *  on each user follow-up; the UI expires the waiting pulse from it. */
  awaitingReplySince?: number;
  createdAt: number;
}

export interface CanvasBoard {
  projectKey: string;
  projectName: string;
  /** Absolute project root the board is scoped to. */
  root: string;
  /** Monotonic mutation counter — SSE clients use it for ?since gating. */
  seq: number;
  frames: CanvasFrame[];
  comments: CanvasComment[];
  createdAt: number;
  updatedAt: number;
}

export interface CanvasBoardSummary {
  projectKey: string;
  projectName: string;
  root: string;
  frameCount: number;
  unresolvedComments: number;
  updatedAt: number;
}

export interface CanvasFeedbackEvent {
  event: "frame.feedback";
  projectKey: string;
  frameId: string;
  title: string;
  revision: number;
  sessionId?: string;
  dispatchedAt: string; // ISO-8601
  comments: Array<{
    id: string;
    body: string;
    author?: string;
    selection?: { originalText: string };
    createdAt: string; // ISO-8601
  }>;
  /** Human/agent-readable rendering of the comments. */
  feedbackMarkdown: string;
}

/**
 * Emitted when a user sends a comment "now" (or follows up in its thread)
 * expecting a REPLY rather than a document revision. The agent replies with
 * `plannotator canvas reply <commentId> --as <name> "<message>"`.
 */
export interface CanvasReplyRequestEvent {
  event: "comment.reply_request";
  projectKey: string;
  frameId: string;
  title: string;
  commentId: string;
  sessionId?: string;
  dispatchedAt: string; // ISO-8601
  /** The comment plus the conversation so far. */
  comment: {
    body: string;
    author?: string;
    selection?: { originalText: string };
  };
  thread: Array<{ author: string; body: string; fromAgent: boolean; createdAt: string }>;
  feedbackMarkdown: string;
}

/**
 * Emitted when a user closes (archives) a frame in the canvas. Purely
 * informational — the agent should treat it as a no-op acknowledgement that
 * the preview was dismissed; no revision is expected.
 */
export interface CanvasFrameClosedEvent {
  event: "frame.closed";
  projectKey: string;
  frameId: string;
  title: string;
  revision: number;
  sessionId?: string;
  dispatchedAt: string; // ISO-8601 (named to share the watch stream's `since` gating)
  feedbackMarkdown: string;
}

/** Anything delivered to `canvas watch` / the feedback log. */
export type CanvasWatchEvent =
  | CanvasFeedbackEvent
  | CanvasFrameClosedEvent
  | CanvasReplyRequestEvent;

export interface CreateFrameInput {
  html: string;
  title?: string;
  sessionId?: string;
  groupHint?: string;
  sourcePath?: string;
  suggestedSize?: { width: number; height: number };
}

// ---------------------------------------------------------------------------
// Directories & identity
// ---------------------------------------------------------------------------

export function getCanvasDir(): string {
  const dir = join(getPlannotatorDataDir(), "canvas");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function projectsDir(): string {
  const dir = join(getCanvasDir(), "projects");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function boardDir(projectKey: string): string {
  return join(projectsDir(), projectKey);
}

/**
 * Derive a stable board identity from a project root path.
 * Key = sanitized directory name + 8-char path hash, so two projects with
 * the same folder name (or a renamed checkout) never collide.
 *
 * The path is canonicalized first (symlinks resolved) so e.g. macOS's
 * /tmp → /private/tmp and PLANNOTATOR_CWD vs process.cwd() always map to
 * the same board.
 */
export function deriveProjectIdentity(root: string): {
  projectKey: string;
  projectName: string;
  /** Canonicalized root (symlinks resolved when the path exists). */
  root: string;
} {
  let canonical = root;
  try {
    canonical = realpathSync(root);
  } catch {
    // path may not exist (tests, deleted dirs) — hash the raw form
  }
  const name = extractDirName(canonical) ?? "project";
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 8);
  return { projectKey: `${name}-${hash}`, projectName: name, root: canonical };
}

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

let idSeq = 0;
function nextId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${Date.now().toString(36)}-${(idSeq++).toString(36)}${rand}`;
}

// ---------------------------------------------------------------------------
// Board load/save
// ---------------------------------------------------------------------------

function boardPath(projectKey: string): string {
  return join(boardDir(projectKey), "board.json");
}

/**
 * Project keys are server-generated (`name-8hex`), but they also arrive via
 * URL params — reject anything path-shaped so a crafted key can never escape
 * the projects directory (mirrors the frameId guard in readFrameHtml).
 */
export function isSafeProjectKey(projectKey: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(projectKey) && !projectKey.includes("..");
}

export function getBoard(projectKey: string): CanvasBoard | null {
  if (!isSafeProjectKey(projectKey)) return null;
  try {
    const raw = readFileSync(boardPath(projectKey), "utf-8");
    return JSON.parse(raw) as CanvasBoard;
  } catch {
    return null;
  }
}

export function getOrCreateBoard(root: string): CanvasBoard {
  const { projectKey, projectName, root: canonical } = deriveProjectIdentity(root);
  const existing = getBoard(projectKey);
  if (existing) return existing;

  const now = Date.now();
  const board: CanvasBoard = {
    projectKey,
    projectName,
    root: canonical,
    seq: 0,
    frames: [],
    comments: [],
    createdAt: now,
    updatedAt: now,
  };
  saveBoard(board);
  return board;
}

function saveBoard(board: CanvasBoard): void {
  const dir = boardDir(board.projectKey);
  mkdirSync(dir, { recursive: true });
  writeFileSync(boardPath(board.projectKey), JSON.stringify(board, null, 2), "utf-8");
}

/** Bump the mutation counter and persist. Every write path funnels through this. */
function commit(board: CanvasBoard): void {
  board.seq += 1;
  board.updatedAt = Date.now();
  saveBoard(board);
}

export function listBoards(): CanvasBoardSummary[] {
  try {
    const entries = readdirSync(projectsDir(), { withFileTypes: true });
    const summaries: CanvasBoardSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const board = getBoard(entry.name);
      if (!board) continue;
      summaries.push({
        projectKey: board.projectKey,
        projectName: board.projectName,
        root: board.root,
        frameCount: board.frames.filter((f) => f.status === "active").length,
        unresolvedComments: board.comments.filter((c) => !c.resolved && !c.dispatchedAt).length,
        updatedAt: board.updatedAt,
      });
    }
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Frame HTML revisions
// ---------------------------------------------------------------------------

function frameHtmlPath(projectKey: string, frameId: string, revision: number): string {
  return join(boardDir(projectKey), "frames", frameId, `${revision}.html`);
}

function writeFrameHtml(projectKey: string, frameId: string, revision: number, html: string): void {
  const dir = join(boardDir(projectKey), "frames", frameId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(frameHtmlPath(projectKey, frameId, revision), html, "utf-8");
}

export function readFrameHtml(
  projectKey: string,
  frameId: string,
  revision?: number,
): string | null {
  const board = getBoard(projectKey);
  const frame = board?.frames.find((f) => f.id === frameId);
  if (!frame) return null;
  const rev = revision ?? frame.revision;
  // Frame ids are server-generated (no separators), but guard anyway.
  if (frameId.includes("/") || frameId.includes("\\") || frameId.includes("..")) return null;
  try {
    return readFileSync(frameHtmlPath(projectKey, frameId, rev), "utf-8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Auto-placement
//
// New frames flow into a roughly-square grid that wraps to new rows downward
// (not an ever-growing horizontal strip). Shared grid math in canvas-layout.ts
// is also used by the client's "Tidy" reflow, so placement and tidy agree.
// ---------------------------------------------------------------------------

export const DEFAULT_FRAME_WIDTH = 600;
export const DEFAULT_FRAME_HEIGHT = 450;
const MAX_FRAME_DIMENSION = 4000;
const MIN_FRAME_DIMENSION = 50;
/** World-coordinate bound — beyond this, fit/extent math degenerates. */
const MAX_FRAME_COORD = 1_000_000;
const MAX_COMMENT_BODY_CHARS = 20_000;
const MAX_SELECTION_CHARS = 2_000;

function placeFrame(
  board: CanvasBoard,
  size: { width: number; height: number },
): { x: number; y: number } {
  const active = board.frames.filter((f) => f.status === "active");
  if (active.length === 0) {
    return { x: (GRID_CELL_W - size.width) / 2, y: (GRID_CELL_H - size.height) / 2 };
  }
  return nextGridSlot(
    active.map((f) => ({ x: f.x, y: f.y, width: f.width, height: f.height })),
    size,
  );
}

// ---------------------------------------------------------------------------
// Frame mutations
// ---------------------------------------------------------------------------

function clampDimension(value: number): number {
  return Math.min(Math.max(value, MIN_FRAME_DIMENSION), MAX_FRAME_DIMENSION);
}

function clampCoord(value: number): number {
  return Math.min(Math.max(value, -MAX_FRAME_COORD), MAX_FRAME_COORD);
}

function clampSize(size?: { width: number; height: number }): {
  width: number;
  height: number;
} {
  const w = Number(size?.width);
  const h = Number(size?.height);
  return {
    width: Number.isFinite(w) && w > 0 ? clampDimension(w) : DEFAULT_FRAME_WIDTH,
    height: Number.isFinite(h) && h > 0 ? clampDimension(h) : DEFAULT_FRAME_HEIGHT,
  };
}

export function createFrame(root: string, input: CreateFrameInput): {
  board: CanvasBoard;
  frame: CanvasFrame;
} {
  const board = getOrCreateBoard(root);
  const size = clampSize(input.suggestedSize);
  const pos = placeFrame(board, size);
  const now = Date.now();

  const frame: CanvasFrame = {
    id: nextId("frm"),
    title: input.title?.trim() || `Frame ${board.frames.length + 1}`,
    x: pos.x,
    y: pos.y,
    width: size.width,
    height: size.height,
    revision: 1,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.groupHint ? { groupHint: input.groupHint } : {}),
    ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
    // An explicit --size is a fixed viewport; otherwise the UI auto-fits
    // height to the rendered content.
    sizedBy: input.suggestedSize ? "agent" : "auto",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  writeFrameHtml(board.projectKey, frame.id, 1, input.html);
  board.frames.push(frame);
  commit(board);
  return { board, frame };
}

export function updateFrameHtml(
  projectKey: string,
  frameId: string,
  html: string,
): CanvasFrame | null {
  const board = getBoard(projectKey);
  const frame = board?.frames.find((f) => f.id === frameId);
  if (!board || !frame) return null;

  frame.revision += 1;
  delete frame.feedbackPendingRevision; // new revision answers the feedback
  delete frame.feedbackPendingSince;
  frame.updatedAt = Date.now();
  writeFrameHtml(projectKey, frameId, frame.revision, html);
  commit(board);
  return frame;
}

/** Apply geometry fields in place (clamped); no commit. */
function applyGeometry(
  frame: CanvasFrame,
  geometry: Partial<Pick<CanvasFrame, "x" | "y" | "width" | "height">>,
): void {
  if (Number.isFinite(geometry.x)) frame.x = clampCoord(geometry.x!);
  if (Number.isFinite(geometry.y)) frame.y = clampCoord(geometry.y!);
  if (Number.isFinite(geometry.width) && geometry.width! > 0) {
    frame.width = clampDimension(geometry.width!);
  }
  if (Number.isFinite(geometry.height) && geometry.height! > 0) {
    frame.height = clampDimension(geometry.height!);
  }
}

/** Apply title/status fields in place; no commit. */
function applyMeta(
  frame: CanvasFrame,
  meta: Partial<Pick<CanvasFrame, "title" | "status">>,
): void {
  if (typeof meta.title === "string" && meta.title.trim()) frame.title = meta.title.trim();
  if (meta.status === "active" || meta.status === "archived") frame.status = meta.status;
}

export function updateFrameGeometry(
  projectKey: string,
  frameId: string,
  geometry: Partial<Pick<CanvasFrame, "x" | "y" | "width" | "height">>,
): CanvasFrame | null {
  const board = getBoard(projectKey);
  const frame = board?.frames.find((f) => f.id === frameId);
  if (!board || !frame) return null;

  applyGeometry(frame, geometry);
  frame.updatedAt = Date.now();
  commit(board);
  return frame;
}

/**
 * Reflow every active frame into a masonry layout (the "Tidy" action) —
 * shortest-column packing, so variable-height (auto-fit) frames leave no row
 * whitespace. Ordered by creation so the arrangement is stable and
 * predictable. One commit → one SSE resync. Returns the updated board (or
 * null if missing).
 */
export function arrangeBoard(projectKey: string): CanvasBoard | null {
  const board = getBoard(projectKey);
  if (!board) return null;
  const active = board.frames
    .filter((f) => f.status === "active")
    .sort((a, b) => a.createdAt - b.createdAt);
  if (active.length === 0) return board;

  const positions = layoutMasonry(
    active.map((f) => ({ id: f.id, width: f.width, height: f.height })),
  );
  const now = Date.now();
  for (const frame of active) {
    const pos = positions.get(frame.id);
    if (pos) {
      frame.x = pos.x;
      frame.y = pos.y;
      frame.updatedAt = now;
    }
  }
  commit(board);
  return board;
}

export function updateFrameMeta(
  projectKey: string,
  frameId: string,
  meta: Partial<Pick<CanvasFrame, "title" | "status">>,
): CanvasFrame | null {
  const board = getBoard(projectKey);
  const frame = board?.frames.find((f) => f.id === frameId);
  if (!board || !frame) return null;

  applyMeta(frame, meta);
  frame.updatedAt = Date.now();
  commit(board);
  return frame;
}

export interface FramePatch {
  html?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  title?: string;
  status?: "active" | "archived";
  /**
   * Who owns the size after this patch. `auto` marks an auto-fit (the UI
   * grew the frame to its measured content height) and additionally pushes
   * any now-overlapped neighbors downward; `user` pins the frame against
   * future auto-fits and never moves other frames.
   */
  sizedBy?: "auto" | "user";
}

/**
 * Apply a combined html/geometry/meta patch as ONE commit (one seq bump),
 * so a single PATCH request produces exactly one SSE event and never trips
 * the client's seq-gap resync. `moved` lists neighbors pushed down by an
 * auto-fit reflow (empty unless `sizedBy: "auto"` changed this frame's rect).
 */
export function applyFramePatch(
  projectKey: string,
  frameId: string,
  patch: FramePatch,
): { frame: CanvasFrame; htmlChanged: boolean; moved: CanvasFrame[] } | null {
  const board = getBoard(projectKey);
  const frame = board?.frames.find((f) => f.id === frameId);
  if (!board || !frame) return null;

  let htmlChanged = false;
  if (typeof patch.html === "string") {
    frame.revision += 1;
    delete frame.feedbackPendingRevision; // new revision answers the feedback
  delete frame.feedbackPendingSince;
    writeFrameHtml(projectKey, frameId, frame.revision, patch.html);
    htmlChanged = true;
  }
  applyGeometry(frame, patch);
  applyMeta(frame, patch);
  if (patch.sizedBy === "auto" || patch.sizedBy === "user") frame.sizedBy = patch.sizedBy;
  const now = Date.now();
  frame.updatedAt = now;

  const moved: CanvasFrame[] = [];
  if (patch.sizedBy === "auto") {
    const active = board.frames.filter((f) => f.status === "active");
    const movedYs = resolveCollisions(
      active.map((f) => ({ id: f.id, x: f.x, y: f.y, width: f.width, height: f.height })),
      frameId,
    );
    for (const f of active) {
      const y = movedYs.get(f.id);
      if (y !== undefined) {
        f.y = clampCoord(y);
        f.updatedAt = now;
        moved.push(f);
      }
    }
  }
  commit(board);
  return { frame, htmlChanged, moved };
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export interface AddCommentInput {
  body: string;
  author?: string;
  selection?: { originalText: string };
}

export function addComment(
  projectKey: string,
  frameId: string,
  input: AddCommentInput,
): CanvasComment | null {
  const board = getBoard(projectKey);
  const frame = board?.frames.find((f) => f.id === frameId);
  if (!board || !frame) return null;

  const comment: CanvasComment = {
    id: nextId("cmt"),
    frameId,
    // Caps: comment bodies are user-typed, but selection text comes from the
    // (untrusted) frame document — bound both so a hostile frame can't bloat
    // boards or feedback payloads.
    body: input.body.slice(0, MAX_COMMENT_BODY_CHARS),
    ...(input.author ? { author: input.author } : {}),
    ...(input.selection?.originalText
      ? { selection: { originalText: input.selection.originalText.slice(0, MAX_SELECTION_CHARS) } }
      : {}),
    frameRevision: frame.revision,
    resolved: false,
    createdAt: Date.now(),
  };
  board.comments.push(comment);
  commit(board);
  return comment;
}

export function updateComment(
  projectKey: string,
  commentId: string,
  patch: Partial<Pick<CanvasComment, "body" | "resolved">>,
): CanvasComment | null {
  const board = getBoard(projectKey);
  const comment = board?.comments.find((c) => c.id === commentId);
  if (!board || !comment) return null;

  if (typeof patch.body === "string") comment.body = patch.body;
  if (typeof patch.resolved === "boolean") comment.resolved = patch.resolved;
  commit(board);
  return comment;
}

export function deleteComment(projectKey: string, commentId: string): boolean {
  const board = getBoard(projectKey);
  if (!board) return false;
  const before = board.comments.length;
  board.comments = board.comments.filter((c) => c.id !== commentId);
  if (board.comments.length === before) return false;
  commit(board);
  return true;
}

// ---------------------------------------------------------------------------
// Feedback dispatch
// ---------------------------------------------------------------------------

/** Render dispatched comments in the established exportAnnotations voice. */
export function formatFeedbackMarkdown(
  frame: Pick<CanvasFrame, "title" | "revision">,
  comments: CanvasComment[],
): string {
  let output = `# Frame Feedback: ${frame.title} (rev ${frame.revision})\n\n`;
  output += `I've reviewed this frame and have ${comments.length} piece${comments.length > 1 ? "s" : ""} of feedback:\n\n`;
  comments.forEach((c, index) => {
    output += `## ${index + 1}. `;
    if (c.selection?.originalText) {
      output += `Feedback on: "${c.selection.originalText}"\n`;
    } else {
      output += `Feedback on the frame\n`;
    }
    output += `> ${c.body}\n\n`;
  });
  return output.trimEnd() + "\n";
}

function feedbackLogPath(projectKey: string): string {
  return join(boardDir(projectKey), "feedback.ndjson");
}

// Strictly monotonic dispatch clock: board-wide dispatches loop synchronously
// and would otherwise stamp several events with the same millisecond, making
// `since`-based replay ambiguous at the boundary.
let lastDispatchMs = 0;
function nextDispatchMs(): number {
  const now = Math.max(Date.now(), lastDispatchMs + 1);
  lastDispatchMs = now;
  return now;
}

/**
 * Bundle a frame's unresolved, undispatched comments (or an explicit list)
 * into a feedback event: marks them dispatched, appends the event to the
 * project's NDJSON log, and returns it. Returns null when the frame is
 * missing; returns an `empty` marker when there is nothing to send.
 */
export function dispatchFrameFeedback(
  projectKey: string,
  frameId: string,
  commentIds?: string[],
): CanvasFeedbackEvent | { empty: true } | null {
  const board = getBoard(projectKey);
  const frame = board?.frames.find((f) => f.id === frameId);
  if (!board || !frame) return null;

  const eligible = board.comments.filter(
    (c) =>
      c.frameId === frameId &&
      !c.dispatchedAt &&
      !c.resolved &&
      (!commentIds || commentIds.includes(c.id)),
  );
  if (eligible.length === 0) return { empty: true };

  const now = nextDispatchMs();
  for (const c of eligible) c.dispatchedAt = now;
  // Mark the frame as awaiting a revision at its current revision. Cleared
  // automatically once an HTML update bumps the revision past this value;
  // the timestamp lets the UI expire the indicator if no revision ever comes.
  frame.feedbackPendingRevision = frame.revision;
  frame.feedbackPendingSince = now;

  const event: CanvasFeedbackEvent = {
    event: "frame.feedback",
    projectKey,
    frameId,
    title: frame.title,
    revision: frame.revision,
    ...(frame.sessionId ? { sessionId: frame.sessionId } : {}),
    dispatchedAt: new Date(now).toISOString(),
    comments: eligible.map((c) => ({
      id: c.id,
      body: c.body,
      ...(c.author ? { author: c.author } : {}),
      ...(c.selection ? { selection: c.selection } : {}),
      createdAt: new Date(c.createdAt).toISOString(),
    })),
    feedbackMarkdown: formatFeedbackMarkdown(frame, eligible),
  };

  appendFileSync(feedbackLogPath(projectKey), JSON.stringify(event) + "\n", "utf-8");
  commit(board);
  return event;
}

/** Dispatch every frame's unresolved comments on a board. */
export function dispatchBoardFeedback(projectKey: string): CanvasFeedbackEvent[] {
  const board = getBoard(projectKey);
  if (!board) return [];
  const frameIds = new Set(
    board.comments.filter((c) => !c.dispatchedAt && !c.resolved).map((c) => c.frameId),
  );
  const events: CanvasFeedbackEvent[] = [];
  for (const frameId of frameIds) {
    const result = dispatchFrameFeedback(projectKey, frameId);
    if (result && !("empty" in result)) events.push(result);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Reply threads ("Send now" — expects a reply, not a revision)
// ---------------------------------------------------------------------------

/** Render a reply-request: the comment, the thread so far, and how to reply. */
function formatReplyRequestMarkdown(
  frame: Pick<CanvasFrame, "title">,
  comment: CanvasComment,
): string {
  let out = `# Reply requested: ${frame.title}\n\n`;
  out += `The user is waiting for a REPLY (not a document revision). Reply with:\n`;
  out += `  plannotator canvas reply ${comment.id} --as "<your name>" "<message>"\n\n`;
  if (comment.selection?.originalText) {
    out += `On selected text: "${comment.selection.originalText}"\n`;
  }
  out += `\n${comment.author ?? "user"}: ${comment.body}\n`;
  for (const r of comment.replies ?? []) {
    out += `${r.author} (${r.fromAgent ? "you" : "user"}): ${r.body}\n`;
  }
  return out;
}

function buildReplyRequestEvent(
  projectKey: string,
  frame: CanvasFrame,
  comment: CanvasComment,
  nowIso: string,
): CanvasReplyRequestEvent {
  return {
    event: "comment.reply_request",
    projectKey,
    frameId: frame.id,
    title: frame.title,
    commentId: comment.id,
    ...(frame.sessionId ? { sessionId: frame.sessionId } : {}),
    dispatchedAt: nowIso,
    comment: {
      body: comment.body,
      ...(comment.author ? { author: comment.author } : {}),
      ...(comment.selection ? { selection: comment.selection } : {}),
    },
    thread: (comment.replies ?? []).map((r) => ({
      author: r.author,
      body: r.body,
      fromAgent: r.fromAgent,
      createdAt: new Date(r.createdAt).toISOString(),
    })),
    feedbackMarkdown: formatReplyRequestMarkdown(frame, comment),
  };
}

/**
 * "Send now": dispatch a single comment expecting a REPLY. Marks it sent and
 * awaiting a reply (NOT a revision — never sets feedbackPendingRevision, so no
 * dots), logs + returns a reply-request event. `empty` if already sent.
 */
export function dispatchCommentReply(
  projectKey: string,
  commentId: string,
): CanvasReplyRequestEvent | { empty: true } | null {
  const board = getBoard(projectKey);
  const comment = board?.comments.find((c) => c.id === commentId);
  const frame = comment && board?.frames.find((f) => f.id === comment.frameId);
  if (!board || !comment || !frame) return null;
  if (comment.dispatchedAt || comment.resolved) return { empty: true };

  const now = nextDispatchMs();
  comment.dispatchedAt = now;
  comment.awaitingReply = true;
  comment.awaitingReplySince = now;

  const event = buildReplyRequestEvent(projectKey, frame, comment, new Date(now).toISOString());
  appendFileSync(feedbackLogPath(projectKey), JSON.stringify(event) + "\n", "utf-8");
  commit(board);
  return event;
}

/**
 * Append a reply to a comment's thread. Agent replies (fromAgent) answer the
 * pending request and clear `awaitingReply`. User replies (UI follow-ups)
 * re-arm `awaitingReply` and produce a fresh reply-request event so the agent
 * sees the follow-up. Returns the comment and any event to dispatch/log.
 */
export function addReply(
  projectKey: string,
  commentId: string,
  input: { author: string; body: string; fromAgent: boolean },
): { comment: CanvasComment; event?: CanvasReplyRequestEvent } | null {
  const board = getBoard(projectKey);
  const comment = board?.comments.find((c) => c.id === commentId);
  const frame = comment && board?.frames.find((f) => f.id === comment.frameId);
  if (!board || !comment || !frame) return null;

  const reply: CanvasReply = {
    id: nextId("rpl"),
    author: (input.author || (input.fromAgent ? "agent" : "user")).slice(0, 80),
    body: input.body.slice(0, MAX_COMMENT_BODY_CHARS),
    fromAgent: input.fromAgent,
    createdAt: Date.now(),
  };
  comment.replies = [...(comment.replies ?? []), reply];
  // A reply only makes sense once the comment is part of a thread — ensure it's
  // marked sent so it leaves the revision-feedback pool.
  if (!comment.dispatchedAt) comment.dispatchedAt = reply.createdAt;

  let event: CanvasReplyRequestEvent | undefined;
  if (input.fromAgent) {
    comment.awaitingReply = false;
    delete comment.awaitingReplySince;
  } else {
    comment.awaitingReply = true;
    comment.awaitingReplySince = reply.createdAt;
    const nowIso = new Date(nextDispatchMs()).toISOString();
    event = buildReplyRequestEvent(projectKey, frame, comment, nowIso);
    appendFileSync(feedbackLogPath(projectKey), JSON.stringify(event) + "\n", "utf-8");
  }
  commit(board);
  return { comment, ...(event ? { event } : {}) };
}

/**
 * Close (archive) a frame and emit an informational `frame.closed` event to
 * the watch log so the agent knows the preview was dismissed. The event is a
 * no-op acknowledgement — no revision is expected in response.
 */
export function closeFrame(
  projectKey: string,
  frameId: string,
): CanvasFrameClosedEvent | null {
  const board = getBoard(projectKey);
  const frame = board?.frames.find((f) => f.id === frameId);
  if (!board || !frame) return null;

  frame.status = "archived";
  frame.updatedAt = Date.now();

  const now = nextDispatchMs();
  const event: CanvasFrameClosedEvent = {
    event: "frame.closed",
    projectKey,
    frameId,
    title: frame.title,
    revision: frame.revision,
    ...(frame.sessionId ? { sessionId: frame.sessionId } : {}),
    dispatchedAt: new Date(now).toISOString(),
    feedbackMarkdown:
      `# Frame Closed: ${frame.title} (rev ${frame.revision})\n\n` +
      `The user closed this preview in the canvas. This is informational — ` +
      `no action or new revision is required.\n`,
  };

  appendFileSync(feedbackLogPath(projectKey), JSON.stringify(event) + "\n", "utf-8");
  commit(board);
  return event;
}

/**
 * Close (archive) every active frame on a board in a single commit — the bulk
 * counterpart to closeFrame, for clearing a whole board instead of dismissing
 * previews one by one. Reuses the per-frame `frame.closed` event (one per
 * frame) so the agent's watcher needs no new case; their `dispatchedAt`
 * timestamps stay strictly monotonic via nextDispatchMs. Commits once.
 * Returns the events (empty when the board is unknown or already clear).
 */
export function closeBoard(projectKey: string): CanvasFrameClosedEvent[] {
  const board = getBoard(projectKey);
  if (!board) return [];
  const active = board.frames.filter((f) => f.status === "active");
  if (active.length === 0) return [];

  const events: CanvasFrameClosedEvent[] = [];
  for (const frame of active) {
    frame.status = "archived";
    frame.updatedAt = Date.now();
    const now = nextDispatchMs();
    events.push({
      event: "frame.closed",
      projectKey,
      frameId: frame.id,
      title: frame.title,
      revision: frame.revision,
      ...(frame.sessionId ? { sessionId: frame.sessionId } : {}),
      dispatchedAt: new Date(now).toISOString(),
      feedbackMarkdown:
        `# Frame Closed: ${frame.title} (rev ${frame.revision})\n\n` +
        `The user cleared the canvas board. This is informational — ` +
        `no action or new revision is required.\n`,
    });
  }
  for (const event of events) {
    appendFileSync(feedbackLogPath(projectKey), JSON.stringify(event) + "\n", "utf-8");
  }
  commit(board);
  return events;
}

/**
 * Read dispatched feedback events from the project log, optionally filtered
 * to those strictly after `sinceIso`. Exclusive filtering is safe because
 * dispatch timestamps are strictly monotonic (see dispatchFrameFeedback) —
 * no two events ever share a `dispatchedAt`, so a reconnect replay with the
 * last-seen timestamp can never skip an unseen sibling. Malformed lines are
 * skipped.
 */
export function readFeedbackEvents(
  projectKey: string,
  sinceIso?: string,
): CanvasWatchEvent[] {
  if (!isSafeProjectKey(projectKey)) return [];
  const path = feedbackLogPath(projectKey);
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, "utf-8").split("\n");
    const events: CanvasWatchEvent[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as CanvasWatchEvent;
        if (sinceIso && event.dispatchedAt <= sinceIso) continue;
        events.push(event);
      } catch {
        // skip malformed line
      }
    }
    return events;
  } catch {
    return [];
  }
}
