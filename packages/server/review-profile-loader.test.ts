import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_DEFAULT_ID } from "@plannotator/shared/review-profiles";
import { loadReviewProfiles } from "./review-profile-loader";

let dataDir: string;
let prevDataDir: string | undefined;

function writeUserProfile(name: string, contents: string) {
  const dir = join(dataDir, "reviews");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), contents);
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "plannotator-data-"));
  prevDataDir = process.env.PLANNOTATOR_DATA_DIR;
  process.env.PLANNOTATOR_DATA_DIR = dataDir;
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.PLANNOTATOR_DATA_DIR;
  else process.env.PLANNOTATOR_DATA_DIR = prevDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("loadReviewProfiles", () => {
  test("always returns builtin:default, even with no profile dirs", () => {
    const profiles = loadReviewProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe(BUILTIN_DEFAULT_ID);
    expect(profiles[0].default).toBe(true);
  });

  test("infers id/label end-to-end from a bare user file", () => {
    writeUserProfile("api-contracts.json", JSON.stringify({ instructions: "Check API contracts." }));

    const profiles = loadReviewProfiles();
    const profile = profiles.find((p) => p.id === "user:api-contracts");
    expect(profile).toBeDefined();
    expect(profile!.label).toBe("API Contracts");
    expect(profile!.source).toBe("user");
    expect(profile!.sourcePath).toBe(join(dataDir, "reviews", "api-contracts.json"));
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
});
