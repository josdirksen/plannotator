/**
 * Review Profile Loader
 *
 * Reads review profiles from disk and resolves them into a flat, launchable
 * list. Two sources, loaded in spec order:
 *
 *   - builtin: in code (BUILTIN_PROFILES) — `builtin:default` is today's review.
 *   - user:    `${PLANNOTATOR_DATA_DIR}/reviews/*.json` — personal, every repo.
 *
 * Malformed files are skipped with one log line and never throw. Inference and
 * name-clash resolution come from the runtime-agnostic shared module; this file
 * only does the disk I/O. Reload on each request — no file watching.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPlannotatorDataDir } from "@plannotator/shared/data-dir";
import {
  resolveReviewProfiles,
  type RawReviewProfileEntry,
  type ResolvedReviewProfile,
} from "@plannotator/shared/review-profiles";

/** Read every `*.json` file in a reviews dir into raw entries (no validation). */
function readReviewDir(dir: string): RawReviewProfileEntry[] {
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
  // Sort so a bare-name clash resolves deterministically (first-seen wins) rather
  // than by filesystem readdir order, which varies across machines.
  for (const filename of filenames.sort()) {
    if (!filename.toLowerCase().endsWith(".json")) continue;
    const path = join(dir, filename);
    try {
      const raw = readFileSync(path, "utf-8");
      entries.push({ source: "user", path, json: JSON.parse(raw) });
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
 * Load and resolve review profiles from builtin + user sources. Always returns
 * at least `builtin:default`.
 */
export function loadReviewProfiles(): ResolvedReviewProfile[] {
  const userDir = join(getPlannotatorDataDir(), "reviews");
  const entries: RawReviewProfileEntry[] = readReviewDir(userDir);

  return resolveReviewProfiles(entries);
}
