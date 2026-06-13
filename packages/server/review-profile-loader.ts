/**
 * Review Profile Loader
 *
 * Reads review profiles from disk and resolves them into a flat, launchable
 * list. Three sources, loaded in spec order:
 *
 *   - builtin: in code (BUILTIN_PROFILES) — `builtin:default` is today's review.
 *   - user:    `${PLANNOTATOR_DATA_DIR}/reviews/*.json` — personal, every repo.
 *   - repo:    `<repoCwd>/.plannotator/reviews/*.json` — checked in, shared.
 *
 * Malformed files are skipped with one log line and never throw. Inference and
 * name-clash resolution come from the runtime-agnostic shared module; this file
 * only does the disk I/O. Reload on each request — no file watching.
 *
 * Repo-profile scoping (per spec): repo profiles are only loaded when there is
 * one unambiguous local review repo. The caller decides that by passing
 * `repoCwd` only when the session has a single local repo (i.e. not remote-only
 * PR mode and not ambiguous workspace mode); otherwise it omits `repoCwd` and
 * repo profiles are simply absent.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPlannotatorDataDir } from "@plannotator/shared/data-dir";
import {
  resolveReviewProfiles,
  type RawReviewProfileEntry,
  type ResolvedReviewProfile,
} from "@plannotator/shared/review-profiles";

export interface LoadReviewProfilesOptions {
  /**
   * Working directory of the single, unambiguous local review repo. Repo
   * profiles are read from `<repoCwd>/.plannotator/reviews`. Omit in
   * remote-only PR mode or ambiguous workspace mode to exclude repo profiles.
   */
  repoCwd?: string;
}

/** Read every `*.json` file in a reviews dir into raw entries (no validation). */
function readReviewDir(
  dir: string,
  source: "user" | "repo",
): RawReviewProfileEntry[] {
  if (!existsSync(dir)) return [];

  let filenames: string[];
  try {
    filenames = readdirSync(dir);
  } catch (err) {
    console.error(
      `[plannotator] Could not read review profiles dir ${dir}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }

  const entries: RawReviewProfileEntry[] = [];
  for (const filename of filenames) {
    if (!filename.toLowerCase().endsWith(".json")) continue;
    const path = join(dir, filename);
    try {
      const raw = readFileSync(path, "utf-8");
      entries.push({ source, path, json: JSON.parse(raw) });
    } catch (err) {
      // Skip-and-log: one line, never throw. A broken file does not break
      // discovery for its valid siblings.
      console.error(
        `[plannotator] Skipping malformed review profile ${path}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return entries;
}

/**
 * Load and resolve review profiles from builtin + user + (optionally) repo
 * sources. Always returns at least `builtin:default`.
 */
export function loadReviewProfiles(
  options: LoadReviewProfilesOptions = {},
): ResolvedReviewProfile[] {
  const userDir = join(getPlannotatorDataDir(), "reviews");
  const entries: RawReviewProfileEntry[] = readReviewDir(userDir, "user");

  if (options.repoCwd) {
    const repoDir = join(options.repoCwd, ".plannotator", "reviews");
    entries.push(...readReviewDir(repoDir, "repo"));
  }

  return resolveReviewProfiles(entries);
}
