/**
 * Review Profiles — shared types, shape validation, inference, and resolution.
 *
 * Runtime-agnostic: no node:fs, no node:http, no Bun APIs. The loader that
 * reads files from disk lives in packages/server/review-profile-loader.ts and
 * calls into this module. Vendored to Pi.
 *
 * A review profile is a named bundle of review intent. The only field a human
 * must write is `instructions`; everything else (`id`, `label`, `engines`) is
 * inferred. See docs/custom-reviews.md for the authoritative spec.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Engines a profile can target. */
export type ReviewEngine = "claude" | "codex";

/** Where a resolved profile came from. */
export type ReviewProfileSource = "builtin" | "user" | "repo";

export interface ReviewProfile {
  /** Inferred from filename if omitted. */
  id: string;
  /** Inferred from id if omitted. */
  label: string;
  /** The only field a human must write. */
  instructions: string;
  description?: string;
  /** Defaults to all supported engines. */
  engines?: ReviewEngine[];
}

export interface ResolvedReviewProfile extends ReviewProfile {
  source: ReviewProfileSource;
  sourcePath?: string;
  /** True for builtin:default — surfaced to the picker as the pre-selected option. */
  default?: boolean;
  /** Always resolved to a concrete list (never undefined after resolution). */
  engines: ReviewEngine[];
}

/** Response shape for `GET /api/agents/review-profiles`. */
export interface ReviewProfilesResponse {
  profiles: Array<{
    id: string;
    label: string;
    description?: string;
    engines: ReviewEngine[];
    source: ReviewProfileSource;
    sourcePath?: string;
    default?: boolean;
  }>;
}

/** All engines a profile may target. Inference default. */
export const SUPPORTED_ENGINES: ReadonlyArray<ReviewEngine> = ["claude", "codex"];

/** Reserved id for the built-in default review. */
export const BUILTIN_DEFAULT_ID = "builtin:default";

// ---------------------------------------------------------------------------
// Bounds — reject obviously malformed/abusive profiles without a schema engine.
// ---------------------------------------------------------------------------

const MAX_INSTRUCTIONS_LEN = 20_000;
const MAX_LABEL_LEN = 200;
const MAX_DESCRIPTION_LEN = 2_000;
const MAX_BARE_ID_LEN = 200;

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
  engines: [...SUPPORTED_ENGINES],
  default: true,
};

export const BUILTIN_PROFILES: ReadonlyArray<ResolvedReviewProfile> = [
  BUILTIN_DEFAULT_PROFILE,
];

// ---------------------------------------------------------------------------
// Shape validation
// ---------------------------------------------------------------------------

/** A raw profile entry as discovered on disk, before validation/inference. */
export interface RawReviewProfileEntry {
  source: "user" | "repo";
  /** Absolute path to the JSON file. */
  path: string;
  /** Parsed JSON contents (already JSON.parse'd by the loader). */
  json: unknown;
}

export interface ParsedReviewProfileShape {
  instructions: string;
  id?: string;
  label?: string;
  description?: string;
  engines?: ReviewEngine[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEngine(value: unknown): value is ReviewEngine {
  return value === "claude" || value === "codex";
}

/**
 * Validate the shape of a parsed profile JSON. Returns the well-typed fields on
 * success, or `null` when the entry is malformed and should be dropped.
 *
 * Rules:
 *  - `instructions` is required and must be a non-empty (after trim) string.
 *  - `id`, `label`, `description` if present must be strings within bounds.
 *  - `engines` if present must be a non-empty array that is a subset of the
 *    supported engines.
 *  - Bounded sizes guard against obviously abusive input.
 */
export function validateProfileShape(json: unknown): ParsedReviewProfileShape | null {
  if (!isPlainObject(json)) return null;

  const { instructions, id, label, description, engines } = json;

  if (typeof instructions !== "string") return null;
  if (instructions.trim().length === 0) return null;
  if (instructions.length > MAX_INSTRUCTIONS_LEN) return null;

  const out: ParsedReviewProfileShape = { instructions };

  if (id !== undefined) {
    if (typeof id !== "string") return null;
    const trimmed = id.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_BARE_ID_LEN) return null;
    // A separator-only id (e.g. "___") would infer to an empty label,
    // violating the non-empty `label` contract. Require at least one word.
    if (inferLabel(trimmed).length === 0) return null;
    out.id = trimmed;
  }

  if (label !== undefined) {
    if (typeof label !== "string") return null;
    const trimmed = label.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_LABEL_LEN) return null;
    out.label = trimmed;
  }

  if (description !== undefined) {
    if (typeof description !== "string") return null;
    if (description.length > MAX_DESCRIPTION_LEN) return null;
    out.description = description;
  }

  if (engines !== undefined) {
    if (!Array.isArray(engines) || engines.length === 0) return null;
    if (!engines.every(isEngine)) return null;
    // Dedupe while preserving order.
    out.engines = [...new Set(engines as ReviewEngine[])];
  }

  return out;
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

/** Strip a `.json` suffix and return the filename stem. */
export function filenameStem(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, "");
  return base.replace(/\.json$/i, "");
}

/**
 * Infer the namespaced id from a source + bare id (e.g. a filename stem).
 * `security` + `user` → `user:security`.
 */
export function inferId(bareId: string, source: "user" | "repo"): string {
  return `${source}:${bareId}`;
}

/**
 * Title-case a bare id into a label. `api-contracts` → `API Contracts`.
 * Splits on `-` and `_`; known acronyms are upper-cased.
 */
export function inferLabel(bareId: string): string {
  const ACRONYMS = new Set(["api", "ui", "ux", "sql", "css", "html", "id", "url"]);
  return bareId
    .split(/[-_]+/)
    .filter((w) => w.length > 0)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return word.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve raw discovered entries plus builtins into a deduped, fully-inferred
 * list of launchable profiles.
 *
 * Name-clash story (deliberately trivial — see spec):
 *  - `builtin:default` is special-cased and always wins its name; no user/repo
 *    entry can shadow it.
 *  - On a bare-name clash between a user and a repo profile, the user wins.
 *  - Malformed entries are dropped. The caller logs them — resolution stays
 *    pure and silent.
 */
export function resolveReviewProfiles(
  entries: RawReviewProfileEntry[],
  builtins: ReadonlyArray<ResolvedReviewProfile> = BUILTIN_PROFILES,
): ResolvedReviewProfile[] {
  // Bare name → resolved profile. user wins over repo.
  const byBareName = new Map<string, ResolvedReviewProfile>();

  for (const entry of entries) {
    const shape = validateProfileShape(entry.json);
    if (!shape) continue; // malformed — dropped (caller logs)

    const bareId = shape.id ?? filenameStem(entry.path);
    if (bareId.length === 0) continue;

    // Guard the inferred-label contract: a separator-only bareId (e.g. an
    // "___.json" filename) infers to an empty label. Drop it unless an
    // explicit non-empty label was supplied.
    const label = shape.label ?? inferLabel(bareId);
    if (label.length === 0) continue;

    // builtin:default is reserved; a custom file cannot claim it.
    const namespacedId = inferId(bareId, entry.source);
    if (namespacedId === BUILTIN_DEFAULT_ID) continue;

    const resolved: ResolvedReviewProfile = {
      id: namespacedId,
      label,
      instructions: shape.instructions,
      description: shape.description,
      engines: shape.engines ?? [...SUPPORTED_ENGINES],
      source: entry.source,
      sourcePath: entry.path,
    };

    const existing = byBareName.get(bareId);
    if (!existing) {
      byBareName.set(bareId, resolved);
      continue;
    }
    // user beats repo on a bare-name clash. Otherwise keep first-seen.
    if (existing.source === "repo" && resolved.source === "user") {
      byBareName.set(bareId, resolved);
    }
  }

  return [...builtins, ...byBareName.values()];
}

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
