import { describe, expect, it } from 'bun:test';
import {
  PORTABLE_GUIDED_REVIEW_KIND,
  PORTABLE_GUIDED_REVIEW_SCRIPT_ID,
  PORTABLE_GUIDED_REVIEW_VERSION,
} from '@plannotator/shared/guide-export';
import { readEmbeddedPortableGuidedReview } from './portableGuideSnapshot';

function documentWith(textContent: string | null) {
  return {
    getElementById(id: string) {
      return id === PORTABLE_GUIDED_REVIEW_SCRIPT_ID ? { textContent } : null;
    },
  };
}

describe('embedded portable guided-review snapshot', () => {
  it('distinguishes an ordinary review page from a portable export', () => {
    expect(readEmbeddedPortableGuidedReview({ getElementById: () => null })).toEqual({ kind: 'absent' });
  });

  it('parses a valid embedded snapshot', () => {
    const snapshot = {
      kind: PORTABLE_GUIDED_REVIEW_KIND,
      version: PORTABLE_GUIDED_REVIEW_VERSION,
      exportedAt: '2026-07-10T12:00:00.000Z',
      guide: {
        title: 'Portable guide',
        intent: 'Review it offline.',
        sections: [{ title: 'One', overview: 'Overview', diffs: [{ file: 'src/a.ts' }] }],
        reviewed: [false],
      },
      review: {
        rawPatch: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b',
        gitRef: 'main...HEAD',
      },
    };
    expect(readEmbeddedPortableGuidedReview(documentWith(JSON.stringify(snapshot)))).toEqual({
      kind: 'loaded',
      snapshot,
    });
  });

  it('surfaces malformed payloads instead of falling back to demo data', () => {
    const result = readEmbeddedPortableGuidedReview(documentWith('{broken'));
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.message).toContain('not valid JSON');
  });
});
