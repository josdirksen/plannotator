/**
 * SidebarPeek — the closed-state edge-hover reveal, ported from the
 * single-server-runtime worktree's SidebarPeek (the authoritative reference;
 * see docs/canvas-spec.md notes):
 *
 *   rest on a 20px left-edge strip for 600ms → a backdrop-dimmed floating
 *   clone of the sidebar slides in → moving onto it locks it open instantly →
 *   leaving forgives a 150ms corner-cut before sliding away.
 *
 * Hover-intent model (the part that has to feel exactly right):
 *
 *   - The STRIP only ever *schedules the open*. Its leave only cancels a
 *     still-pending open (the quick-brush case). It NEVER schedules a hide.
 *   - The PANEL alone owns staying-open and hiding: entering it cancels every
 *     timer (lock open); leaving it starts the 150ms hide grace.
 *
 * Why the split matters: the panel slides in from translateX(-100%), so at
 * the instant of reveal the cursor is briefly over the backdrop *beneath* the
 * still-off-screen panel. If the strip or backdrop could schedule a hide, the
 * reveal would race its own teardown and the panel would flicker/retreat —
 * the subtle jank. With hide owned solely by leaving the panel, the reveal can
 * never cancel itself, and there is no same-tick race to win.
 *
 * State is mirrored into refs so the timer callbacks never read a stale
 * `visible`. Renders null while the docked sidebar is open, and drops all peek
 * state if the sidebar opens mid-peek.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { SIDEBAR_WIDTH, useSidebar } from "./SidebarShell";

const SHOW_DELAY_MS = 600;
const HIDE_DELAY_MS = 150;
const PANEL_SLIDE_MS = 150;
const BACKDROP_FADE_MS = 200;

export function SidebarPeek({ children }: { children: React.ReactNode }) {
  const { open } = useSidebar();
  // `visible` drives the slide/fade; `mounted` keeps the backdrop in the DOM
  // through its fade-out. The panel itself is always rendered (slid off-screen
  // when hidden) so its geometry/handlers are stable.
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const visibleRef = useRef(false);

  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = (ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) => {
    if (ref.current) {
      clearTimeout(ref.current);
      ref.current = null;
    }
  };

  const reveal = useCallback(() => {
    clearTimer(hideTimer);
    clearTimer(unmountTimer);
    visibleRef.current = true;
    setMounted(true);
    setVisible(true);
  }, []);

  const conceal = useCallback(() => {
    clearTimer(showTimer);
    clearTimer(hideTimer);
    visibleRef.current = false;
    setVisible(false);
    // Hold the backdrop in the DOM until the fade-out finishes.
    clearTimer(unmountTimer);
    unmountTimer.current = setTimeout(() => {
      unmountTimer.current = null;
      setMounted(false);
    }, BACKDROP_FADE_MS);
  }, []);

  // --- Strip: open trigger only ---

  // Must *rest* on the edge before it reveals; a quick brush schedules an open
  // that the strip-leave cancels before it fires.
  const onStripEnter = useCallback(() => {
    if (visibleRef.current || showTimer.current) return;
    showTimer.current = setTimeout(() => {
      showTimer.current = null;
      reveal();
    }, SHOW_DELAY_MS);
  }, [reveal]);

  const onStripLeave = useCallback(() => {
    clearTimer(showTimer);
  }, []);

  // --- Panel: owns keep-open + hide ---

  // Cursor on the panel → lock open instantly, killing any pending hide and a
  // not-yet-fired open. Re-reveals if the panel was caught mid-conceal.
  const onPanelEnter = useCallback(() => {
    clearTimer(hideTimer);
    clearTimer(showTimer);
    if (!visibleRef.current) reveal();
  }, [reveal]);

  // Leaving the panel forgives a 150ms diagonal corner-cut before hiding.
  const onPanelLeave = useCallback(() => {
    clearTimer(hideTimer);
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      conceal();
    }, HIDE_DELAY_MS);
  }, [conceal]);

  // If the real sidebar opens (⌘B) mid-peek, drop all peek state.
  useEffect(() => {
    if (open) {
      clearTimer(showTimer);
      clearTimer(hideTimer);
      clearTimer(unmountTimer);
      visibleRef.current = false;
      setVisible(false);
      setMounted(false);
    }
  }, [open]);

  useEffect(
    () => () => {
      clearTimer(showTimer);
      clearTimer(hideTimer);
      clearTimer(unmountTimer);
    },
    [],
  );

  if (open) return null;

  return (
    <>
      {/* Invisible hover strip — 20px wide, vertically centered to the panel's
          80vh band so the cursor that triggers it is always within the
          revealed panel. Only the class drives the vertical centering (no
          inline transform) — Tailwind v4 emits `translate: 0 -50%`. */}
      <div
        data-peek-strip
        className="fixed left-0 top-1/2 z-40 h-[80vh] w-5 -translate-y-1/2"
        onMouseEnter={onStripEnter}
        onMouseLeave={onStripLeave}
      />

      {/* Backdrop — fades with visibility, unmounted after the fade completes.
          Purely a dim + click-to-dismiss surface; it never schedules show/hide
          (that's owned by the panel), so it can't fight the reveal. */}
      {mounted && (
        <div
          className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-200"
          style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none" }}
          onClick={conceal}
          aria-hidden
        />
      )}

      {/* The floating panel — slides in from the left edge. Vertical centering
          is done entirely via the inline transform; do NOT also add
          `-translate-y-1/2` (Tailwind v4 emits a separate `translate` property
          that would stack with this transform and shove the panel off-screen). */}
      <div
        data-peek-panel
        data-peek-visible={visible ? "1" : "0"}
        className="fixed left-0 top-1/2 z-50 h-[80vh] overflow-hidden rounded-r-xl border border-l-0 border-border bg-sidebar text-sidebar-foreground shadow-2xl"
        style={{
          width: SIDEBAR_WIDTH,
          transform: `translateY(-50%) translateX(${visible ? "0" : "-100%"})`,
          transition: `transform ${PANEL_SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
          willChange: "transform",
          pointerEvents: visible ? "auto" : "none",
        }}
        onMouseEnter={onPanelEnter}
        onMouseLeave={onPanelLeave}
      >
        {children}
      </div>
    </>
  );
}
