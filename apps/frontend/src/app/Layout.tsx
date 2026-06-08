import { useCallback, useEffect, useRef } from "react";
import { Outlet, useMatchRoute } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "../components/sidebar/AppSidebar";
import { SidebarPeek } from "../components/sidebar/SidebarPeek";
import { useResizablePanel } from "@plannotator/ui/hooks/useResizablePanel";
import { ResizeHandle } from "@plannotator/ui/components/ResizeHandle";
import { AddProjectDialog } from "../components/landing/AddProjectDialog";
import { AppSettingsDialog } from "../components/settings/AppSettingsDialog";
import { SessionSurface } from "../components/sessions/SessionSurface";
import { appStore } from "../stores/app-store";
import { setGlobalFetchBase } from "@plannotator/ui/utils/api";
import { useDaemonEvents } from "../daemon/events/use-daemon-events";

setGlobalFetchBase("/daemon");
import { projectStore } from "../stores/project-store";
import { useAppStore } from "../stores/app-store";

function LayoutContent({
  sidebarResize,
  closeSidebarRef,
}: {
  sidebarResize: ReturnType<typeof useResizablePanel>;
  closeSidebarRef: React.MutableRefObject<() => void>;
}) {
  const addProjectOpen = useAppStore((s) => s.addProjectOpen);
  const setAddProjectOpen = useAppStore((s) => s.setAddProjectOpen);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const visitedSessions = useAppStore((s) => s.visitedSessions);
  const matchRoute = useMatchRoute();
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();

  // Bridge the snap-close handler (created outside the provider) to the
  // sidebar's setter, which only exists in here.
  useEffect(() => {
    closeSidebarRef.current = () => setSidebarOpen(false);
  }, [closeSidebarRef, setSidebarOpen]);

  const { reportActiveSession } = useDaemonEvents();

  useEffect(() => {
    void projectStore.getState().fetchProjects();
  }, []);

  const isOnSession = !!matchRoute({ to: "/s/$sessionId", fuzzy: true });

  useEffect(() => {
    reportActiveSession(isOnSession ? activeSessionId : null);
  }, [reportActiveSession, isOnSession, activeSessionId]);
  const showLanding = !isOnSession;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        const current = appStore.getState().settingsOpen;
        appStore.getState().setSettingsOpen(!current);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // While drag-resizing the sidebar, suppress its width transition so it tracks
  // the cursor 1:1 instead of trailing 200ms behind (see styles.css).
  useEffect(() => {
    const el = document.documentElement;
    if (sidebarResize.isDragging) el.setAttribute("data-sidebar-resizing", "");
    else el.removeAttribute("data-sidebar-resizing");
    return () => el.removeAttribute("data-sidebar-resizing");
  }, [sidebarResize.isDragging]);

  return (
    <>
      <AppSidebar />
      <SidebarPeek />
      {/* Drag handle on the docked sidebar's right edge (open + desktop only). */}
      {sidebarOpen && (
        <div
          className="fixed inset-y-0 z-30 hidden md:flex"
          style={{ left: "var(--sidebar-width)" }}
        >
          <ResizeHandle {...sidebarResize.handleProps} side="left" />
        </div>
      )}
      <main className="relative flex-1 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            visibility: showLanding ? "visible" : "hidden",
            zIndex: showLanding ? 1 : 0,
          }}
        >
          <Outlet />
        </div>

        {Object.values(visitedSessions).map(({ sessionId, bootstrap }) => {
          const isActive = sessionId === activeSessionId && isOnSession;
          return (
            <div
              key={sessionId}
              className={`absolute inset-0 overflow-hidden ${sidebarOpen ? "rounded-tl-xl border-l border-border/50" : ""}`}
              style={{
                visibility: isActive ? "visible" : "hidden",
                contentVisibility: isActive ? "visible" : "hidden",
                containIntrinsicSize: isActive ? undefined : "auto 100vh",
                zIndex: isActive ? 1 : 0,
              }}
            >
              <SessionSurface bootstrap={bootstrap} />
            </div>
          );
        })}
      </main>
      <AddProjectDialog open={addProjectOpen} onOpenChange={setAddProjectOpen} />
      <AppSettingsDialog />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            "--normal-bg": "var(--card)",
            "--normal-border": "var(--border)",
            "--normal-text": "var(--foreground)",
            "--normal-action-bg": "var(--primary)",
            "--normal-action-text": "var(--primary-foreground)",
          } as React.CSSProperties,
        }}
      />
    </>
  );
}

export function Layout() {
  const matchRoute = useMatchRoute();
  const initiallyOnSession = !!matchRoute({ to: "/s/$sessionId", fuzzy: true });
  // useSidebar() (which owns the close fn) only exists inside SidebarProvider,
  // so the snap handler can't reach it from here. LayoutContent fills this ref;
  // the snap handler calls through it.
  const closeSidebarRef = useRef<() => void>(() => {});
  const sidebarResize = useResizablePanel({
    storageKey: "plannotator-app-sidebar-width",
    defaultWidth: 256, // 16rem
    minWidth: 220,
    maxWidth: 480,
    side: "left",
    // Drag the sidebar skinny → snap it shut (matches the in-plan panels).
    onSnapClose: () => closeSidebarRef.current(),
    // Render-free drag: write the live width straight to a :root CSS var. The
    // whole layout (sidebar, sessions) never re-renders mid-drag. React only
    // commits to state on release. SidebarProvider's --sidebar-width references
    // this var, so React re-renders can't clobber the imperative value.
    apply: (w) => {
      document.documentElement.style.setProperty("--app-sidebar-width", `${w}px`);
    },
  });

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={100}>
      <SidebarProvider
        defaultOpen={!initiallyOnSession}
        style={
          {
            // References the :root var written imperatively during drag; falls
            // back to the committed width for the initial render / before any drag.
            "--sidebar-width": `var(--app-sidebar-width, ${sidebarResize.width}px)`,
          } as React.CSSProperties
        }
      >
        <LayoutContent sidebarResize={sidebarResize} closeSidebarRef={closeSidebarRef} />
      </SidebarProvider>
    </TooltipProvider>
  );
}
