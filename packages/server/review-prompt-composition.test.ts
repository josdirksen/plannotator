import { describe, expect, test } from "bun:test";
import { composeClaudeReviewPrompt, CLAUDE_REVIEW_PROMPT } from "./claude-review";
import { composeCodexReviewPrompt, CODEX_REVIEW_SYSTEM_PROMPT } from "./codex-review";
import {
  BUILTIN_DEFAULT_PROFILE,
  type ResolvedReviewProfile,
} from "@plannotator/shared/review-profiles";

// Stand-in for buildAgentReviewUserMessage(...) output. The composer treats it
// as opaque text, so a literal is enough to pin placement and byte-equality.
const userMessage = "Review of the current code changes.\n\n```diff\n+const x = 1;\n```";

const security: ResolvedReviewProfile = {
  id: "user:security",
  label: "Security",
  instructions: "Focus only on security-impacting issues.",
  source: "user",
};

// The exact prompt today, before this phase, for the default path.
const claudeDefault = CLAUDE_REVIEW_PROMPT + "\n\n---\n\n" + userMessage;
const codexDefault = CODEX_REVIEW_SYSTEM_PROMPT + "\n\n---\n\n" + userMessage;

describe("review prompt composition — default is byte-identical", () => {
  test("Claude: absent profile matches today's prompt exactly", () => {
    expect(composeClaudeReviewPrompt(userMessage)).toBe(claudeDefault);
  });

  test("Claude: builtin:default matches today's prompt exactly", () => {
    expect(composeClaudeReviewPrompt(userMessage, BUILTIN_DEFAULT_PROFILE)).toBe(claudeDefault);
  });

  test("Codex: absent profile matches today's prompt exactly", () => {
    expect(composeCodexReviewPrompt(userMessage)).toBe(codexDefault);
  });

  test("Codex: builtin:default matches today's prompt exactly", () => {
    expect(composeCodexReviewPrompt(userMessage, BUILTIN_DEFAULT_PROFILE)).toBe(codexDefault);
  });

  test("a custom profile with empty instructions still yields the default prompt", () => {
    const blank: ResolvedReviewProfile = { ...security, instructions: "   " };
    expect(composeClaudeReviewPrompt(userMessage, blank)).toBe(claudeDefault);
    expect(composeCodexReviewPrompt(userMessage, blank)).toBe(codexDefault);
  });
});

describe("review prompt composition — custom section placement", () => {
  test("Claude: section sits between system prompt and user message", () => {
    const prompt = composeClaudeReviewPrompt(userMessage, security);

    const expected =
      CLAUDE_REVIEW_PROMPT +
      "\n\n" +
      "## Custom Review Profile\n\nProfile: Security\nSource: user\n\nFocus only on security-impacting issues." +
      "\n\n---\n\n" +
      userMessage;

    expect(prompt).toBe(expected);
    // Ordering invariant: system prompt → section → separator → user message.
    expect(prompt.indexOf("## Custom Review Profile")).toBeGreaterThan(
      prompt.indexOf(CLAUDE_REVIEW_PROMPT),
    );
    expect(prompt.indexOf(userMessage)).toBeGreaterThan(
      prompt.indexOf("## Custom Review Profile"),
    );
  });

  test("Codex: section sits between system prompt and user message", () => {
    const prompt = composeCodexReviewPrompt(userMessage, security);

    const expected =
      CODEX_REVIEW_SYSTEM_PROMPT +
      "\n\n" +
      "## Custom Review Profile\n\nProfile: Security\nSource: user\n\nFocus only on security-impacting issues." +
      "\n\n---\n\n" +
      userMessage;

    expect(prompt).toBe(expected);
  });

  test("section carries the profile's label and source verbatim", () => {
    const profile: ResolvedReviewProfile = {
      id: "user:perf",
      label: "Performance",
      instructions: "Flag N+1 queries.",
      source: "user",
    };
    const prompt = composeClaudeReviewPrompt(userMessage, profile);
    expect(prompt).toContain("Profile: Performance\nSource: user\n\nFlag N+1 queries.");
  });
});
