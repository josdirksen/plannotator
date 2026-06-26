import type { CodeAnnotation, SelectedLineRange } from '@plannotator/ui/types';

/**
 * True when an annotation belongs to the active PR + diff-scope (or carries no
 * PR scope of its own). Centralizes the predicate that the diff surfaces use to
 * keep annotations from one PR/diff-scope out of another after an in-place
 * switch — previously duplicated inline across ReviewDiffPanel,
 * projectFileAnnotations, and the file-comment projections.
 */
export function annotationMatchesPrScope(
  a: CodeAnnotation,
  prUrl: string | undefined,
  prDiffScope: string | undefined,
): boolean {
  return (
    (!a.prUrl || !prUrl || a.prUrl === prUrl) &&
    (!a.diffScope || !prDiffScope || a.diffScope === prDiffScope)
  );
}

/** True when an annotation is file-scoped (whole-file comment, not a line/general one). */
export function isFileScopedAnnotation(a: CodeAnnotation): boolean {
  return (a.scope ?? 'line') === 'file';
}

/**
 * The diff line range an annotation anchors to, as a Pierre `SelectedLineRange`
 * — used to replay a comment's selection as the controlled highlight when it's
 * clicked. Normalizes endpoint order and maps our `'new'|'old'` side to Pierre's
 * `'additions'|'deletions'`. Not meaningful for file-scoped comments (callers
 * skip those via {@link isFileScopedAnnotation}).
 */
export function lineRangeForAnnotation(a: CodeAnnotation): SelectedLineRange {
  return {
    start: Math.min(a.lineStart, a.lineEnd),
    end: Math.max(a.lineStart, a.lineEnd),
    side: a.side === 'new' ? 'additions' : 'deletions',
  };
}
