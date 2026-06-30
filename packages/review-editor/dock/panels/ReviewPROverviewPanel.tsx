import React, { useEffect } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { useReviewState } from '../ReviewStateContext';
import { PRSummaryTab } from '../../components/PRSummaryTab';
import { PRCommentsTab } from '../../components/PRCommentsTab';
import { PRChecksTab } from '../../components/PRChecksTab';
import { OverlayScrollArea } from '@plannotator/ui/components/OverlayScrollArea';
import { getMRLabel } from '@plannotator/shared/pr-types';

/**
 * Combined PR overview — one dock panel that shows the PR summary, checks, and
 * comments together instead of three separate tabs. Summary (top) and Checks
 * (bottom) stack in the left column; Comments fill the full-height right column.
 *
 * Reuses the existing PRSummaryTab / PRChecksTab / PRCommentsTab components
 * unchanged and the single shared /api/pr-context fetch from ReviewStateContext
 * (same data lifecycle as the former ReviewPRSummaryPanel).
 */

/** Region label header shared by the panel's regions, with an optional right-aligned action. */
function RegionHeader({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex-shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      <span>{children}</span>
      {action}
    </div>
  );
}

export const ReviewPROverviewPanel: React.FC<IDockviewPanelProps> = () => {
  const {
    prMetadata,
    prContext,
    isPRContextLoading,
    prContextError,
    fetchPRContext,
    platformUser,
  } = useReviewState();

  useEffect(() => {
    if (!prContext && !prContextError && !isPRContextLoading) fetchPRContext();
  }, [prContext, prContextError, isPRContextLoading, fetchPRContext]);

  if (!prMetadata) {
    return <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No PR metadata</div>;
  }

  if (isPRContextLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading PR…
      </div>
    );
  }

  if (prContextError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-destructive text-sm">{prContextError}</div>
        <button
          type="button"
          onClick={fetchPRContext}
          className="px-2.5 py-1 rounded-md text-xs font-medium bg-muted hover:bg-muted/80 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!prContext) return null;

  return (
    <div className="h-full flex gap-3 p-3 bg-background">
      {/* Left column — Summary grows to fill, Checks pinned to the bottom at a bounded height. */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <section className="flex-1 min-h-0 flex flex-col rounded-lg border border-border/30 bg-surface-0 shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
          <RegionHeader
            action={
              <a
                href={prMetadata.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 normal-case tracking-normal font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Open {getMRLabel(prMetadata)}
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            }
          >
            Summary
          </RegionHeader>
          <OverlayScrollArea className="flex-1 min-h-0 scroll-fade">
            <PRSummaryTab context={prContext} metadata={prMetadata} />
          </OverlayScrollArea>
        </section>

        <section className="flex-shrink-0 max-h-44 flex flex-col rounded-lg border border-border/30 bg-surface-0 shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
          <RegionHeader>Checks</RegionHeader>
          <OverlayScrollArea className="flex-1 min-h-0 scroll-fade">
            <PRChecksTab context={prContext} />
          </OverlayScrollArea>
        </section>
      </div>

      {/* Right column — Comments (full height; owns its own scroll). */}
      <section className="flex-1 min-w-0 flex flex-col rounded-lg border border-border/30 bg-surface-0 shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
        <RegionHeader>Comments</RegionHeader>
        <div className="flex-1 min-h-0">
          <PRCommentsTab context={prContext} platformUser={platformUser} />
        </div>
      </section>
    </div>
  );
};
