/**
 * Board comments panel — shows ALL comments on the board by default, grouped
 * by frame, with jump-to-frame, resolve/delete, per-frame and board-wide
 * dispatch. The composer targets the currently-active frame.
 *
 * Dispatch confirmation is owned by the parent (a shared shadcn dialog), so
 * this panel just requests dispatch and never renders its own modal.
 */

import React, { useMemo, useRef, useState } from "react";
import { X, CornerDownLeft } from "lucide-react";
import type { CanvasComment, CanvasFrame } from "../types";

const ROW_QUOTE = "border-l-2 border-accent/60 pl-2 text-[11px] italic text-muted-foreground";

function CommentRow({
  comment,
  onResolve,
  onDelete,
  onSendNow,
  onReply,
}: {
  comment: CanvasComment;
  onResolve: (resolved: boolean) => void;
  onDelete: () => void;
  onSendNow: () => void;
  onReply: (body: string) => void;
}) {
  const dispatched = !!comment.dispatchedAt;
  const replies = comment.replies ?? [];
  const inThread = replies.length > 0 || comment.awaitingReply;
  const [replyDraft, setReplyDraft] = useState("");

  return (
    <div
      className={`group rounded-md border p-2 ${
        inThread ? "border-accent/40 bg-accent/5" : "border-border/60 bg-background/40"
      } ${comment.resolved ? "opacity-60" : ""}`}
    >
      {comment.selection?.originalText && (
        <div className={`mb-1 truncate ${ROW_QUOTE}`}>“{comment.selection.originalText}”</div>
      )}
      <div className="whitespace-pre-wrap text-[12.5px] leading-snug text-foreground">
        {comment.body}
      </div>

      {/* Reply thread */}
      {replies.length > 0 && (
        <div className="mt-2 space-y-1.5 border-l-2 border-border/60 pl-2">
          {replies.map((r) => (
            <div key={r.id}>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className={`font-semibold ${r.fromAgent ? "text-primary" : "text-foreground"}`}>
                  {r.author}
                </span>
                {r.fromAgent && (
                  <span className="rounded bg-primary/15 px-1 text-[9px] font-medium text-primary">
                    agent
                  </span>
                )}
              </div>
              <div className="whitespace-pre-wrap text-[12px] leading-snug text-foreground/90">
                {r.body}
              </div>
            </div>
          ))}
        </div>
      )}

      {comment.awaitingReply && !comment.resolved && (
        <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-accent">
          <span className="awaiting-reply-pulse h-1.5 w-1.5 rounded-full bg-accent" />
          waiting for a reply…
        </div>
      )}

      {/* In-thread user follow-up */}
      {inThread && !comment.resolved && (
        <div className="mt-2 flex gap-1.5">
          <input
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && replyDraft.trim()) {
                onReply(replyDraft.trim());
                setReplyDraft("");
              }
            }}
            placeholder="Reply…"
            className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-1 text-[11.5px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={() => {
              if (replyDraft.trim()) {
                onReply(replyDraft.trim());
                setReplyDraft("");
              }
            }}
            disabled={!replyDraft.trim()}
            className="shrink-0 cursor-pointer rounded px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            Reply
          </button>
        </div>
      )}

      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
        {comment.author && <span className="truncate">{comment.author}</span>}
        <span>r{comment.frameRevision}</span>
        {dispatched && !inThread && (
          <span className="rounded bg-success/15 px-1 py-px font-medium text-success">sent</span>
        )}
        {comment.resolved && (
          <span className="rounded bg-muted px-1 py-px font-medium">resolved</span>
        )}
        <span className="ml-auto flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {!dispatched && !comment.resolved && (
            <button
              onClick={onSendNow}
              className="cursor-pointer rounded px-1 py-px font-medium text-accent hover:bg-accent/15"
              title="Send now and wait for a reply (no document revision)"
            >
              send now
            </button>
          )}
          {!dispatched && (
            <button
              onClick={() => onResolve(!comment.resolved)}
              className="cursor-pointer rounded px-1 py-px hover:bg-muted hover:text-foreground"
            >
              {comment.resolved ? "unresolve" : "resolve"}
            </button>
          )}
          {!dispatched && (
            <button
              onClick={onDelete}
              className="cursor-pointer rounded px-1 py-px hover:bg-destructive/15 hover:text-destructive"
            >
              delete
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

export interface CommentsPanelProps {
  frames: CanvasFrame[];
  comments: CanvasComment[];
  activeFrameId: string | null;
  /** Frame whose group should be scrolled into view + highlighted, if any. */
  focusFrameId: string | null;
  onAddComment: (frameId: string, body: string) => Promise<void>;
  /** Add a comment and immediately send it expecting a reply (no dots). */
  onAddAndSendNow: (frameId: string, body: string) => Promise<void>;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDeleteComment: (id: string) => void;
  onSendCommentNow: (id: string) => void;
  onReplyInThread: (commentId: string, body: string) => void;
  onJumpToFrame: (frameId: string) => void;
  onDispatchFrame: (frameId: string) => void;
  onDispatchAll: () => void;
  onClose: () => void;
}

export function CommentsPanel({
  frames,
  comments,
  activeFrameId,
  focusFrameId,
  onAddComment,
  onAddAndSendNow,
  onResolveComment,
  onDeleteComment,
  onSendCommentNow,
  onReplyInThread,
  onJumpToFrame,
  onDispatchFrame,
  onDispatchAll,
  onClose,
}: CommentsPanelProps) {
  const [draft, setDraft] = useState("");
  const groupRefs = useRef(new Map<string, HTMLDivElement>());

  const frameById = useMemo(() => new Map(frames.map((f) => [f.id, f])), [frames]);
  const activeFrame = activeFrameId ? frameById.get(activeFrameId) ?? null : null;

  const totalPending = useMemo(
    () => comments.filter((c) => !c.resolved && !c.dispatchedAt).length,
    [comments],
  );

  // Group comments by frame. Include the active frame even when empty so the
  // user can always see where a new comment will land. Order: active frame
  // first, then frames with the most pending comments, then by recency.
  const groups = useMemo(() => {
    const byFrame = new Map<string, CanvasComment[]>();
    for (const c of comments) {
      const list = byFrame.get(c.frameId) ?? [];
      list.push(c);
      byFrame.set(c.frameId, list);
    }
    if (activeFrameId && frameById.has(activeFrameId) && !byFrame.has(activeFrameId)) {
      byFrame.set(activeFrameId, []);
    }
    const entries = [...byFrame.entries()]
      .map(([frameId, list]) => ({
        frameId,
        frame: frameById.get(frameId),
        comments: list.sort((a, b) => a.createdAt - b.createdAt),
        pending: list.filter((c) => !c.resolved && !c.dispatchedAt).length,
      }))
      .filter((g) => g.frame); // drop archived/missing frames
    entries.sort((a, b) => {
      if (a.frameId === activeFrameId) return -1;
      if (b.frameId === activeFrameId) return 1;
      if (b.pending !== a.pending) return b.pending - a.pending;
      return (b.frame!.updatedAt ?? 0) - (a.frame!.updatedAt ?? 0);
    });
    return entries;
  }, [comments, frameById, activeFrameId]);

  // Scroll the focused frame's group into view when requested.
  React.useEffect(() => {
    if (!focusFrameId) return;
    const el = groupRefs.current.get(focusFrameId);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusFrameId, groups]);

  async function submitDraft(sendNow = false) {
    const body = draft.trim();
    if (!body || !activeFrameId) return;
    setDraft("");
    const action = sendNow ? onAddAndSendNow : onAddComment;
    await action(activeFrameId, body).catch(() => setDraft(body));
  }

  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-foreground">Comments</div>
          <div className="text-[10px] text-muted-foreground">
            {comments.length} total · {totalPending} pending
          </div>
        </div>
        {totalPending > 0 && (
          <button
            onClick={onDispatchAll}
            className="cursor-pointer rounded-md bg-primary px-2 py-1 text-[11.5px] font-medium text-primary-foreground hover:opacity-90"
            title="Send all pending comments to the agent"
          >
            Send all ({totalPending})
          </button>
        )}
        <button
          onClick={onClose}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Close panel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Grouped comments */}
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {groups.length === 0 && (
          <div className="py-10 text-center text-xs leading-relaxed text-muted-foreground">
            No comments yet.
            <br />
            Select text inside a frame, or click a frame and write one below.
          </div>
        )}
        {groups.map((g) => {
          const isFocus = g.frameId === focusFrameId;
          return (
            <div
              key={g.frameId}
              ref={(el) => {
                if (el) groupRefs.current.set(g.frameId, el);
                else groupRefs.current.delete(g.frameId);
              }}
              className={`rounded-lg border p-2 ${
                isFocus ? "border-accent/50 bg-accent/5" : "border-transparent"
              }`}
            >
              <div className="mb-1.5 flex items-center gap-2">
                <button
                  onClick={() => onJumpToFrame(g.frameId)}
                  className="min-w-0 flex-1 truncate text-left text-[12px] font-semibold text-foreground hover:text-accent"
                  title="Jump to frame"
                >
                  {g.frame!.title}
                </button>
                {g.pending > 0 && (
                  <button
                    onClick={() => onDispatchFrame(g.frameId)}
                    className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Send this frame's feedback to the agent"
                  >
                    Send ({g.pending})
                  </button>
                )}
              </div>
              {g.comments.length === 0 ? (
                <div className="px-1 pb-1 text-[11px] text-muted-foreground/70">
                  No comments — add one below.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {g.comments.map((c) => (
                    <CommentRow
                      key={c.id}
                      comment={c}
                      onResolve={(resolved) => onResolveComment(c.id, resolved)}
                      onDelete={() => onDeleteComment(c.id)}
                      onSendNow={() => onSendCommentNow(c.id)}
                      onReply={(body) => onReplyInThread(c.id, body)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Composer — targets the active frame */}
      <div className="border-t border-border/60 px-3 py-2.5">
        {activeFrame ? (
          <>
            <div className="mb-1.5 truncate text-[11px] text-muted-foreground">
              Commenting on <span className="font-medium text-foreground">{activeFrame.title}</span>
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submitDraft();
                }
              }}
              placeholder="Comment on this frame…"
              rows={2}
              className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-[12.5px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground/70">
                <CornerDownLeft className="h-3 w-3" /> ⌘↵
              </span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => void submitDraft(true)}
                  disabled={!draft.trim()}
                  className="cursor-pointer rounded-md border border-accent/40 px-2 py-1.5 text-[12px] font-medium text-accent hover:bg-accent/10 disabled:cursor-default disabled:opacity-40"
                  title="Add and send now — wait for a reply (no document revision)"
                >
                  Send now
                </button>
                <button
                  onClick={() => void submitDraft(false)}
                  disabled={!draft.trim()}
                  className="cursor-pointer rounded-md bg-muted px-2.5 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted/70 disabled:cursor-default disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="py-1 text-center text-[11px] leading-relaxed text-muted-foreground">
            Click a frame to comment on it, or select text inside a frame.
          </div>
        )}
      </div>
    </div>
  );
}
