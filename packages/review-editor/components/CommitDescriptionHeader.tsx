import React from 'react';
import type { CommitDiffInfo } from '@plannotator/shared/types';
import { Avatar } from './Avatar';
import { MarkdownBody } from './PRSummaryTab';
import { OverlayScrollArea } from '@plannotator/ui/components/OverlayScrollArea';

/**
 * The commit description card heading the all-files view while a
 * `commit:<sha>` diff is on screen: subject, author (avatar + name), sha,
 * age, and the full message body rendered as markdown — the same renderer
 * the PR viewer uses. Long bodies scroll inside the card so the diff below
 * keeps most of the viewport.
 */
export const CommitDescriptionHeader: React.FC<{ info: CommitDiffInfo }> = ({ info }) => (
  <div className="border-b border-border/50 bg-card/30 flex-shrink-0">
    <div className="px-4 pt-3 pb-2">
      <div className="text-sm font-semibold leading-snug break-words">{info.subject}</div>
      <div className="mt-1.5 flex items-center gap-2 min-w-0 text-xs text-muted-foreground">
        <Avatar src={info.avatarUrl} name={info.author} size={18} />
        <span className="truncate">{info.author}</span>
        <span className="font-mono text-[11px]" title={info.sha}>{info.shortSha}</span>
        <span className="text-muted-foreground/70">{info.ageRelative}</span>
      </div>
    </div>
    {info.body && (
      <OverlayScrollArea className="max-h-56">
        <div className="px-4 pb-3">
          <MarkdownBody markdown={info.body} />
        </div>
      </OverlayScrollArea>
    )}
  </div>
);
