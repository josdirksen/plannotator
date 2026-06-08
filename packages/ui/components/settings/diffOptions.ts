import type { DiffLineBgIntensity } from '@plannotator/shared/config';

// Diff display option arrays — shared by the review settings tabs and DiffOptionsPopover.
// Extracted from the (deleted) Settings.tsx monolith.

export const DIFF_FONT_OPTIONS = [
  { value: '', label: 'Theme Default' },
  { value: 'Fira Code', label: 'Fira Code' },
  { value: 'Hack', label: 'Hack' },
  { value: 'IBM Plex Mono', label: 'IBM Plex Mono' },
  { value: 'Inconsolata', label: 'Inconsolata' },
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Red Hat Mono', label: 'Red Hat Mono' },
  { value: 'Roboto Mono', label: 'Roboto Mono' },
  { value: 'Source Code Pro', label: 'Source Code Pro' },
  { value: 'Atkinson Hyperlegible Mono', label: 'Atkinson Hyperlegible' },
];

export const DIFF_STYLE_OPTIONS = [
  { value: 'split' as const, label: 'Split' },
  { value: 'unified' as const, label: 'Unified' },
];
export const OVERFLOW_OPTIONS = [
  { value: 'scroll' as const, label: 'Scroll' },
  { value: 'wrap' as const, label: 'Wrap' },
];
export const INDICATOR_OPTIONS = [
  { value: 'bars' as const, label: 'Bars' },
  { value: 'classic' as const, label: 'Classic' },
  { value: 'none' as const, label: 'None' },
];
export const LINE_DIFF_OPTIONS = [
  { value: 'word-alt' as const, label: 'Word-Alt' },
  { value: 'word' as const, label: 'Word' },
  { value: 'char' as const, label: 'Char' },
  { value: 'none' as const, label: 'None' },
];
export const LINE_BG_INTENSITY_OPTIONS: { value: DiffLineBgIntensity; label: string }[] = [
  { value: 'subtle', label: 'Subtle' },
  { value: 'normal', label: 'Normal' },
  { value: 'strong', label: 'Strong' },
];
export const DEFAULT_DIFF_TYPE_OPTIONS = [
  { value: 'uncommitted' as const, label: 'All Changes', description: "Everything you've changed since your last commit" },
  { value: 'unstaged' as const, label: 'Unstaged', description: "Only changes you haven't staged yet" },
  { value: 'staged' as const, label: 'Staged', description: "Only changes you've staged for commit" },
  { value: 'merge-base' as const, label: 'Committed', description: "Everything you've committed on this branch" },
  { value: 'all' as const, label: 'All Files (HEAD)', description: "Every tracked file at HEAD, shown as additions" },
];
