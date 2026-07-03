import React, { useEffect, useState } from 'react';
import type { AgentJobInfo, AgentCapabilities } from '@plannotator/ui/types';
import type { AgentLaunchParams } from '@plannotator/ui/hooks/useAgentJobs';
import type { ReviewEngine } from '@plannotator/ui/hooks/useAgentSettings';
import { REVIEW_ENGINE_LABEL } from '@plannotator/ui/components/AgentsTab';
import { isTerminalStatus } from '@plannotator/shared/agent-jobs';
import { useGuideData } from '../../hooks/guide/useGuideData';
import { useReviewState } from '../../dock/ReviewStateContext';
import { GuideEmptyState } from './GuideEmptyState';
import { GuideGenerating } from './GuideGenerating';
import { GuideSectionSkeleton } from './GuideSkeleton';
import { GuideView } from './GuideView';

interface GuideScreenProps {
  /** Latest completed guide job id (or the demo guide id in standalone mode).
   *  Null when no guide has completed yet. */
  activeGuideJobId: string | null;
  jobs: AgentJobInfo[];
  capabilities: AgentCapabilities | null;
  launchJob: (params: AgentLaunchParams) => Promise<AgentJobInfo | null>;
  killJob: (id: string) => Promise<void>;
  /** Close the takeover and return to the diff workspace. */
  onClose: () => void;
  /** Navigate to a guide by job id once GuideEmptyState's failure-recovery
   *  panel successfully submits a manually-fixed output (POST .../submit →
   *  200). Wired to the same handler ReviewSidebar's onOpenGuide uses. */
  onOpenFixedGuide?: (jobId: string) => void;
}

/**
 * Guided Review takeover root. App.tsx renders this as a peer of the file
 * tree / center dock (which stay mounted but CSS-hidden) when `guideOpen`.
 *
 * Branches on the state of `guide`-provider jobs, in priority order:
 *   1. a running guide job always wins — regenerating shows progress, not
 *      the previous guide (single-active-guide model, v1 scope).
 *   2. otherwise, a known completed guide (`activeGuideJobId`) renders.
 *   3. otherwise, the empty/launch state.
 */
export const GuideScreen: React.FC<GuideScreenProps> = ({
  activeGuideJobId,
  jobs,
  capabilities,
  launchJob,
  killJob,
  onClose,
  onOpenFixedGuide,
}) => {
  const [cancelling, setCancelling] = useState(false);
  const runningJob = jobs.find((j) => j.provider === 'guide' && !isTerminalStatus(j.status)) ?? null;

  if (runningJob) {
    return (
      <GuideGenerating
        job={runningJob}
        onCancel={async () => {
          if (cancelling) return;
          setCancelling(true);
          try {
            await killJob(runningJob.id);
          } finally {
            setCancelling(false);
          }
        }}
      />
    );
  }

  if (activeGuideJobId) {
    // Keyed on jobId so per-guide state (focusedFile today, anything added
    // later) resets when the user switches to a different completed guide
    // rather than carrying over stale state from the previous one.
    return <ActiveGuide key={activeGuideJobId} jobId={activeGuideJobId} jobs={jobs} />;
  }

  // No running job and no completed guide to show — if the most recent guide
  // job failed (or was killed) rather than never having been launched, surface
  // that instead of a plain "start a guide?" landing page, so the failure
  // isn't invisible. `jobs` is append-ordered (see upsertJob in useAgentJobs),
  // so the last `guide`-provider entry is the most recently launched one.
  const guideJobs = jobs.filter((j) => j.provider === 'guide');
  const latestGuideJob = guideJobs.length > 0 ? guideJobs[guideJobs.length - 1] : null;
  const failedGuideJob =
    latestGuideJob && latestGuideJob.id !== activeGuideJobId && (latestGuideJob.status === 'failed' || latestGuideJob.status === 'killed')
      ? latestGuideJob
      : null;

  if (failedGuideJob) {
    return (
      // Keyed on jobId: if a repair job also fails, the failure panel remounts
      // fresh (probe re-runs, textarea edits don't carry over from the prior
      // failed job) rather than reusing stale state from the last one.
      <GuideEmptyState
        key={failedGuideJob.id}
        capabilities={capabilities}
        launchJob={launchJob}
        onBack={onClose}
        failure={{
          jobId: failedGuideJob.id,
          engine: failedGuideJob.engine,
          error: failedGuideJob.error ?? 'Guide generation failed.',
        }}
        onOpenFixedGuide={onOpenFixedGuide}
      />
    );
  }

  return <GuideEmptyState capabilities={capabilities} launchJob={launchJob} onBack={onClose} />;
};

function ActiveGuide({ jobId, jobs }: { jobId: string; jobs: AgentJobInfo[] }) {
  const { guide, loading, error, reviewed, toggleReviewed, retry } = useGuideData(jobId);
  const [focusedFile, setFocusedFile] = useState<string | null>(null);
  const state = useReviewState();

  // focusedFile otherwise stays null until pointerenter (see GuideDiffSection),
  // which leaves a keyboard-only user with nothing focused (no annotation
  // toolbar target) until they touch the mouse. Default it once the guide
  // loads: the first section's first diff file that still resolves against
  // the current diff (guide refs can go stale if the diff changed since
  // generation — see GuideDiffSection's "no longer in the current diff" case).
  useEffect(() => {
    if (focusedFile !== null || !guide) return;
    const filePathsInDiff = new Set(state.files.map((f) => f.path));
    const allRefs = guide.sections
      .flatMap((s) => s.diffs)
      .concat((guide.unplacedFiles ?? []).map((file) => ({ file })));
    const firstResolvable = allRefs.find((ref) => filePathsInDiff.has(ref.file));
    if (firstResolvable) setFocusedFile(firstResolvable.file);
  }, [guide, focusedFile, state.files]);

  if (loading) {
    return (
      <div className="w-full px-10 py-8">
        <div className="h-7 w-80 animate-pulse rounded bg-muted/30" />
        <div className="mt-3 h-4 w-full max-w-md animate-pulse rounded bg-muted/20" />
        <div className="mt-2 h-3 w-48 animate-pulse rounded bg-muted/20" />
        <GuideSectionSkeleton />
      </div>
    );
  }

  if (error || !guide) {
    return (
      <div className="w-full px-10 py-16 text-center">
        <p className="text-sm text-muted-foreground">{error ?? 'Guide not found'}</p>
        <button onClick={retry} className="mt-3 text-xs text-primary hover:text-primary/80 transition-colors">
          Retry
        </button>
      </div>
    );
  }

  const engine = jobs.find((j) => j.id === jobId)?.engine;

  return (
    <GuideView
      guide={guide}
      reviewed={reviewed}
      onToggleReviewed={toggleReviewed}
      engineLabel={engine ? REVIEW_ENGINE_LABEL[engine as ReviewEngine] ?? engine : undefined}
      focusedFile={focusedFile}
      onFocusFile={setFocusedFile}
    />
  );
}
