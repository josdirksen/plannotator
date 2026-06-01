/**
 * DocBadges — repo / branch / plan-diff / demo / linked-doc badge cluster.
 *
 * Extracted from Viewer.tsx so the same markup can render in two places:
 *   - layout="column": original location at the top-left of the plan card (absolute)
 *   - layout="row":   inside the sticky header lane when the user scrolls
 *
 * In row layout, the demo badge and linked-doc breadcrumb are dropped — the
 * sticky lane hides entirely in linked-doc mode, and the demo badge is purely
 * decorative top-of-doc context.
 */

import React from 'react';
import { PlanDiffBadge } from './plan-diff/PlanDiffBadge';
import type { PlanDiffStats } from '../utils/planDiffEngine';
import { hostnameOrFallback } from '@plannotator/shared/project';

export interface DocBadgesProps {
  layout: 'column' | 'row';
  repoInfo?: { display: string; branch?: string } | null;
  planDiffStats?: PlanDiffStats | null;
  isPlanDiffActive?: boolean;
  hasPreviousVersion?: boolean;
  onPlanDiffToggle?: () => void;
  showDemoBadge?: boolean;
  linkedDocInfo?: { filepath: string; onBack: () => void; label?: string; backLabel?: string } | null;
  /**
   * Whether to render the linked-doc breadcrumb. Off in folder-annotate mode,
   * where the sidebar file browser already provides the way back to the file
   * list — the breadcrumb would just duplicate it. The breadcrumb is the ONLY
   * way back in plan / single-file / HTML modes (no browser), so it stays there.
   * `linkedDocInfo` itself is unaffected (still drives copy label + Ask AI source).
   */
  showLinkedDocBadge?: boolean;
  /** Source attribution for HTML/URL annotations (e.g. "https://..." or "index.html") */
  sourceInfo?: string;
}

export const DocBadges: React.FC<DocBadgesProps> = ({
  layout,
  repoInfo,
  planDiffStats,
  isPlanDiffActive,
  hasPreviousVersion,
  onPlanDiffToggle,
  showDemoBadge,
  linkedDocInfo,
  showLinkedDocBadge = true,
  sourceInfo,
}) => {
  const isRow = layout === 'row';

  // The breadcrumb is shown only when requested (off in folder mode).
  const showBreadcrumb = !!linkedDocInfo && showLinkedDocBadge;

  // In row layout, only PlanDiffBadge (when it has stats to show)
  // actually renders — everything else is hidden. Check what
  // will truly produce visible output to avoid an empty wrapper div.
  const anything = isRow
    ? (!linkedDocInfo && (hasPreviousVersion && planDiffStats))
    : repoInfo || hasPreviousVersion || showDemoBadge || showBreadcrumb || sourceInfo;
  if (!anything) return null;

  // Row layout: single horizontal line. Column layout: stacked rows.
  const outerClass = isRow
    ? 'flex flex-row items-center gap-1.5 text-[9px] text-muted-foreground/70 font-mono'
    : 'flex flex-col items-start gap-1 text-[9px] text-muted-foreground/50 font-mono';

  return (
    <div className={outerClass}>
      {/* Row layout (sticky lane) omits repo/branch to keep the bar compact —
          they'd otherwise push the container wide enough to visually extend
          under the action buttons. Plan-diff badge still renders below. */}
      {repoInfo && !linkedDocInfo && !isRow && (
        <div className="flex items-center gap-1.5">
          <span
            className="px-1.5 py-0.5 bg-muted/50 rounded truncate max-w-[140px]"
            title={repoInfo.display}
          >
            {repoInfo.display}
          </span>
          {repoInfo.branch && (
            <span
              className="px-1.5 py-0.5 bg-muted/30 rounded max-w-[120px] flex items-center gap-1 overflow-hidden"
              title={repoInfo.branch}
            >
              <svg className="w-2.5 h-2.5 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
              </svg>
              <span className="truncate">{repoInfo.branch}</span>
            </span>
          )}
        </div>
      )}

      {sourceInfo && !linkedDocInfo && !isRow && (
        <span
          className="px-1.5 py-0.5 bg-muted/30 rounded truncate max-w-[200px]"
          title={sourceInfo}
        >
          {/^https?:\/\//i.test(sourceInfo)
            ? hostnameOrFallback(sourceInfo)
            : sourceInfo}
        </span>
      )}

      {onPlanDiffToggle && !linkedDocInfo && (
        <PlanDiffBadge
          stats={planDiffStats ?? null}
          isActive={isPlanDiffActive ?? false}
          onToggle={onPlanDiffToggle}
          hasPreviousVersion={hasPreviousVersion ?? false}
        />
      )}

      {/* Demo badge: only in column (top-of-doc) layout */}
      {!isRow && showDemoBadge && !linkedDocInfo && (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-amber-500/15 text-amber-600 dark:text-amber-400">
          Demo
        </span>
      )}

      {/* Linked-doc breadcrumb: only in column layout (sticky lane is hidden in linked-doc mode) */}
      {!isRow && showBreadcrumb && linkedDocInfo && (
        <div className="flex items-center gap-1.5">
          <button
            onClick={linkedDocInfo.onBack}
            className="px-1.5 py-0.5 bg-primary/10 text-primary rounded hover:bg-primary/20 transition-colors flex items-center gap-1"
          >
            <svg
              className="w-2.5 h-2.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
              />
            </svg>
            {linkedDocInfo.backLabel || 'plan'}
          </button>
          <span className="px-1.5 py-0.5 bg-primary/10 text-primary/80 rounded">
            {linkedDocInfo.label || 'Linked File'}
          </span>
          <span
            className="px-1.5 py-0.5 bg-muted/50 text-muted-foreground rounded truncate max-w-[200px]"
            title={linkedDocInfo.filepath}
          >
            {linkedDocInfo.filepath.split('/').pop()}
          </span>
        </div>
      )}
    </div>
  );
};
