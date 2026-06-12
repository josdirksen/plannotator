/**
 * App sidebar shell — offcanvas rail, ported from the single-server-runtime
 * worktree's shadcn-based app sidebar (see SIDEBAR-HANDOFF.md notes in
 * docs/canvas-spec.md). Simplified for the canvas: fixed width, no drag
 * resize, no tree — but the same structural ideas:
 *
 *  - Open/closed state seeded from localStorage and persisted on toggle.
 *  - ⌘B / Ctrl-B toggles.
 *  - "Closing" never unmounts: a gap spacer animates its width to 0 while a
 *    fixed panel slides off the left edge, letting the canvas reclaim width.
 *  - When closed, <SidebarPeek/> (separate component) owns the edge-reveal.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export const SIDEBAR_WIDTH = 244;
const STORAGE_KEY = "plannotator-canvas-sidebar";

interface SidebarContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}

export function SidebarProvider({
  defaultOpen,
  children,
}: {
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpenState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "open") return true;
      if (stored === "closed") return false;
    } catch {
      // storage unavailable
    }
    return defaultOpen;
  });

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "open" : "closed");
    } catch {
      // best effort
    }
  }, []);

  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "b" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const value = useMemo(() => ({ open, setOpen, toggle }), [open, setOpen, toggle]);
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

/**
 * The docked rail: gap spacer + fixed sliding panel. Children are the shared
 * sidebar content (also rendered by the peek).
 */
export function SidebarRail({ children }: { children: React.ReactNode }) {
  const { open } = useSidebar();
  return (
    <>
      {/* Gap spacer — collapses so the canvas reclaims the width. */}
      <div
        className="h-full shrink-0 transition-[width] duration-200 ease-out"
        style={{ width: open ? SIDEBAR_WIDTH : 0 }}
      />
      {/* Fixed panel — slides off the left edge rather than unmounting. */}
      <div
        className="fixed inset-y-0 left-0 z-30 bg-sidebar text-sidebar-foreground transition-[transform] duration-200 ease-out"
        style={{
          width: SIDEBAR_WIDTH,
          transform: open ? "translateX(0)" : `translateX(-${SIDEBAR_WIDTH}px)`,
        }}
      >
        {children}
      </div>
    </>
  );
}

/** Toggle button rendered in the main surface's chrome (not in the sidebar). */
export function SidebarTrigger({ className }: { className?: string }) {
  const { open, toggle } = useSidebar();
  return (
    <button
      onClick={toggle}
      title={`${open ? "Hide" : "Show"} sidebar (⌘B)`}
      className={`flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer ${className ?? ""}`}
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="9" y1="4" x2="9" y2="20" />
      </svg>
    </button>
  );
}
