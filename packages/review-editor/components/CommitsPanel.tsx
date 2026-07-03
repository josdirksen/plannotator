import React from 'react';
import type { CommitListEntry } from '@plannotator/shared/types';
import { PanelViewToggle, type ReviewPanelView } from './PanelViewToggle';
import { OverlayScrollArea } from '@plannotator/ui/components/OverlayScrollArea';

/**
 * The Commits panel — a pure linear history rail (`git log --first-parent`,
 * newest first). It never becomes a file list: clicking a commit opens that
 * commit's own diff (vs its first parent) in the center dock as the all-files
 * view. A divider marks where the branch meets the review base; everything
 * above it is branch-local work.
 */

interface CommitsPanelProps {
  width?: number;
  commits: CommitListEntry[];
  /** Base ref for the divider label (e.g. `origin/main`). */
  base: string | null;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  /** Full sha of the commit whose diff is on screen, if any. */
  activeCommitSha: string | null;
  onSelectCommit: (sha: string) => void;
  onShowMore: () => void;
  onRetry: () => void;
  /** View switcher, same header slot as the other panels. */
  onSelectPanelView: (view: ReviewPanelView) => void;
  /** Whether the Git status segment is offered (since-base capable repos). */
  showSectionsOption: boolean;
}

/** Compact `%cr` output for the rail: "2 hours ago" → "2h". Compound or
 * unusual phrasings fall back to the raw string. */
function compactAge(age: string): string {
  const m = age.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)/);
  if (!m) return age;
  const unit = { second: 's', minute: 'm', hour: 'h', day: 'd', week: 'w', month: 'mo', year: 'y' }[m[2]];
  return `${m[1]}${unit}`;
}

const CommitRow: React.FC<{
  commit: CommitListEntry;
  isActive: boolean;
  onSelect: () => void;
}> = ({ commit, isActive, onSelect }) => (
  <button
    onClick={onSelect}
    className={`file-tree-item w-full text-left group ${isActive ? 'active' : ''}`}
    style={{ paddingLeft: 8 }}
    title={`${commit.sha}\n${commit.subject}${commit.isRepoUser ? '' : `\n${commit.author}`}`}
  >
    <div className="flex items-center gap-1.5 flex-1 min-w-0">
      {/* HEAD marker: filled dot for the current commit, outline otherwise. */}
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          commit.isHead ? 'bg-primary' : 'border border-muted-foreground/50'
        }`}
        aria-hidden="true"
      />
      <span className="font-mono text-[10px] text-muted-foreground flex-shrink-0">{commit.shortSha}</span>
      <span className="truncate">{commit.subject}</span>
      {!commit.isRepoUser && commit.author && (
        <span className="text-[10px] text-muted-foreground/70 max-w-[72px] truncate flex-shrink-0">
          {commit.author}
        </span>
      )}
    </div>
    <span className="text-[10px] text-muted-foreground/70 tabular-nums flex-shrink-0 pl-1.5">
      {compactAge(commit.ageRelative)}
    </span>
  </button>
);

const BaseDivider: React.FC<{ base: string }> = ({ base }) => (
  <div className="flex items-center gap-2 px-2 py-1" aria-label={`Base: ${base}`}>
    <span className="h-px flex-1 bg-border" />
    <span className="text-[10px] font-mono text-muted-foreground/70 truncate max-w-[140px]">{base}</span>
    <span className="h-px flex-1 bg-border" />
  </div>
);

export const CommitsPanel: React.FC<CommitsPanelProps> = ({
  width,
  commits,
  base,
  hasMore,
  isLoading,
  isLoadingMore,
  error,
  activeCommitSha,
  onSelectCommit,
  onShowMore,
  onRetry,
  onSelectPanelView,
  showSectionsOption,
}) => {
  // isPastBase is a suffix of the linear walk (reachability from the base is
  // monotone along first parents), so a single divider before its first
  // occurrence is exhaustive.
  const dividerIndex = commits.findIndex((c) => c.isPastBase);

  return (
    <aside
      className="border-r border-border/50 bg-card/30 flex flex-col flex-shrink-0 overflow-hidden"
      style={{ width: width ?? 256 }}
    >
      {/* Header — same slot/layout as the other panel views. */}
      <div className="px-3 flex items-center border-b border-border/50 flex-shrink-0" style={{ height: 'var(--panel-header-h)' }}>
        <div className="w-full flex items-center justify-between gap-2">
          <PanelViewToggle
            view="commits"
            onSelect={onSelectPanelView}
            showSections={showSectionsOption}
            showCommits
          />
          <span className="text-xs text-muted-foreground tabular-nums">{commits.length}</span>
        </div>
      </div>

      <OverlayScrollArea className="flex-1 min-h-0">
        <div className="px-1 py-1">
          {error ? (
            <div className="px-2 py-4 text-center space-y-2">
              <div className="text-xs text-destructive break-words">{error}</div>
              <button
                onClick={onRetry}
                className="text-[11px] text-primary/80 underline underline-offset-2 decoration-primary/40 hover:text-primary transition-colors"
              >
                Retry
              </button>
            </div>
          ) : isLoading && commits.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground/50">Loading commits…</div>
          ) : commits.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground/50">No commits</div>
          ) : (
            <>
              {commits.map((commit, index) => (
                <React.Fragment key={commit.sha}>
                  {index === dividerIndex && base && <BaseDivider base={base} />}
                  <CommitRow
                    commit={commit}
                    isActive={commit.sha === activeCommitSha}
                    onSelect={() => onSelectCommit(commit.sha)}
                  />
                </React.Fragment>
              ))}
              {hasMore && (
                <button
                  onClick={onShowMore}
                  disabled={isLoadingMore}
                  className="w-full text-left px-2 py-1 text-[11px] text-primary/80 underline underline-offset-2 decoration-primary/40 hover:text-primary hover:decoration-primary transition-colors disabled:opacity-50"
                >
                  {isLoadingMore ? 'Loading…' : 'Show more'}
                </button>
              )}
            </>
          )}
        </div>
      </OverlayScrollArea>
    </aside>
  );
};
