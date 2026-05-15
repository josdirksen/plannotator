import React, { useEffect, useMemo, useState } from 'react';
import { PRESENCE_SWATCHES } from '@plannotator/ui/utils/presenceColor';
import { OverlayScrollArea } from '../OverlayScrollArea';
import {
  FileTree,
  buildFileTree,
  collectFilePaths,
  collectFolderPaths,
  sumFileCounts,
} from '../file-tree/FileTree';

/**
 * Pure create-room dialog. Collects display name, color, expiry, and
 * confirms the image-strip consequence when relevant. In folder sessions,
 * additionally renders a file picker so the user can choose which docs
 * enter the room snapshot.
 *
 * Emits one callback (`onStart`) with the settled options; the parent
 * (`App.tsx`'s `handleConfirmStartRoom`) calls `createRoom()` directly
 * because the flow needs a synchronous `window.open()` inside the click
 * handler's user-activation window — a React hook boundary between click
 * and open would get the popup blocked in most browsers.
 *
 * Not a controlled modal — parent decides when to mount. Dismiss via the
 * Cancel button (not Esc-only) so the caller can abort an in-flight
 * createRoom via AbortController.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StartRoomSubmit {
  displayName: string;
  color: string;
  expiresInDays: 0 | 1 | 7 | 30;
  selectedPaths?: string[];
}

export interface FolderFileEntry {
  /** Relative path from folder root (e.g. "README.md", "src/design.md") */
  path: string;
  /** Display name (basename) */
  name: string;
  /** Byte length of the file content */
  sizeBytes: number;
}

export interface FolderSessionInfo {
  files: FolderFileEntry[];
  preselectedPaths: Set<string>;
  annotationCounts: Map<string, number>;
  /** Per-file count of annotations that carry images (will be stripped for rooms). */
  imageAnnotationCounts?: Map<string, number>;
}

export interface StartRoomModalProps {
  initialDisplayName?: string;
  initialColor?: string;
  imageAnnotationsToStrip?: number;
  inFlight?: boolean;
  errorMessage?: string;
  folderSession?: FolderSessionInfo;
  onStart(submit: StartRoomSubmit): void;
  onCancel(): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RAW_BYTES = 5 * 1024 * 1024; // 5 MB plaintext picker cap

// ---------------------------------------------------------------------------
// File Picker (folder-mode section)
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// FilePicker (composed tree)
// ---------------------------------------------------------------------------

const FilePicker: React.FC<{
  session: FolderSessionInfo;
  selected: Set<string>;
  onToggle: (path: string) => void;
  onSelectAnnotated: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  disabled: boolean;
}> = ({ session, selected, onToggle, onSelectAnnotated, onSelectAll, onClear, disabled }) => {
  const tree = useMemo(() => buildFileTree(session.files), [session.files]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(collectFolderPaths(tree)),
  );

  useEffect(() => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      for (const path of collectFolderPaths(tree)) next.add(path);
      return next;
    });
  }, [tree]);

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectedBytes = useMemo(
    () => session.files.filter(f => selected.has(f.path)).reduce((sum, f) => sum + f.sizeBytes, 0),
    [session.files, selected],
  );
  const overBudget = selectedBytes > MAX_RAW_BYTES;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium uppercase text-muted-foreground">Files to share</label>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <button type="button" onClick={onSelectAnnotated} disabled={disabled} className="hover:text-foreground transition-colors">Annotated</button>
          <span className="opacity-30">|</span>
          <button type="button" onClick={onSelectAll} disabled={disabled} className="hover:text-foreground transition-colors">All</button>
          <span className="opacity-30">|</span>
          <button type="button" onClick={onClear} disabled={disabled} className="hover:text-foreground transition-colors">None</button>
        </div>
      </div>
      <OverlayScrollArea className="border border-border rounded-lg max-h-[240px]">
        <FileTree
          nodes={tree}
          expandedFolders={expandedFolders}
          onToggleFolder={(path) => toggleFolder(path)}
          onSelectFile={(node) => onToggle(node.path)}
          getFileDisplayName={(node) => node.name}
          getFolderCount={(node) => sumFileCounts(node, session.annotationCounts)}
          getFileCount={(node) => session.annotationCounts.get(node.path) ?? 0}
          isFileDisabled={(node) => disabled || (overBudget && !selected.has(node.path))}
          renderFolderControl={({ node }) => {
            const childFiles = collectFilePaths(node);
            const allChecked = childFiles.length > 0 && childFiles.every(p => selected.has(p));
            const someChecked = !allChecked && childFiles.some(p => selected.has(p));
            const folderDisabled = disabled || (overBudget && !childFiles.some(p => selected.has(p)));
            const toggleFolderSelection = () => {
              if (folderDisabled) return;
              if (allChecked || someChecked) {
                for (const p of childFiles) if (selected.has(p)) onToggle(p);
              } else {
                for (const p of childFiles) if (!selected.has(p)) onToggle(p);
              }
            };
            return (
              <input
                type="checkbox"
                checked={allChecked}
                ref={el => { if (el) el.indeterminate = someChecked; }}
                onChange={toggleFolderSelection}
                disabled={folderDisabled}
                className="rounded border-border accent-primary flex-shrink-0"
                onClick={e => e.stopPropagation()}
              />
            );
          }}
          renderFileControl={({ node, disabled: fileDisabled }) => (
            <input
              type="checkbox"
              checked={selected.has(node.path)}
              onChange={() => onToggle(node.path)}
              disabled={fileDisabled}
              className="rounded border-border accent-primary flex-shrink-0"
              onClick={e => e.stopPropagation()}
            />
          )}
          renderFileMeta={({ node }) => (
            <span className="text-[10px] text-muted-foreground/50 flex-shrink-0 tabular-nums">
              {formatBytes(node.sizeBytes ?? 0)}
            </span>
          )}
        />
      </OverlayScrollArea>
      <div className={`text-[11px] flex items-center justify-between ${overBudget ? 'text-destructive' : 'text-muted-foreground'}`}>
        <span>{selected.size} file{selected.size === 1 ? '' : 's'} selected</span>
        <span className="tabular-nums">{formatBytes(selectedBytes)} / {formatBytes(MAX_RAW_BYTES)}</span>
      </div>
      {overBudget && (
        <div className="text-[11px] text-destructive">
          Selection exceeds the 5 MB limit. Deselect some files to continue.
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Modal
// ---------------------------------------------------------------------------

export function StartRoomModal({
  initialDisplayName = '',
  initialColor = PRESENCE_SWATCHES[0],
  imageAnnotationsToStrip = 0,
  inFlight = false,
  errorMessage,
  folderSession,
  onStart,
  onCancel,
}: StartRoomModalProps): React.ReactElement {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [color, setColor] = useState<string>(initialColor);
  const [expiresInDays, setExpiresInDays] = useState<0 | 1 | 7 | 30>(7);

  // File picker state (folder mode only)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(
    () => folderSession ? new Set(folderSession.preselectedPaths) : new Set(),
  );

  const isFolder = !!folderSession;

  const effectiveImageStrip = useMemo(() => {
    if (!isFolder || !folderSession?.imageAnnotationCounts) return imageAnnotationsToStrip;
    let total = 0;
    for (const path of selectedFiles) {
      total += folderSession.imageAnnotationCounts.get(path) ?? 0;
    }
    return total;
  }, [isFolder, folderSession, selectedFiles, imageAnnotationsToStrip]);
  const strips = effectiveImageStrip > 0;

  const selectedBytes = useMemo(() => {
    if (!folderSession) return 0;
    return folderSession.files.filter(f => selectedFiles.has(f.path)).reduce((s, f) => s + f.sizeBytes, 0);
  }, [folderSession, selectedFiles]);
  const overBudget = isFolder && selectedBytes > MAX_RAW_BYTES;
  const noFilesSelected = isFolder && selectedFiles.size === 0;

  const ctaLabel = inFlight
    ? 'Creating…'
    : strips ? 'Strip images and start' : 'Start room';

  function handleToggle(path: string) {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight || overBudget || noFilesSelected) return;
    const trimmed = displayName.trim();
    if (!trimmed) return;
    onStart({
      displayName: trimmed,
      color,
      expiresInDays,
      ...(isFolder ? { selectedPaths: [...selectedFiles] } : {}),
    });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      data-testid="start-room-modal"
    >
      <form
        onSubmit={handleSubmit}
        className={`bg-card border border-border rounded-xl shadow-2xl max-w-[90vw] p-5 space-y-4 ${
          isFolder ? 'w-[560px]' : 'w-[420px]'
        }`}
      >
        <div>
          <h2 className="text-base font-semibold">
            {isFolder ? 'Start a live folder session' : 'Start a live review session'}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {isFolder
              ? 'Choose which files to include. Collaborators see the selected documents and annotations in real time.'
              : 'Share a link. Collaborators see your plan and annotations in real time. Their changes sync to you.'}
          </p>
        </div>

        {folderSession && (
          <FilePicker
            session={folderSession}
            selected={selectedFiles}
            onToggle={handleToggle}
            onSelectAnnotated={() => setSelectedFiles(new Set(folderSession.preselectedPaths))}
            onSelectAll={() => setSelectedFiles(new Set(folderSession.files.map(f => f.path)))}
            onClear={() => setSelectedFiles(new Set())}
            disabled={inFlight}
          />
        )}

        <div className="space-y-2">
          <label className="text-xs font-medium uppercase text-muted-foreground">Display name</label>
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            disabled={inFlight}
            className="w-full px-2 py-1 border rounded text-sm"
            placeholder="Your name"
            autoFocus={!isFolder}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium uppercase text-muted-foreground">Color</label>
          <div className="flex items-center gap-1">
            {PRESENCE_SWATCHES.map(s => (
              <button
                key={s}
                type="button"
                disabled={inFlight}
                onClick={() => setColor(s)}
                className={`w-6 h-6 rounded-full border-2 ${color === s ? 'border-foreground' : 'border-transparent'}`}
                style={{ backgroundColor: s }}
                aria-label={`Color ${s}`}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium uppercase text-muted-foreground">Expires</label>
          <select
            value={expiresInDays}
            onChange={e => setExpiresInDays(Number(e.target.value) as 0 | 1 | 7 | 30)}
            disabled={inFlight}
            className="w-full px-2 py-1 border rounded text-sm"
          >
            <option value={1}>1 day</option>
            <option value={7}>7 days (default)</option>
            <option value={30}>30 days</option>
            <option value={0}>Never</option>
          </select>
        </div>

        {strips && (
          <div className="text-xs bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200 p-2 rounded">
            <strong>Images won't travel.</strong>{' '}
            {effectiveImageStrip} item{effectiveImageStrip === 1 ? '' : 's'} with image attachments will be stripped before sharing. Your local copies stay intact.
          </div>
        )}

        {errorMessage && (
          <div className="text-xs bg-destructive/10 text-destructive p-2 rounded" role="alert">
            {errorMessage}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={inFlight || !displayName.trim() || overBudget || noFilesSelected}
            className="px-3 py-1.5 text-sm rounded bg-foreground text-background disabled:opacity-50"
          >
            {ctaLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
