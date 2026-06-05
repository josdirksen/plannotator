/**
 * Tripwires — Bun server helpers.
 *
 * Runtime glue for the pure tripwire evaluation logic in
 * @plannotator/shared/tripwires: resolves the repo root and reads the
 * `.plannotator/tripwires.json` config from disk. Both helpers fail-open
 * (return null) so a missing repo or config never breaks code review.
 *
 * The Pi extension has mirror helpers using node:child_process at
 * apps/pi-extension/server/serverReview.ts.
 */

import { $ } from "bun";
import { existsSync, readFileSync } from "node:fs";

/**
 * Resolve the git repository root for a working directory. Returns null when
 * the directory is not inside a git repo (or git is unavailable).
 */
export async function repoRootFromCwd(cwd: string): Promise<string | null> {
  try {
    const result = await $`git rev-parse --show-toplevel`.cwd(cwd).quiet().nothrow();
    if (result.exitCode === 0) {
      const root = result.stdout.toString().trim();
      return root || null;
    }
  } catch {
    // Not in a git repo
  }
  return null;
}

/**
 * Read `.plannotator/tripwires.json` from a repo root. Returns null on miss or
 * any read error (fail-open).
 */
export function readTripwiresFile(root: string): string | null {
  try {
    const path = `${root}/.plannotator/tripwires.json`;
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}
