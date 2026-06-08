import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { SelectedLineRange } from '@plannotator/ui/types';
import type {
  SemanticDiffBinaryChange,
  SemanticDiffChange,
  SemanticDiffResponse,
} from '@plannotator/shared/semantic-diff-types';
import { useReviewState } from '../ReviewStateContext';

type SemanticDiffOkResponse = Extract<SemanticDiffResponse, { status: 'ok' }>;
type SemanticDiffErrorResponse = Extract<SemanticDiffResponse, { status: 'error' }>;

type LoadState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; data: SemanticDiffOkResponse }
  | { status: 'empty'; data: SemanticDiffOkResponse }
  | { status: 'error'; error: SemanticDiffErrorResponse | Error };

type SemanticDiffGroup = {
  filePath: string;
  changes: SemanticDiffChange[];
  binaryChanges: SemanticDiffBinaryChange[];
};

const changeSymbols: Record<string, string> = {
  added: '⊕',
  deleted: '⊖',
  modified: '∆',
  moved: '↻',
  renamed: '↻',
  reordered: '↕',
};

function getChangeSymbol(changeType: string): string {
  if (changeType.includes('renamed') || changeType.includes('moved')) return '↻';
  return changeSymbols[changeType] ?? '∆';
}

function getChangeClass(changeType: string): string {
  if (changeType.includes('added')) return 'added';
  if (changeType.includes('deleted')) return 'deleted';
  if (changeType.includes('renamed')) return 'renamed';
  if (changeType.includes('moved')) return 'moved';
  if (changeType.includes('reordered')) return 'reordered';
  return 'modified';
}

function getDisplayName(change: SemanticDiffChange): string {
  if (change.oldEntityName && change.oldEntityName !== change.entityName) {
    return `${change.oldEntityName} -> ${change.entityName}`;
  }
  return change.entityName;
}

function getBinaryDisplayName(change: SemanticDiffBinaryChange): string {
  if (change.oldFilePath && change.oldFilePath !== change.filePath) {
    return `${change.oldFilePath} -> ${change.filePath}`;
  }
  return 'file';
}

function getBinaryStatus(change: SemanticDiffBinaryChange): string {
  return change.fileStatus || change.changeType;
}

function lineSelectionForChange(change: SemanticDiffChange): SelectedLineRange | null {
  const deleted = change.changeType === 'deleted';
  const start = deleted ? change.oldStartLine : change.startLine;
  const end = deleted ? change.oldEndLine : change.endLine;
  if (!start || start < 1) return null;

  return {
    start,
    end: end && end >= start ? end : start,
    side: deleted ? 'deletions' : 'additions',
  };
}

function formatSummary(data: SemanticDiffOkResponse): string {
  const summary = data.summary;
  const parts = [
    `${summary.added} added`,
    `${summary.modified} modified`,
    `${summary.deleted} deleted`,
  ];
  if (summary.renamed > 0) parts.push(`${summary.renamed} renamed`);
  if (summary.moved > 0) parts.push(`${summary.moved} moved`);
  if (summary.reordered > 0) parts.push(`${summary.reordered} reordered`);
  if (summary.binary > 0) parts.push(`${summary.binary} binary`);
  if (summary.orphan > 0) parts.push(`${summary.orphan} orphans`);
  return `Summary: ${parts.join(', ')} across ${summary.fileCount} files`;
}

function formatLoadError(error: SemanticDiffErrorResponse | Error): string {
  return error.message || 'Semantic diff failed.';
}

export function ReviewSemanticDiffPanel() {
  const state = useReviewState();
  const {
    rawPatch,
    semanticDiffAvailable,
    onSemanticDiffUnavailable,
    onSemanticDiffLoadError,
    onSemanticDiffLoadSuccess,
    openDiffFile,
    onLineSelection,
  } = state;
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!semanticDiffAvailable) return;

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
          onSemanticDiffUnavailable();
          return;
        }
        if (data.status === 'error') {
          if (onSemanticDiffLoadError()) return;
          setLoadState({ status: 'error', error: data });
          return;
        }
        onSemanticDiffLoadSuccess();
        setLoadState(data.changes.length === 0 && data.binaryChanges.length === 0
          ? { status: 'empty', data }
          : { status: 'ready', data });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error('Failed to load semantic diff:', error);
        if (onSemanticDiffLoadError()) return;
        setLoadState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) });
      });

    return () => controller.abort();
  }, [
    rawPatch,
    retryCount,
    semanticDiffAvailable,
    onSemanticDiffUnavailable,
    onSemanticDiffLoadError,
    onSemanticDiffLoadSuccess,
  ]);

  const groupedChanges = useMemo(() => {
    if (loadState.status !== 'ready' && loadState.status !== 'empty') return [];

    const groups: SemanticDiffGroup[] = [];
    const byPath = new Map<string, SemanticDiffGroup>();
    const getGroup = (filePath: string) => {
      const existing = byPath.get(filePath);
      if (existing) return existing;

      const next = { filePath, changes: [], binaryChanges: [] };
      byPath.set(filePath, next);
      groups.push(next);
      return next;
    };

    for (const change of loadState.data.changes) {
      getGroup(change.filePath).changes.push(change);
    }
    for (const change of loadState.data.binaryChanges) {
      getGroup(change.filePath).binaryChanges.push(change);
    }

    return groups;
  }, [loadState]);

  const openChange = useCallback((change: SemanticDiffChange) => {
    openDiffFile(change.filePath);
    onLineSelection(lineSelectionForChange(change));
  }, [openDiffFile, onLineSelection]);

  const openBinaryChange = useCallback((change: SemanticDiffBinaryChange) => {
    openDiffFile(change.filePath);
    onLineSelection(null);
  }, [openDiffFile, onLineSelection]);

  if (!semanticDiffAvailable) return null;

  if (loadState.status === 'idle' || loadState.status === 'loading') {
    return (
      <div className="semantic-diff-panel">
        <div className="semantic-diff-terminal" aria-live="polite">
          <div className="semantic-diff-loading">Running semantic diff...</div>
        </div>
      </div>
    );
  }

  if (loadState.status === 'error') {
    return (
      <div className="semantic-diff-panel">
        <div className="semantic-diff-terminal" aria-live="polite">
          <div className="semantic-diff-error" role="alert">
            Semantic diff failed: {formatLoadError(loadState.error)}
          </div>
          <button
            type="button"
            className="semantic-diff-retry"
            onClick={() => setRetryCount((count) => count + 1)}
          >
            ↻ retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="semantic-diff-panel">
      <div className="semantic-diff-terminal" aria-label="Semantic diff">
        {groupedChanges.map((group) => (
          <section className="semantic-diff-file" key={group.filePath}>
            <div className="semantic-diff-box-line">
              <span>┌─ </span>
              <span className="semantic-diff-path">{group.filePath}</span>
              <span className="semantic-diff-fill" aria-hidden="true"> ─────────────────────────────────────────────</span>
            </div>
            <div className="semantic-diff-box-line">│</div>
            {group.changes.map((change, index) => (
              <button
                type="button"
                className="semantic-diff-row"
                key={change.entityId ?? `${change.filePath}:${change.entityType}:${change.entityName}:${index}`}
                onClick={() => openChange(change)}
                title={`${change.filePath}${change.startLine ? `:${change.startLine}` : ''}`}
              >
                <span className="semantic-diff-pipe" aria-hidden="true">│</span>
                <span className="semantic-diff-row-body">
                  <span className={`semantic-diff-symbol semantic-diff-symbol-${getChangeClass(change.changeType)}`}>
                    {getChangeSymbol(change.changeType)}
                  </span>
                  <span className="semantic-diff-kind">{change.entityType}</span>
                  <span className="semantic-diff-name">{getDisplayName(change)}</span>
                  <span className="semantic-diff-status">[{change.changeType}]</span>
                </span>
              </button>
            ))}
            {group.binaryChanges.map((change, index) => {
              const status = getBinaryStatus(change);
              return (
                <button
                  type="button"
                  className="semantic-diff-row"
                  key={`${change.filePath}:binary:${index}`}
                  onClick={() => openBinaryChange(change)}
                  title={change.filePath}
                >
                  <span className="semantic-diff-pipe" aria-hidden="true">│</span>
                  <span className="semantic-diff-row-body">
                    <span className={`semantic-diff-symbol semantic-diff-symbol-${getChangeClass(status)}`}>
                      {getChangeSymbol(status)}
                    </span>
                    <span className="semantic-diff-kind">binary</span>
                    <span className="semantic-diff-name">{getBinaryDisplayName(change)}</span>
                    <span className="semantic-diff-status">[{status}]</span>
                  </span>
                </button>
              );
            })}
            <div className="semantic-diff-box-line">
              <span>└</span>
              <span className="semantic-diff-fill" aria-hidden="true">───────────────────────────────────────────────────────</span>
            </div>
          </section>
        ))}

        {loadState.status === 'empty' && (
          <div className="semantic-diff-empty">No semantic changes found.</div>
        )}
        <div className="semantic-diff-summary">{formatSummary(loadState.data)}</div>
      </div>
    </div>
  );
}
