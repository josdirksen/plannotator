import { useCallback, useEffect, useRef, useState } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { AppSidebarContent } from "./AppSidebar";

// Hover-intent: how long the cursor must rest on the left edge before the peek
// slides in. Keeps a quick brush past the edge from triggering it. Tune freely.
const SHOW_DELAY_MS = 600;
// Grace period before hiding when the cursor leaves the peek, so you don't lose
// it by cutting a corner.
const HIDE_DELAY_MS = 150;

export function SidebarPeek() {
  const { open } = useSidebar();
  const [visible, setVisible] = useState(false);
  const [backdropMounted, setBackdropMounted] = useState(false);
  const [backdropVisible, setBackdropVisible] = useState(false);
  const showTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearShow = useCallback(() => {
    if (showTimeout.current) {
      clearTimeout(showTimeout.current);
      showTimeout.current = null;
    }
  }, []);

  const clearHide = useCallback(() => {
    if (hideTimeout.current) {
      clearTimeout(hideTimeout.current);
      hideTimeout.current = null;
    }
  }, []);

  // Edge strip: arm a delayed reveal (hover intent).
  const scheduleShow = useCallback(() => {
    clearHide();
    if (visible) return;
    clearShow();
    showTimeout.current = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
  }, [visible, clearHide, clearShow]);

  // Left the edge before the delay elapsed — cancel the pending reveal.
  const cancelShow = useCallback(() => {
    clearShow();
  }, [clearShow]);

  // On the peek itself: keep it open instantly (cancel any pending hide).
  const keepOpen = useCallback(() => {
    clearShow();
    clearHide();
    setVisible(true);
  }, [clearShow, clearHide]);

  const hide = useCallback(() => {
    clearShow();
    clearHide();
    hideTimeout.current = setTimeout(() => setVisible(false), HIDE_DELAY_MS);
  }, [clearShow, clearHide]);

  // Backdrop fade follows visibility.
  useEffect(() => {
    if (visible) {
      setBackdropMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setBackdropVisible(true));
      });
    } else {
      setBackdropVisible(false);
      const timer = setTimeout(() => setBackdropMounted(false), 200);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  // If the real sidebar opens, drop any pending peek state.
  useEffect(() => {
    if (open) {
      clearShow();
      clearHide();
      setVisible(false);
    }
  }, [open, clearShow, clearHide]);

  // Clean up timers on unmount.
  useEffect(() => () => {
    if (showTimeout.current) clearTimeout(showTimeout.current);
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
  }, []);

  if (open) return null;

  return (
    <>
      {/* Hover strip — invisible hit area on the left edge (delayed reveal).
          Matched to the peek's vertical band so the peek always opens directly
          under the cursor (no dead zones above/below where it would open). */}
      <div
        className="fixed left-0 top-1/2 z-40 h-[80vh] w-5 -translate-y-1/2"
        onMouseEnter={scheduleShow}
        onMouseLeave={cancelShow}
      />
      {/* Backdrop overlay */}
      {backdropMounted && (
        <div
          className="pointer-events-none fixed inset-0 z-40 bg-black/30"
          style={{
            opacity: backdropVisible ? 1 : 0,
            transition: "opacity 200ms ease",
          }}
        />
      )}
      {/* Floating sidebar panel */}
      <div
        className="fixed left-0 top-1/2 z-50 h-[80vh] w-[var(--sidebar-width)] rounded-r-lg border border-l-0 border-border bg-sidebar text-sidebar-foreground shadow-[0_8px_40px_-12px_rgba(0,0,0,0.3)]"
        style={{
          transform: visible ? "translate(0px, -50%)" : "translate(-100%, -50%)",
          transition: "transform 150ms cubic-bezier(0.4, 0, 0.2, 1)",
          willChange: "transform",
        }}
        onMouseEnter={keepOpen}
        onMouseLeave={hide}
      >
        <div className="flex h-full flex-col overflow-hidden rounded-r-lg">
          <AppSidebarContent />
        </div>
      </div>
    </>
  );
}
