import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommitHistoryPage, CommitListEntry } from '@plannotator/shared/types';

const PAGE_SIZE = 50;

interface UseCommitLogOptions {
  /** Fetch only while the Commits view is visible in an API-mode session. */
  enabled: boolean;
  /** History identity — refetch from page one when it changes (worktree
   * switch, base switch). A commit CLICK must not be part of this key: paging
   * state has to survive selecting commits from a deep page. */
  contextKey: string;
}

interface UseCommitLogReturn {
  commits: CommitListEntry[];
  /** Base ref the divider represents (server echo), null before first load. */
  base: string | null;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  showMore: () => void;
  /** Reload from page one (e.g. after a staleness refresh picked up new
   * commits). Keeps the current list on screen while reloading. */
  refresh: () => void;
}

/**
 * Pages `GET /api/commits` for the Commits panel. Generation-guarded: a
 * response from a superseded fetch (context changed, refresh fired) is
 * dropped so it can't overwrite newer state.
 */
export function useCommitLog({ enabled, contextKey }: UseCommitLogOptions): UseCommitLogReturn {
  const [commits, setCommits] = useState<CommitListEntry[]>([]);
  const [base, setBase] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const commitsRef = useRef(commits);
  commitsRef.current = commits;

  const fetchPage = useCallback(async (before?: string) => {
    const generation = ++generationRef.current;
    const setBusy = before ? setIsLoadingMore : setIsLoading;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before) params.set('before', before);
      const res = await fetch(`/api/commits?${params}`);
      const data = (await res.json()) as CommitHistoryPage & { error?: string };
      if (generation !== generationRef.current) return;
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to load commits');
      setCommits((prev) => {
        if (!before) return data.commits;
        // Append, deduping on sha — a concurrent refresh or a history that
        // moved between pages could otherwise repeat rows.
        const seen = new Set(prev.map((c) => c.sha));
        return [...prev, ...data.commits.filter((c) => !seen.has(c.sha))];
      });
      setBase(data.base || null);
      setHasMore(data.hasMore);
    } catch (err) {
      if (generation !== generationRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load commits');
    } finally {
      if (generation === generationRef.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void fetchPage();
    // On disable, just invalidate in-flight fetches; keep the list so
    // re-entering the view doesn't flash empty before the refetch lands.
    return () => {
      generationRef.current++;
    };
  }, [enabled, contextKey, fetchPage]);

  const showMore = useCallback(() => {
    const last = commitsRef.current[commitsRef.current.length - 1];
    if (last) void fetchPage(last.sha);
  }, [fetchPage]);

  const refresh = useCallback(() => {
    void fetchPage();
  }, [fetchPage]);

  return { commits, base, hasMore, isLoading, isLoadingMore, error, showMore, refresh };
}
