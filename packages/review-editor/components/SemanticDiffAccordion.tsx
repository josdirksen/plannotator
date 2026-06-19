import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useReviewStateOptional } from '../dock/ReviewStateContext';
import { useResizablePanel } from '@plannotator/ui/hooks/useResizablePanel';
import {
  SemanticDiffRows,
  groupSemanticChangesByFile,
  lineSelectionForChange,
} from '../dock/panels/semanticDiffShared';
import type {
  SemanticDiffResponse,
  SemanticDiffOkResponse,
  SemanticDiffChange,
  SemanticDiffBinaryChange,
} from '@plannotator/shared/semantic-diff-types';

type LoadState =
  | { status: 'idle' | 'loading' | 'unavailable' | 'error' }
  | { status: 'ready' | 'empty'; data: SemanticDiffOkResponse };

/**
 * Sidebar-constrained semantic diff: the same entity rows as the dock panel,
 * collapsed into an accordion pinned at the bottom of the file tree. Reuses the
 * existing /api/semantic-diff endpoint and the shared SemanticDiffRows markup;
 * clicking a change navigates exactly like the panel/badge (openDiffFile +
 * line select). Self-contained via ReviewStateContext.
 */
export const SemanticDiffAccordion: React.FC = () => {
  const state = useReviewStateOptional();
  const [open, setOpen] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });

  // Vertical resize for the expanded body (reuses the sidebar resize hook on
  // the y-axis; drag the top handle up to grow the panel, double-click to reset).
  const resize = useResizablePanel({
    axis: 'y',
    side: 'bottom',
    storageKey: 'pn-semantic-diff-height',
    defaultWidth: 240,
    minWidth: 96,
    maxWidth: 500,
  });

  const rawPatch = state?.rawPatch;
  const semanticDiffAvailable = state?.semanticDiffAvailable ?? false;

  useEffect(() => {
    if (!semanticDiffAvailable) {
      setLoadState({ status: 'unavailable' });
      return;
    }
    const controller = new AbortController();
    setLoadState({ status: 'loading' });
    fetch('/api/semantic-diff', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('Semantic diff failed');
        return res.json() as Promise<SemanticDiffResponse>;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.status === 'unavailable') {
          setLoadState({ status: 'unavailable' });
          return;
        }
        if (data.status === 'error') {
          setLoadState({ status: 'error' });
          return;
        }
        setLoadState(
          data.changes.length === 0 && data.binaryChanges.length === 0
            ? { status: 'empty', data }
            : { status: 'ready', data },
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadState({ status: 'error' });
      });
    return () => controller.abort();
  }, [rawPatch, semanticDiffAvailable]);

  const grouped = useMemo(() => {
    if (loadState.status !== 'ready' && loadState.status !== 'empty') return [];
    return groupSemanticChangesByFile(loadState.data.changes, loadState.data.binaryChanges);
  }, [loadState]);

  const count = useMemo(
    () => grouped.reduce((n, g) => n + g.changes.length + g.binaryChanges.length, 0),
    [grouped],
  );

  const openChange = useCallback(
    (change: SemanticDiffChange) => {
      state?.openDiffFile(change.filePath);
      state?.onLineSelection(lineSelectionForChange(change));
    },
    [state],
  );
  const openBinaryChange = useCallback(
    (change: SemanticDiffBinaryChange) => {
      state?.openDiffFile(change.filePath);
      state?.onLineSelection(null);
    },
    [state],
  );

  if (!semanticDiffAvailable || loadState.status === 'unavailable') return null;

  return (
    <div className="border-t border-border/50 flex-shrink-0">
      {open && (
        <div
          onPointerDown={resize.handleProps.onPointerDown}
          onDoubleClick={resize.handleProps.onDoubleClick}
          style={resize.handleProps.style}
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize · double-click to reset"
          className={`h-1 -mt-px cursor-row-resize transition-colors ${
            resize.isDragging ? 'bg-primary/40' : 'hover:bg-border'
          }`}
        />
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Semantic diff — changed functions, classes, and other entities"
      >
        <svg
          className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium">Semantic diff</span>
        {count > 0 && <span className="ml-auto tabular-nums text-muted-foreground/70">{count}</span>}
      </button>
      {open && (
        <div
          className="semantic-diff-accordion overflow-auto border-t border-border/40"
          style={{ height: resize.size }}
        >
          {loadState.status === 'loading' && (
            <div className="px-3 py-2 text-xs text-muted-foreground/70">Loading…</div>
          )}
          {loadState.status === 'error' && (
            <div className="px-3 py-2 text-xs text-destructive">Semantic diff failed.</div>
          )}
          {(loadState.status === 'ready' || loadState.status === 'empty') && grouped.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground/70">No semantic changes.</div>
          )}
          {grouped.map((group) => {
            const slash = group.filePath.lastIndexOf('/');
            const dir = slash === -1 ? '' : group.filePath.slice(0, slash + 1);
            const name = slash === -1 ? group.filePath : group.filePath.slice(slash + 1);
            return (
              <section className="semantic-diff-file" key={group.filePath}>
                <header className="semantic-diff-file-header">
                  <span className="semantic-diff-path" title={group.filePath}>
                    {dir && <span className="semantic-diff-path-dir">{dir}</span>}
                    <span className="semantic-diff-path-name">{name}</span>
                  </span>
                </header>
                <div className="semantic-diff-rows">
                  <SemanticDiffRows
                    changes={group.changes}
                    binaryChanges={group.binaryChanges}
                    onOpenChange={openChange}
                    onOpenBinary={openBinaryChange}
                  />
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
