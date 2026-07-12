import React, { useState } from 'react';
import { AlertTriangle, Download, Link2, Loader2, Share2, WifiOff } from 'lucide-react';
import type {
  PortableGuidedReviewExportFormat,
  PortableGuidedReviewExportPreflight,
  PortableGuidedReviewLargeFileChoice,
  PortableGuidedReviewLargeFile,
} from '@plannotator/shared/guide-export';

interface GuideShareMenuProps {
  jobId: string;
}

type GuideExportInfo = PortableGuidedReviewExportPreflight;

type PreflightStatus = 'idle' | 'loading' | 'error';

function parseFiniteNonNegativeNumber(input: unknown): number | null {
  return typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : null;
}

function parseGuideExportInfo(input: unknown): GuideExportInfo | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  // SAFETY: the object/null/array checks above establish a local string-keyable boundary value.
  const record = input as Record<string, unknown>;
  const totalPatchBytes = parseFiniteNonNegativeNumber(record.totalPatchBytes);
  if (totalPatchBytes === null || !Array.isArray(record.largeFiles)) return null;

  const largeFiles: PortableGuidedReviewLargeFile[] = [];
  for (const value of record.largeFiles) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    // SAFETY: the object/null/array checks above establish a local string-keyable boundary value.
    const file = value as Record<string, unknown>;
    const patchBytes = parseFiniteNonNegativeNumber(file.patchBytes);
    if (typeof file.path !== 'string' || patchBytes === null) return null;
    largeFiles.push({ path: file.path, patchBytes });
  }

  if (typeof record.estimatedBytes !== 'object' || record.estimatedBytes === null || Array.isArray(record.estimatedBytes)) {
    return null;
  }
  // SAFETY: the object/null/array checks above establish a local string-keyable boundary value.
  const estimated = record.estimatedBytes as Record<string, unknown>;
  const small = parseFiniteNonNegativeNumber(estimated.small);
  const offline = parseFiniteNonNegativeNumber(estimated.offline);
  if (small === null || offline === null) return null;

  return { totalPatchBytes, largeFiles, estimatedBytes: { small, offline } };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

/** Guided-review sharing menu with compact online and fully self-contained downloads. */
export const GuideShareMenu: React.FC<GuideShareMenuProps> = ({ jobId }) => {
  const [open, setOpen] = useState(false);
  const [preflightStatus, setPreflightStatus] = useState<PreflightStatus>('idle');
  const [exportInfo, setExportInfo] = useState<GuideExportInfo | null>(null);
  const [pendingFormat, setPendingFormat] = useState<PortableGuidedReviewExportFormat | null>(null);
  const encodedJobId = encodeURIComponent(jobId);

  const resetMenu = () => {
    setOpen(false);
    setPreflightStatus('idle');
    setExportInfo(null);
    setPendingFormat(null);
  };

  const startDownload = (format: PortableGuidedReviewExportFormat, largeFiles: PortableGuidedReviewLargeFileChoice) => {
    const params = new URLSearchParams({ format, largeFiles });
    const anchor = document.createElement('a');
    anchor.href = `/api/guide/${encodedJobId}/export?${params.toString()}`;
    anchor.download = '';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    resetMenu();
  };

  const loadExportInfo = async () => {
    if (preflightStatus === 'loading') return;
    setPreflightStatus('loading');
    setExportInfo(null);
    setPendingFormat(null);
    try {
      const response = await fetch(`/api/guide/${encodedJobId}/export-info`);
      if (!response.ok) {
        setPreflightStatus('error');
        return;
      }
      const input: unknown = await response.json();
      const info = parseGuideExportInfo(input);
      if (!info) {
        setPreflightStatus('error');
        return;
      }
      setExportInfo(info);
      setPreflightStatus('idle');
    } catch (_cause: unknown) {
      setPreflightStatus('error');
    }
  };

  const chooseFormat = (format: PortableGuidedReviewExportFormat) => {
    if (!exportInfo) return;
    if (exportInfo.largeFiles.length === 0) {
      startDownload(format, 'include');
      return;
    }
    setPendingFormat(format);
  };

  const largeFileBytes = exportInfo?.largeFiles.reduce((total, file) => total + file.patchBytes, 0) ?? 0;

  return (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => {
          if (open) {
            resetMenu();
            return;
          }
          setOpen(true);
          void loadExportInfo();
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      >
        <Share2 size={13} />
        Share
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close share menu"
            onClick={resetMenu}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-20 mt-1.5 w-72 overflow-hidden rounded-lg border border-border/50 bg-popover p-1 shadow-xl"
          >
            {pendingFormat && exportInfo ? (
              <div className="p-2" aria-live="polite">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 flex-shrink-0 text-amber-500" size={15} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">Large files in this review</p>
                    <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
                      Including them adds {formatBytes(largeFileBytes)} of diff content to the download.
                    </p>
                  </div>
                </div>
                <div className="mt-2 max-h-28 space-y-1 overflow-y-auto rounded-md bg-muted/35 p-2">
                  {exportInfo.largeFiles.map((file, index) => (
                    <div key={`${file.path}:${index}`} className="flex items-center justify-between gap-2 font-mono text-[9.5px]">
                      <span className="min-w-0 truncate text-foreground/80" title={file.path}>{file.path}</span>
                      <span className="flex-shrink-0 text-muted-foreground">{formatBytes(file.patchBytes)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2.5 grid gap-1.5">
                  <button
                    type="button"
                    onClick={() => startDownload(pendingFormat, 'exclude')}
                    className="min-h-11 rounded-md bg-foreground px-2.5 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90"
                  >
                    Exclude large files
                  </button>
                  <button
                    type="button"
                    onClick={() => startDownload(pendingFormat, 'include')}
                    className="min-h-11 rounded-md border border-border/60 px-2.5 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
                  >
                    Include everything
                  </button>
                </div>
                <p className="mt-2 text-center text-[9.5px] leading-snug text-muted-foreground/60">
                  Excluded files keep their name and guide summary; only their patch content is omitted.
                </p>
              </div>
            ) : (
              <>
                <p className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Download HTML
                </p>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => chooseFormat('small')}
                  disabled={!exportInfo}
                  className="flex min-h-11 w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-65"
                >
                  {preflightStatus === 'loading'
                    ? <Loader2 className="mt-0.5 flex-shrink-0 animate-spin text-foreground/70" size={14} />
                    : <Download className="mt-0.5 flex-shrink-0 text-foreground/70" size={14} />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-xs font-medium text-foreground">
                      Small HTML
                      {exportInfo && <span className="font-mono text-[9.5px] font-normal text-muted-foreground">~{formatBytes(exportInfo.estimatedBytes.small)}</span>}
                    </span>
                    <span className="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground/60">
                      Requires internet to load the viewer
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => chooseFormat('offline')}
                  disabled={!exportInfo}
                  className="flex min-h-11 w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-65"
                >
                  <WifiOff className="mt-0.5 flex-shrink-0 text-foreground/70" size={14} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-xs font-medium text-foreground">
                      Fully self-contained
                      {exportInfo && <span className="font-mono text-[9.5px] font-normal text-muted-foreground">~{formatBytes(exportInfo.estimatedBytes.offline)}</span>}
                    </span>
                    <span className="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground/60">
                      Larger file that works completely offline
                    </span>
                  </span>
                </button>

                {preflightStatus === 'error' && (
                  <p className="mx-2.5 mb-2 text-[10.5px] text-destructive" role="alert">
                    Could not inspect the export.{' '}
                    <button
                      type="button"
                      onClick={() => void loadExportInfo()}
                      className="font-medium underline underline-offset-2"
                    >
                      Try again.
                    </button>
                  </p>
                )}

                <div className="my-1 border-t border-border/40" />
                <button
                  type="button"
                  role="menuitem"
                  disabled
                  className="flex min-h-11 w-full cursor-not-allowed items-start gap-2.5 rounded-md px-2.5 py-2 text-left opacity-45"
                >
                  <Link2 className="mt-0.5 flex-shrink-0 text-foreground/70" size={14} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-xs font-medium text-foreground">
                      Create HTML share link
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-muted-foreground">
                        Next
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground/60">
                      Encrypted, expiring Totpage link
                    </span>
                  </span>
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};
