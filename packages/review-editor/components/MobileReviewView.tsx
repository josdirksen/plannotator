import React, { useMemo, useState } from 'react';
import type { CodeAnnotation } from '@plannotator/ui/types';
import type { PRMetadata } from '@plannotator/shared/pr-provider';
import { getMRNumberLabel, getDisplayRepo } from '@plannotator/shared/pr-provider';
import { GitHubIcon } from '@plannotator/ui/components/GitHubIcon';
import { GitLabIcon } from '@plannotator/ui/components/GitLabIcon';
import { RepoIcon } from '@plannotator/ui/components/RepoIcon';
import type { DiffFile } from '../types';

/**
 * Read-only mobile shell for the code review app. Replaces the desktop
 * 3-pane Dockview layout below the `useIsMobile` breakpoint. Renders a
 * stacked, single-column flow: identity bar -> PR summary -> file cards
 * with tap-to-expand unified-diff bodies. Annotation creation is disabled;
 * existing annotations (including externals) render inline under each file.
 */

interface MobileReviewViewProps {
  files: DiffFile[];
  annotations: CodeAnnotation[];
  prMetadata: PRMetadata | null;
  repoInfo: { display: string; branch?: string } | null;
  onExit: () => void;
  isExiting: boolean;
}

interface FileCardProps {
  file: DiffFile;
  annotations: CodeAnnotation[];
  defaultOpen: boolean;
}

type DiffLineKind = 'add' | 'del' | 'context' | 'hunk' | 'meta';

interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

function classifyDiffLines(patch: string): DiffLine[] {
  const result: DiffLine[] = [];
  const rawLines = patch.split('\n');
  let inHunk = false;

  for (const line of rawLines) {
    if (line.startsWith('@@')) {
      result.push({ kind: 'hunk', text: line });
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      // Skip pre-hunk metadata: `diff --git`, `index`, `---`, `+++`,
      // `new file mode`, `similarity index`, etc.
      continue;
    }
    if (line.startsWith('+')) result.push({ kind: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) result.push({ kind: 'del', text: line.slice(1) });
    else if (line.startsWith('\\')) result.push({ kind: 'meta', text: line });
    else result.push({ kind: 'context', text: line.startsWith(' ') ? line.slice(1) : line });
  }

  return result;
}

const lineClass: Record<DiffLineKind, string> = {
  add: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-l-2 border-emerald-500/60',
  del: 'bg-red-500/10 text-red-700 dark:text-red-300 border-l-2 border-red-500/60',
  context: 'text-foreground/80 border-l-2 border-transparent',
  hunk: 'bg-muted/40 text-muted-foreground border-l-2 border-border/60 italic',
  meta: 'text-muted-foreground/60 border-l-2 border-transparent italic',
};

const linePrefix: Record<DiffLineKind, string> = {
  add: '+',
  del: '−',
  context: ' ',
  hunk: ' ',
  meta: ' ',
};

const FileCard: React.FC<FileCardProps> = ({ file, annotations, defaultOpen }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const lines = useMemo(() => (isOpen ? classifyDiffLines(file.patch) : []), [isOpen, file.patch]);

  const fileAnnotations = useMemo(
    () => annotations.filter(a => a.filePath === file.path).sort((a, b) => a.lineStart - b.lineStart),
    [annotations, file.path],
  );

  const renamed = !!file.oldPath && file.oldPath !== file.path;

  return (
    <section className="border border-border/60 rounded-lg bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="w-full flex items-start gap-2 p-3 text-left active:bg-muted/40 transition-colors"
      >
        <svg
          className={`w-4 h-4 flex-shrink-0 mt-0.5 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-foreground break-all leading-snug">{file.path}</div>
          {renamed && (
            <div className="font-mono text-[10px] text-muted-foreground/70 break-all mt-0.5">
              renamed from {file.oldPath}
            </div>
          )}
          <div className="flex items-center gap-3 mt-1.5 text-[11px]">
            <span className="text-emerald-600 dark:text-emerald-400 font-mono">+{file.additions}</span>
            <span className="text-red-600 dark:text-red-400 font-mono">−{file.deletions}</span>
            {fileAnnotations.length > 0 && (
              <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium">
                {fileAnnotations.length} note{fileAnnotations.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-border/40">
          <div className="overflow-x-auto">
            <pre className="text-[11px] leading-relaxed font-mono py-1 min-w-fit">
              {lines.map((line, i) => (
                <div key={i} className={`flex px-2 ${lineClass[line.kind]}`}>
                  <span className="select-none w-3 flex-shrink-0 opacity-60">{linePrefix[line.kind]}</span>
                  <span className="whitespace-pre flex-1">{line.text || ' '}</span>
                </div>
              ))}
            </pre>
          </div>

          {fileAnnotations.length > 0 && (
            <div className="border-t border-border/40 p-3 space-y-2 bg-muted/20">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Annotations
              </div>
              {fileAnnotations.map(ann => (
                <AnnotationCard key={ann.id} annotation={ann} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

const AnnotationCard: React.FC<{ annotation: CodeAnnotation }> = ({ annotation }) => {
  const range =
    annotation.lineStart === annotation.lineEnd
      ? `L${annotation.lineStart}`
      : `L${annotation.lineStart}–${annotation.lineEnd}`;
  const sideLabel = annotation.side === 'old' ? 'old' : 'new';

  const typeStyle: Record<string, string> = {
    comment: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
    suggestion: 'bg-purple-500/10 text-purple-700 dark:text-purple-300',
    concern: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  };
  const badge = typeStyle[annotation.type] ?? 'bg-muted text-muted-foreground';

  return (
    <div className="border border-border/40 rounded-md p-2.5 bg-card">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className={`text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded ${badge}`}>
          {annotation.type}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">
          {range} ({sideLabel})
        </span>
        {annotation.author && (
          <span className="text-[10px] text-muted-foreground/70 ml-auto">{annotation.author}</span>
        )}
        {annotation.source && !annotation.author && (
          <span className="text-[10px] text-muted-foreground/70 ml-auto">{annotation.source}</span>
        )}
      </div>
      {annotation.text && (
        <div className="text-xs text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">
          {annotation.text}
        </div>
      )}
      {annotation.suggestedCode && (
        <pre className="mt-2 text-[10px] font-mono bg-muted/40 rounded px-2 py-1 overflow-x-auto whitespace-pre">
          {annotation.suggestedCode}
        </pre>
      )}
    </div>
  );
};

export const MobileReviewView: React.FC<MobileReviewViewProps> = ({
  files,
  annotations,
  prMetadata,
  repoInfo,
  onExit,
  isExiting,
}) => {
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  const mrNumberLabel = prMetadata ? getMRNumberLabel(prMetadata) : null;
  const PlatformIcon = prMetadata?.platform === 'gitlab' ? GitLabIcon : GitHubIcon;

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <header className="px-3 py-2 border-b border-border/50 bg-card/80 backdrop-blur-xl flex items-center gap-2 z-10">
        <div className="min-w-0 flex-1">
          {prMetadata ? (
            <>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
                <PlatformIcon className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">
                  {getDisplayRepo(prMetadata)}
                  {mrNumberLabel && <span className="ml-1 text-muted-foreground/70">{mrNumberLabel}</span>}
                </span>
              </div>
              <div className="text-sm font-medium text-foreground truncate mt-0.5">
                {prMetadata.title}
              </div>
            </>
          ) : repoInfo ? (
            <>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
                <RepoIcon className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{repoInfo.display}</span>
              </div>
              {repoInfo.branch && (
                <div className="text-sm font-mono text-foreground truncate mt-0.5">{repoInfo.branch}</div>
              )}
            </>
          ) : (
            <div className="text-sm font-medium text-foreground">Review</div>
          )}
        </div>
        <button
          type="button"
          onClick={onExit}
          disabled={isExiting}
          className="px-3 py-2 rounded-md text-xs font-medium bg-muted text-foreground active:bg-muted/70 disabled:opacity-50 transition-colors"
        >
          {isExiting ? 'Closing…' : 'Close'}
        </button>
      </header>

      <div className="px-3 py-1.5 text-[10px] text-muted-foreground bg-muted/30 border-b border-border/40 text-center">
        Read-only view — open on desktop to annotate
      </div>

      <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3">
        {files.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-xs text-muted-foreground py-12">No changes to review.</div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-1 text-[11px]">
              <span className="text-muted-foreground">
                {files.length} file{files.length === 1 ? '' : 's'}
              </span>
              <span className="text-emerald-600 dark:text-emerald-400 font-mono">+{totalAdditions}</span>
              <span className="text-red-600 dark:text-red-400 font-mono">−{totalDeletions}</span>
              {annotations.length > 0 && (
                <span className="ml-auto text-primary">
                  {annotations.length} annotation{annotations.length === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {files.map((file, idx) => (
              <FileCard
                key={file.path}
                file={file}
                annotations={annotations}
                defaultOpen={files.length === 1 || (files.length <= 3 && idx === 0)}
              />
            ))}
          </>
        )}
      </main>
    </div>
  );
};
