/**
 * Ingestion-phase tests for custom reviews:
 *  - Codex priority normalizes onto the shared important|nit|pre_existing scale
 *    at the boundary values (the single map lives in codex-review.ts).
 *  - Completion semantics: a provider that exits 0 but returns empty/garbage
 *    output fails the job instead of silently showing "done".
 */
import { describe, expect, test } from "bun:test";
import {
  codexPriorityToSeverity,
  transformReviewFindings,
  type CodexFinding,
} from "./codex-review";
import { parseClaudeStreamOutput } from "./claude-review";
import {
  markJobReviewFailed,
  REVIEW_OUTPUT_FAILED,
  type AgentJobInfo,
} from "@plannotator/shared/agent-jobs";

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

describe("completion semantics — empty/unparseable output fails the job", () => {
  // Guards the fix: a provider that exits 0 with nothing/garbage must fail the
  // job (REVIEW_OUTPUT_FAILED), not silently leave it "done" with no findings.
  test("parseClaudeStreamOutput returns null for empty/whitespace stdout", () => {
    expect(parseClaudeStreamOutput("")).toBeNull();
    expect(parseClaudeStreamOutput("   \n  ")).toBeNull();
  });

  test("parseClaudeStreamOutput returns null for unparseable stdout", () => {
    expect(parseClaudeStreamOutput("not json\n{ broken")).toBeNull();
  });

  test("markJobReviewFailed flips the job to failed with a calm, leak-free reason", () => {
    const job = { status: "running" } as unknown as AgentJobInfo;
    markJobReviewFailed(job, REVIEW_OUTPUT_FAILED);
    expect(job.status).toBe("failed");
    expect(job.error).toBe(REVIEW_OUTPUT_FAILED);
    // No schema/CLI internals leaked in the user-facing reason.
    expect(REVIEW_OUTPUT_FAILED).not.toContain("stdout");
    expect(REVIEW_OUTPUT_FAILED).not.toContain("JSON");
  });
});
