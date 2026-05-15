import React from "react";
import { CountBadge } from "../CountBadge";
import type { FileTreeNode } from "./tree";

export {
  buildFileTree,
  collectFilePaths,
  collectFolderPaths,
  sortFileTree,
  sumFileCounts,
  type FileTreeFileEntry,
  type FileTreeNode,
} from "./tree";

export interface FileTreeRowContext<T extends FileTreeNode> {
  node: T;
  depth: number;
  path: string;
  isActive: boolean;
  isExpanded: boolean;
  disabled: boolean;
}

export interface FileTreeProps<T extends FileTreeNode = FileTreeNode> {
  nodes: T[];
  expandedFolders: Set<string>;
  onToggleFolder: (key: string, node: T) => void;
  activePath?: string | null;
  onSelectFile?: (node: T) => void;
  className?: string;
  getFolderKey?: (node: T) => string;
  getPath?: (node: T) => string;
  getFileDisplayName?: (node: T) => string;
  getFolderCount?: (node: T) => number;
  getFileCount?: (node: T) => number;
  isFileHighlighted?: (node: T) => boolean;
  isFileDisabled?: (node: T) => boolean;
  renderFolderControl?: (ctx: FileTreeRowContext<T>) => React.ReactNode;
  renderFileControl?: (ctx: FileTreeRowContext<T>) => React.ReactNode;
  renderFolderMeta?: (ctx: FileTreeRowContext<T>) => React.ReactNode;
  renderFileMeta?: (ctx: FileTreeRowContext<T>) => React.ReactNode;
}

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <svg
    className={`w-3 h-3 flex-shrink-0 text-muted-foreground/60 transition-transform ${expanded ? "rotate-90" : ""}`}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

const FolderIcon = () => (
  <svg className="w-3 h-3 flex-shrink-0 text-muted-foreground/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
  </svg>
);

const FileIcon = () => (
  <svg className="w-3 h-3 flex-shrink-0 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

function triggerFromKeyboard(e: React.KeyboardEvent, run: () => void): void {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  run();
}

export function FileTree<T extends FileTreeNode = FileTreeNode>({
  nodes,
  expandedFolders,
  onToggleFolder,
  activePath,
  onSelectFile,
  className = "py-1 px-1",
  getFolderKey = node => node.path,
  getPath = node => node.path,
  getFileDisplayName = node => node.name.replace(/\.mdx?$/i, ""),
  getFolderCount,
  getFileCount,
  isFileHighlighted,
  isFileDisabled,
  renderFolderControl,
  renderFileControl,
  renderFolderMeta,
  renderFileMeta,
}: FileTreeProps<T>): React.ReactElement {
  const renderNode = (node: T, depth: number): React.ReactNode => {
    const path = getPath(node);
    const isActive = node.type === "file" && path === activePath;
    const disabled = node.type === "file" && !!isFileDisabled?.(node);
    const folderKey = node.type === "folder" ? getFolderKey(node) : "";
    const isExpanded = node.type === "folder" && expandedFolders.has(folderKey);
    const context: FileTreeRowContext<T> = { node, depth, path, isActive, isExpanded, disabled };
    const paddingLeft = 8 + depth * 14;

    if (node.type === "folder") {
      const count = getFolderCount?.(node) ?? 0;
      const toggle = () => onToggleFolder(folderKey, node);
      return (
        <React.Fragment key={path}>
          <div
            role="button"
            tabIndex={0}
            onClick={toggle}
            onKeyDown={e => triggerFromKeyboard(e, toggle)}
            className="w-full flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors rounded-sm cursor-pointer"
            style={{ paddingLeft }}
          >
            <ChevronIcon expanded={isExpanded} />
            {renderFolderControl?.(context)}
            <FolderIcon />
            <span className="truncate">{node.name}</span>
            {renderFolderMeta?.(context)}
            {count > 0 && <CountBadge count={count} className="ml-auto" />}
          </div>
          {isExpanded && (node.children as T[] | undefined)?.map(child => renderNode(child, depth + 1))}
        </React.Fragment>
      );
    }

    const count = getFileCount?.(node) ?? 0;
    const highlighted = !!isFileHighlighted?.(node);
    const select = () => {
      if (!disabled) onSelectFile?.(node);
    };
    return (
      <div
        key={path}
        role={onSelectFile ? "button" : undefined}
        tabIndex={onSelectFile && !disabled ? 0 : undefined}
        onClick={select}
        onKeyDown={onSelectFile && !disabled ? e => triggerFromKeyboard(e, select) : undefined}
        className={`w-full flex items-center gap-1.5 py-1 text-[11px] transition-colors rounded-sm ${
          isActive
            ? "bg-primary/10 text-primary font-medium"
            : "text-foreground/80 hover:text-foreground hover:bg-muted/50"
        } ${highlighted ? "file-annotation-flash" : ""} ${
          disabled ? "opacity-40 cursor-not-allowed" : onSelectFile ? "cursor-pointer" : ""
        }`}
        style={{ paddingLeft: paddingLeft + 15 }}
        title={path}
      >
        {renderFileControl?.(context)}
        <FileIcon />
        <span className="truncate flex-1">{getFileDisplayName(node)}</span>
        {renderFileMeta?.(context)}
        {count > 0 && <CountBadge count={count} active={isActive} className="ml-auto" />}
      </div>
    );
  };

  return (
    <div className={className}>
      {nodes.map(node => renderNode(node, 0))}
    </div>
  );
}
