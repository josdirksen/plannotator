import { describe, test, expect } from "bun:test";
import {
  BUILTIN_DEFAULT_ID,
  filenameStem,
  inferId,
  inferLabel,
  resolveReviewProfiles,
  validateProfileShape,
  type RawReviewProfileEntry,
} from "./review-profiles";

const userEntry = (path: string, json: unknown): RawReviewProfileEntry => ({
  source: "user",
  path,
  json,
});

describe("inference", () => {
  test("id ← filename stem namespaced by source", () => {
    expect(filenameStem("/home/me/.plannotator/reviews/security.json")).toBe("security");
    expect(inferId("security", "user")).toBe("user:security");
  });

  test("label ← title-cased id", () => {
    expect(inferLabel("api-contracts")).toBe("API Contracts");
    expect(inferLabel("performance")).toBe("Performance");
    expect(inferLabel("data_flow")).toBe("Data Flow");
  });

  test("a bare instructions-only file resolves with inferred id/label", () => {
    const [, profile] = resolveReviewProfiles([
      userEntry("/data/reviews/security.json", { instructions: "Focus on security." }),
    ]);
    expect(profile.id).toBe("user:security");
    expect(profile.label).toBe("Security");
    expect(profile.source).toBe("user");
    expect(profile.sourcePath).toBe("/data/reviews/security.json");
  });
});

describe("validateProfileShape", () => {
  test("requires non-empty instructions string", () => {
    expect(validateProfileShape({ instructions: "ok" })).not.toBeNull();
    expect(validateProfileShape({ instructions: "   " })).toBeNull();
    expect(validateProfileShape({ instructions: 42 })).toBeNull();
    expect(validateProfileShape({})).toBeNull();
    expect(validateProfileShape(null)).toBeNull();
    expect(validateProfileShape([{ instructions: "ok" }])).toBeNull();
  });

  test("rejects oversized instructions", () => {
    expect(validateProfileShape({ instructions: "a".repeat(20_001) })).toBeNull();
  });
});

describe("resolution + name clashes", () => {
  test("builtin:default is always present", () => {
    const resolved = resolveReviewProfiles([]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].id).toBe(BUILTIN_DEFAULT_ID);
    expect(resolved[0].default).toBe(true);
  });

  test("first-seen user profile wins on a bare-name clash", () => {
    const resolved = resolveReviewProfiles([
      userEntry("/data/reviews/security.json", { instructions: "first version" }),
      userEntry("/data/reviews/security.json", { instructions: "second version" }),
    ]);
    const security = resolved.filter((p) => p.label === "Security");
    expect(security).toHaveLength(1);
    expect(security[0].source).toBe("user");
    expect(security[0].id).toBe("user:security");
    expect(security[0].instructions).toBe("first version");
  });

  test("malformed entries are dropped, valid siblings survive", () => {
    const resolved = resolveReviewProfiles([
      userEntry("/data/reviews/broken.json", { notInstructions: true }),
      userEntry("/data/reviews/good.json", { instructions: "valid" }),
    ]);
    const ids = resolved.map((p) => p.id);
    expect(ids).toContain("user:good");
    expect(ids).not.toContain("user:broken");
    // discovery still works — builtin + the one good profile
    expect(resolved).toHaveLength(2);
  });

  test("a custom file cannot claim the reserved builtin:default name", () => {
    const resolved = resolveReviewProfiles([
      userEntry("/data/reviews/whatever.json", {
        id: "builtin:default",
        instructions: "hijack attempt",
      }),
    ]);
    const defaults = resolved.filter((p) => p.id === BUILTIN_DEFAULT_ID);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].source).toBe("builtin");
    expect(defaults[0].instructions).toBe("");
  });
});
