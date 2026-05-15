/**
 * RoomFileList — sidebar file list for multi-doc live rooms.
 *
 * Renders the `docs` keys from the room snapshot as a navigable file list.
 *
 * Data flow: room state → sorted paths → tree structure → rendered rows.
 * No server calls — all content comes from the decrypted room snapshot.
 */

import React, { useEffect, useMemo, useState } from 'react';
import type { PresenceState, RoomAnnotation } from '@plannotator/shared/collab';
import {
  FileTree,
  buildFileTree,
  collectFolderPaths,
  sumFileCounts,
} from '../file-tree/FileTree';

export interface RoomFileListProps {
  docs: Record<string, string>;
  annotations: RoomAnnotation[];
  activeDoc?: string;
  onSelectDoc: (path: string) => void;
  remotePresence?: Record<string, PresenceState>;
  htmlDocPaths?: string[];
}

export const RoomFileList: React.FC<RoomFileListProps> = ({
  docs,
  annotations,
  activeDoc,
  onSelectDoc,
  remotePresence,
  htmlDocPaths,
}) => {
  const paths = useMemo(() => Object.keys(docs).sort(), [docs]);
  const tree = useMemo(() => buildFileTree(paths.map(path => ({ path }))), [paths]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(collectFolderPaths(tree)),
  );
  const htmlSet = useMemo(() => htmlDocPaths ? new Set(htmlDocPaths) : new Set<string>(), [htmlDocPaths]);

  useEffect(() => {
    const folderPaths = collectFolderPaths(tree);
    setExpandedFolders(prev => {
      const next = new Set(prev);
      for (const path of folderPaths) next.add(path);
      return next;
    });
  }, [tree]);

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
      <FileTree
        nodes={tree}
        expandedFolders={expandedFolders}
        onToggleFolder={(key) => {
          setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });
        }}
        activePath={activeDoc ?? null}
        onSelectFile={(node) => onSelectDoc(node.path)}
        getFileDisplayName={(node) => htmlSet.has(node.path) ? node.name : node.name.replace(/\.mdx?$/i, '')}
        getFolderCount={(node) => sumFileCounts(node, annotationCounts)}
        getFileCount={(node) => annotationCounts.get(node.path) ?? 0}
        renderFileMeta={({ node }) => {
          const presenceColors = presenceByDoc.get(node.path) ?? [];
          if (presenceColors.length === 0) return null;
          const hasCount = (annotationCounts.get(node.path) ?? 0) > 0;
          return (
            <span className={`${hasCount ? '' : 'ml-auto'} flex items-center gap-0.5 flex-shrink-0`}>
              {presenceColors.slice(0, 3).map((color, i) => (
                <span key={i} className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              ))}
              {presenceColors.length > 3 && (
                <span className="text-[9px] text-muted-foreground">+{presenceColors.length - 3}</span>
              )}
            </span>
          );
        }}
      />
    </div>
  );
};
