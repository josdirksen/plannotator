import React, { useEffect } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { useReviewState } from '../ReviewStateContext';
import { PRSummaryTab } from '../../components/PRSummaryTab';
import { PRCommentsTab } from '../../components/PRCommentsTab';
import { PRChecksTab } from '../../components/PRChecksTab';
import { OverlayScrollArea } from '@plannotator/ui/components/OverlayScrollArea';

/**
 * Combined PR overview — one dock panel that shows the PR summary, checks, and
 * comments together instead of three separate tabs. Summary (top) and Checks
 * (bottom) stack in the left column; Comments fill the full-height right column.
 *
 * Reuses the existing PRSummaryTab / PRChecksTab / PRCommentsTab components
 * unchanged and the single shared /api/pr-context fetch from ReviewStateContext
 * (same data lifecycle as the former ReviewPRSummaryPanel).
 */

/** Region label header shared by the stacked left-column regions. */
function RegionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-shrink-0 px-3 py-1.5 border-b border-border/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
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
    <div className="h-full grid grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-3 p-3 bg-background">
      {/* Left column — Summary (top) + Checks (bottom, bounded) */}
      <div className="min-h-0 grid grid-rows-[1fr_minmax(0,auto)] gap-3">
        <section className="min-h-0 flex flex-col rounded-lg border border-border/30 bg-surface-0 shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
          <RegionHeader>Summary</RegionHeader>
          <OverlayScrollArea className="flex-1 min-h-0">
            <PRSummaryTab context={prContext} metadata={prMetadata} />
          </OverlayScrollArea>
        </section>

        <section className="min-h-0 max-h-[45%] flex flex-col rounded-lg border border-border/30 bg-surface-0 shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
          <RegionHeader>Checks</RegionHeader>
          <OverlayScrollArea className="flex-1 min-h-0">
            <PRChecksTab context={prContext} />
          </OverlayScrollArea>
        </section>
      </div>

      {/* Right column — Comments (full height; owns its own scroll) */}
      <section className="min-h-0 flex flex-col rounded-lg border border-border/30 bg-surface-0 shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
        <RegionHeader>Comments</RegionHeader>
        <div className="flex-1 min-h-0">
          <PRCommentsTab context={prContext} platformUser={platformUser} />
        </div>
      </section>
    </div>
  );
};
