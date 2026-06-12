/**
 * HTTP + SSE client for the canvas server. All endpoints are same-origin.
 */

import type {
  CanvasBoard,
  CanvasBoardEvent,
  CanvasComment,
  CanvasFrame,
  CanvasProjectSummary,
} from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep default
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function fetchProjects(): Promise<CanvasProjectSummary[]> {
  const body = await json<{ projects: CanvasProjectSummary[] }>(
    await fetch("/api/canvas/projects"),
  );
  return body.projects;
}

export async function fetchBoard(projectKey: string): Promise<CanvasBoard> {
  const body = await json<{ board: CanvasBoard }>(
    await fetch(`/api/canvas/board?project=${encodeURIComponent(projectKey)}`),
  );
  return body.board;
}

export async function fetchFrameHtml(
  projectKey: string,
  frameId: string,
): Promise<{ html: string; revision: number }> {
  return json(
    await fetch(
      `/api/canvas/frames/${encodeURIComponent(frameId)}/html?project=${encodeURIComponent(projectKey)}`,
    ),
  );
}

export async function patchFrame(
  projectKey: string,
  frameId: string,
  patch: Partial<Pick<CanvasFrame, "x" | "y" | "width" | "height" | "title" | "status">> & {
    /** Auto-fit ("auto") or manual-resize pin ("user"); "agent" is create-only. */
    sizedBy?: "auto" | "user";
  },
): Promise<CanvasFrame> {
  const body = await json<{ frame: CanvasFrame }>(
    await fetch(
      `/api/canvas/frames/${encodeURIComponent(frameId)}?project=${encodeURIComponent(projectKey)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    ),
  );
  return body.frame;
}

export async function postComment(
  projectKey: string,
  frameId: string,
  input: { body: string; author?: string; selection?: { originalText: string } },
): Promise<CanvasComment> {
  const body = await json<{ comment: CanvasComment }>(
    await fetch(
      `/api/canvas/frames/${encodeURIComponent(frameId)}/comments?project=${encodeURIComponent(projectKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    ),
  );
  return body.comment;
}

export async function patchComment(
  projectKey: string,
  commentId: string,
  patch: { body?: string; resolved?: boolean },
): Promise<CanvasComment> {
  const body = await json<{ comment: CanvasComment }>(
    await fetch(
      `/api/canvas/comments/${encodeURIComponent(commentId)}?project=${encodeURIComponent(projectKey)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    ),
  );
  return body.comment;
}

export async function deleteComment(projectKey: string, commentId: string): Promise<void> {
  await json(
    await fetch(
      `/api/canvas/comments/${encodeURIComponent(commentId)}?project=${encodeURIComponent(projectKey)}`,
      { method: "DELETE" },
    ),
  );
}

export async function dispatchFrame(
  projectKey: string,
  frameId: string,
  commentIds?: string[],
): Promise<{ empty?: boolean }> {
  return json(
    await fetch(
      `/api/canvas/frames/${encodeURIComponent(frameId)}/dispatch?project=${encodeURIComponent(projectKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(commentIds ? { commentIds } : {}),
      },
    ),
  );
}

/** Dispatch all pending comments on a board. Returns the dispatched-event count. */
export async function dispatchBoard(projectKey: string): Promise<number> {
  const body = await json<{ events: unknown[] }>(
    await fetch(`/api/canvas/projects/${encodeURIComponent(projectKey)}/dispatch`, {
      method: "POST",
    }),
  );
  return body.events.length;
}

/** Close (archive) a frame and notify the watching agent as a no-op. */
export async function closeFrame(projectKey: string, frameId: string): Promise<void> {
  await json(
    await fetch(
      `/api/canvas/frames/${encodeURIComponent(frameId)}/close?project=${encodeURIComponent(projectKey)}`,
      { method: "POST" },
    ),
  );
}

/** Close (archive) every active frame on a board at once. Returns the count. */
export async function closeBoard(projectKey: string): Promise<number> {
  const body = await json<{ closed: number }>(
    await fetch(`/api/canvas/projects/${encodeURIComponent(projectKey)}/close`, {
      method: "POST",
    }),
  );
  return body.closed;
}

/** "Send now": dispatch a single comment expecting a reply (no dots). */
export async function sendCommentNow(
  projectKey: string,
  commentId: string,
): Promise<{ empty?: boolean }> {
  return json(
    await fetch(
      `/api/canvas/comments/${encodeURIComponent(commentId)}/send-now?project=${encodeURIComponent(projectKey)}`,
      { method: "POST" },
    ),
  );
}

/** Add a reply to a comment's thread (user follow-up from the UI). */
export async function replyToComment(
  projectKey: string,
  commentId: string,
  input: { author: string; body: string },
): Promise<CanvasComment> {
  const body = await json<{ comment: CanvasComment }>(
    await fetch(
      `/api/canvas/comments/${encodeURIComponent(commentId)}/reply?project=${encodeURIComponent(projectKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, fromAgent: false }),
      },
    ),
  );
  return body.comment;
}

/** Reflow all frames into a tidy grid. Returns the updated board. */
export async function arrangeBoard(projectKey: string): Promise<CanvasBoard> {
  const body = await json<{ board: CanvasBoard }>(
    await fetch(`/api/canvas/projects/${encodeURIComponent(projectKey)}/arrange`, {
      method: "POST",
    }),
  );
  return body.board;
}

/**
 * Subscribe to board mutation events. Reconnects with backoff; calls
 * `onReconnect` after each successful (re)connect so the caller can refetch
 * state it may have missed while disconnected.
 */
export function subscribeBoardEvents(
  onEvent: (event: CanvasBoardEvent) => void,
  onReconnect: () => void,
): () => void {
  let stopped = false;
  let source: EventSource | null = null;
  let retryMs = 1000;
  let everConnected = false;

  function connect() {
    if (stopped) return;
    source = new EventSource("/api/canvas/stream");
    source.onopen = () => {
      retryMs = 1000;
      if (everConnected) onReconnect();
      everConnected = true;
    };
    source.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data) as CanvasBoardEvent);
      } catch {
        // skip malformed event
      }
    };
    source.onerror = () => {
      source?.close();
      if (stopped) return;
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 15_000);
    };
  }

  connect();
  return () => {
    stopped = true;
    source?.close();
  };
}
