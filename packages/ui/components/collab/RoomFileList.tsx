/**
 * RoomFileList — sidebar file list for multi-doc live rooms.
 *
 * Renders the `docs` keys from the room snapshot as a navigable file list.
 * Visual styling mirrors FileBrowser's TreeNode (same Tailwind classes,
 * indentation math, icon sizing) but is a separate implementation because
 * TreeNode is not exported from FileBrowser.
 *
 * Data flow: room state → sorted paths → tree structure → rendered rows.
 * No server calls — all content comes from the decrypted room snapshot.
 */

import React, { useMemo } from 'react';
import type { PresenceState, RoomAnnotation } from '@plannotator/shared/collab';
import { CountBadge } from '../sidebar/CountBadge';

export interface RoomFileListProps {
  docs: Record<string, string>;
  annotations: RoomAnnotation[];
  activeDoc: string;
  onSelectDoc: (path: string) => void;
  remotePresence?: Record<string, PresenceState>;
  htmlDocPaths?: string[];
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: TreeNode[];
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const filePath of paths) {
    const parts = filePath.split('/');
    let current = root;
    let pathSoFar = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
      const isFile = i === parts.length - 1;
      let node = current.find(n => n.name === part && n.type === (isFile ? 'file' : 'folder'));
      if (!node) {
        node = { name: part, path: pathSoFar, type: isFile ? 'file' : 'folder' };
        if (!isFile) node.children = [];
        current.push(node);
      }
      if (!isFile) current = node.children!;
    }
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.children) sort(n.children);
  };
  sort(root);
  return root;
}

const FileRow: React.FC<{
  node: TreeNode;
  depth: number;
  activeDoc: string;
  annotationCounts: Map<string, number>;
  presenceByDoc: Map<string, string[]>;
  htmlSet: Set<string>;
  onSelect: (path: string) => void;
}> = ({ node, depth, activeDoc, annotationCounts, presenceByDoc, htmlSet, onSelect }) => {
  const isActive = node.path === activeDoc;
  const paddingLeft = 8 + depth * 14;

  if (node.type === 'folder') {
    return (
      <>
        <div
          className="w-full flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground"
          style={{ paddingLeft }}
        >
          <svg className="w-3 h-3 flex-shrink-0 rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <svg className="w-3 h-3 flex-shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="truncate">{node.name}</span>
        </div>
        {node.children?.map(child => (
          <FileRow
            key={child.path}
            node={child}
            depth={depth + 1}
            activeDoc={activeDoc}
            annotationCounts={annotationCounts}
            presenceByDoc={presenceByDoc}
            htmlSet={htmlSet}
            onSelect={onSelect}
          />
        ))}
      </>
    );
  }

  const isHtml = htmlSet.has(node.path);
  const annotationCount = annotationCounts.get(node.path) ?? 0;
  const presenceColors = presenceByDoc.get(node.path) ?? [];
  const displayName = isHtml ? node.name : node.name.replace(/\.mdx?$/i, '');

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`w-full flex items-center gap-1.5 py-1 text-[11px] transition-colors rounded-sm ${
        isActive
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-foreground/80 hover:text-foreground hover:bg-muted/50'
      }`}
      style={{ paddingLeft: paddingLeft + 15 }}
      title={node.path}
    >
      <svg className="w-3 h-3 flex-shrink-0 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span className="truncate flex-1">{displayName}</span>
      {presenceColors.length > 0 && (
        <span className="flex items-center gap-0.5 flex-shrink-0">
          {presenceColors.slice(0, 3).map((color, i) => (
            <span key={i} className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
          ))}
          {presenceColors.length > 3 && (
            <span className="text-[9px] text-muted-foreground">+{presenceColors.length - 3}</span>
          )}
        </span>
      )}
      {annotationCount > 0 && <CountBadge count={annotationCount} active={isActive} className="ml-auto" />}
    </button>
  );
};

export const RoomFileList: React.FC<RoomFileListProps> = ({
  docs,
  annotations,
  activeDoc,
  onSelectDoc,
  remotePresence,
  htmlDocPaths,
}) => {
  const paths = useMemo(() => Object.keys(docs).sort(), [docs]);
  const tree = useMemo(() => buildTree(paths), [paths]);
  const htmlSet = useMemo(() => htmlDocPaths ? new Set(htmlDocPaths) : new Set<string>(), [htmlDocPaths]);

  const annotationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ann of annotations) {
      if (ann.docPath) {
        counts.set(ann.docPath, (counts.get(ann.docPath) ?? 0) + 1);
      }
    }
    return counts;
  }, [annotations]);

  const presenceByDoc = useMemo(() => {
    if (!remotePresence) return new Map<string, string[]>();
    const result = new Map<string, string[]>();
    for (const p of Object.values(remotePresence)) {
      if (p.activeDoc) {
        const colors = result.get(p.activeDoc) ?? [];
        colors.push(p.user.color);
        result.set(p.activeDoc, colors);
      }
    }
    return result;
  }, [remotePresence]);

  const totalCount = useMemo(
    () => Array.from(annotationCounts.values()).reduce((s, c) => s + c, 0),
    [annotationCounts],
  );

  return (
    <div className="flex flex-col">
      {totalCount > 0 && (
        <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-b border-border/30">
          {totalCount} annotation{totalCount === 1 ? '' : 's'} across {annotationCounts.size} file{annotationCounts.size === 1 ? '' : 's'}
        </div>
      )}
      <div className="py-1 px-1">
        {tree.map(node => (
          <FileRow
            key={node.path}
            node={node}
            depth={0}
            activeDoc={activeDoc}
            annotationCounts={annotationCounts}
            presenceByDoc={presenceByDoc}
            htmlSet={htmlSet}
            onSelect={onSelectDoc}
          />
        ))}
      </div>
    </div>
  );
};
