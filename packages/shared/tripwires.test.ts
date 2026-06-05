import { describe, expect, test } from "bun:test";
import { transformReviewInput } from "./external-annotation";
import {
  evaluateTripwires,
  globToRegExp,
  matchesAnyGlob,
  parseChangedLines,
  parseTripwiresConfig,
  tripwireHitToReviewAnnotation,
  TRIPWIRE_SOURCE,
  type TripwiresConfig,
} from "./tripwires";

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

describe("globToRegExp / matchesAnyGlob", () => {
  test("* matches a single segment but not across /", () => {
    expect(globToRegExp("src/*.ts").test("src/index.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/deep/index.ts")).toBe(false);
  });

  test("** matches across path separators", () => {
    expect(globToRegExp("src/**/index.ts").test("src/a/b/index.ts")).toBe(true);
    expect(globToRegExp("src/**").test("src/a/b/c.ts")).toBe(true);
  });

  test("? matches exactly one non-slash char", () => {
    expect(globToRegExp("a?.ts").test("ab.ts")).toBe(true);
    expect(globToRegExp("a?.ts").test("abc.ts")).toBe(false);
    expect(globToRegExp("a?.ts").test("a/.ts")).toBe(false);
  });

  test("leading **/ matches zero or more leading segments", () => {
    const re = globToRegExp("**/auth.ts");
    expect(re.test("auth.ts")).toBe(true);
    expect(re.test("packages/server/auth.ts")).toBe(true);
  });

  test("mid-path **/ matches zero or more segments (incl. none)", () => {
    // Regression: a mid-path `**/` used to require at least one intervening
    // segment (`^a/.*/b$`), so `a/b` silently failed to match.
    const re = globToRegExp("packages/**/auth.ts");
    expect(re.test("packages/auth.ts")).toBe(true); // zero segments
    expect(re.test("packages/server/auth.ts")).toBe(true);
    expect(re.test("packages/a/b/auth.ts")).toBe(true);
    expect(matchesAnyGlob("packages/auth.ts", ["packages/**/auth.ts"])).toBe(true);
    expect(matchesAnyGlob("packages/server/auth.ts", ["packages/**/auth.ts"])).toBe(true);
  });

  test("mid-path **/ still requires the surrounding separators", () => {
    // `a/**/b` must NOT collapse to `ab` (the slash is required).
    expect(matchesAnyGlob("ab", ["a/**/b"])).toBe(false);
    expect(matchesAnyGlob("aXb", ["a/**/b"])).toBe(false);
    expect(matchesAnyGlob("a/b", ["a/**/b"])).toBe(true);
    expect(matchesAnyGlob("a/x/y/b", ["a/**/b"])).toBe(true);
  });

  test("trailing /** keeps its leading separator (no zero-collapse)", () => {
    expect(matchesAnyGlob("src/auth/x.ts", ["src/auth/**"])).toBe(true);
    expect(matchesAnyGlob("src/auth/a/b/x.ts", ["src/auth/**"])).toBe(true);
    // Must not match a sibling whose name merely starts with `auth`.
    expect(matchesAnyGlob("src/authx.ts", ["src/auth/**"])).toBe(false);
  });

  test("regex specials in the literal portion are escaped", () => {
    expect(globToRegExp("a.b.ts").test("a.b.ts")).toBe(true);
    expect(globToRegExp("a.b.ts").test("axbxts")).toBe(false);
  });

  test("matchesAnyGlob ORs across globs", () => {
    expect(matchesAnyGlob("src/auth.ts", ["lib/*.ts", "src/*.ts"])).toBe(true);
    expect(matchesAnyGlob("src/auth.ts", ["lib/*.ts"])).toBe(false);
  });

  test("multiple wildcards separated by literals match without backtracking", () => {
    expect(matchesAnyGlob("axbyc", ["a*b*c"])).toBe(true);
    expect(matchesAnyGlob("abc", ["a*b*c"])).toBe(true);
    expect(matchesAnyGlob("axbyd", ["a*b*c"])).toBe(false);
  });

  test("pathological glob does not catastrophically backtrack (ReDoS guard)", () => {
    // The old regex translation emitted adjacent `.*` quantifiers, so a glob
    // like `**a**a...Z` against a non-matching path backtracked exponentially.
    // The linear matcher must return promptly (well under a wall-clock budget).
    const hostileGlob = "**a".repeat(16) + ".ts";
    const path = "a".repeat(40) + "X";
    const start = performance.now();
    const result = matchesAnyGlob(path, [hostileGlob]);
    const elapsed = performance.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(1000); // was ~36s with the old regex

    const start2 = performance.now();
    const result2 = matchesAnyGlob(
      "packages/secret/" + "a".repeat(56),
      ["packages/secret/" + "**".repeat(11) + "Z"],
    );
    expect(performance.now() - start2).toBeLessThan(1000); // was an effective hang
    expect(result2).toBe(false);
  });

  test("globs over MAX_GLOB_LENGTH are skipped (never compiled/matched)", () => {
    const huge = "**a".repeat(100); // 300 chars
    expect(huge.length).toBeGreaterThan(256);
    expect(matchesAnyGlob("a".repeat(50), [huge])).toBe(false);
    // A normal glob alongside it still matches.
    expect(matchesAnyGlob("a/b.ts", [huge, "a/*.ts"])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Config parsing — fail-open
// ---------------------------------------------------------------------------

describe("parseTripwiresConfig", () => {
  test("malformed JSON fails open to empty rules", () => {
    expect(parseTripwiresConfig("{not json")).toEqual({ rules: [] });
  });

  test("null / undefined / wrong shape fail open", () => {
    expect(parseTripwiresConfig(null)).toEqual({ rules: [] });
    expect(parseTripwiresConfig(undefined)).toEqual({ rules: [] });
    expect(parseTripwiresConfig("42")).toEqual({ rules: [] });
    expect(parseTripwiresConfig('{"rules":"nope"}')).toEqual({ rules: [] });
  });

  test("one bad rule never discards siblings", () => {
    const raw = JSON.stringify({
      rules: [
        { globs: ["src/*.ts"], note: "good" },
        { note: "no globs at all" }, // dropped
        { globs: [] }, // dropped (empty)
        { globs: ["lib/*.ts"], symbols: ["foo"] },
      ],
    });
    const config = parseTripwiresConfig(raw);
    expect(config.rules.length).toBe(2);
    expect(config.rules[0].globs).toEqual(["src/*.ts"]);
    expect(config.rules[1].globs).toEqual(["lib/*.ts"]);
  });

  test("defaults id to rule-<index> and coerces symbols", () => {
    const raw = JSON.stringify({
      rules: [{ globs: ["a.ts"], symbols: ["x", 5, "y"] }],
    });
    const config = parseTripwiresConfig(raw);
    expect(config.rules[0].id).toBe("rule-0");
    expect(config.rules[0].symbols).toEqual(["x", "y"]);
  });

  test("preserves explicit id and note", () => {
    const raw = JSON.stringify({
      rules: [{ id: "auth", globs: ["a.ts"], note: "do not touch" }],
    });
    const config = parseTripwiresConfig(raw);
    expect(config.rules[0].id).toBe("auth");
    expect(config.rules[0].note).toBe("do not touch");
  });
});

// ---------------------------------------------------------------------------
// parseChangedLines — line-number correctness
// ---------------------------------------------------------------------------

describe("parseChangedLines", () => {
  test("tracks new-side and old-side line numbers across multi-hunk multi-file patches", () => {
    const patch = [
      "diff --git a/one.ts b/one.ts",
      "index 111..222 100644",
      "--- a/one.ts",
      "+++ b/one.ts",
      "@@ -1,3 +1,4 @@",
      " const a = 1;",
      "+const added = 2;",
      " const b = 3;",
      "-const removed = 4;",
      " const c = 5;",
      "@@ -10,2 +11,2 @@",
      " keep();",
      "-old();",
      "+brandNew();",
      "diff --git a/two.ts b/two.ts",
      "index 333..444 100644",
      "--- a/two.ts",
      "+++ b/two.ts",
      "@@ -5,1 +5,2 @@",
      " base();",
      "+extra();",
    ].join("\n");

    const spans = parseChangedLines(patch);
    expect(spans.length).toBe(2);

    const one = spans[0];
    expect(one.filePath).toBe("one.ts");
    // added at new line 2
    const added = one.changed.find((c) => c.content === "const added = 2;");
    expect(added).toEqual({ filePath: "one.ts", lineNumber: 2, side: "new", content: "const added = 2;" });
    // removed at old line 3
    const removed = one.changed.find((c) => c.content === "const removed = 4;");
    expect(removed).toEqual({ filePath: "one.ts", lineNumber: 3, side: "old", content: "const removed = 4;" });
    // second hunk: old() removed at old line 11, brandNew() added at new line 12
    const oldCall = one.changed.find((c) => c.content === "old();");
    expect(oldCall).toEqual({ filePath: "one.ts", lineNumber: 11, side: "old", content: "old();" });
    const brandNew = one.changed.find((c) => c.content === "brandNew();");
    expect(brandNew).toEqual({ filePath: "one.ts", lineNumber: 12, side: "new", content: "brandNew();" });

    const two = spans[1];
    expect(two.filePath).toBe("two.ts");
    const extra = two.changed.find((c) => c.content === "extra();");
    expect(extra).toEqual({ filePath: "two.ts", lineNumber: 6, side: "new", content: "extra();" });
  });

  test("empty / null patch yields no spans", () => {
    expect(parseChangedLines("")).toEqual([]);
    // @ts-expect-error null guard
    expect(parseChangedLines(null)).toEqual([]);
  });

  test("captures trailing hunk function-context", () => {
    const patch = [
      "diff --git a/f.ts b/f.ts",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,2 +1,3 @@ export function loadConfig() {",
      " const a = 1;",
      "+const b = 2;",
    ].join("\n");
    const spans = parseChangedLines(patch);
    expect(spans[0].hunkContexts).toEqual(["export function loadConfig() {"]);
  });

  test("binary-file change emits a file-scope span (no hunks)", () => {
    const patch = [
      "diff --git a/bin.dat b/bin.dat",
      "index eaf36c1..bfa7018 100644",
      "Binary files a/bin.dat and b/bin.dat differ",
    ].join("\n");
    const spans = parseChangedLines(patch);
    expect(spans.length).toBe(1);
    expect(spans[0].filePath).toBe("bin.dat");
    expect(spans[0].changed).toEqual([]);
  });

  test("GIT binary patch emits a file-scope span", () => {
    const patch = [
      "diff --git a/img.png b/img.png",
      "index aaa..bbb 100644",
      "GIT binary patch",
      "literal 5",
      "McmZQzWcvRP00RpG0RR91",
      "",
      "literal 4",
      "LcmZQzWMT#Y01f~L",
    ].join("\n");
    const spans = parseChangedLines(patch);
    expect(spans.length).toBe(1);
    expect(spans[0].filePath).toBe("img.png");
  });

  test("mode-only (chmod) change emits a file-scope span", () => {
    const patch = ["diff --git a/run.sh b/run.sh", "old mode 100644", "new mode 100755"].join("\n");
    const spans = parseChangedLines(patch);
    expect(spans.length).toBe(1);
    expect(spans[0].filePath).toBe("run.sh");
    expect(spans[0].changed).toEqual([]);
  });

  test("mode change bundled with edits does not produce a duplicate span", () => {
    const patch = [
      "diff --git a/run.sh b/run.sh",
      "old mode 100644",
      "new mode 100755",
      "index 111..222",
      "--- a/run.sh",
      "+++ b/run.sh",
      "@@ -1 +1,2 @@",
      " a",
      "+b",
    ].join("\n");
    const spans = parseChangedLines(patch);
    expect(spans.length).toBe(1);
    expect(spans[0].changed.length).toBe(1);
  });

  test("C-quoted paths are decoded before prefix stripping", () => {
    const patch = [
      'diff --git "a/we\\"ird.ts" "b/we\\"ird.ts"',
      "index 111..222 100644",
      '--- "a/we\\"ird.ts"',
      '+++ "b/we\\"ird.ts"',
      "@@ -1 +1,2 @@",
      " a",
      "+b",
    ].join("\n");
    const spans = parseChangedLines(patch);
    expect(spans.length).toBe(1);
    expect(spans[0].filePath).toBe('we"ird.ts');
  });

  test("C-quoted path with an escaped tab is decoded", () => {
    const patch = [
      'diff --git "a/we\\tird.ts" "b/we\\tird.ts"',
      '--- "a/we\\tird.ts"',
      '+++ "b/we\\tird.ts"',
      "@@ -1 +1,2 @@",
      " a",
      "+b",
    ].join("\n");
    const spans = parseChangedLines(patch);
    expect(spans[0].filePath).toBe("we\tird.ts");
  });
});

// ---------------------------------------------------------------------------
// evaluateTripwires — semantics
// ---------------------------------------------------------------------------

function cfg(rules: TripwiresConfig["rules"]): TripwiresConfig {
  return { rules };
}

describe("evaluateTripwires", () => {
  test("globs-only rule trips on any added line, anchored to first change", () => {
    const patch = [
      "diff --git a/src/auth.ts b/src/auth.ts",
      "--- a/src/auth.ts",
      "+++ b/src/auth.ts",
      "@@ -1,1 +1,2 @@",
      " const a = 1;",
      "+const b = 2;",
    ].join("\n");
    const hits = evaluateTripwires(patch, cfg([{ id: "auth", globs: ["src/auth.ts"] }]));
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ ruleId: "auth", filePath: "src/auth.ts", scope: "line", side: "new", line: 2 });
    expect(hits[0].note).toBe("Touches a slop-free zone");
  });

  test("symbol in added line trips with a line anchor", () => {
    const patch = [
      "diff --git a/lib/core.ts b/lib/core.ts",
      "--- a/lib/core.ts",
      "+++ b/lib/core.ts",
      "@@ -1,1 +1,2 @@",
      " const a = 1;",
      "+export function validateToken() {}",
    ].join("\n");
    const hits = evaluateTripwires(
      patch,
      cfg([{ id: "r", globs: ["lib/*.ts"], symbols: ["validateToken"], note: "guarded" }]),
    );
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ scope: "line", side: "new", line: 2, note: "guarded" });
  });

  test("symbol in removed line trips on the old side", () => {
    const patch = [
      "diff --git a/lib/core.ts b/lib/core.ts",
      "--- a/lib/core.ts",
      "+++ b/lib/core.ts",
      "@@ -1,2 +1,1 @@",
      " keep();",
      "-validateToken();",
    ].join("\n");
    const hits = evaluateTripwires(patch, cfg([{ globs: ["lib/*.ts"], symbols: ["validateToken"] }]));
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ scope: "line", side: "old", line: 2 });
  });

  test("symbol only in hunk context yields a file-scope hit", () => {
    const patch = [
      "diff --git a/lib/core.ts b/lib/core.ts",
      "--- a/lib/core.ts",
      "+++ b/lib/core.ts",
      "@@ -2,2 +2,3 @@ export function validateToken() {",
      " const a = 1;",
      "+const b = 2;",
    ].join("\n");
    const hits = evaluateTripwires(patch, cfg([{ globs: ["lib/*.ts"], symbols: ["validateToken"] }]));
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ scope: "file", filePath: "lib/core.ts" });
    expect(hits[0].side).toBeUndefined();
    expect(hits[0].line).toBeUndefined();
  });

  test("multi-symbol rule trips on any of its symbols", () => {
    const patch = [
      "diff --git a/lib/core.ts b/lib/core.ts",
      "--- a/lib/core.ts",
      "+++ b/lib/core.ts",
      "@@ -1,1 +1,3 @@",
      " base();",
      "+alpha();",
      "+beta();",
    ].join("\n");
    const hits = evaluateTripwires(patch, cfg([{ globs: ["lib/*.ts"], symbols: ["beta", "gamma"] }]));
    expect(hits.length).toBe(1);
    expect(hits[0].line).toBe(3);
  });

  test("pure-deletion file gives an old-side hit", () => {
    const patch = [
      "diff --git a/src/auth.ts b/src/auth.ts",
      "--- a/src/auth.ts",
      "+++ b/src/auth.ts",
      "@@ -1,2 +1,1 @@",
      " keep();",
      "-gone();",
    ].join("\n");
    const hits = evaluateTripwires(patch, cfg([{ globs: ["src/auth.ts"] }]));
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ scope: "line", side: "old", line: 2 });
  });

  test("deleted-file patch (/dev/null new path) gives a hit", () => {
    const patch = [
      "diff --git a/src/auth.ts b/src/auth.ts",
      "deleted file mode 100644",
      "--- a/src/auth.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-const a = 1;",
      "-const b = 2;",
    ].join("\n");
    const hits = evaluateTripwires(patch, cfg([{ globs: ["src/auth.ts"] }]));
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ scope: "line", side: "old", filePath: "src/auth.ts" });
  });

  test("rename-only (no edits) gives a file-scope hit", () => {
    const patch = [
      "diff --git a/src/auth.ts b/src/login.ts",
      "similarity index 100%",
      "rename from src/auth.ts",
      "rename to src/login.ts",
    ].join("\n");
    const hits = evaluateTripwires(patch, cfg([{ globs: ["src/auth.ts"] }]));
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ scope: "file", filePath: "src/login.ts" });
  });

  test("rename + edits gives an anchored hit", () => {
    const patch = [
      "diff --git a/src/auth.ts b/src/login.ts",
      "similarity index 80%",
      "rename from src/auth.ts",
      "rename to src/login.ts",
      "--- a/src/auth.ts",
      "+++ b/src/login.ts",
      "@@ -1,1 +1,2 @@",
      " const a = 1;",
      "+const b = 2;",
    ].join("\n");
    const hits = evaluateTripwires(patch, cfg([{ globs: ["src/login.ts"] }]));
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ scope: "line", side: "new", filePath: "src/login.ts", line: 2 });
  });

  test("glob matching the old path of a rename trips", () => {
    const patch = [
      "diff --git a/src/auth.ts b/src/login.ts",
      "similarity index 80%",
      "rename from src/auth.ts",
      "rename to src/login.ts",
      "--- a/src/auth.ts",
      "+++ b/src/login.ts",
      "@@ -1,1 +1,2 @@",
      " const a = 1;",
      "+const b = 2;",
    ].join("\n");
    // The rule only knows the OLD path; the file is moving out of the zone.
    const hits = evaluateTripwires(patch, cfg([{ id: "auth", globs: ["src/auth.ts"] }]));
    expect(hits.length).toBe(1);
    expect(hits[0].ruleId).toBe("auth");
    expect(hits[0].filePath).toBe("src/login.ts");
  });

  test("rename + edit whose first changed line is a deletion keys to the NEW path", () => {
    // Regression: an old-side anchor (a leading `-` line on a renamed+edited
    // file) used to stamp the OLD path, which no review-editor surface keys by —
    // the marker dropped, the sidebar card orphaned, click-to-jump broke. The
    // hit must carry the NEW (display) path while still anchoring side/line.
    const patch = [
      "diff --git a/old/secret.ts b/new/secret.ts",
      "similarity index 80%",
      "rename from old/secret.ts",
      "rename to new/secret.ts",
      "--- a/old/secret.ts",
      "+++ b/new/secret.ts",
      "@@ -1,2 +1,1 @@",
      "-const removed = 1;",
      " const kept = 2;",
    ].join("\n");
    const hits = evaluateTripwires(patch, cfg([{ id: "r1", globs: ["**/secret.ts"] }]));
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({
      ruleId: "r1",
      filePath: "new/secret.ts", // NEW path, not "old/secret.ts"
      scope: "line",
      side: "old", // the matched line still lives on the old side
      line: 1,
    });
  });

  test("symbol hit on an old-side line of a renamed+edited file keys to the NEW path", () => {
    const patch = [
      "diff --git a/old/secret.ts b/new/secret.ts",
      "rename from old/secret.ts",
      "rename to new/secret.ts",
      "--- a/old/secret.ts",
      "+++ b/new/secret.ts",
      "@@ -1,2 +1,1 @@",
      "-validateToken();",
      " keep();",
    ].join("\n");
    const hits = evaluateTripwires(
      patch,
      cfg([{ id: "r", globs: ["**/secret.ts"], symbols: ["validateToken"] }]),
    );
    expect(hits.length).toBe(1);
    expect(hits[0].filePath).toBe("new/secret.ts");
    expect(hits[0].side).toBe("old");
  });

  test("binary-file change trips a glob-only rule (file-scope)", () => {
    const patch = [
      "diff --git a/assets/logo.png b/assets/logo.png",
      "index eaf36c1..bfa7018 100644",
      "Binary files a/assets/logo.png and b/assets/logo.png differ",
    ].join("\n");
    const hits = evaluateTripwires(patch, cfg([{ id: "r", globs: ["**/*.png"] }]));
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ scope: "file", filePath: "assets/logo.png" });
    expect(hits[0].line).toBeUndefined();
  });

  test("mode-only (chmod) change trips a glob-only rule (file-scope)", () => {
    const patch = ["diff --git a/run.sh b/run.sh", "old mode 100644", "new mode 100755"].join("\n");
    const hits = evaluateTripwires(patch, cfg([{ id: "r", globs: ["run.sh"] }]));
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ scope: "file", filePath: "run.sh" });
  });

  test("C-quoted file path is decoded so the rule glob matches", () => {
    const patch = [
      'diff --git "a/we\\"ird.ts" "b/we\\"ird.ts"',
      'index 111..222 100644',
      '--- "a/we\\"ird.ts"',
      '+++ "b/we\\"ird.ts"',
      "@@ -1 +1,2 @@",
      " a",
      "+b",
    ].join("\n");
    const hits = evaluateTripwires(patch, cfg([{ id: "r", globs: ['we"ird.ts'] }]));
    expect(hits.length).toBe(1);
    expect(hits[0].filePath).toBe('we"ird.ts');
  });

  test("pathological glob in a rule does not hang evaluation (ReDoS guard)", () => {
    const patch = "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1,2 @@\n a\n+b\n";
    const start = performance.now();
    const hits = evaluateTripwires(patch, cfg([{ id: "h", globs: ["**a".repeat(14) + ".ts"] }]));
    expect(performance.now() - start).toBeLessThan(1000); // was ~50s
    expect(hits).toEqual([]);
  });

  test("empty / null patch yields no hits", () => {
    expect(evaluateTripwires("", cfg([{ globs: ["a.ts"] }]))).toEqual([]);
    // @ts-expect-error null guard
    expect(evaluateTripwires(null, cfg([{ globs: ["a.ts"] }]))).toEqual([]);
  });

  test("no rules yields no hits", () => {
    const patch = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n a\n+b\n";
    expect(evaluateTripwires(patch, cfg([]))).toEqual([]);
  });

  test("dedup: same rule + file + line emitted once", () => {
    const patch = [
      "diff --git a/lib/core.ts b/lib/core.ts",
      "--- a/lib/core.ts",
      "+++ b/lib/core.ts",
      "@@ -1,1 +1,2 @@",
      " base();",
      "+foo(); foo();",
    ].join("\n");
    // Two globs both match the same file — only one hit for the one changed line.
    const hits = evaluateTripwires(
      patch,
      cfg([{ id: "r", globs: ["lib/*.ts", "lib/**"], symbols: ["foo"] }]),
    );
    expect(hits.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Annotation mapping + round-trip through transformReviewInput
// ---------------------------------------------------------------------------

describe("tripwireHitToReviewAnnotation", () => {
  test("line-scope hit maps to a valid review annotation accepted by transformReviewInput", () => {
    const input = tripwireHitToReviewAnnotation({
      ruleId: "auth",
      filePath: "src/auth.ts",
      note: "do not touch",
      scope: "line",
      side: "new",
      line: 42,
    });
    expect(input).toEqual({
      source: TRIPWIRE_SOURCE,
      type: "concern",
      scope: "line",
      filePath: "src/auth.ts",
      text: "do not touch",
      author: "Tripwire",
      side: "new",
      lineStart: 42,
      lineEnd: 42,
    });

    const result = transformReviewInput(input);
    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error(result.error);
    const ann = result.annotations[0];
    expect(ann.source).toBe(TRIPWIRE_SOURCE);
    expect(ann.type).toBe("concern");
    expect(ann.scope).toBe("line");
    expect(ann.filePath).toBe("src/auth.ts");
    expect(ann.lineStart).toBe(42);
    expect(ann.lineEnd).toBe(42);
    expect(ann.side).toBe("new");
    expect(ann.author).toBe("Tripwire");
  });

  test("file-scope hit (no line anchor) is accepted by transformReviewInput", () => {
    const input = tripwireHitToReviewAnnotation({
      ruleId: "auth",
      filePath: "src/login.ts",
      note: "Touches a slop-free zone",
      scope: "file",
    });
    expect(input.lineStart).toBeUndefined();
    expect(input.lineEnd).toBeUndefined();
    expect(input.side).toBeUndefined();

    const result = transformReviewInput(input);
    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error(result.error);
    const ann = result.annotations[0];
    expect(ann.scope).toBe("file");
    expect(ann.filePath).toBe("src/login.ts");
    expect(ann.lineStart).toBe(0);
    expect(ann.lineEnd).toBe(0);
  });

  test("default note is non-empty and survives the round-trip", () => {
    const hits = evaluateTripwires(
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n a\n+b\n",
      cfg([{ globs: ["a.ts"] }]),
    );
    expect(hits[0].note.length).toBeGreaterThan(0);
    const result = transformReviewInput(tripwireHitToReviewAnnotation(hits[0]));
    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations[0].text).toBe(hits[0].note);
  });
});
