import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Code2,
  FileText,
  Folder,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  Trash2,
} from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PullRequestIcon } from "@plannotator/ui/components/PullRequestIcon";
import { prettyPath } from "@plannotator/shared/project";
import { ASCII_BANNER } from "./ascii-banner";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useProjectStore, projectStore } from "../../stores/project-store";
import { GitDashboard } from "./git-dashboard/GitDashboard";
import { ActiveSessionsList } from "./ActiveSessionsList";
import { FullSessionsHistoryView } from "./FullSessionsHistoryView";
import { useDaemonEventStore } from "../../daemon/events/event-store";
import { daemonApiClient } from "../../daemon/api/client";
import { buildStacks, type PRStack } from "./buildStacks";
import type {
  ProjectEntry,
  PRListItem,
  WorktreeEntry,
} from "../../daemon/contracts";

interface LandingPageProps {
  onAddProject: () => void;
}

export type LaunchFn = (cwd: string, action: "review" | "annotate", prUrl?: string) => void;

export function LandingPage({ onAddProject }: LandingPageProps) {
  const projects = useProjectStore((s) => s.projects);
  const sessions = useDaemonEventStore((s) => s.sessions);
  const [launching, setLaunching] = useState(false);
  const [viewIndex, setViewIndex] = useState(() =>
    typeof window !== "undefined" && window.location.hash === "#dashboard" ? 1 : 0,
  );
  const navigate = useNavigate();

  const launch = useCallback<LaunchFn>(
    async (cwd, action, prUrl) => {
      if (launching) return;
      setLaunching(true);
      try {
        const result =
          action === "annotate"
            ? await daemonApiClient.createAnnotateFolderSession(cwd)
            : await daemonApiClient.createReviewSession(cwd, prUrl);
        if (result.ok) {
          void navigate({ to: "/s/$sessionId", params: { sessionId: result.data.session.id } });
        } else {
          toast.error("Failed to launch", { description: result.error.message });
        }
      } finally {
        setLaunching(false);
      }
    },
    [launching, navigate],
  );

  return (
    <div className="isolate flex h-full flex-col bg-muted">
      <div className="flex-1 overflow-hidden p-2">
        <div className="relative h-full overflow-hidden rounded-xl bg-card shadow-[var(--card-shadow)]">
          <div className="absolute top-2 left-2 z-10">
            <SidebarTrigger />
          </div>
          <div
            className="flex h-full"
            style={{
              transform: `translateX(${-viewIndex * 100}%)`,
              transition: "transform 500ms cubic-bezier(0.4, 0, 0.2, 1)",
              willChange: "transform",
            }}
          >
            <div className="h-full w-full shrink-0">
              <main className="flex h-full items-center justify-center overflow-auto">
                <div className="w-full max-w-2xl px-6">
                  <pre
                    // ASCII art must render in a guaranteed-monospace font. Use Geist
                    // Mono (the app's mono face) for the intended look, with a system
                    // monospace fallback so a failed or re-broken webfont still draws
                    // aligned, legible art instead of proportional mush. The geist-mono
                    // dependency is pinned to an exact version because a 5.2.8 patch
                    // once shifted its line-box metrics and overlapped these rows.
                    className="mb-8 select-none overflow-x-auto text-[5px] leading-[1.2] text-foreground/70 sm:text-[6px] md:text-[7px]"
                    style={{
                      fontFamily:
                        '"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                    }}
                    aria-hidden="true"
                  >
                    {ASCII_BANNER}
                  </pre>

                  {projects.length === 0 && sessions.length === 0 ? (
                    <EmptyState onAddProject={onAddProject} />
                  ) : (
                    <div className="flex flex-col gap-8">
                      {projects.length > 0 && (
                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                              Projects
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={onAddProject}
                                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-foreground/80 hover:bg-surface-1 hover:text-foreground"
                              >
                                <FolderPlus className="size-3.5" />
                                Add project
                              </button>
                              <button
                                type="button"
                                onClick={() => setViewIndex(1)}
                                className="text-[12px] text-muted-foreground hover:text-foreground"
                              >
                                Git Dashboard →
                              </button>
                            </div>
                          </div>
                          <ProjectTable projects={projects} launch={launch} launching={launching} />
                        </div>
                      )}

                      {(projects.length > 0 || sessions.length > 0) && (
                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                              Active sessions
                            </span>
                            <button
                              type="button"
                              onClick={() => setViewIndex(2)}
                              className="text-[12px] text-muted-foreground hover:text-foreground"
                            >
                              History →
                            </button>
                          </div>
                          <ActiveSessionsList />
                        </div>
                      )}

                      {projects.length === 0 && (
                        <button
                          type="button"
                          onClick={onAddProject}
                          className="inline-flex items-center gap-1.5 text-[12px] text-foreground/80 hover:text-foreground"
                        >
                          <FolderPlus className="size-3.5" />
                          Add project to launch sessions
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </main>
            </div>
            <div className="h-full w-full shrink-0">
              <GitDashboard active={viewIndex === 1} onBack={() => setViewIndex(0)} />
            </div>
            <div className="h-full w-full shrink-0">
              <FullSessionsHistoryView active={viewIndex === 2} onBack={() => setViewIndex(0)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectTable({
  projects,
  launch,
  launching,
}: {
  projects: ProjectEntry[];
  launch: LaunchFn;
  launching: boolean;
}) {
  const topLevel = projects.filter((p) => !p.parentCwd);
  const worktreeChildren = (parentCwd: string) => projects.filter((p) => p.parentCwd === parentCwd);

  return (
    <div className="max-h-96 overflow-y-auto rounded-lg border border-border">
      {topLevel.map((project, i) => {
        const children = worktreeChildren(project.cwd);
        return (
          <ProjectNode
            key={project.cwd}
            project={project}
            children={children}
            isFirst={i === 0}
            launch={launch}
            launching={launching}
          />
        );
      })}
    </div>
  );
}

function ProjectNode({
  project,
  children,
  isFirst,
  launch,
  launching,
}: {
  project: ProjectEntry;
  children: ProjectEntry[];
  isFirst: boolean;
  launch: LaunchFn;
  launching: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([]);
  const [worktreesFetched, setWorktreesFetched] = useState(false);
  const [prs, setPrs] = useState<PRListItem[]>([]);
  const [prPlatform, setPrPlatform] = useState<string | null>(null);
  const [prError, setPrError] = useState<string | null>(null);
  const [prsLoading, setPrsLoading] = useState(false);
  const [prsFetchedAt, setPrsFetchedAt] = useState(0);
  const hasChildren = children.length > 0;

  useEffect(() => {
    if (!expanded || worktreesFetched) return;
    setWorktreesFetched(true);
    daemonApiClient.listWorktrees(project.cwd).then((result) => {
      if (result.ok) {
        setWorktrees(result.data.worktrees.filter((wt) => wt.path !== project.cwd));
      }
    });
  }, [expanded, project.cwd, worktreesFetched]);

  useEffect(() => {
    if (!expanded) return;
    const stale = !prsFetchedAt || Date.now() - prsFetchedAt > 30_000;
    if (!stale || prsLoading) return;
    setPrsLoading(true);
    daemonApiClient.listPRs(project.cwd).then((result) => {
      if (result.ok) {
        setPrs(result.data.prs);
        setPrPlatform(result.data.platform);
        setPrError(result.data.error ?? null);
      }
      setPrsLoading(false);
      setPrsFetchedAt(Date.now());
    });
  }, [expanded, project.cwd, prsFetchedAt, prsLoading]);

  const hasWorktrees = hasChildren || worktrees.length > 0;

  const handleRemove = useCallback(async () => {
    const ok = window.confirm(
      `Remove "${project.name}"?\n\nThis will cancel active sessions and delete plan history for this project.`,
    );
    if (!ok) return;
    const removed = await projectStore.getState().removeProject(project.cwd, true);
    if (removed) {
      toast.success(`Removed ${project.name}`);
    } else {
      toast.error(`Failed to remove ${project.name}`);
    }
  }, [project.name, project.cwd]);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div>
          <div
            className={cn(
              "group flex w-full items-center gap-3 px-3 py-2 text-[13px]",
              !isFirst && "border-t border-border",
              "text-foreground hover:bg-surface-1",
            )}
          >
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{project.name}</span>
                  {project.branch && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {project.branch}
                    </span>
                  )}
                </div>
                <div
                  className="truncate font-mono text-[11px] text-muted-foreground/70"
                  title={project.cwd}
                >
                  {prettyPath(project.cwd)}
                </div>
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <button
                type="button"
                aria-label="Review project"
                title="Review"
                disabled={launching}
                onClick={() => launch(project.cwd, "review")}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-surface-1 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
              >
                <Code2 className="size-3.5" />
                Review
              </button>
              <button
                type="button"
                aria-label="Annotate project"
                title="Annotate"
                disabled={launching}
                onClick={() => launch(project.cwd, "annotate")}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-surface-1 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
              >
                <FileText className="size-3.5" />
                Annotate
              </button>
            </div>
            <button
              type="button"
              aria-label={expanded ? "Collapse" : "Expand"}
              onClick={() => setExpanded((prev) => !prev)}
              className={cn(
                "shrink-0 rounded p-0.5 text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground",
                "focus-visible:opacity-100 group-hover:opacity-100",
                expanded ? "opacity-100" : "opacity-0",
              )}
            >
              {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
          </div>

          {expanded && (
            <div className="border-t border-border bg-muted/50 px-3 py-2 pl-9">
              <Tabs defaultValue="worktrees">
                <TabsList className="mb-1.5 gap-1">
                  <TabsTrigger value="worktrees" className="px-2 py-0.5 text-[11px]">
                    Worktrees
                  </TabsTrigger>
                  <TabsTrigger value="prs" className="px-2 py-0.5 text-[11px]">
                    PRs
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="worktrees">
                  <WorktreeList
                    children={children}
                    worktrees={worktrees}
                    hasWorktrees={hasWorktrees}
                    launch={launch}
                    launching={launching}
                  />
                </TabsContent>
                <TabsContent value="prs">
                  <PRList
                    prs={prs}
                    loading={prsLoading}
                    error={prError}
                    platform={prPlatform}
                    projectCwd={project.cwd}
                    launch={launch}
                    launching={launching}
                  />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-[160px] overflow-hidden rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-lg">
          <ContextMenu.Item
            onSelect={handleRemove}
            className="mx-1 flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-destructive outline-none data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
          >
            <Trash2 className="size-3.5" />
            Remove project
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function PRRow({
  pr,
  projectCwd,
  launch,
  launching,
}: {
  pr: PRListItem;
  projectCwd: string;
  launch: LaunchFn;
  launching: boolean;
}) {
  return (
    <button
      type="button"
      disabled={launching}
      onClick={() => launch(projectCwd, "review", pr.url)}
      className={cn(
        "flex items-center gap-2 rounded-md border px-2 py-1 text-left text-[11px]",
        "border-border bg-background text-foreground/80 hover:border-foreground/20 hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      <PullRequestIcon
        className={cn(
          "size-3.5 shrink-0",
          pr.state === "open" && "text-green-500",
          pr.state === "merged" && "text-purple-500",
          pr.state === "closed" && "text-muted-foreground",
        )}
      />
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">#{pr.number}</span>
      <span className="truncate">{pr.title}</span>
      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">@{pr.author}</span>
    </button>
  );
}

function StackIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 500 400"
      fill="none"
      stroke="currentColor"
      strokeWidth={28}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <polygon points="250,30 470,160 250,290 30,160" />
      <polyline points="30,220 250,350 470,220" />
      <polyline points="30,280 250,410 470,280" />
    </svg>
  );
}

function StackGroup({
  stack,
  projectCwd,
  launch,
  launching,
}: {
  stack: PRStack;
  projectCwd: string;
  launch: LaunchFn;
  launching: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border border-border bg-background">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] text-foreground/80 hover:text-foreground"
      >
        <StackIcon className="size-3.5 shrink-0 text-accent" />
        <span className="font-mono text-[10px] text-muted-foreground">{stack.label}</span>
        <span className="text-[10px] text-muted-foreground">({stack.prs.length} PRs)</span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-1 px-1 pb-1">
          {stack.prs.map((pr) => (
            <PRRow
              key={pr.id}
              pr={pr}
              projectCwd={projectCwd}
              launch={launch}
              launching={launching}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PRList({
  prs,
  loading,
  error,
  platform,
  projectCwd,
  launch,
  launching,
}: {
  prs: PRListItem[];
  loading: boolean;
  error: string | null;
  platform: string | null;
  projectCwd: string;
  launch: LaunchFn;
  launching: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = useMemo(
    () => (showAll ? prs : prs.filter((pr) => pr.state === "open")),
    [prs, showAll],
  );
  const hiddenCount = prs.length - visible.length;
  const { stacks, loose } = useMemo(() => buildStacks(visible), [visible]);

  if (loading) {
    return <div className="py-1 text-[11px] text-muted-foreground">Loading PRs…</div>;
  }
  if (error === "no-remote") {
    return <div className="py-1 text-[11px] text-muted-foreground">No git remote detected</div>;
  }
  if (error === "no-cli") {
    return (
      <div className="py-1 text-[11px] text-muted-foreground">
        {platform === "gitlab" ? "GitLab CLI (glab)" : "GitHub CLI (gh)"} not installed
      </div>
    );
  }
  if (error === "auth-failed") {
    return (
      <div className="py-1 text-[11px] text-muted-foreground">
        {platform === "gitlab" ? "glab" : "gh"} not authenticated — run{" "}
        <code className="rounded bg-muted px-1 text-[10px]">
          {platform === "gitlab" ? "glab" : "gh"} auth login
        </code>
      </div>
    );
  }
  if (error === "fetch-failed") {
    return (
      <div className="py-1 text-[11px] text-muted-foreground">
        Failed to load {platform === "gitlab" ? "merge requests" : "pull requests"}
      </div>
    );
  }
  if (visible.length === 0 && !showAll) {
    return (
      <div className="py-1 text-[11px] text-muted-foreground">
        No open pull requests
        {hiddenCount > 0 && (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="underline hover:text-foreground"
            >
              show {hiddenCount} closed/merged
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {stacks.map((stack) => (
        <StackGroup
          key={stack.label}
          stack={stack}
          projectCwd={projectCwd}
          launch={launch}
          launching={launching}
        />
      ))}
      {loose.map((pr) => (
        <PRRow
          key={pr.id}
          pr={pr}
          projectCwd={projectCwd}
          launch={launch}
          launching={launching}
        />
      ))}
      {!showAll && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="py-0.5 text-left text-[10px] text-muted-foreground hover:text-foreground"
        >
          Show {hiddenCount} closed/merged
        </button>
      )}
    </div>
  );
}

function WorktreeList({
  children,
  worktrees,
  hasWorktrees,
  launch,
  launching,
}: {
  children: ProjectEntry[];
  worktrees: WorktreeEntry[];
  hasWorktrees: boolean;
  launch: LaunchFn;
  launching: boolean;
}) {
  if (!hasWorktrees) {
    return <div className="py-1 text-[11px] text-muted-foreground">No worktrees</div>;
  }

  const allWorktrees: { path: string; branch: string }[] = [];
  for (const child of children) {
    allWorktrees.push({ path: child.cwd, branch: child.branch ?? child.name });
  }
  for (const wt of worktrees) {
    if (!children.some((c) => c.cwd === wt.path)) {
      allWorktrees.push({ path: wt.path, branch: wt.branch ?? "detached" });
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {allWorktrees.map((wt) => (
        <div
          key={wt.path}
          className={cn(
            "group flex items-center gap-2 rounded-md border px-2 py-1 text-[11px]",
            "border-border bg-background text-foreground/80 hover:border-foreground/20 hover:text-foreground",
          )}
        >
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 truncate">{wt.branch}</span>
          <span
            className="ml-auto min-w-0 truncate font-mono text-[10px] text-muted-foreground/70"
            title={wt.path}
          >
            {prettyPath(wt.path)}
          </span>
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              aria-label={`Review ${wt.branch}`}
              title="Review"
              disabled={launching}
              onClick={() => launch(wt.path, "review")}
              className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium hover:bg-surface-1 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
            >
              <Code2 className="size-3" />
              Review
            </button>
            <button
              type="button"
              aria-label={`Annotate ${wt.branch}`}
              title="Annotate"
              disabled={launching}
              onClick={() => launch(wt.path, "annotate")}
              className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium hover:bg-surface-1 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
            >
              <FileText className="size-3" />
              Annotate
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onAddProject }: { onAddProject: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <h2 className="text-lg font-semibold">No projects yet</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Projects appear automatically when an agent creates a session, or you can add one manually.
      </p>
      <button
        type="button"
        onClick={onAddProject}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
      >
        <FolderPlus className="size-4" />
        Add project
      </button>
    </div>
  );
}
