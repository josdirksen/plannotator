/**
 * Plannotator Canvas — root app (docs/canvas-spec.md).
 *
 * Left: flat project sidebar (offcanvas rail + edge-peek). Center: the
 * two-layer canvas viewport. Right: comments panel for the selected frame.
 * State flows in over one SSE connection; agents push frames via the CLI.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast, Toaster } from "sonner";
import { MessageSquare, LayoutGrid, X } from "lucide-react";
import { ThemeProvider, useTheme } from "@plannotator/ui/components/ThemeProvider";
import { CommentPopover } from "@plannotator/ui/components/CommentPopover";
import { getIdentity } from "@plannotator/ui/utils/identity";
import type {
  Camera,
  CanvasBoardEvent,
  CanvasComment,
  CanvasFrame,
  CanvasProjectSummary,
} from "./types";
import * as api from "./api";
import { CanvasViewport } from "./components/CanvasViewport";
import { CommentsPanel } from "./components/CommentsPanel";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { FocusBar } from "./components/FocusBar";
import {
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "./components/sidebar/SidebarShell";
import { SidebarPeek } from "./components/sidebar/SidebarPeek";
import { SidebarContent } from "./components/sidebar/SidebarContent";

declare const __APP_VERSION__: string;

const BRIDGE_PREFIX = "plannotator-bridge-";

// Auto-fit: frames sized by no one (sizedBy "auto" / legacy undefined) grow to
// their bridge-measured content height, so pages land at natural size instead
// of uniform constrained cards. Bounds keep a pathological page from creating
// a skyscraper or a sliver.
const AUTO_FIT_MIN_HEIGHT = 160;
const AUTO_FIT_MAX_HEIGHT = 2400;
/** Ignore sub-epsilon differences — re-fitting on every minor reflow would churn. */
const AUTO_FIT_EPSILON = 24;
/** Max fits per revision: a page whose content height tracks its container
 *  would otherwise re-report after every fit, forever. */
const AUTO_FIT_MAX_PASSES = 3;

/** An in-frame text selection awaiting a comment. The popover anchors to a
 *  stable fixed-position element (`anchorEl`) that we move imperatively —
 *  passing a fresh rect each scroll tick would change the anchor's identity
 *  and trip the shared CommentPopover's drag-reset, snapping a user-dragged
 *  popover back onto the selection (the HtmlViewer uses this same pattern). */
interface SelectionState {
  frameId: string;
  text: string;
  anchorEl: HTMLElement;
}

/** A pending feedback-dispatch confirmation. */
type DispatchTarget = { kind: "frame"; frameId: string } | { kind: "all" };

function cameraStorageKey(projectKey: string): string {
  return `plannotator-canvas-camera:${projectKey}`;
}

function loadCamera(projectKey: string): Camera | null {
  try {
    const raw = localStorage.getItem(cameraStorageKey(projectKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Camera;
    if (
      typeof parsed.x === "number" &&
      typeof parsed.y === "number" &&
      typeof parsed.z === "number" &&
      parsed.z > 0
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Minimal dark/light toggle using the shared theme provider. */
function ModeButton() {
  const { resolvedMode, setMode } = useTheme();
  return (
    <button
      onClick={() => setMode(resolvedMode === "dark" ? "light" : "dark")}
      title="Toggle light/dark"
      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {resolvedMode === "dark" ? "☾" : "☀"}
    </button>
  );
}

function CanvasApp() {
  const { open: sidebarOpen } = useSidebar();

  const [projects, setProjects] = useState<CanvasProjectSummary[]>([]);
  const [activeProjectKey, setActiveProjectKey] = useState<string | null>(null);
  const [frames, setFrames] = useState<CanvasFrame[]>([]);
  const [comments, setComments] = useState<CanvasComment[]>([]);
  const boardSeq = useRef(0);

  const [htmlCache, setHtmlCache] = useState(new Map<string, { html: string; revision: number }>());
  const htmlInFlight = useRef(new Set<string>());

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null);
  const [focusedFrameId, setFocusedFrameId] = useState<string | null>(null);

  // Aggregate comments panel: shows every board comment grouped by frame.
  // `focusCommentFrameId` scrolls/highlights one frame's group when opened
  // from a pin or the focus bar.
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [focusCommentFrameId, setFocusCommentFrameId] = useState<string | null>(null);

  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [dispatchTarget, setDispatchTarget] = useState<DispatchTarget | null>(null);
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);

  const iframeMap = useRef(new Map<string, HTMLIFrameElement>());
  const appliedMarks = useRef(new Map<string, Set<string>>());
  const cameraCommandRef = useRef<null | { type: "fit" } | { type: "center-frame"; frameId: string }>(null);
  const pendingDeepLinkFrame = useRef<string | null>(null);

  // Stable anchor element for the selection popover (identity must never
  // change while the popover is open — see SelectionState docs).
  const selectionAnchorRef = useRef<HTMLDivElement | null>(null);
  const getSelectionAnchor = useCallback((x: number, y: number): HTMLElement => {
    let el = selectionAnchorRef.current;
    if (!el) {
      el = document.createElement("div");
      el.style.position = "fixed";
      el.style.width = "1px";
      el.style.height = "1px";
      el.style.pointerEvents = "none";
      document.body.appendChild(el);
      selectionAnchorRef.current = el;
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    return el;
  }, []);
  useEffect(
    () => () => {
      selectionAnchorRef.current?.remove();
      selectionAnchorRef.current = null;
    },
    [],
  );

  const framesRef = useRef(frames);
  framesRef.current = frames;
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const selectionRef = useRef<SelectionState | null>(null);
  selectionRef.current = selection;
  const focusedFrameIdRef = useRef(focusedFrameId);
  focusedFrameIdRef.current = focusedFrameId;

  // Defensive invariant: the popover must never outlive its frame being the
  // interactive one (a programmatic activation change could otherwise leave it
  // anchored to — and submitting into — the wrong frame).
  useEffect(() => {
    setSelection((prev) =>
      prev && prev.frameId !== activeFrameId && prev.frameId !== focusedFrameId ? null : prev,
    );
  }, [activeFrameId, focusedFrameId]);
  const activeProjectRef = useRef(activeProjectKey);
  activeProjectRef.current = activeProjectKey;

  // Toasts via sonner, matching the plan/review apps.
  const pushToast = useCallback((message: string, actionLabel?: string, onAction?: () => void) => {
    if (actionLabel && onAction) {
      toast(message, { action: { label: actionLabel, onClick: onAction } });
    } else {
      toast(message);
    }
  }, []);

  const openComments = useCallback((frameId?: string) => {
    setCommentsPanelOpen(true);
    setFocusCommentFrameId(frameId ?? null);
  }, []);

  // Tidy: reflow every frame into a grid (server-side, one commit) and fit.
  const tidyBoard = useCallback(async () => {
    const projectKey = activeProjectRef.current;
    if (!projectKey) return;
    try {
      const board = await api.arrangeBoard(projectKey);
      // Same staleness guards as loadBoard: the user may have switched
      // projects while the arrange was in flight — never apply A's board (or
      // clobber the seq counter) while B is active.
      if (activeProjectRef.current !== projectKey) return;
      if (board.seq < boardSeq.current) return;
      boardSeq.current = board.seq;
      setFrames(board.frames);
      cameraCommandRef.current = { type: "fit" };
      setFrames((prev) => [...prev]);
    } catch {
      pushToast("Couldn't arrange the board");
    }
  }, [pushToast]);

  // ---------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await api.fetchProjects());
    } catch {
      // server briefly unavailable; SSE reconnect will retry
    }
  }, []);

  const loadBoard = useCallback(async (projectKey: string): Promise<CanvasFrame[] | null> => {
    try {
      const board = await api.fetchBoard(projectKey);
      // Staleness guards: the user may have switched projects while this
      // fetch was in flight, and an SSE event applied meanwhile can be newer
      // than the snapshot — never regress state or the seq counter.
      if (activeProjectRef.current !== projectKey) return null;
      if (board.seq < boardSeq.current) return null;
      boardSeq.current = board.seq;
      setFrames(board.frames);
      setComments(board.comments);
      return board.frames;
    } catch {
      if (activeProjectRef.current !== projectKey) return null;
      setFrames([]);
      setComments([]);
      return [];
    }
  }, []);

  const selectProject = useCallback(
    (projectKey: string, options?: { frameId?: string; singleDoc?: boolean }) => {
      setActiveProjectKey(projectKey);
      activeProjectRef.current = projectKey; // sync for in-flight fetch guards
      boardSeq.current = 0;
      setSelectedIds(new Set());
      setActiveFrameId(null);
      setFocusedFrameId(null);
      setFocusCommentFrameId(null);
      setSelection(null);
      setHtmlCache(new Map());
      htmlInFlight.current.clear();
      appliedMarks.current.clear();
      pendingDeepLinkFrame.current = options?.frameId ?? null;
      const wantSingleDoc = options?.singleDoc === true;
      const url = new URL(window.location.href);
      url.searchParams.set("project", projectKey);
      url.searchParams.delete("frame");
      url.searchParams.delete("single");
      window.history.replaceState(null, "", url.toString());
      void loadBoard(projectKey).then((frames) => {
        const deepLinkFrame = pendingDeepLinkFrame.current;
        const active = (frames ?? []).filter((f) => f.status === "active");
        // --single-doc: open the lone frame full-screen — but ONLY if the board
        // truly has just this one frame (the extra guard).
        const singleEligible =
          wantSingleDoc &&
          deepLinkFrame != null &&
          active.length === 1 &&
          active[0].id === deepLinkFrame;
        if (singleEligible) {
          cameraCommandRef.current = { type: "fit" }; // sane camera behind focus
          setFocusedFrameId(deepLinkFrame);
          pendingDeepLinkFrame.current = null;
        } else if (deepLinkFrame) {
          cameraCommandRef.current = { type: "center-frame", frameId: deepLinkFrame };
          pendingDeepLinkFrame.current = null;
        } else if (!loadCamera(projectKey)) {
          cameraCommandRef.current = { type: "fit" };
        }
        // Re-render so the viewport effect consumes the command.
        setFrames((prev) => [...prev]);
      });
    },
    [loadBoard],
  );

  // Initial load: projects + deep link.
  useEffect(() => {
    void (async () => {
      const list = await api.fetchProjects().catch(() => [] as CanvasProjectSummary[]);
      setProjects(list);
      const params = new URLSearchParams(window.location.search);
      const wanted = params.get("project");
      const frameId = params.get("frame") ?? undefined;
      const singleDoc = params.get("single") === "1";
      const target =
        (wanted && list.find((p) => p.projectKey === wanted)?.projectKey) ||
        list[0]?.projectKey ||
        null;
      if (target) selectProject(target, { frameId, singleDoc });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------
  // SSE: board events
  // ---------------------------------------------------------------------

  const projectsRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleProjectsRefresh = useCallback(() => {
    if (projectsRefreshTimer.current) return;
    projectsRefreshTimer.current = setTimeout(() => {
      projectsRefreshTimer.current = null;
      void refreshProjects();
    }, 500);
  }, [refreshProjects]);

  const invalidateFrameHtml = useCallback((frameId: string, revision: number) => {
    htmlInFlight.current.delete(frameId);
    appliedMarks.current.delete(frameId);
    void (async () => {
      const projectKey = activeProjectRef.current;
      if (!projectKey) return;
      try {
        const result = await api.fetchFrameHtml(projectKey, frameId);
        setHtmlCache((prev) => {
          const next = new Map(prev);
          next.set(frameId, { html: result.html, revision: result.revision });
          return next;
        });
      } catch {
        // frame may have been archived since
      }
    })();
    void revision;
  }, []);

  const handleBoardEvent = useCallback(
    (event: CanvasBoardEvent) => {
      if (event.type === "hello") return;
      scheduleProjectsRefresh();
      if (!event.projectKey || event.projectKey !== activeProjectRef.current) return;

      // Seq-gap detection: missed events → full board resync.
      if (typeof event.seq === "number") {
        const expected = boardSeq.current + 1;
        if (event.seq < expected) return; // stale/duplicate (e.g. our own echo)
        if (event.seq > expected) {
          boardSeq.current = event.seq;
          void loadBoard(event.projectKey);
          return;
        }
        boardSeq.current = event.seq;
      }

      switch (event.type) {
        case "frame.created": {
          const frame = event.frame!;
          setFrames((prev) => (prev.some((f) => f.id === frame.id) ? prev : [...prev, frame]));
          pushToast(`New frame: ${frame.title}`, "Jump to", () => {
            cameraCommandRef.current = { type: "center-frame", frameId: frame.id };
            setFrames((prev) => [...prev]);
          });
          break;
        }
        case "frame.updated": {
          const frame = event.frame!;
          setFrames((prev) => prev.map((f) => (f.id === frame.id ? frame : f)));
          if (event.htmlChanged) invalidateFrameHtml(frame.id, frame.revision);
          break;
        }
        case "comment.created": {
          const comment = event.comment!;
          setComments((prev) =>
            prev.some((c) => c.id === comment.id) ? prev : [...prev, comment],
          );
          break;
        }
        case "comment.updated": {
          const comment = event.comment!;
          setComments((prev) => prev.map((c) => (c.id === comment.id ? comment : c)));
          break;
        }
        case "comment.deleted": {
          setComments((prev) => prev.filter((c) => c.id !== event.commentId));
          break;
        }
        case "board.arranged": {
          // Many frames moved in one commit — resync the whole board.
          void loadBoard(event.projectKey);
          break;
        }
        case "board.cleared": {
          // Every active frame was archived at once. Drop them, and let go of
          // any focus/selection that pointed at a now-gone frame. Idempotent,
          // so it's safe whether this is our own echo or another client's.
          const ids = new Set(event.frameIds ?? []);
          setFrames((prev) => prev.filter((f) => !ids.has(f.id)));
          setFocusedFrameId((prev) => (prev && ids.has(prev) ? null : prev));
          setActiveFrameId((prev) => (prev && ids.has(prev) ? null : prev));
          setSelection((prev) => (prev && ids.has(prev.frameId) ? null : prev));
          break;
        }
        case "feedback.dispatched": {
          const ids = new Set(event.dispatchedCommentIds ?? []);
          const now = Date.now();
          setComments((prev) =>
            prev.map((c) => (ids.has(c.id) ? { ...c, dispatchedAt: c.dispatchedAt ?? now } : c)),
          );
          // The dispatched frame now carries feedbackPendingRevision — apply it
          // so the awaiting-revision indicator lights up.
          if (event.frame) {
            const f = event.frame;
            setFrames((prev) => prev.map((x) => (x.id === f.id ? f : x)));
          }
          break;
        }
      }
    },
    [scheduleProjectsRefresh, loadBoard, pushToast, invalidateFrameHtml],
  );

  useEffect(() => {
    return api.subscribeBoardEvents(handleBoardEvent, () => {
      void refreshProjects();
      const projectKey = activeProjectRef.current;
      if (projectKey) void loadBoard(projectKey);
    });
  }, [handleBoardEvent, refreshProjects, loadBoard]);

  // ---------------------------------------------------------------------
  // Frame HTML cache
  // ---------------------------------------------------------------------

  const ensureHtml = useCallback(
    (frameId: string) => {
      const projectKey = activeProjectRef.current;
      if (!projectKey) return;
      const frame = framesRef.current.find((f) => f.id === frameId);
      if (!frame) return;
      const cached = htmlCache.get(frameId);
      if (cached && cached.revision === frame.revision) return;
      if (htmlInFlight.current.has(frameId)) return;
      htmlInFlight.current.add(frameId);
      void api
        .fetchFrameHtml(projectKey, frameId)
        .then((result) => {
          setHtmlCache((prev) => {
            const next = new Map(prev);
            next.set(frameId, { html: result.html, revision: result.revision });
            return next;
          });
        })
        .catch(() => {
          // retried on next mount-set change
        })
        .finally(() => htmlInFlight.current.delete(frameId));
    },
    [htmlCache],
  );

  // ---------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------

  const commitGeometry = useCallback(
    (id: string, geometry: Pick<CanvasFrame, "x" | "y" | "width" | "height">) => {
      const projectKey = activeProjectRef.current;
      if (!projectKey) return;
      // A manual resize pins the frame (sizedBy: user) so auto-fit never
      // fights the user's hands. Moves leave the size owner unchanged.
      const before = framesRef.current.find((f) => f.id === id);
      const resized =
        !!before && (before.width !== geometry.width || before.height !== geometry.height);
      const patch = resized ? { ...geometry, sizedBy: "user" as const } : geometry;
      setFrames((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
      void api.patchFrame(projectKey, id, patch).catch(() => {
        pushToast("Failed to save frame position");
        void loadBoard(projectKey);
      });
    },
    [pushToast, loadBoard],
  );

  // Grow (or shrink) a frame to its content's measured height, reported by the
  // injected bridge. Skips frames pinned by the user or sized by the agent.
  // The server pushes any newly-overlapped neighbors down and broadcasts a
  // board resync when that happens.
  const autoFitGuard = useRef(new Map<string, { revision: number; passes: number }>());
  const autoFitFrame = useCallback((frameId: string, contentHeight: number) => {
    const projectKey = activeProjectRef.current;
    if (!projectKey) return;
    const frame = framesRef.current.find((f) => f.id === frameId);
    if (!frame || frame.status !== "active") return;
    if (frame.sizedBy === "user" || frame.sizedBy === "agent") return;
    // Focus mode fills the viewport, so the iframe's layout width — and thus
    // the measured content height — has nothing to do with the frame's board
    // size. Skip; unfocusing restores the width and re-fires the observer.
    if (focusedFrameIdRef.current === frameId) return;
    const target = Math.min(
      Math.max(Math.ceil(contentHeight), AUTO_FIT_MIN_HEIGHT),
      AUTO_FIT_MAX_HEIGHT,
    );
    if (Math.abs(target - frame.height) < AUTO_FIT_EPSILON) return;
    const guard = autoFitGuard.current.get(frameId);
    const passes = guard?.revision === frame.revision ? guard.passes : 0;
    if (passes >= AUTO_FIT_MAX_PASSES) return;
    autoFitGuard.current.set(frameId, { revision: frame.revision, passes: passes + 1 });
    setFrames((prev) =>
      prev.map((f) => (f.id === frameId ? { ...f, height: target, sizedBy: "auto" } : f)),
    );
    void api.patchFrame(projectKey, frameId, { height: target, sizedBy: "auto" }).catch(() => {
      // transient — the next content report or board sync reconciles
    });
  }, []);

  const archiveFrames = useCallback(
    (ids: string[]) => {
      const projectKey = activeProjectRef.current;
      if (!projectKey) return;
      setFrames((prev) => prev.filter((f) => !ids.includes(f.id)));
      for (const id of ids) {
        void api.patchFrame(projectKey, id, { status: "archived" }).catch(() => {
          void loadBoard(projectKey);
        });
      }
      pushToast(`Archived ${ids.length} frame${ids.length > 1 ? "s" : ""}`);
    },
    [pushToast, loadBoard],
  );

  // Close a frame: archive it locally and tell the server, which notifies the
  // watching agent (no-op acknowledgement that the preview was dismissed).
  const closeFrame = useCallback(
    (frameId: string) => {
      const projectKey = activeProjectRef.current;
      if (!projectKey) return;
      const frame = framesRef.current.find((f) => f.id === frameId);
      setFrames((prev) => prev.filter((f) => f.id !== frameId));
      if (focusedFrameId === frameId) setFocusedFrameId(null);
      if (activeFrameId === frameId) setActiveFrameId(null);
      void api.closeFrame(projectKey, frameId).catch(() => {
        pushToast("Failed to close frame");
        void loadBoard(projectKey);
      });
      pushToast(`Closed “${frame?.title ?? "frame"}” — agent notified`);
    },
    [pushToast, loadBoard, focusedFrameId, activeFrameId],
  );

  // Close (archive) every active frame on the board at once — the bulk version
  // of the per-frame X. Optimistic: drop the frames now, reconcile on error.
  const confirmClearBoard = useCallback(async () => {
    const projectKey = activeProjectRef.current;
    if (!projectKey) return;
    setClearBusy(true);
    const ids = framesRef.current.filter((f) => f.status === "active").map((f) => f.id);
    setFrames((prev) => prev.filter((f) => !ids.includes(f.id)));
    setFocusedFrameId(null);
    setActiveFrameId(null);
    setSelection(null);
    try {
      const n = await api.closeBoard(projectKey);
      pushToast(
        n > 0 ? `Closed ${n} frame${n > 1 ? "s" : ""} — agent notified` : "Board already empty",
      );
    } catch {
      pushToast("Failed to close board");
      void loadBoard(projectKey);
    } finally {
      setClearBusy(false);
      setClearConfirm(false);
    }
  }, [pushToast, loadBoard]);

  const addComment = useCallback(
    async (frameId: string, body: string, selection?: { originalText: string }) => {
      const projectKey = activeProjectRef.current;
      if (!projectKey) throw new Error("No project selected");
      const comment = await api.postComment(projectKey, frameId, {
        body,
        author: getIdentity() || undefined,
        selection,
      });
      setComments((prev) => (prev.some((c) => c.id === comment.id) ? prev : [...prev, comment]));
      return comment;
    },
    [],
  );

  const resolveComment = useCallback((id: string, resolved: boolean) => {
    const projectKey = activeProjectRef.current;
    if (!projectKey) return;
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, resolved } : c)));
    void api.patchComment(projectKey, id, { resolved }).catch(() => {});
    if (resolved) {
      const comment = commentsRef.current.find((c) => c.id === id);
      const iframe = comment && iframeMap.current.get(comment.frameId);
      iframe?.contentWindow?.postMessage({ type: `${BRIDGE_PREFIX}remove-mark`, id }, "*");
    }
  }, []);

  const removeComment = useCallback((id: string) => {
    const projectKey = activeProjectRef.current;
    if (!projectKey) return;
    const comment = commentsRef.current.find((c) => c.id === id);
    setComments((prev) => prev.filter((c) => c.id !== id));
    void api.deleteComment(projectKey, id).catch(() => {});
    const iframe = comment && iframeMap.current.get(comment.frameId);
    iframe?.contentWindow?.postMessage({ type: `${BRIDGE_PREFIX}remove-mark`, id }, "*");
  }, []);

  // "Send now": dispatch one comment expecting a REPLY (no dots). The
  // comment.updated SSE flips it to awaiting-reply; optimistic flag for snap.
  const sendCommentNow = useCallback(
    (id: string) => {
      const projectKey = activeProjectRef.current;
      if (!projectKey) return;
      setComments((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, dispatchedAt: c.dispatchedAt ?? Date.now(), awaitingReply: true } : c,
        ),
      );
      void api
        .sendCommentNow(projectKey, id)
        .then((r) => {
          if (r.empty) {
            // No SSE fires for an empty dispatch — resync so the optimistic
            // awaiting-reply flag doesn't stick on an already-sent comment.
            pushToast("Already sent");
            void loadBoard(projectKey);
          } else {
            pushToast("Sent — waiting for a reply");
          }
        })
        .catch(() => {
          pushToast("Couldn't send the comment");
          void loadBoard(projectKey);
        });
    },
    [pushToast, loadBoard],
  );

  // User follow-up in a comment's thread (re-arms awaiting-reply server-side).
  // The authoritative comment.updated SSE applies the new thread (seq-gated);
  // don't also overwrite from the POST response — that's unordered and would
  // let a slow response clobber a newer SSE state on rapid replies.
  const replyInThread = useCallback(
    async (commentId: string, body: string) => {
      const projectKey = activeProjectRef.current;
      if (!projectKey || !body.trim()) return;
      await api
        .replyToComment(projectKey, commentId, { author: getIdentity() || "you", body })
        .catch(() => pushToast("Couldn't post reply"));
    },
    [pushToast],
  );

  // Dispatch is two-step: request (opens the shared confirm dialog) → confirm
  // (executes). Keeps every "send feedback to the agent" action behind one
  // explicit, previewed confirmation.
  const requestDispatchFrame = useCallback((frameId: string) => {
    setDispatchError(null);
    setDispatchTarget({ kind: "frame", frameId });
  }, []);

  const requestDispatchAll = useCallback(() => {
    setDispatchError(null);
    setDispatchTarget({ kind: "all" });
  }, []);

  const confirmDispatch = useCallback(async () => {
    const projectKey = activeProjectRef.current;
    if (!projectKey || !dispatchTarget) return;
    setDispatchBusy(true);
    setDispatchError(null);
    try {
      if (dispatchTarget.kind === "all") {
        const sent = await api.dispatchBoard(projectKey);
        pushToast(sent > 0 ? "All pending feedback sent to agent" : "Nothing pending to send");
      } else {
        const result = await api.dispatchFrame(projectKey, dispatchTarget.frameId);
        pushToast(result.empty ? "Nothing pending to send" : "Feedback sent to agent");
      }
      setDispatchTarget(null);
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : "Dispatch failed — try again");
    } finally {
      setDispatchBusy(false);
    }
  }, [dispatchTarget, pushToast]);

  // ---------------------------------------------------------------------
  // In-frame annotation bridge (selection → comment), gated by e.source so
  // multiple frame iframes can't cross-talk.
  // ---------------------------------------------------------------------

  const registerIframe = useCallback((frameId: string, el: HTMLIFrameElement | null) => {
    if (el) iframeMap.current.set(frameId, el);
    else iframeMap.current.delete(frameId);
  }, []);

  const frameIdForSource = useCallback((source: MessageEventSource | null): string | null => {
    if (!source) return null;
    for (const [frameId, iframe] of iframeMap.current) {
      if (iframe.contentWindow === source) return frameId;
    }
    return null;
  }, []);

  const applyMarksForFrame = useCallback((frameId: string) => {
    const iframe = iframeMap.current.get(frameId);
    if (!iframe?.contentWindow) return;
    let applied = appliedMarks.current.get(frameId);
    if (!applied) {
      applied = new Set();
      appliedMarks.current.set(frameId, applied);
    }
    for (const comment of commentsRef.current) {
      if (comment.frameId !== frameId) continue;
      if (!comment.selection?.originalText) continue;
      if (comment.resolved || comment.dispatchedAt) continue;
      if (applied.has(comment.id)) continue;
      applied.add(comment.id);
      iframe.contentWindow.postMessage(
        {
          type: `${BRIDGE_PREFIX}find-and-mark`,
          id: comment.id,
          originalText: comment.selection.originalText,
          annotationType: "comment",
        },
        "*",
      );
    }
  }, []);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as { type?: string } | null;
      if (!data || typeof data.type !== "string" || !data.type.startsWith(BRIDGE_PREFIX)) return;
      const frameId = frameIdForSource(e.source);
      if (!frameId) return;
      const type = data.type.slice(BRIDGE_PREFIX.length);

      if (type === "ready") {
        // Fresh document (load or revision reload): old marks are gone.
        appliedMarks.current.delete(frameId);
        applyMarksForFrame(frameId);
        return;
      }

      // Content height report (load + debounced ResizeObserver) → auto-fit.
      if (type === "resize") {
        const msg = e.data as { height?: number };
        if (typeof msg.height === "number" && Number.isFinite(msg.height) && msg.height > 0) {
          autoFitFrame(frameId, msg.height);
        }
        return;
      }

      // Bridge rects are in iframe-internal CSS pixels; the wrapper is
      // visually scaled by the camera zoom, so scale by the actual visual
      // ratio before anchoring in page coordinates.
      const anchorFromBridgeRect = (
        targetFrameId: string,
        rect: { top: number; left: number; width: number },
      ): { x: number; y: number } | null => {
        const iframe = iframeMap.current.get(targetFrameId);
        if (!iframe) return null;
        const iframeRect = iframe.getBoundingClientRect();
        const scale = iframe.clientWidth > 0 ? iframeRect.width / iframe.clientWidth : 1;
        return {
          x: iframeRect.left + (rect.left + rect.width / 2) * scale,
          y: iframeRect.top + rect.top * scale,
        };
      };

      // Selection → comment popover, only for the interactive frame.
      if (type === "selection") {
        if (frameId !== activeFrameId && frameId !== focusedFrameId) return;
        const msg = e.data as { text: string; rect: { top: number; left: number; width: number } };
        const anchor = anchorFromBridgeRect(frameId, msg.rect);
        if (!anchor) return;
        setSelection({ frameId, text: msg.text, anchorEl: getSelectionAnchor(anchor.x, anchor.y) });
        return;
      }

      // The selection scrolled inside the frame — move the (stable) anchor
      // element and nudge the popover's scroll listener to reposition. No
      // setState: the anchor's identity must not change or a user-dragged
      // popover would snap back (CommentPopover resets drag on anchor change).
      if (type === "selection-rect") {
        const sel = selectionRef.current;
        if (sel && sel.frameId === frameId) {
          const msg = e.data as { rect: { top: number; left: number; width: number } };
          const anchor = anchorFromBridgeRect(frameId, msg.rect);
          if (anchor) {
            getSelectionAnchor(anchor.x, anchor.y);
            window.dispatchEvent(new Event("scroll"));
          }
        }
        return;
      }

      // Ignore selection-clear: once the popover is up, it owns its own
      // dismissal (Escape / click-outside / submit). Clicks inside the
      // cross-origin iframe never reach the parent, so closing here would drop
      // the popover the instant the user moved to type in it.

      if (type === "mark-click") {
        const msg = e.data as { id: string };
        const comment = commentsRef.current.find((c) => c.id === msg.id);
        if (comment) openComments(comment.frameId);
        return;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameIdForSource, applyMarksForFrame, activeFrameId, focusedFrameId, openComments, autoFitFrame]);

  // Apply marks when a frame becomes interactive (its iframe may have been
  // ready long before its comments loaded).
  useEffect(() => {
    if (activeFrameId) applyMarksForFrame(activeFrameId);
    if (focusedFrameId) applyMarksForFrame(focusedFrameId);
  }, [activeFrameId, focusedFrameId, comments, applyMarksForFrame]);

  const submitSelectionComment = useCallback(
    async (body: string) => {
      const sel = selection;
      if (!sel || !body.trim()) return;
      setSelection(null);
      try {
        const comment = await addComment(sel.frameId, body, { originalText: sel.text });
        const applied = appliedMarks.current.get(sel.frameId) ?? new Set<string>();
        applied.add(comment.id);
        appliedMarks.current.set(sel.frameId, applied);
        iframeMap.current.get(sel.frameId)?.contentWindow?.postMessage(
          { type: `${BRIDGE_PREFIX}create-mark`, id: comment.id, annotationType: "comment" },
          "*",
        );
        openComments(sel.frameId);
      } catch {
        pushToast("Failed to add comment");
      }
    },
    [selection, addComment, pushToast, openComments],
  );

  // ---------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------

  const activeProject = useMemo(
    () => projects.find((p) => p.projectKey === activeProjectKey) ?? null,
    [projects, activeProjectKey],
  );

  const activeFramesSorted = useMemo(
    () =>
      frames
        .filter((f) => f.status === "active")
        .sort((a, b) => a.y - b.y || a.x - b.x),
    [frames],
  );

  const focusedFrame = useMemo(
    () => frames.find((f) => f.id === focusedFrameId) ?? null,
    [frames, focusedFrameId],
  );
  const focusedIndex = focusedFrame
    ? activeFramesSorted.findIndex((f) => f.id === focusedFrame.id)
    : -1;

  // Pending comments included in the active dispatch (for the confirm preview).
  const dispatchPreview = useMemo(() => {
    if (!dispatchTarget) return [];
    return comments.filter(
      (c) =>
        !c.resolved &&
        !c.dispatchedAt &&
        (dispatchTarget.kind === "all" || c.frameId === dispatchTarget.frameId),
    );
  }, [comments, dispatchTarget]);

  const dispatchTargetTitle = useMemo(() => {
    if (dispatchTarget?.kind !== "frame") return null;
    return frames.find((f) => f.id === dispatchTarget.frameId)?.title ?? "frame";
  }, [dispatchTarget, frames]);

  const pendingForFocused = useMemo(
    () =>
      focusedFrameId
        ? comments.filter(
            (c) => c.frameId === focusedFrameId && !c.resolved && !c.dispatchedAt,
          ).length
        : 0,
    [comments, focusedFrameId],
  );

  const totalPending = useMemo(
    () => comments.filter((c) => !c.resolved && !c.dispatchedAt).length,
    [comments],
  );

  // Frames awaiting a revision: feedback was dispatched at the current revision
  // and the agent hasn't uploaded a new one. Clears when revision bumps past it.
  const awaitingFrameIds = useMemo(
    () =>
      new Set(
        frames
          .filter((f) => f.feedbackPendingRevision != null && f.feedbackPendingRevision === f.revision)
          .map((f) => f.id),
      ),
    [frames],
  );

  const initialCamera = useMemo(
    () => (activeProjectKey ? loadCamera(activeProjectKey) : null),
    [activeProjectKey],
  );

  const onCameraSettle = useCallback(
    (camera: Camera) => {
      if (!activeProjectKey) return;
      try {
        localStorage.setItem(cameraStorageKey(activeProjectKey), JSON.stringify(camera));
      } catch {
        // best effort
      }
    },
    [activeProjectKey],
  );

  const sidebarBody = (
    <SidebarContent
      projects={projects}
      activeProjectKey={activeProjectKey}
      onSelectProject={selectProject}
      version={typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined}
    />
  );

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  return (
    // Root is the sidebar color — the main panel rounds its top-left against it
    // when the sidebar is open, creating the inset seam (matches the daemon shell).
    <div className="flex h-screen w-screen overflow-hidden bg-sidebar text-foreground">
      <SidebarRail>{sidebarBody}</SidebarRail>
      <SidebarPeek>{sidebarBody}</SidebarPeek>

      <div
        className={`relative flex min-w-0 flex-1 flex-col bg-background transition-[border-radius] duration-200 ${
          sidebarOpen ? "overflow-hidden rounded-tl-xl border-l border-border/50" : ""
        }`}
      >
        {/* Top chrome */}
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 bg-card/60 px-2.5">
          {!sidebarOpen && <SidebarTrigger />}
          <div className="min-w-0 truncate text-[13px] font-medium text-foreground">
            {activeProject?.projectName ?? "Canvas"}
          </div>
          {activeProject && (
            <div className="truncate text-[11px] text-muted-foreground" title={activeProject.root}>
              {activeProject.root}
            </div>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => void tidyBoard()}
              className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Arrange all frames into a grid"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Tidy
            </button>
            {frames.some((f) => f.status === "active") && (
              <button
                onClick={() => setClearConfirm(true)}
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="Close every frame on this board"
              >
                <X className="h-3.5 w-3.5" />
                Close all
              </button>
            )}
            <button
              onClick={() => {
                cameraCommandRef.current = { type: "fit" };
                setFrames((prev) => [...prev]);
              }}
              className="cursor-pointer rounded-md px-2 py-1 text-[11.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Zoom to fit (0)"
            >
              Fit
            </button>
            <button
              onClick={() => (commentsPanelOpen ? setCommentsPanelOpen(false) : openComments())}
              className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors ${
                commentsPanelOpen
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              title="Show all comments"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Comments
              {totalPending > 0 && (
                <span className="rounded-full bg-accent/20 px-1.5 text-[10px] font-semibold text-accent">
                  {totalPending}
                </span>
              )}
            </button>
            <ModeButton />
            {sidebarOpen && <SidebarTrigger />}
          </div>
        </div>

        {/* Main surface */}
        <div className="relative flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            {activeProjectKey ? (
              <>
                <CanvasViewport
                  // Remount per project: the viewport's camera/wrapper state is
                  // project-scoped, and this is what applies each project's
                  // saved camera (initialCamera is consumed at mount).
                  key={activeProjectKey}
                  frames={frames}
                  comments={comments}
                  htmlCache={htmlCache}
                  ensureHtml={ensureHtml}
                  selectedIds={selectedIds}
                  onSelectionChange={setSelectedIds}
                  activeFrameId={activeFrameId}
                  onActiveFrameChange={setActiveFrameId}
                  focusedFrameId={focusedFrameId}
                  onFocusedFrameChange={setFocusedFrameId}
                  onCommitGeometry={commitGeometry}
                  onArchiveFrames={archiveFrames}
                  onCloseFrame={closeFrame}
                  onOpenComments={openComments}
                  awaitingFrameIds={awaitingFrameIds}
                  registerIframe={registerIframe}
                  cameraCommandRef={cameraCommandRef}
                  initialCamera={initialCamera}
                  onCameraSettle={onCameraSettle}
                />
                {activeFramesSorted.length === 0 && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="rounded-lg border border-dashed border-border/70 bg-card/60 px-6 py-5 text-center">
                      <div className="text-[13px] font-medium text-foreground">No frames yet</div>
                      <div className="mt-1.5 text-xs text-muted-foreground">
                        Have your agent run{" "}
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px]">
                          plannotator canvas add page.html
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                {focusedFrame && (
                  <FocusBar
                    frame={focusedFrame}
                    pendingComments={pendingForFocused}
                    hasPrev={focusedIndex > 0}
                    hasNext={focusedIndex >= 0 && focusedIndex < activeFramesSorted.length - 1}
                    onPrev={() => setFocusedFrameId(activeFramesSorted[focusedIndex - 1].id)}
                    onNext={() => setFocusedFrameId(activeFramesSorted[focusedIndex + 1].id)}
                    onOpenComments={() => openComments(focusedFrame.id)}
                    onExit={() => setFocusedFrameId(null)}
                  />
                )}
              </>
            ) : (
              <div className="flex h-full items-center justify-center">
                <div className="max-w-sm rounded-lg border border-dashed border-border/70 bg-card/60 px-6 py-6 text-center">
                  <div className="text-sm font-semibold text-foreground">Plannotator Canvas</div>
                  <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Agents publish live HTML previews here. From any project directory, run:
                  </div>
                  <div className="mt-3 rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground">
                    plannotator canvas add page.html
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Aggregate comments panel — all board comments, grouped by frame */}
          {commentsPanelOpen && activeProjectKey && (
            <CommentsPanel
              frames={activeFramesSorted}
              comments={comments}
              activeFrameId={activeFrameId}
              focusFrameId={focusCommentFrameId}
              onAddComment={(frameId, body) => addComment(frameId, body).then(() => undefined)}
              onAddAndSendNow={async (frameId, body) => {
                const c = await addComment(frameId, body);
                sendCommentNow(c.id);
              }}
              onResolveComment={resolveComment}
              onDeleteComment={removeComment}
              onSendCommentNow={sendCommentNow}
              onReplyInThread={replyInThread}
              onJumpToFrame={(frameId) => {
                cameraCommandRef.current = { type: "center-frame", frameId };
                setFrames((prev) => [...prev]);
              }}
              onDispatchFrame={requestDispatchFrame}
              onDispatchAll={requestDispatchAll}
              onClose={() => setCommentsPanelOpen(false)}
            />
          )}
        </div>
      </div>

      {/* In-frame selection → shared comment popover (matches the plan editor) */}
      {selection && (
        <CommentPopover
          anchorEl={selection.anchorEl}
          contextText={selection.text}
          isGlobal={false}
          allowImages={false}
          onSubmit={(text) => void submitSelectionComment(text)}
          onClose={() => setSelection(null)}
        />
      )}

      {/* Feedback dispatch confirmation (shared shadcn dialog) */}
      <ConfirmDialog
        open={dispatchTarget !== null}
        title={
          dispatchTarget?.kind === "all"
            ? `Send ${dispatchPreview.length} comment${dispatchPreview.length === 1 ? "" : "s"} to the agent?`
            : `Send ${dispatchPreview.length} comment${dispatchPreview.length === 1 ? "" : "s"} on “${dispatchTargetTitle ?? "frame"}”?`
        }
        description={
          <>
            Delivered to <span className="font-mono text-foreground/80">plannotator canvas watch</span>{" "}
            for this project.
          </>
        }
        confirmLabel="Send feedback"
        busy={dispatchBusy}
        error={dispatchError}
        onConfirm={() => void confirmDispatch()}
        onOpenChange={(open) => {
          if (!open) setDispatchTarget(null);
        }}
        body={
          dispatchPreview.length === 0 ? (
            <span className="text-muted-foreground">No pending comments to send.</span>
          ) : (
            dispatchPreview.map((c) => (
              <div key={c.id} className="text-foreground">
                {c.selection?.originalText && (
                  <span className="text-muted-foreground">“{c.selection.originalText}” — </span>
                )}
                {c.body}
              </div>
            ))
          )
        }
      />

      <ConfirmDialog
        open={clearConfirm}
        title="Close all frames on this board?"
        description={
          <>
            Every preview is dismissed and the watching agent is notified (no
            revision required). Frame history is kept on disk.
          </>
        }
        confirmLabel="Close all"
        busyLabel="Closing…"
        cancelLabel="Cancel"
        busy={clearBusy}
        onConfirm={() => void confirmClearBoard()}
        onOpenChange={(open) => {
          if (!open) setClearConfirm(false);
        }}
      />

      <Toaster
        position="bottom-center"
        toastOptions={{
          style: {
            "--normal-bg": "var(--card)",
            "--normal-border": "var(--border)",
            "--normal-text": "var(--foreground)",
          } as React.CSSProperties,
        }}
      />
    </div>
  );
}

export default function App() {
  const defaultSidebarOpen = !new URLSearchParams(window.location.search).get("frame");
  return (
    <ThemeProvider>
      <SidebarProvider defaultOpen={defaultSidebarOpen}>
        <CanvasApp />
      </SidebarProvider>
    </ThemeProvider>
  );
}
