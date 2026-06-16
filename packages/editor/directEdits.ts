import { createTwoFilesPatch } from 'diff';

const EMPTY_FEEDBACK_SENTINELS = new Set([
  '',
  'User reviewed the document and has no feedback.',
  'User reviewed the messages and has no feedback.',
]);

export function normalizeEditedMarkdown(base: string | null, current: string | null | undefined): string | null {
  if (base === null || current == null || current === base) return null;
  return current;
}

export function buildDirectEditsSection(
  base: string | null,
  current: string | null | undefined,
  sourceConverted: boolean,
): string {
  const edited = normalizeEditedMarkdown(base, current);
  if (base === null || edited === null) return '';

  const patch = createTwoFilesPatch(
    'plan.md (original)',
    'plan.md (edited)',
    base,
    edited,
    undefined,
    undefined,
    { context: 3 },
  );
  const preamble = sourceConverted
    ? 'The user edited a markdown conversion of the original source. This diff describes the desired content changes (it is not a literal patch to a file on disk):'
    : 'The user edited the document directly. Apply these exact changes — a unified diff against the version you submitted:';

  return ['# Direct Edits', '', preamble, '', '```diff', patch.trimEnd(), '```'].join('\n');
}

export function composeFeedbackWithDirectEdits(annotationsText: string, editsSection: string): string {
  if (!editsSection) return annotationsText;
  return EMPTY_FEEDBACK_SENTINELS.has(annotationsText)
    ? editsSection
    : `${editsSection}\n\n---\n\n${annotationsText}`;
}
