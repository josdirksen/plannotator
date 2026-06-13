/**
 * Ingestion-phase tests for custom reviews:
 *  - Codex priority normalizes onto the shared important|nit|pre_existing scale
 *    at the boundary values (the single map lives in codex-review.ts).
 *  - The in-diff guard drops findings whose file is not in the reviewed diff and
 *    counts the drops, while staying a no-op when the changed-file list is
 *    unavailable.
 *  - Completion semantics: when every finding is out-of-diff the job is flipped
 *    to "failed" (a green run cannot hide behind "0 findings"); the post-ingest
 *    summary surfaces a calm "N findings · M skipped" one-liner without leaking
 *    provider internals.
 *
 * The filter / fail-marker / summary helpers are the exact functions
 * onJobComplete calls, so these tests exercise real ingestion logic rather than
 * a re-implementation.
 */
import { describe, expect, test } from "bun:test";
import {
  codexPriorityToSeverity,
  transformReviewFindings,
  type CodexFinding,
} from "./codex-review";
import {
  filterToReviewedDiff,
  markJobReviewFailed,
  applyReviewFindingsSummary,
  REVIEW_ALL_OUT_OF_DIFF,
} from "./review";
import type { AgentJobInfo } from "@plannotator/shared/agent-jobs";

function codexFinding(priority: number | null, file: string): CodexFinding {
  return {
    title: "title",
    body: "body",
    confidence_score: 0.9,
    priority,
    code_location: {
      absolute_file_path: file,
      line_range: { start: 1, end: 2 },
    },
  };
}

describe("codexPriorityToSeverity — boundary mapping", () => {
  test("0 and 1 map to important", () => {
    expect(codexPriorityToSeverity(0)).toBe("important");
    expect(codexPriorityToSeverity(1)).toBe("important");
  });
  test("2 maps to nit", () => {
    expect(codexPriorityToSeverity(2)).toBe("nit");
  });
  test("3 and null map to pre_existing", () => {
    expect(codexPriorityToSeverity(3)).toBe("pre_existing");
    expect(codexPriorityToSeverity(null)).toBe("pre_existing");
  });
});

describe("transformReviewFindings — stamps shared severity", () => {
  test("each finding carries the normalized severity", () => {
    const out = transformReviewFindings(
      [codexFinding(0, "a.ts"), codexFinding(2, "b.ts"), codexFinding(null, "c.ts")],
      "codex:1",
      undefined,
      "Codex",
    );
    expect(out.map((a) => a.severity)).toEqual(["important", "nit", "pre_existing"]);
  });
});

describe("filterToReviewedDiff — in-diff guard", () => {
  const ann = (filePath: string) => ({ filePath });

  test("drops findings whose file is not in the reviewed diff and counts them", () => {
    const { kept, dropped } = filterToReviewedDiff(
      [ann("src/a.ts"), ann("src/ghost.ts"), ann("src/b.ts")],
      ["src/a.ts", "src/b.ts"],
    );
    expect(kept.map((a) => a.filePath)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(dropped).toBe(1);
  });

  test("keeps everything when the changed-file list is unavailable", () => {
    const items = [ann("src/a.ts"), ann("src/x.ts")];
    expect(filterToReviewedDiff(items, undefined).kept).toHaveLength(2);
    expect(filterToReviewedDiff(items, []).dropped).toBe(0);
  });

  test("all findings out of diff yields empty kept (the fail precondition)", () => {
    const { kept, dropped } = filterToReviewedDiff(
      [ann("ghost1.ts"), ann("ghost2.ts")],
      ["src/real.ts"],
    );
    expect(kept).toHaveLength(0);
    expect(dropped).toBe(2);
  });
});

describe("completion semantics", () => {
  function job(): AgentJobInfo {
    return {
      id: "j1",
      source: "codex:1",
      provider: "codex",
      label: "Code Review",
      status: "done",
      startedAt: 0,
      command: ["codex"],
    };
  }

  test("all-dropped flips the job to failed with a calm reason", () => {
    const transformed = [{ filePath: "ghost.ts" }];
    const { kept } = filterToReviewedDiff(transformed, ["src/real.ts"]);

    const j = job();
    // Mirrors onJobComplete's branch exactly.
    if (kept.length === 0 && transformed.length > 0) {
      markJobReviewFailed(j, REVIEW_ALL_OUT_OF_DIFF);
    }

    expect(j.status).toBe("failed");
    expect(j.error).toBe(REVIEW_ALL_OUT_OF_DIFF);
    // Calm one-liner — no schema/provider internals.
    expect(j.error).not.toMatch(/json|schema|parse|codex|claude|priority/i);
  });

  test("partial drop keeps the job complete and notes the skip count", () => {
    const j = job();
    j.summary = { correctness: "Issues Found", explanation: "2 findings", confidence: 0.8 };
    applyReviewFindingsSummary(j, 2, 1);

    expect(j.status).toBe("done");
    expect(j.summary?.explanation).toContain("1 skipped (not in the reviewed diff)");
  });

  test("no drops leaves the summary untouched", () => {
    const j = job();
    j.summary = { correctness: "Correct", explanation: "clean", confidence: 1 };
    applyReviewFindingsSummary(j, 3, 0);
    expect(j.summary?.explanation).toBe("clean");
  });
});
