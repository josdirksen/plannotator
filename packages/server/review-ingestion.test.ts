/**
 * Ingestion-phase tests: a provider that exits 0 but returns empty/garbage
 * output fails the job instead of silently showing "done".
 */
import { describe, expect, test } from "bun:test";
import { parseClaudeStreamOutput } from "./claude-review";
import {
  markJobReviewFailed,
  REVIEW_OUTPUT_FAILED,
  type AgentJobInfo,
} from "@plannotator/shared/agent-jobs";

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
