import React from 'react';

interface IconProps {
  className?: string;
}

/**
 * CommentIcon — the annotation/comment glyph: a chat bubble with text lines.
 * This is the original "annotations" icon (used by the annotation toolbar's
 * Comment action and the header annotations-panel toggle); the header reskin
 * briefly swapped it for lucide's PanelRight* (a sidebar panel), so it's the
 * canonical home here. Custom (not a lucide icon); inherits color via
 * currentColor, size via `className`.
 */
export const CommentIcon: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
    />
  </svg>
);
