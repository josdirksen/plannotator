/**
 * CanvasViewport — the two-layer infinite canvas (docs/canvas-spec.md §3.7).
 *
 * Layer 1 (chrome): a single CSS-transformed container holding frame chrome
 * (labels, placeholder rects, selection outlines, comment pins, resize
 * handles) positioned in world coordinates. The camera is applied as one
 * transform on this container.
 *
 * Layer 2 (content): an untransformed sibling. Each mounted frame's iframe
 * lives in an absolutely positioned wrapper whose on-screen transform is
 * computed from the camera every camera change — imperatively, outside
 * React. Iframes never move in the DOM, so they never reload.
 *
 * Camera state lives in a ref and is applied in rAF; React only sees a
 * debounced "settled" camera (for culling and the zoom readout). Frame
 * drags write styles directly to both layers and commit once on release.
 *
 * Focus mode is a style change on one content wrapper (animate to fill the
 * viewport), never a remount — scroll/form/JS state survives (spec §6).
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Camera, CanvasComment, CanvasFrame } from "../types";
import {
  centerFrame,
  fitBounds,
  framesBounds,
  frameScreenRect,
  pan,
  shouldMount,
  zoomBy,
} from "../camera";
import { FrameContent } from "./FrameContent";

const LABEL_HEIGHT = 24;
const DRAG_THRESHOLD_PX = 4;
const CAMERA_SETTLE_MS = 200;
const KEEPALIVE_BUDGET = 6;
const FOCUS_TRANSITION_MS = 260;

type ResizeCorner = "nw" | "ne" | "sw" | "se";

interface DragState {
  kind: "pan" | "move" | "marquee" | "resize";
  startScreen: { x: number; y: number };
  /** move/resize */
  frameIds?: string[];
  startGeometries?: Map<string, Pick<CanvasFrame, "x" | "y" | "width" | "height">>;
  corner?: ResizeCorner;
  /** pan */
  startCamera?: Camera;
  /** becomes true after passing the drag threshold */
  engaged: boolean;
}

export interface CanvasViewportProps {
  frames: CanvasFrame[];
  comments: CanvasComment[];
  /** Frame HTML cache: id → { html, revision }. */
  htmlCache: Map<string, { html: string; revision: number }>;
  /** Request HTML for a frame (no-op if already cached/loading). */
  ensureHtml: (frameId: string) => void;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  /** The single "activated" frame whose iframe receives pointer events. */
  activeFrameId: string | null;
  onActiveFrameChange: (id: string | null) => void;
  focusedFrameId: string | null;
  onFocusedFrameChange: (id: string | null) => void;
  onCommitGeometry: (
    id: string,
    geometry: Pick<CanvasFrame, "x" | "y" | "width" | "height">,
  ) => void;
  onArchiveFrames: (ids: string[]) => void;
  /** Close a frame: archive it and notify the agent (no-op acknowledgement). */
  onCloseFrame: (frameId: string) => void;
  onOpenComments: (frameId: string) => void;
  /** Frames awaiting a revision after feedback was sent (show the dot wave). */
  awaitingFrameIds: Set<string>;
  registerIframe: (frameId: string, el: HTMLIFrameElement | null) => void;
  /** Imperative camera commands from the parent (deep links, jump-to-frame). */
  cameraCommandRef: React.MutableRefObject<
    null | { type: "fit" } | { type: "center-frame"; frameId: string }
  >;
  /** Initial camera (per-project persistence); reported back on settle. */
  initialCamera: Camera | null;
  onCameraSettle: (camera: Camera) => void;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function CanvasViewport({
  frames,
  comments,
  htmlCache,
  ensureHtml,
  selectedIds,
  onSelectionChange,
  activeFrameId,
  onActiveFrameChange,
  focusedFrameId,
  onFocusedFrameChange,
  onCommitGeometry,
  onArchiveFrames,
  onCloseFrame,
  onOpenComments,
  awaitingFrameIds,
  registerIframe,
  cameraCommandRef,
  initialCamera,
  onCameraSettle,
}: CanvasViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const chromeLayerRef = useRef<HTMLDivElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);

  const cameraRef = useRef<Camera>(initialCamera ?? { x: 80, y: 80, z: 1 });
  const [settledCamera, setSettledCamera] = useState<Camera>(cameraRef.current);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafId = useRef<number | null>(null);

  const wrapperMap = useRef(new Map<string, HTMLDivElement>());
  const chromeMap = useRef(new Map<string, HTMLDivElement>());
  const framesRef = useRef(frames);
  framesRef.current = frames;
  /** Live geometry overrides while dragging (world coords). */
  const dragGeometry = useRef(new Map<string, Pick<CanvasFrame, "x" | "y" | "width" | "height">>());
  const dragState = useRef<DragState | null>(null);
  const [gesturing, setGesturing] = useState(false);
  const spaceHeld = useRef(false);
  const [spacePan, setSpacePan] = useState(false);

  const focusedRef = useRef<string | null>(focusedFrameId);
  const [mountedIds, setMountedIds] = useState<Set<string>>(new Set());
  const keepAlive = useRef<string[]>([]);

  const activeFrames = useMemo(() => frames.filter((f) => f.status === "active"), [frames]);

  const geometryOf = useCallback(
    (frame: CanvasFrame): Pick<CanvasFrame, "x" | "y" | "width" | "height"> =>
      dragGeometry.current.get(frame.id) ?? frame,
    [],
  );

  // -------------------------------------------------------------------------
  // Camera application (imperative, rAF-coalesced)
  // -------------------------------------------------------------------------

  const applyWrapperStyle = useCallback(
    (frameId: string, el: HTMLDivElement) => {
      const frame = framesRef.current.find((f) => f.id === frameId);
      if (!frame) return;
      if (focusedRef.current === frameId) return; // focus mode owns this wrapper
      const g = dragGeometry.current.get(frameId) ?? frame;
      const c = cameraRef.current;
      el.style.width = `${g.width}px`;
      el.style.height = `${g.height}px`;
      el.style.transform = `translate(${g.x * c.z + c.x}px, ${g.y * c.z + c.y}px) scale(${c.z})`;
      el.style.visibility = "visible";
    },
    [],
  );

  const applyCamera = useCallback(() => {
    const c = cameraRef.current;
    const chrome = chromeLayerRef.current;
    if (chrome) {
      chrome.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.z})`;
      chrome.style.setProperty("--inv-z", String(1 / c.z));
    }
    for (const [id, el] of wrapperMap.current) applyWrapperStyle(id, el);
  }, [applyWrapperStyle]);

  const scheduleApply = useCallback(() => {
    if (rafId.current !== null) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      applyCamera();
    });
  }, [applyCamera]);

  const setCamera = useCallback(
    (next: Camera) => {
      cameraRef.current = next;
      scheduleApply();
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        setSettledCamera(cameraRef.current);
        onCameraSettle(cameraRef.current);
      }, CAMERA_SETTLE_MS);
    },
    [scheduleApply, onCameraSettle],
  );

  // Apply on mount and whenever frames change (geometry from server, new frames).
  useEffect(() => {
    applyCamera();
  });

  // Unmount cleanup: a pending settle or rAF firing after unmount would call
  // setState / write to detached nodes.
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    },
    [],
  );

  const registerWrapper = useCallback(
    (frameId: string, el: HTMLDivElement | null) => {
      if (el) {
        wrapperMap.current.set(frameId, el);
        if (focusedRef.current === frameId) {
          // Focused-while-culled: the wrapper mounts after the focus effect
          // already ran. Apply the fill styles now (instant — there is no
          // prior on-screen rect to animate from).
          enterFocusRef.current?.(frameId, el, true);
        } else {
          applyWrapperStyle(frameId, el);
        }
      } else {
        wrapperMap.current.delete(frameId);
      }
    },
    [applyWrapperStyle],
  );
  // enterFocusStyles is defined below (needs applyWrapperStyle); reach it via
  // a ref so registerWrapper's identity stays stable for FrameContent's memo.
  const enterFocusRef = useRef<((frameId: string, el: HTMLDivElement, instant: boolean) => void) | null>(null);

  const registerChrome = useCallback((frameId: string, el: HTMLDivElement | null) => {
    if (el) chromeMap.current.set(frameId, el);
    else chromeMap.current.delete(frameId);
  }, []);

  // -------------------------------------------------------------------------
  // Culling: recompute the mounted set when the camera settles.
  // Active/focused frames and a small keep-alive LRU stay mounted.
  // -------------------------------------------------------------------------

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const { clientWidth: w, clientHeight: h } = viewport;
    const next = new Set<string>();
    for (const frame of activeFrames) {
      if (shouldMount(settledCamera, geometryOf(frame), w, h)) next.add(frame.id);
    }
    if (activeFrameId) next.add(activeFrameId);
    if (focusedFrameId) next.add(focusedFrameId);
    for (const id of keepAlive.current) {
      if (activeFrames.some((f) => f.id === id)) next.add(id);
    }
    setMountedIds((prev) => {
      if (prev.size === next.size && [...prev].every((id) => next.has(id))) return prev;
      return next;
    });
  }, [settledCamera, activeFrames, activeFrameId, focusedFrameId, geometryOf]);

  // Fetch HTML for newly mounted frames.
  useEffect(() => {
    for (const id of mountedIds) ensureHtml(id);
  }, [mountedIds, ensureHtml]);

  // Track recently-interacted frames (keep-alive LRU).
  useEffect(() => {
    if (!activeFrameId) return;
    keepAlive.current = [
      activeFrameId,
      ...keepAlive.current.filter((id) => id !== activeFrameId),
    ].slice(0, KEEPALIVE_BUDGET);
  }, [activeFrameId]);

  // -------------------------------------------------------------------------
  // Focus mode: style-only change on the wrapper, animated. Three transitions
  // must all work: enter (null→F), exit (F→null), and direct switch (F1→F2,
  // via FocusBar prev/next) — the switch must fully restore F1 (transform,
  // size, zIndex) or it stays fullscreen covering F2.
  // -------------------------------------------------------------------------

  const focusTransition = `transform ${FOCUS_TRANSITION_MS}ms cubic-bezier(0.4,0,0.2,1), width ${FOCUS_TRANSITION_MS}ms cubic-bezier(0.4,0,0.2,1), height ${FOCUS_TRANSITION_MS}ms cubic-bezier(0.4,0,0.2,1)`;

  const enterFocusStyles = useCallback(
    (frameId: string, el: HTMLDivElement, instant: boolean) => {
      el.style.zIndex = "30";
      el.style.visibility = "visible";
      el.style.transition = instant ? "none" : focusTransition;
      requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        el.style.transform = `translate(0px, 0px) scale(1)`;
        el.style.width = `${viewport.clientWidth}px`;
        el.style.height = `${viewport.clientHeight}px`;
        setTimeout(() => {
          el.style.transition = "none";
          // Track viewport resizes while focused.
          el.style.width = "100%";
          el.style.height = "100%";
        }, instant ? 0 : FOCUS_TRANSITION_MS);
      });
    },
    [focusTransition],
  );

  const restoreFromFocus = useCallback(
    (frameId: string, el: HTMLDivElement, instant: boolean) => {
      const viewport = viewportRef.current;
      // Freeze current pixel size so the transition has a concrete start.
      if (viewport) {
        el.style.width = `${viewport.clientWidth}px`;
        el.style.height = `${viewport.clientHeight}px`;
      }
      el.style.transition = instant ? "none" : focusTransition;
      requestAnimationFrame(() => {
        // focusedRef no longer points here, so applyWrapperStyle resumes ownership.
        applyWrapperStyle(frameId, el);
        setTimeout(() => {
          el.style.transition = "none";
          el.style.zIndex = "";
          applyWrapperStyle(frameId, el);
        }, instant ? 0 : FOCUS_TRANSITION_MS);
      });
    },
    [focusTransition, applyWrapperStyle],
  );

  enterFocusRef.current = enterFocusStyles;

  useEffect(() => {
    const prev = focusedRef.current;
    focusedRef.current = focusedFrameId;
    if (prev === focusedFrameId) return;
    const reduced = prefersReducedMotion();

    if (prev) {
      const prevEl = wrapperMap.current.get(prev);
      if (prevEl) restoreFromFocus(prev, prevEl, reduced);
    }
    if (focusedFrameId) {
      const el = wrapperMap.current.get(focusedFrameId);
      // A culled frame's wrapper may not exist yet — registerWrapper applies
      // the focus styles when it mounts on the next render.
      if (el) enterFocusStyles(focusedFrameId, el, reduced);
    }
  }, [focusedFrameId, enterFocusStyles, restoreFromFocus]);

  // -------------------------------------------------------------------------
  // Gestures
  // -------------------------------------------------------------------------

  // Wheel: pinch / ctrl+wheel zooms about the cursor; plain wheel pans.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    function onWheel(e: WheelEvent) {
      if (focusedRef.current) return; // focus mode: let the page scroll
      e.preventDefault();
      const rect = viewport!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        setCamera(zoomBy(cameraRef.current, sx, sy, Math.exp(-e.deltaY * 0.01)));
      } else {
        setCamera(pan(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    }
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [setCamera]);

  // Keyboard: space (pan), zoom steps, fit, escape, archive.
  useEffect(() => {
    function isTypingTarget(e: KeyboardEvent): boolean {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e)) return;
      if (e.code === "Space" && !spaceHeld.current) {
        spaceHeld.current = true;
        setSpacePan(true);
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        if (focusedRef.current) {
          onFocusedFrameChange(null);
        } else if (activeFrameId) {
          onActiveFrameChange(null);
        } else if (selectedIds.size > 0) {
          onSelectionChange(new Set());
        }
        return;
      }
      if (focusedRef.current) return; // remaining shortcuts are canvas-only
      // Don't hijack browser-zoom chords (Cmd+0 / Cmd+= / Cmd+-).
      if (e.metaKey || e.ctrlKey) return;

      const viewport = viewportRef.current;
      if (!viewport) return;
      const cx = viewport.clientWidth / 2;
      const cy = viewport.clientHeight / 2;

      if (e.key === "0") {
        const bounds = framesBounds(framesRef.current);
        if (bounds) {
          setCamera(fitBounds(bounds, viewport.clientWidth, viewport.clientHeight));
        }
      } else if (e.key === "1") {
        setCamera(zoomBy(cameraRef.current, cx, cy, 1 / cameraRef.current.z));
      } else if (e.key === "=" || e.key === "+") {
        setCamera(zoomBy(cameraRef.current, cx, cy, 1.2));
      } else if (e.key === "-" || e.key === "_") {
        setCamera(zoomBy(cameraRef.current, cx, cy, 1 / 1.2));
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0) {
        onArchiveFrames([...selectedIds]);
        onSelectionChange(new Set());
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") {
        spaceHeld.current = false;
        setSpacePan(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    selectedIds,
    activeFrameId,
    onSelectionChange,
    onActiveFrameChange,
    onFocusedFrameChange,
    onArchiveFrames,
    setCamera,
  ]);

  // Imperative camera commands (deep links, jump-to-frame toasts).
  useEffect(() => {
    const command = cameraCommandRef.current;
    if (!command) return;
    cameraCommandRef.current = null;
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (command.type === "fit") {
      const bounds = framesBounds(framesRef.current);
      if (bounds) setCamera(fitBounds(bounds, viewport.clientWidth, viewport.clientHeight));
    } else {
      const frame = framesRef.current.find((f) => f.id === command.frameId);
      if (frame) setCamera(centerFrame(frame, viewport.clientWidth, viewport.clientHeight));
    }
  });

  const screenPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const beginDrag = useCallback(
    (state: DragState) => {
      dragState.current = state;
      setGesturing(true);

      function onMove(e: MouseEvent) {
        const drag = dragState.current;
        if (!drag) return;
        const point = {
          x: e.clientX - viewportRef.current!.getBoundingClientRect().left,
          y: e.clientY - viewportRef.current!.getBoundingClientRect().top,
        };
        const dxScreen = point.x - drag.startScreen.x;
        const dyScreen = point.y - drag.startScreen.y;
        if (!drag.engaged && Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD_PX) return;
        drag.engaged = true;

        if (drag.kind === "pan") {
          setCamera({
            ...drag.startCamera!,
            x: drag.startCamera!.x + dxScreen,
            y: drag.startCamera!.y + dyScreen,
          });
          return;
        }

        const z = cameraRef.current.z;
        const dx = dxScreen / z;
        const dy = dyScreen / z;

        if (drag.kind === "move") {
          for (const id of drag.frameIds!) {
            const start = drag.startGeometries!.get(id)!;
            dragGeometry.current.set(id, { ...start, x: start.x + dx, y: start.y + dy });
            const chromeEl = chromeMap.current.get(id);
            if (chromeEl) {
              chromeEl.style.left = `${start.x + dx}px`;
              chromeEl.style.top = `${start.y + dy}px`;
            }
            const wrapper = wrapperMap.current.get(id);
            if (wrapper) applyWrapperStyle(id, wrapper);
          }
          return;
        }

        if (drag.kind === "resize") {
          const id = drag.frameIds![0];
          const start = drag.startGeometries!.get(id)!;
          const corner = drag.corner!;
          let { x, y, width, height } = start;
          if (corner.includes("e")) width = Math.max(120, start.width + dx);
          if (corner.includes("s")) height = Math.max(90, start.height + dy);
          if (corner.includes("w")) {
            width = Math.max(120, start.width - dx);
            x = start.x + (start.width - width);
          }
          if (corner.includes("n")) {
            height = Math.max(90, start.height - dy);
            y = start.y + (start.height - height);
          }
          dragGeometry.current.set(id, { x, y, width, height });
          const chromeEl = chromeMap.current.get(id);
          if (chromeEl) {
            chromeEl.style.left = `${x}px`;
            chromeEl.style.top = `${y}px`;
            chromeEl.style.width = `${width}px`;
            chromeEl.style.height = `${height}px`;
          }
          const wrapper = wrapperMap.current.get(id);
          if (wrapper) applyWrapperStyle(id, wrapper);
          return;
        }

        if (drag.kind === "marquee") {
          const marquee = marqueeRef.current;
          if (!marquee) return;
          const left = Math.min(drag.startScreen.x, point.x);
          const top = Math.min(drag.startScreen.y, point.y);
          marquee.style.display = "block";
          marquee.style.left = `${left}px`;
          marquee.style.top = `${top}px`;
          marquee.style.width = `${Math.abs(dxScreen)}px`;
          marquee.style.height = `${Math.abs(dyScreen)}px`;
        }
      }

      function onUp(e: MouseEvent) {
        const drag = dragState.current;
        dragState.current = null;
        setGesturing(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (!drag) return;

        if (drag.kind === "marquee") {
          const marquee = marqueeRef.current;
          if (marquee) marquee.style.display = "none";
          if (drag.engaged) {
            const rect = viewportRef.current!.getBoundingClientRect();
            const end = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            const minX = Math.min(drag.startScreen.x, end.x);
            const maxX = Math.max(drag.startScreen.x, end.x);
            const minY = Math.min(drag.startScreen.y, end.y);
            const maxY = Math.max(drag.startScreen.y, end.y);
            const hit = new Set<string>();
            for (const frame of framesRef.current) {
              if (frame.status !== "active") continue;
              const r = frameScreenRect(cameraRef.current, frame);
              if (r.left < maxX && r.left + r.width > minX && r.top < maxY && r.top + r.height > minY) {
                hit.add(frame.id);
              }
            }
            onSelectionChange(hit);
          } else {
            // Plain click on empty canvas: clear selection + deactivate.
            onSelectionChange(new Set());
            onActiveFrameChange(null);
          }
          return;
        }

        if ((drag.kind === "move" || drag.kind === "resize") && drag.engaged) {
          for (const id of drag.frameIds!) {
            const geometry = dragGeometry.current.get(id);
            if (geometry) onCommitGeometry(id, geometry);
          }
          dragGeometry.current.clear();
          return;
        }
        dragGeometry.current.clear();
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [applyWrapperStyle, onCommitGeometry, onSelectionChange, onActiveFrameChange, setCamera],
  );

  const onViewportMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (focusedRef.current) return;
      const isPan = e.button === 1 || (e.button === 0 && spaceHeld.current);
      if (isPan) {
        e.preventDefault();
        beginDrag({
          kind: "pan",
          startScreen: screenPoint(e),
          startCamera: cameraRef.current,
          engaged: false,
        });
        return;
      }
      if (e.button !== 0) return;
      // Empty-canvas drag → marquee (frame chrome stops propagation).
      beginDrag({ kind: "marquee", startScreen: screenPoint(e), engaged: false });
    },
    [beginDrag, screenPoint],
  );

  const onFrameMouseDown = useCallback(
    (e: React.MouseEvent, frame: CanvasFrame) => {
      if (focusedRef.current) return;
      if (e.button === 1 || (e.button === 0 && spaceHeld.current)) return; // viewport pans
      if (e.button !== 0) return;
      e.stopPropagation();

      if (e.shiftKey) {
        const next = new Set(selectedIds);
        if (next.has(frame.id)) next.delete(frame.id);
        else next.add(frame.id);
        onSelectionChange(next);
        return;
      }

      const moveIds = selectedIds.has(frame.id) ? [...selectedIds] : [frame.id];
      const startGeometries = new Map(
        moveIds
          .map((id) => framesRef.current.find((f) => f.id === id))
          .filter((f): f is CanvasFrame => !!f)
          .map((f) => [f.id, { x: f.x, y: f.y, width: f.width, height: f.height }]),
      );
      beginDrag({
        kind: "move",
        startScreen: screenPoint(e),
        frameIds: moveIds,
        startGeometries,
        engaged: false,
      });

      // A click (drag never engages) selects + activates — the single
      // activation step that hands the iframe pointer events.
      const drag = dragState.current;
      const onUpOnce = () => {
        window.removeEventListener("mouseup", onUpOnce);
        if (drag && !drag.engaged) {
          onSelectionChange(new Set([frame.id]));
          onActiveFrameChange(frame.id);
        }
      };
      window.addEventListener("mouseup", onUpOnce);
    },
    [selectedIds, onSelectionChange, onActiveFrameChange, beginDrag, screenPoint],
  );

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent, frame: CanvasFrame, corner: ResizeCorner) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      beginDrag({
        kind: "resize",
        startScreen: screenPoint(e),
        frameIds: [frame.id],
        startGeometries: new Map([
          [frame.id, { x: frame.x, y: frame.y, width: frame.width, height: frame.height }],
        ]),
        corner,
        engaged: false,
      });
    },
    [beginDrag, screenPoint],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const commentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of comments) {
      if (c.resolved || c.dispatchedAt) continue;
      counts.set(c.frameId, (counts.get(c.frameId) ?? 0) + 1);
    }
    return counts;
  }, [comments]);

  const zoomPct = Math.round(settledCamera.z * 100);
  const focusActive = focusedFrameId !== null;

  return (
    <div
      ref={viewportRef}
      data-canvas-viewport
      className={`relative h-full w-full overflow-hidden bg-background ${
        spacePan ? "cursor-grab" : ""
      }`}
      onMouseDown={onViewportMouseDown}
    >
      {/* Dot grid backdrop */}
      <div className="canvas-dot-grid absolute inset-0" aria-hidden />

      {/* Layer 1: chrome (camera-transformed) */}
      <div
        ref={chromeLayerRef}
        className="absolute left-0 top-0"
        style={{ transformOrigin: "0 0" }}
      >
        {activeFrames.map((frame) => {
          const selected = selectedIds.has(frame.id);
          const active = activeFrameId === frame.id;
          const pendingComments = commentCounts.get(frame.id) ?? 0;
          const awaiting = awaitingFrameIds.has(frame.id);
          return (
            <div
              key={frame.id}
              ref={(el) => registerChrome(frame.id, el)}
              className="absolute"
              style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
              onMouseDown={(e) => onFrameMouseDown(e, frame)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onFocusedFrameChange(frame.id);
              }}
            >
              {/* Placeholder rect (visible until the live iframe covers it) */}
              <div className="absolute inset-0 rounded-sm border border-border/70 bg-muted/30" />

              {/* Awaiting-revision indicator — animated dot wave above top-right,
                  shown until the agent uploads a new revision. Counter-scaled to
                  stay a constant on-screen size. */}
              {awaiting && (
                <div
                  className="pointer-events-none absolute right-0 flex justify-end"
                  style={{
                    bottom: "100%",
                    transformOrigin: "100% 100%",
                    transform: "scale(var(--inv-z, 1))",
                    paddingBottom: 4,
                  }}
                  title="Feedback sent — awaiting a new revision from the agent"
                >
                  <div className="awaiting-dots" aria-hidden />
                </div>
              )}

              {/* Selection / activation outline (screen-constant width) */}
              {(selected || active) && (
                <div
                  className="pointer-events-none absolute inset-0 rounded-sm"
                  style={{
                    outline: `calc(${active ? 2 : 1.5}px * var(--inv-z, 1)) solid var(--${active ? "accent" : "primary"})`,
                    outlineOffset: `calc(1px * var(--inv-z, 1))`,
                  }}
                />
              )}

              {/* Label — counter-scaled so it stays legible when zoomed out */}
              <div
                className="frame-label absolute left-0 flex items-center gap-1.5"
                style={{
                  bottom: "100%",
                  transformOrigin: "0 100%",
                  transform: "scale(var(--inv-z, 1))",
                  height: LABEL_HEIGHT,
                  maxWidth: 320,
                }}
              >
                <span
                  className={`truncate text-[12px] font-medium ${
                    selected || active ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {frame.title}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground/70">
                  r{frame.revision}
                </span>
                {pendingComments > 0 && (
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenComments(frame.id);
                    }}
                    className="shrink-0 cursor-pointer rounded-full bg-accent/20 px-1.5 text-[10px] font-semibold text-accent hover:bg-accent/30"
                    title={`${pendingComments} pending comment${pendingComments > 1 ? "s" : ""}`}
                  >
                    {pendingComments}
                  </button>
                )}
                {/* Close: archive the frame + tell the agent (no-op ack). */}
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseFrame(frame.id);
                  }}
                  className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground/70 hover:bg-destructive/15 hover:text-destructive"
                  title="Close this preview (notifies the agent)"
                >
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>

              {/* Resize handles (selected, single selection) */}
              {selected && selectedIds.size === 1 &&
                (["nw", "ne", "sw", "se"] as ResizeCorner[]).map((corner) => (
                  <div
                    key={corner}
                    onMouseDown={(e) => onResizeMouseDown(e, frame, corner)}
                    className="absolute z-10 rounded-[2px] border border-primary bg-background"
                    style={{
                      width: "calc(8px * var(--inv-z, 1))",
                      height: "calc(8px * var(--inv-z, 1))",
                      cursor: `${corner}-resize`,
                      left: corner.includes("w") ? 0 : undefined,
                      right: corner.includes("e") ? 0 : undefined,
                      top: corner.includes("n") ? 0 : undefined,
                      bottom: corner.includes("s") ? 0 : undefined,
                      transform: `translate(${corner.includes("w") ? "-50%" : "50%"}, ${corner.includes("n") ? "-50%" : "50%"})`,
                    }}
                  />
                ))}
            </div>
          );
        })}
      </div>

      {/* Marquee (screen space) */}
      <div
        ref={marqueeRef}
        className="pointer-events-none absolute z-20 hidden border border-primary/70 bg-primary/10"
      />

      {/* Layer 2: content (untransformed sibling — iframes never re-parent) */}
      <div className="pointer-events-none absolute inset-0 z-10">
        {/* Focus backdrop lives INSIDE the content layer: the layer's z-10
            creates a stacking context, so a sibling backdrop above it would
            also sit above the focused wrapper (zIndex 30 is confined here).
            The conditional slot before the keyed list never remounts iframes. */}
        {focusActive && (
          <div
            className="pointer-events-none absolute inset-0 bg-background/80"
            style={{ zIndex: 20 }}
            aria-hidden
          />
        )}
        {activeFrames
          .filter((f) => mountedIds.has(f.id))
          .map((frame) => {
            const cached = htmlCache.get(frame.id);
            return (
              <FrameContent
                key={frame.id}
                frameId={frame.id}
                html={cached?.html ?? null}
                revision={cached?.revision ?? frame.revision}
                registerWrapper={registerWrapper}
                registerIframe={registerIframe}
                interactive={
                  !gesturing &&
                  !spacePan &&
                  (activeFrameId === frame.id || focusedFrameId === frame.id)
                }
              />
            );
          })}
      </div>

      {/* Zoom readout */}
      <div className="absolute bottom-3 right-3 z-20 rounded-md border border-border/60 bg-card/90 px-2 py-1 text-[11px] tabular-nums text-muted-foreground shadow-sm backdrop-blur-sm">
        {zoomPct}%
      </div>
    </div>
  );
}
