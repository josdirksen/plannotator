import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_DEFAULT_ID } from "@plannotator/shared/review-profiles";
import { loadReviewProfiles } from "./review-profile-loader";

let dataDir: string;
let repoDir: string;
let prevDataDir: string | undefined;

function writeUserProfile(name: string, contents: string) {
  const dir = join(dataDir, "reviews");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), contents);
}

function writeRepoProfile(name: string, contents: string) {
  const dir = join(repoDir, ".plannotator", "reviews");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), contents);
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "plannotator-data-"));
  repoDir = mkdtempSync(join(tmpdir(), "plannotator-repo-"));
  prevDataDir = process.env.PLANNOTATOR_DATA_DIR;
  process.env.PLANNOTATOR_DATA_DIR = dataDir;
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.PLANNOTATOR_DATA_DIR;
  else process.env.PLANNOTATOR_DATA_DIR = prevDataDir;
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repoDir, { recursive: true, force: true });
});

describe("loadReviewProfiles", () => {
  test("always returns builtin:default, even with no profile dirs", () => {
    const profiles = loadReviewProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe(BUILTIN_DEFAULT_ID);
    expect(profiles[0].default).toBe(true);
  });

  test("infers id/label/engines end-to-end from a bare user file", () => {
    writeUserProfile("api-contracts.json", JSON.stringify({ instructions: "Check API contracts." }));

    const profiles = loadReviewProfiles();
    const profile = profiles.find((p) => p.id === "user:api-contracts");
    expect(profile).toBeDefined();
    expect(profile!.label).toBe("API Contracts");
    expect(profile!.engines).toEqual(["claude", "codex"]);
    expect(profile!.source).toBe("user");
    expect(profile!.sourcePath).toBe(join(dataDir, "reviews", "api-contracts.json"));
  });

  test("user profile beats a repo profile on a bare-name clash", () => {
    writeUserProfile("security.json", JSON.stringify({ instructions: "user security" }));
    writeRepoProfile("security.json", JSON.stringify({ instructions: "repo security" }));

    const profiles = loadReviewProfiles({ repoCwd: repoDir });
    const security = profiles.filter((p) => p.label === "Security");
    expect(security).toHaveLength(1);
    expect(security[0].source).toBe("user");
    expect(security[0].instructions).toBe("user security");
  });

  test("malformed JSON is skipped; valid siblings survive", () => {
    writeUserProfile("broken.json", "{ not valid json");
    writeUserProfile("good.json", JSON.stringify({ instructions: "valid" }));

    const profiles = loadReviewProfiles();
    const ids = profiles.map((p) => p.id);
    expect(ids).toContain("user:good");
    expect(ids).not.toContain("user:broken");
    // builtin + the one good profile
    expect(profiles).toHaveLength(2);
  });

  test("repo profiles are absent when no repoCwd is provided", () => {
    writeRepoProfile("security.json", JSON.stringify({ instructions: "repo only" }));

    // No repoCwd → ambiguous/remote session → repo profiles excluded.
    const profiles = loadReviewProfiles();
    expect(profiles.map((p) => p.id)).not.toContain("repo:security");

    // With repoCwd → the repo profile is loaded.
    const withRepo = loadReviewProfiles({ repoCwd: repoDir });
    expect(withRepo.map((p) => p.id)).toContain("repo:security");
  });
});
