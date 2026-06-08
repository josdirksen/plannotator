import React from 'react';

interface IconProps {
  className?: string;
}

/**
 * RedlineIcon — the redline (delete) annotation glyph: a Heroicons "backspace"
 * outline. This is the original redline icon; the toolstrip reskin briefly
 * swapped it for lucide's Trash2 (a trash can), so it's restored here. Custom
 * (not a lucide icon); inherits color via currentColor, size via `className`.
 */
export const RedlineIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 9.75L14.25 12m0 0l2.25 2.25M14.25 12l2.25-2.25M14.25 12L12 14.25m-2.58 4.92l-6.375-6.375a1.125 1.125 0 010-1.59L9.42 4.83c.211-.211.498-.33.796-.33H19.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-9.284c-.298 0-.585-.119-.796-.33z"
    />
  </svg>
);
