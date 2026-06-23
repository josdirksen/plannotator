/**
 * Review Profiles — shared contract types + prompt-composition spine.
 *
 * Runtime-agnostic: no node:fs, no node:http, no Bun APIs. The loader that
 * reads custom reviews from disk lives in packages/server/review-skill-loader.ts
 * and maps each curated Agent Skill into a ResolvedReviewProfile that this
 * module's composer renders. Vendored to Pi.
 *
 * A review profile is a named bundle of review intent. A custom review skill
 * fully replaces the provider's system prompt — picking a review runs that
 * review. The built-in default carries no instructions, so the composer falls
 * back to the provider prompt and the default review stays byte-for-byte today's.
 *
 * See docs/custom-reviews.md.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Where a resolved profile came from. */
export type ReviewProfileSource = "builtin" | "user";

export interface ReviewProfile {
  id: string;
  label: string;
  /** The injected review instructions. */
  instructions: string;
  description?: string;
}

export interface ResolvedReviewProfile extends ReviewProfile {
  source: ReviewProfileSource;
  sourcePath?: string;
  /** True for builtin:default — surfaced to the picker as the pre-selected option. */
  default?: boolean;
}

/** Response shape for `GET /api/agents/review-profiles`. */
export interface ReviewProfilesResponse {
  profiles: Array<{
    id: string;
    label: string;
    description?: string;
    source: ReviewProfileSource;
    sourcePath?: string;
    default?: boolean;
  }>;
}

/** Reserved id for the built-in default review. */
export const BUILTIN_DEFAULT_ID = "builtin:default";

// ---------------------------------------------------------------------------
// Built-in profiles
// ---------------------------------------------------------------------------

/**
 * The built-in default review — today's review, preserved. It carries no
 * custom instructions, so the composer falls back to the provider prompt and
 * the default prompt stays byte-for-byte today's.
 */
export const BUILTIN_DEFAULT_PROFILE: ResolvedReviewProfile = {
  id: BUILTIN_DEFAULT_ID,
  label: "Default",
  instructions: "",
  source: "builtin",
  default: true,
};

// ---------------------------------------------------------------------------
// Prompt composition
// ---------------------------------------------------------------------------

/**
 * A profile replaces the provider prompt only when it carries instructions and
 * isn't the reserved built-in default. The default (or any instruction-less
 * profile) falls back to the provider prompt, keeping it byte-for-byte today's.
 */
function profileHasCustomSection(profile: ResolvedReviewProfile | undefined): boolean {
  return (
    !!profile &&
    profile.id !== BUILTIN_DEFAULT_ID &&
    profile.instructions.trim().length > 0
  );
}

/**
 * Compose the full review prompt deterministically.
 *
 * Custom review skill:
 *   <skill instructions>
 *   ---
 *   <user message>
 *
 * The skill body fully replaces the provider's system prompt. There is no
 * default methodology layered underneath — picking a review runs that review.
 *
 * Built-in default (or any instruction-less profile):
 *   <provider immutable instructions>
 *   ---
 *   <user message>
 *
 * Byte-identical to today's `systemPrompt + "\n\n---\n\n" + userMessage`.
 */
export function composeReviewPrompt(
  systemPrompt: string,
  profile: ResolvedReviewProfile | undefined,
  userMessage: string,
): string {
  if (profileHasCustomSection(profile)) {
    return (profile as ResolvedReviewProfile).instructions.trim() + "\n\n---\n\n" + userMessage;
  }
  return systemPrompt + "\n\n---\n\n" + userMessage;
}
