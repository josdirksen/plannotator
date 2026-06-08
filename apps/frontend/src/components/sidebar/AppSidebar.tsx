import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import * as Collapsible from "@radix-ui/react-collapsible";
import { toast } from "sonner";
import { Folder, FolderOpen, Plus, Settings } from "lucide-react";
import { daemonApiClient } from "../../daemon/api/client";
import { TaterSpriteSidebar } from "@plannotator/ui/components/sprites";
import { useActiveProjectCwd } from "./useActiveProjectCwd";
import { ROW, pad } from "./row-style";
import { appStore, useAppStore } from "../../stores/app-store";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { buildSessionTree } from "@plannotator/ui/utils/sessionTree";
import type {
  SessionTreeProject,
  SessionTreeWorktree,
} from "@plannotator/ui/utils/sessionTree";
import type { DaemonSessionSummary } from "@plannotator/shared/daemon-protocol";
import { useDaemonEventStore } from "../../daemon/events/event-store";
import { useProjectStore } from "../../stores/project-store";
import type { SessionSummary } from "../../daemon/contracts";
import { formatSessionLabel, getSessionModeMeta } from "../../shared/session-meta";

/** Non-terminal session statuses — the only ones the sidebar surfaces. */
const LIVE_STATUSES = new Set<string>(["active", "idle", "awaiting-resubmission"]);

function SessionRow({
  session,
  depth,
  matchRoute,
}: {
  session: DaemonSessionSummary;
  depth: number;
  matchRoute: ReturnType<typeof useMatchRoute>;
}) {
  const isActive = !!matchRoute({
    to: "/s/$sessionId",
    params: { sessionId: session.id },
  });
  const Icon = getSessionModeMeta(session.mode).icon;
  return (
    <Link
      to="/s/$sessionId"
      params={{ sessionId: session.id }}
      style={pad(depth)}
      className={cn(
        ROW,
        isActive &&
          "bg-sidebar-accent font-medium text-sidebar-accent-foreground hover:bg-sidebar-accent",
      )}
      title={formatSessionLabel(session.label, session.mode)}
    >
      <Icon className="size-3 shrink-0 text-muted-foreground/55" />
      <span className="truncate">{formatSessionLabel(session.label, session.mode)}</span>
    </Link>
  );
}

/** Mode icon shared with annotate session rows, so the row reads as a sibling. */
const AnnotateModeIcon = getSessionModeMeta("annotate").icon;

/** True for an annotate session whose match key encodes a folder (vs a single file). */
function isFolderAnnotateSession(s: DaemonSessionSummary): boolean {
  return s.mode === "annotate" && !!s.matchKey && s.matchKey.includes(":folder:");
}

/** The live folder-annotate session anchored to exactly this folder, if any. */
function folderSessionFor(
  sessions: DaemonSessionSummary[],
  cwd: string,
): DaemonSessionSummary | undefined {
  return sessions.find((s) => s.matchKey?.endsWith(`:folder:${cwd}`));
}

/**
 * The folder's "Annotate" row — one per project and worktree, so every folder is
 * openable. When the folder's annotate session is live it IS that session: the row
 * highlights when active and navigates straight to it. When none exists yet, the
 * row launches one (create-or-reuse via the daemon, mirroring HistoryRow.handleOpen).
 */
function FolderAnnotateRow({
  cwd,
  depth,
  session,
  matchRoute,
}: {
  cwd: string;
  depth: number;
  session?: DaemonSessionSummary;
  matchRoute: ReturnType<typeof useMatchRoute>;
}) {
  const navigate = useNavigate();
  const [launching, setLaunching] = useState(false);
  const isActive =
    !!session && !!matchRoute({ to: "/s/$sessionId", params: { sessionId: session.id } });

  const handleOpen = async () => {
    if (session) {
      void navigate({ to: "/s/$sessionId", params: { sessionId: session.id } });
      return;
    }
    if (launching) return;
    setLaunching(true);
    const result = await daemonApiClient.createAnnotateFolderSession(cwd);
    setLaunching(false);
    if (result.ok) {
      void navigate({ to: "/s/$sessionId", params: { sessionId: result.data.session.id } });
    } else {
      toast.error("Failed to open folder", { description: result.error.message });
    }
  };

  return (
    <button
      type="button"
      onClick={handleOpen}
      disabled={launching}
      style={pad(depth)}
      className={cn(
        ROW,
        "cursor-pointer text-muted-foreground/70 disabled:cursor-default disabled:opacity-60",
        isActive &&
          "bg-sidebar-accent font-medium text-sidebar-accent-foreground hover:bg-sidebar-accent",
      )}
      title="Annotate this folder"
    >
      <AnnotateModeIcon className="size-3 shrink-0 text-muted-foreground/55" />
      <span className="truncate">Annotate</span>
    </button>
  );
}

function WorktreeNode({
  worktree,
  depth,
  matchRoute,
}: {
  worktree: SessionTreeWorktree;
  depth: number;
  matchRoute: ReturnType<typeof useMatchRoute>;
}) {
  const override = useAppStore((s) => s.worktreeOpen[worktree.cwd]);
  const setWorktreeOpen = useAppStore((s) => s.setWorktreeOpen);
  // The folder-annotate session (if live) is represented by the Annotate row, not
  // a separate session row.
  const folderSession = folderSessionFor(worktree.sessions, worktree.cwd);
  const sessionRows = worktree.sessions.filter((s) => !isFolderAnnotateSession(s));
  // Default open when the worktree has a real session (something beyond its
  // Annotate row) OR contains the session you're currently viewing — so the
  // active worktree opens itself, even after a refresh (the route is the source
  // of truth). A user's explicit toggle overrides the default and sticks.
  const containsActive = worktree.sessions.some(
    (s) => !!matchRoute({ to: "/s/$sessionId", params: { sessionId: s.id } }),
  );
  const open = override ?? (sessionRows.length > 0 || containsActive);
  return (
    <Collapsible.Root open={open} onOpenChange={(next) => setWorktreeOpen(worktree.cwd, next)}>
      <Collapsible.Trigger
        style={pad(depth)}
        className={cn(ROW, "text-sidebar-foreground/70")}
        title={worktree.name}
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center text-[11px] font-bold text-muted-foreground/55">W</span>
        <span className="truncate">{worktree.name}</span>
        {sessionRows.length > 0 && (
          <span className="ml-auto pl-1 text-[10px] tabular-nums text-muted-foreground/45">
            {sessionRows.length}
          </span>
        )}
      </Collapsible.Trigger>
      <Collapsible.Content>
        <FolderAnnotateRow
          cwd={worktree.cwd}
          depth={depth + 1}
          session={folderSession}
          matchRoute={matchRoute}
        />
        {sessionRows.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            depth={depth + 1}
            matchRoute={matchRoute}
          />
        ))}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function ProjectNode({
  project,
  isOpen,
  onToggle,
  matchRoute,
}: {
  project: SessionTreeProject;
  isOpen: boolean;
  onToggle: () => void;
  matchRoute: ReturnType<typeof useMatchRoute>;
}) {
  // Folder-annotate sessions are shown as each folder's Annotate row, so they're
  // excluded from session-row rendering and from the live-session count.
  const folderSession = folderSessionFor(project.directSessions, project.cwd);
  const directRows = project.directSessions.filter((s) => !isFolderAnnotateSession(s));
  const liveCount =
    directRows.length +
    project.worktrees.reduce(
      (sum, wt) => sum + wt.sessions.filter((s) => !isFolderAnnotateSession(s)).length,
      0,
    );

  return (
    <Collapsible.Root open={isOpen} onOpenChange={onToggle}>
      <Collapsible.Trigger
        style={pad(0)}
        className={cn(ROW, "font-medium text-sidebar-foreground/90")}
        title={project.name}
      >
        {isOpen ? (
          <FolderOpen className="size-3.5 shrink-0 text-muted-foreground/60" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-muted-foreground/60" />
        )}
        <span className="truncate">{project.name}</span>
        {liveCount > 0 && (
          <span className="ml-auto pl-1 text-[10px] tabular-nums text-muted-foreground/45">
            {liveCount}
          </span>
        )}
      </Collapsible.Trigger>
      <Collapsible.Content>
        <FolderAnnotateRow
          cwd={project.cwd}
          depth={1}
          session={folderSession}
          matchRoute={matchRoute}
        />
        {directRows.map((session) => (
          <SessionRow key={session.id} session={session} depth={1} matchRoute={matchRoute} />
        ))}
        {project.worktrees.map((worktree) => (
          <WorktreeNode
            key={worktree.cwd}
            worktree={worktree}
            depth={1}
            matchRoute={matchRoute}
          />
        ))}
        {liveCount === 0 && project.worktrees.length === 0 && !folderSession && (
          <div
            style={pad(1)}
            className="flex h-6 items-center text-[11px] text-muted-foreground/40"
          >
            No live sessions
          </div>
        )}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

export function AppSidebarContent({ contentClassName }: { contentClassName?: string } = {}) {
  const sessions = useDaemonEventStore((s) => s.sessions);
  const projects = useProjectStore((p) => p.projects);
  const expandedProjects = useAppStore((s) => s.expandedProjects);
  const toggleProjectExpand = useAppStore((s) => s.toggleProjectExpand);
  const activeProjectCwd = useActiveProjectCwd();
  const matchRoute = useMatchRoute();

  // Live-only: exclude terminal sessions (completed/cancelled/expired/failed).
  const liveSessions = useMemo<SessionSummary[]>(
    () => sessions.filter((s) => LIVE_STATUSES.has(s.status)),
    [sessions],
  );

  // buildSessionTree only reads project/worktree placement fields, never `mode`,
  // so the (widened) SessionSummary.mode is safe to narrow at this boundary.
  const tree = useMemo(
    () => buildSessionTree(projects, liveSessions as DaemonSessionSummary[]),
    [projects, liveSessions],
  );

  // Active project is open by default — seed it into expandedProjects exactly once
  // per cwd (one-shot guard) so a later explicit collapse isn't re-opened. Effect
  // depends only on activeProjectCwd, never on expandedProjects.
  const seededProjects = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (activeProjectCwd && !seededProjects.current.has(activeProjectCwd)) {
      seededProjects.current.add(activeProjectCwd);
      appStore.getState().setProjectExpanded(activeProjectCwd, true);
    }
  }, [activeProjectCwd]);

  return (
    <>
      <SidebarHeader>
        <Link to="/" className="flex items-end gap-2 px-3 pt-2">
          <TaterSpriteSidebar />
          <div className="flex flex-col">
            <span
              className="text-base font-semibold tracking-tight leading-tight"
              style={{
                fontFamily: "'Instrument Sans Variable', 'Instrument Sans', system-ui, sans-serif",
              }}
            >
              Plannotator
            </span>
            <span className="text-[10px] text-muted-foreground">
              v{__APP_VERSION__} ·{" "}
              <a
                href="https://github.com/backnotprop/plannotator/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                Send feedback
              </a>
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className={`gap-0 px-1 py-2 ${contentClassName ?? ""}`}>
        <button
          type="button"
          onClick={() => appStore.getState().setAddProjectOpen(true)}
          className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
        >
          <Plus className="size-4 shrink-0" />
          New project
        </button>
        <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
          Projects
        </div>
        {tree.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground/50">
            No projects yet
          </div>
        ) : (
          tree.map((project) => (
            <ProjectNode
              key={project.cwd}
              project={project}
              isOpen={expandedProjects.has(project.cwd)}
              onToggle={() => toggleProjectExpand(project.cwd)}
              matchRoute={matchRoute}
            />
          ))
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => appStore.getState().setSettingsOpen(true)}
              tooltip="Settings"
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="offcanvas">
      {/* Logo/header stays pinned at the top; only the project tree drops down
          a bit in the docked sidebar (the peek is fine, so it's untouched). */}
      <AppSidebarContent contentClassName="mt-6" />
    </Sidebar>
  );
}
