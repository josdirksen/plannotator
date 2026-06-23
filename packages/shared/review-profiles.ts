/**
 * Review Profiles — shared contract types + prompt-composition spine.
 *
 * Runtime-agnostic: no node:fs, no node:http, no Bun APIs. The loader that
 * reads custom reviews from disk lives in packages/server/review-skill-loader.ts
 * and maps each curated Agent Skill into a ResolvedReviewProfile that this
 * module's composer renders. Vendored to Pi.
 *
 * A review profile is a named bundle of review intent. For the built-in default
 * the prompt composer omits the Custom Review Profile section entirely, so the
 * default review stays byte-for-byte today's prompt.
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
 * custom instructions; the prompt composer omits the Custom Review Profile
 * section entirely for this id, so the default prompt stays byte-for-byte
 * today's prompt.
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
 * A profile contributes a custom section only when it carries instructions and
 * isn't the reserved built-in default. The default (or any instruction-less
 * profile) yields no section, keeping the prompt byte-for-byte today's prompt.
 */
function profileHasCustomSection(profile: ResolvedReviewProfile | undefined): boolean {
  return (
    !!profile &&
    profile.id !== BUILTIN_DEFAULT_ID &&
    profile.instructions.trim().length > 0
  );
}

/**
 * Render the "## Custom Review Profile" section for a profile, or `null` when
 * the profile contributes none (built-in default / no instructions).
 */
export function renderReviewProfileSection(
  profile: ResolvedReviewProfile | undefined,
): string | null {
  if (!profileHasCustomSection(profile)) return null;
  const p = profile as ResolvedReviewProfile;
  return [
    "## Custom Review Profile",
    "",
    `Profile: ${p.label}`,
    `Source: ${p.source}`,
    "",
    p.instructions.trim(),
  ].join("\n");
}

/**
 * Compose the full review prompt deterministically:
 *
 *   <provider immutable instructions>
 *   [## Custom Review Profile … ---]   (omitted for builtin:default)
 *   <user message>
 *
 * For the built-in default (or any instruction-less profile) the section is
 * omitted and the output is byte-identical to
 * `systemPrompt + "\n\n---\n\n" + userMessage` — today's prompt.
 */
export function composeReviewPrompt(
  systemPrompt: string,
  profile: ResolvedReviewProfile | undefined,
  userMessage: string,
): string {
  const section = renderReviewProfileSection(profile);
  if (section === null) {
    return systemPrompt + "\n\n---\n\n" + userMessage;
  }
  return systemPrompt + "\n\n" + section + "\n\n---\n\n" + userMessage;
}
