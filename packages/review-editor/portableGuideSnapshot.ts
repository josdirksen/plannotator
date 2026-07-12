import {
  PORTABLE_GUIDED_REVIEW_SCRIPT_ID,
  parsePortableGuidedReviewJson,
  type PortableGuidedReviewSnapshotV1,
} from '@plannotator/shared/guide-export';

interface PortableGuideDocument {
  getElementById(id: string): { textContent: string | null } | null;
}

/** Result of inspecting a document for an embedded portable guided-review payload. */
export type EmbeddedPortableGuidedReview =
  | { readonly kind: 'absent' }
  | { readonly kind: 'loaded'; readonly snapshot: PortableGuidedReviewSnapshotV1 }
  | { readonly kind: 'invalid'; readonly message: string };

/** Read and parse the inert guided-review snapshot embedded by the export endpoint. */
export function readEmbeddedPortableGuidedReview(documentLike: PortableGuideDocument): EmbeddedPortableGuidedReview {
  const element = documentLike.getElementById(PORTABLE_GUIDED_REVIEW_SCRIPT_ID);
  if (!element) return { kind: 'absent' };
  if (!element.textContent) {
    return { kind: 'invalid', message: 'The embedded guided-review snapshot is empty.' };
  }
  const parsed = parsePortableGuidedReviewJson(element.textContent);
  if (!parsed.ok) {
    return {
      kind: 'invalid',
      message: `The embedded guided-review snapshot is invalid at ${parsed.error.path}: ${parsed.error.message}`,
    };
  }
  return { kind: 'loaded', snapshot: parsed.value };
}
