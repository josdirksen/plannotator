/**
 * FileBrowser — Markdown file tree for the sidebar
 *
 * Displays collapsible trees of markdown files from user-configured directories.
 * Clicking a file opens it in the main viewer for annotation.
 */

import React from "react";
import type { VaultNode } from "../../types";
import type { DirState } from "../../hooks/useFileBrowser";
import { ObsidianIconRaw } from "../icons/ObsidianIcons";
import { FileTree, sumFileCounts } from "../file-tree/FileTree";

interface FileBrowserProps {
  dirs: DirState[];
  expandedFolders: Set<string>;
  onToggleFolder: (key: string) => void;
  collapsedDirs: Set<string>;
  onToggleCollapse: (dirPath: string) => void;
  onSelectFile: (absolutePath: string, dirPath: string) => void;
  activeFile: string | null;
  onFetchAll: () => void;
  onRetryVaultDir?: (vaultPath: string) => void;
  annotationCounts?: Map<string, number>;
  highlightedFiles?: Set<string>;
}

const DirSection: React.FC<{
  dir: DirState;
  expandedFolders: Set<string>;
  onToggleFolder: (key: string) => void;
  onSelectFile: (absolutePath: string, dirPath: string) => void;
  activeFile: string | null;
  onRetry: () => void;
  annotationCounts?: Map<string, number>;
  highlightedFiles?: Set<string>;
}> = ({ dir, expandedFolders, onToggleFolder, onSelectFile, activeFile, onRetry, annotationCounts, highlightedFiles }) => {
  if (dir.isLoading) {
    return (
      <div className="p-3 text-[11px] text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (dir.error) {
    return (
      <div className="p-3 space-y-2">
        <div className="text-[11px] text-destructive">{dir.error}</div>
        <button
          onClick={onRetry}
          className="text-[10px] text-primary hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (dir.tree.length === 0) {
    return (
      <div className="px-3 py-2 text-[11px] text-muted-foreground">
        No markdown files found
      </div>
    );
  }

  return (
    <FileTree<VaultNode>
      nodes={dir.tree}
      expandedFolders={expandedFolders}
      onToggleFolder={(key) => onToggleFolder(key)}
      activePath={activeFile}
      onSelectFile={(node) => onSelectFile(`${dir.path}/${node.path}`, dir.path)}
      getFolderKey={(node) => `${dir.path}:${node.path}`}
      getPath={(node) => `${dir.path}/${node.path}`}
      getFolderCount={annotationCounts ? (node) => sumFileCounts(node, annotationCounts, child => `${dir.path}/${child.path}`) : undefined}
      getFileCount={annotationCounts ? (node) => annotationCounts.get(`${dir.path}/${node.path}`) ?? 0 : undefined}
      isFileHighlighted={(node) => highlightedFiles?.has(`${dir.path}/${node.path}`) ?? false}
    />
  );
};

export const FileBrowser: React.FC<FileBrowserProps> = ({
  dirs,
  expandedFolders,
  onToggleFolder,
  collapsedDirs,
  onToggleCollapse,
  onSelectFile,
  activeFile,
  onFetchAll,
  onRetryVaultDir,
  annotationCounts,
  highlightedFiles,
}) => {
  if (dirs.length === 0) {
    return (
      <div className="p-3 text-[11px] text-muted-foreground">
        No directories configured. Add directories in Settings → Files.
      </div>
    );
  }

  // Summary header
  const totalCount = annotationCounts ? Array.from(annotationCounts.values()).reduce((s, c) => s + c, 0) : 0;
  const fileCount = annotationCounts?.size ?? 0;

  return (
    <div className="flex flex-col">
      {totalCount > 0 && (
        <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-b border-border/30">
          {totalCount} annotation{totalCount === 1 ? '' : 's'} in {fileCount} file{fileCount === 1 ? '' : 's'}
        </div>
      )}
      {dirs.map((dir) => {
        const isCollapsed = collapsedDirs.has(dir.path);
        return (
          <div key={dir.path}>
            <button
              onClick={() => onToggleCollapse(dir.path)}
              className="w-full flex items-center gap-1.5 px-3 py-2 border-b border-border/30 hover:bg-muted/50 transition-colors"
              title={dir.path}
            >
              <svg
                className={`w-3 h-3 flex-shrink-0 text-muted-foreground/60 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              {dir.isVault && <ObsidianIconRaw className="w-[11px] h-[13px] flex-shrink-0 opacity-70" />}
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider truncate">
                {dir.name}
              </div>
            </button>
            {!isCollapsed && (
              <DirSection
                dir={dir}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                onSelectFile={onSelectFile}
                activeFile={activeFile}
                onRetry={dir.isVault && onRetryVaultDir ? () => onRetryVaultDir(dir.path) : onFetchAll}
                annotationCounts={annotationCounts}
                highlightedFiles={highlightedFiles}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
