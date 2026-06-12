/**
 * Client-side types for the canvas editor.
 *
 * Frame/comment/board shapes mirror packages/shared/canvas-store.ts (the
 * server is the source of truth); the camera and UI-only types live here.
 */

export interface CanvasFrame {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  revision: number;
  sessionId?: string;
  groupHint?: string;
  sourcePath?: string;
  /** Revision feedback was last dispatched at; awaiting revision while === revision. */
  feedbackPendingRevision?: number;
  /** Size owner: auto (UI fits content height), agent (--size), user (manual resize pins). */
  sizedBy?: "auto" | "agent" | "user";
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
}

export interface CanvasReply {
  id: string;
  author: string;
  body: string;
  fromAgent: boolean;
  createdAt: number;
}

export interface CanvasComment {
  id: string;
  frameId: string;
  body: string;
  author?: string;
  selection?: { originalText: string };
  frameRevision: number;
  resolved: boolean;
  dispatchedAt?: number;
  replies?: CanvasReply[];
  awaitingReply?: boolean;
  createdAt: number;
}

export interface CanvasBoard {
  projectKey: string;
  projectName: string;
  root: string;
  seq: number;
  frames: CanvasFrame[];
  comments: CanvasComment[];
  createdAt: number;
  updatedAt: number;
}

export interface CanvasProjectSummary {
  projectKey: string;
  projectName: string;
  root: string;
  frameCount: number;
  unresolvedComments: number;
  updatedAt: number;
}

/** SSE event broadcast by the server on board mutations. */
export interface CanvasBoardEvent {
  type:
    | "hello"
    | "frame.created"
    | "frame.updated"
    | "comment.created"
    | "comment.updated"
    | "comment.deleted"
    | "feedback.dispatched"
    | "board.arranged"
    | "board.cleared";
  projectKey?: string;
  seq?: number;
  frame?: CanvasFrame;
  htmlChanged?: boolean;
  comment?: CanvasComment;
  commentId?: string;
  dispatchedCommentIds?: string[];
  frameIds?: string[];
}

/** Camera: world → screen is `screen = world * z + pan`. */
export interface Camera {
  x: number;
  y: number;
  z: number;
}
