/**
 * Context builders — translate Plannotator review state into system prompts
 * that give the AI session the right background for answering questions.
 *
 * These are provider-agnostic: any AIProvider implementation can use them
 * to build the system prompt it needs.
 */

import type { AIContext } from "./types.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a system prompt from the given context.
 *
 * The prompt tells the AI:
 * - What role it plays (plan reviewer, code reviewer, etc.)
 * - The content it should reference (plan markdown, diff patch, file)
 * - Any annotations the user has already made
 * - That it's operating inside Plannotator (not a general coding session)
 */
export function buildSystemPrompt(ctx: AIContext): string {
  switch (ctx.mode) {
    case "plan-review":
      return buildPlanReviewPrompt(ctx);
    case "code-review":
      return buildCodeReviewPrompt(ctx);
    case "annotate":
      return buildAnnotatePrompt(ctx);
  }
}

/**
 * Build a compact context summary suitable for injecting into a fork prompt.
 *
 * When forking from a parent session, we don't need a full system prompt
 * (the parent's history already provides context). Instead, we inject a
 * short "you are now in Plannotator" preamble with the relevant content.
 */
export function buildForkPreamble(ctx: AIContext): string {
  const lines: string[] = [
    "The user is now reviewing your work in Plannotator and has a question.",
    "Answer the user's message directly and concisely based on the conversation " +
      "history and the context below. Do not re-review or summarize the work unless they ask.",
    "",
  ];

  switch (ctx.mode) {
    case "plan-review": {
      lines.push("## Current Plan Under Review");
      if (ctx.plan.version) {
        const total = ctx.plan.totalVersions ? ` of ${ctx.plan.totalVersions}` : "";
        lines.push(`Plan version: ${ctx.plan.version}${total}`);
      }
      if (ctx.plan.project) {
        lines.push(`Project: ${ctx.plan.project}`);
      }
      lines.push("");
      lines.push(truncate(ctx.plan.plan, MAX_PLAN_CHARS));
      if (ctx.plan.annotations) {
        lines.push("");
        lines.push("## User Annotations So Far");
        lines.push(ctx.plan.annotations);
      }
      break;
    }
    case "code-review": {
      if (ctx.review.filePath) {
        lines.push(`## Reviewing: ${ctx.review.filePath}`);
      }
      if (ctx.review.selectedCode) {
        lines.push("");
        lines.push("### Selected Code");
        lines.push("```");
        lines.push(ctx.review.selectedCode);
        lines.push("```");
      }
      if (ctx.review.lineRange) {
        const { start, end, side } = ctx.review.lineRange;
        lines.push(`Lines ${start}-${end} (${side} side)`);
      }
      lines.push("");
      lines.push("## Diff Patch");
      lines.push("```diff");
      lines.push(truncate(ctx.review.patch, MAX_DIFF_CHARS));
      lines.push("```");
      if (ctx.review.annotations) {
        lines.push("");
        lines.push("## User Annotations So Far");
        lines.push(ctx.review.annotations);
      }
      break;
    }
    case "annotate": {
      lines.push(`## Annotating: ${ctx.annotate.filePath}`);
      if (ctx.annotate.sourceInfo) {
        lines.push(`Source: ${ctx.annotate.sourceInfo}`);
      }
      if (ctx.annotate.renderAs) {
        lines.push(`Render mode: ${ctx.annotate.renderAs}`);
      }
      if (ctx.annotate.sourceConverted) {
        lines.push("Note: this content was converted before annotation, so source line numbers may not match the original document.");
      }
      lines.push("");
      lines.push(truncate(ctx.annotate.content, MAX_PLAN_CHARS));
      if (ctx.annotate.annotations) {
        lines.push("");
        lines.push("## User Annotations So Far");
        lines.push(ctx.annotate.annotations);
      }
      break;
    }
  }

  return lines.join("\n");
}

/**
 * Build the effective prompt for a query, prepending a preamble on the first
 * message. Used by providers that inject context via the prompt itself (Codex,
 * Pi) rather than a separate system-prompt channel (Claude).
 */
export function buildEffectivePrompt(
  userPrompt: string,
  preamble: string | null,
  firstQuerySent: boolean,
): string {
  if (!firstQuerySent && preamble) {
    return `${preamble}\n\n---\n\nUser question: ${userPrompt}`;
  }
  return userPrompt;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const MAX_PLAN_CHARS = 60_000;
const MAX_DIFF_CHARS = 40_000;

/**
 * Leading instruction for every Ask AI session. Ask AI is a chat assistant —
 * it must respond to the user's message, not launch an unprompted review of the
 * material it was given for context.
 */
const ANSWER_DIRECTLY =
  "You are a helpful assistant inside Plannotator. Respond to the user's message directly and concisely. " +
  "The material below is context for what the user is looking at — do NOT review, summarize, or critique it unless the user's message asks you to. " +
  "Only investigate further (read files, run git) if the user's question actually requires it.";

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n... [truncated for context window]`;
}

/**
 * For git-reproducible diff types, return a one-line instruction telling the
 * agent how to inspect the changes itself — so we don't paste the whole diff.
 * Returns null for types that can't be reproduced with a single git command
 * (jj, Perforce, stacked-PR full-stack, workspace, unknown) — those fall back
 * to pasting the diff.
 *
 * NOTE: kept self-contained here because `packages/ai` is dependency-free; the
 * server's richer `getLocalDiffInstruction` (agent-review-message.ts) remains
 * the source of truth for the agent-jobs path.
 */
function gitInspectInstruction(
  diffType: string | undefined,
  base: string | undefined,
): string | null {
  const b = base || "main";
  switch (diffType) {
    case "uncommitted":
      return "Run `git diff HEAD` to see the changes (and `git status` for untracked files).";
    case "staged":
      return "Run `git diff --staged` to see the changes.";
    case "unstaged":
      return "Run `git diff` to see the changes.";
    case "last-commit":
      return "Run `git diff HEAD~1..HEAD` to see the changes.";
    case "branch":
      return `Run \`git diff ${b}..HEAD\` to see the changes.`;
    case "merge-base":
      // Three-dot diff = changes on HEAD since the merge-base with the base —
      // the GitHub PR view. Single command, no shell substitution needed.
      return `Run \`git diff ${b}...HEAD\` to see the changes (matches the PR view).`;
    default:
      return null;
  }
}

function buildPlanReviewPrompt(
  ctx: Extract<AIContext, { mode: "plan-review" }>
): string {
  const sections: string[] = [
    ANSWER_DIRECTLY,
    "",
    "The user is reviewing an implementation plan in Plannotator.",
    "",
    "## Plan Under Review",
  ];

  if (ctx.plan.version) {
    const total = ctx.plan.totalVersions ? ` of ${ctx.plan.totalVersions}` : "";
    sections.push(`Plan version: ${ctx.plan.version}${total}`);
  }

  if (ctx.plan.project) {
    sections.push(`Project: ${ctx.plan.project}`);
  }

  sections.push("");
  sections.push(truncate(ctx.plan.plan, MAX_PLAN_CHARS));

  if (ctx.plan.previousPlan) {
    sections.push("");
    sections.push("## Previous Plan Version (for reference)");
    sections.push(truncate(ctx.plan.previousPlan, MAX_PLAN_CHARS / 2));
  }

  if (ctx.plan.annotations) {
    sections.push("");
    sections.push("## User Annotations");
    sections.push(ctx.plan.annotations);
  }

  return sections.join("\n");
}

function buildCodeReviewPrompt(
  ctx: Extract<AIContext, { mode: "code-review" }>
): string {
  const sections: string[] = [
    ANSWER_DIRECTLY,
    "",
    "The user is reviewing a set of code changes in Plannotator.",
  ];

  const inspect = gitInspectInstruction(ctx.review.diffType, ctx.review.base);

  if (inspect) {
    // Git-reproducible: tell the agent how to look instead of pasting the diff.
    sections.push("");
    sections.push("## The changes under review");
    sections.push(
      `The current working directory is the repository being reviewed. ${inspect}`,
    );
  } else {
    // Fallback (jj, Perforce, stacked-PR full-stack, workspace, unknown):
    // paste the diff since it can't be reproduced with a single git command.
    sections.push("");
    sections.push("## Diff");
    sections.push("```diff");
    sections.push(truncate(ctx.review.patch, MAX_DIFF_CHARS));
    sections.push("```");
  }

  if (ctx.review.selectedCode) {
    sections.push("");
    sections.push("## Code the user has selected");
    sections.push("```");
    sections.push(ctx.review.selectedCode);
    sections.push("```");
  }

  if (ctx.review.annotations) {
    sections.push("");
    sections.push("## User Annotations");
    sections.push(ctx.review.annotations);
  }

  return sections.join("\n");
}

function buildAnnotatePrompt(
  ctx: Extract<AIContext, { mode: "annotate" }>
): string {
  const sections: string[] = [
    ANSWER_DIRECTLY,
    "",
    "The user is annotating a markdown document in Plannotator.",
    "",
    `## Document: ${ctx.annotate.filePath}`,
  ];

  if (ctx.annotate.sourceInfo) {
    sections.push(`Source: ${ctx.annotate.sourceInfo}`);
  }

  if (ctx.annotate.renderAs) {
    sections.push(`Render mode: ${ctx.annotate.renderAs}`);
  }

  if (ctx.annotate.sourceConverted) {
    sections.push("Note: this content was converted before annotation, so source line numbers may not match the original document.");
  }

  sections.push("");
  sections.push(truncate(ctx.annotate.content, MAX_PLAN_CHARS));

  if (ctx.annotate.annotations) {
    sections.push("");
    sections.push("## User Annotations");
    sections.push(ctx.annotate.annotations);
  }

  return sections.join("\n");
}
