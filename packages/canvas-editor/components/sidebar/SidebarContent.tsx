/**
 * Shared sidebar body, rendered by both the docked rail and the edge-peek
 * (same as the reference pattern's AppSidebarContent). Three regions:
 * header (wordmark), the flat project list (most recent first — deliberately
 * no tree), and a footer.
 */

import React from "react";
import type { CanvasProjectSummary } from "../../types";
import { TaterSpriteSidebar } from "../sprites/TaterSpriteSidebar";

/** Centralized row styling (the reference keeps this in row-style.ts). */
const ROW =
  "flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-[13px] leading-none truncate cursor-pointer transition-colors";

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export interface SidebarContentProps {
  projects: CanvasProjectSummary[];
  activeProjectKey: string | null;
  onSelectProject: (projectKey: string) => void;
  version?: string;
}

export function SidebarContent({
  projects,
  activeProjectKey,
  onSelectProject,
  version,
}: SidebarContentProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Header — Tater sprite + wordmark (matches the daemon-shell sidebar). */}
      <div className="flex items-end gap-2 px-3 pt-3 pb-2">
        <TaterSpriteSidebar />
        <div className="flex min-w-0 flex-col">
          <span className="text-base font-semibold leading-tight tracking-tight text-foreground">
            Plannotator
          </span>
          <span className="text-[10px] text-muted-foreground">
            {version ? `v${version} · ` : ""}
            <a
              href="https://github.com/backnotprop/plannotator/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground"
            >
              Send feedback
            </a>
          </span>
        </div>
      </div>

      {/* Project list — flat, most recent at the top. */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {projects.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs leading-relaxed text-muted-foreground">
            No project boards yet.
            <br />
            <span className="mt-2 inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              plannotator canvas add page.html
            </span>
          </div>
        ) : (
          projects.map((p) => {
            const active = p.projectKey === activeProjectKey;
            return (
              <button
                key={p.projectKey}
                onClick={() => onSelectProject(p.projectKey)}
                title={p.root}
                className={`${ROW} ${
                  active
                    ? "bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <svg
                  className="h-3.5 w-3.5 shrink-0 opacity-70"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
                <span className="min-w-0 flex-1 truncate text-left">{p.projectName}</span>
                {p.unresolvedComments > 0 && (
                  <span className="shrink-0 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                    {p.unresolvedComments}
                  </span>
                )}
                <span className="shrink-0 text-[10px] tabular-nums opacity-60">
                  {p.frameCount}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border/60 px-3 py-2">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{projects.length} project{projects.length === 1 ? "" : "s"}</span>
          <span className="opacity-70" title="Sorted by most recent activity">
            recent first
          </span>
        </div>
      </div>
    </div>
  );
}
