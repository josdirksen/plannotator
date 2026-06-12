/**
 * Change type derived from the diff's metadata lines. 'modified' is the
 * default and is deliberately NOT decorated in the UI (mirroring Pierre's
 * diffshub: most files are modifications, so only A/D/R stand out).
 */
export type DiffFileStatus = 'added' | 'deleted' | 'renamed' | 'modified';

export interface DiffFile {
  path: string;
  oldPath?: string;
  patch: string;
  additions: number;
  deletions: number;
  status: DiffFileStatus;
}
