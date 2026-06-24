import { toRelativePath } from "./path-utils";

/**
 * OpenCode CLI Review Agent — prompt, command builder, NDJSON stream reducer,
 * marker-block parser, and finding transformer.
 *
 * OpenCode mirrors Cursor: its headless runner (`opencode run --format json`)
 * exposes no schema-validation flag, so the final review output is prose. That
 * earns strict *parsing* — OpenCode is told to emit a marker-delimited JSON
 * block, and we extract the LAST complete block from the reconstructed text.
 *
 * `opencode run --format json` emits NDJSON where every record is
 * `{ type, timestamp, sessionID, ...data }` (see opencode/src/cli/cmd/run.ts).
 * The assistant text we parse arrives in `type: "text"` events carrying
 * `part.text` (each finalized once, `part.time.end` set) — so the reducer is
 * simpler than Cursor's: no partial-output dedup, just concatenate text parts.
 * `tool_use` / `step_start` / `step_finish` / `reasoning` / `error` events are
 * for live logs only.
 */

// ---------------------------------------------------------------------------
// Static marker — same delimiter Cursor uses; v1 takes the LAST complete block
// (no per-job nonce). Add a nonce only if a real run shows the model echoing
// the marker from the prompt — not before.
// ---------------------------------------------------------------------------

export const OPENCODE_MARKER_OPEN = "<plannotator-review-json>";
export const OPENCODE_MARKER_CLOSE = "</plannotator-review-json>";

// ---------------------------------------------------------------------------
// Types — same severity scheme + freeform summary as Cursor/Claude.
// ---------------------------------------------------------------------------

export type OpencodeSeverity = "important" | "nit" | "pre_existing";

export interface OpencodeFinding {
  file: string;
  line: number;
  end_line: number;
  severity: OpencodeSeverity;
  description: string;
  reasoning: string;
}

export interface OpencodeReviewSummary {
  correctness: string;
  explanation: string;
  confidence: number;
}

export interface OpencodeReviewOutput {
  findings: OpencodeFinding[];
  summary: OpencodeReviewSummary;
}

const VALID_SEVERITIES: ReadonlySet<string> = new Set([
  "important",
  "nit",
  "pre_existing",
]);

// ---------------------------------------------------------------------------
// Schema validator — hand-rolled (OpenCode output is prompt-enforced, so
// validation is the floor that turns prose back into a trusted object).
// ---------------------------------------------------------------------------

/**
 * Validate a parsed object against the OpenCode review schema.
 * Returns the typed output, or null if the shape is invalid. Empty findings are
 * valid as long as the JSON is valid and carries a valid summary.
 */
export function validateOpencodeReviewOutput(parsed: unknown): OpencodeReviewOutput | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.findings)) return null;

  const summary = obj.summary;
  if (!summary || typeof summary !== "object") return null;
  const s = summary as Record<string, unknown>;
  if (typeof s.correctness !== "string") return null;
  if (typeof s.explanation !== "string") return null;
  if (typeof s.confidence !== "number") return null;

  const findings: OpencodeFinding[] = [];
  for (const raw of obj.findings) {
    if (!raw || typeof raw !== "object") return null;
    const f = raw as Record<string, unknown>;
    if (typeof f.file !== "string") return null;
    if (typeof f.line !== "number") return null;
    if (typeof f.severity !== "string" || !VALID_SEVERITIES.has(f.severity)) return null;
    if (typeof f.description !== "string") return null;

    findings.push({
      file: f.file,
      line: f.line,
      end_line: typeof f.end_line === "number" ? f.end_line : f.line,
      severity: f.severity as OpencodeSeverity,
      description: f.description,
      reasoning: typeof f.reasoning === "string" ? f.reasoning : "",
    });
  }

  return {
    findings,
    summary: {
      correctness: s.correctness,
      explanation: s.explanation,
      confidence: s.confidence,
    },
  };
}

// ---------------------------------------------------------------------------
// Review prompt — investigation-first methodology (shared with Cursor), ending
// with the marker-block output contract (OpenCode has no schema flag, so the
// contract IS the prompt). Project-specific rules are NOT baked in: the agent
// discovers and honors repo guidance files at review time, so this same prompt
// works for any repo `plannotator review` is run on.
// ---------------------------------------------------------------------------

export const OPENCODE_REVIEW_PROMPT = `# Code Review

## Your role
You are a senior engineer reviewing a code change. Find the bugs a maintainer
would fix before merging — logic errors, regressions, broken edge cases,
security holes with a real exploit path, data-loss risks. You are not a linter
or style checker. Optimize for findings that get resolved, not for volume: a
few real, well-evidenced bugs beat a long list of nits.

## Method — investigate before you report
You have tools. Use them. Do not judge the diff in isolation:
  - Read the full function and module around each change, not just the hunk.
  - Trace call sites and data flow to see how the changed code is actually used.
  - Read any repo guidance and honor it if present: AGENTS.md, CLAUDE.md,
    REVIEW.md, and any rules files at the repo root and in the directories
    you're reviewing. Treat these as authoritative for this repo and respect any
    skip/ignore rules they define.
  - Before reporting, check whether the issue is already handled elsewhere (a
    guard, try/catch, fallback, type guarantee).
  - Look at sibling code and tests: is the pattern you're flagging used safely
    elsewhere? Is the failure path you fear already covered?

## What to look for
  - Correctness: logic errors, regressions, broken edge cases, off-by-one,
    wrong results, build/type breakage.
  - Robustness: unhandled errors on realistic paths, resource/process leaks,
    races with observable consequences, state left inconsistent on failure.
  - Security (only when the change introduces it): execution of
    user/client-controlled input, trusting unvalidated external or model
    output, weakened trust/read-only guarantees, newly exposed surfaces.
  - Contracts & attribution: wrong file/line/path mapping, scope confusion, or a
    change to one side of a contract (types, API shape, parallel
    implementations) without the matching change on the other side.
  - Clear, citable violations of the repo guidance files above.

## Validate every finding
Confirm each candidate is real by tracing the actual code path. If you can't
show how it triggers, drop it — prefer silence over a false positive. The
confirmation you write becomes the \`reasoning\` field: what triggers it, what
breaks, and why it isn't already handled.

## Severity — report what a maintainer would actually fix
  important — should be fixed before merge: data loss, silent wrong results,
    security with an exploit path, crashes/leaks, contract drift that breaks a
    real consumer, fail-open where it must fail-closed.

  nit — minor and non-blocking: a real but low-impact edge case, missing
    handling on an unlikely path, a robustness gap with an easy workaround.

  pre_existing — a genuine bug in surrounding code NOT introduced by this
    change. Only flag when it directly affects the changed code path.

## Do NOT report
  - Formatting, naming, or style preferences (unless a repo guideline requires).
  - "Consider adding tests" — unless the change adds non-trivial logic with no
    test coverage at all.
  - Hypothetical problems needing exotic conditions with no real code path.
  - Speculative refactors or "this could be cleaner" outside the change's scope.

## Hard constraints
- This is a read-only review. Do NOT modify files.
- Do NOT post any comments to GitHub or GitLab. Do NOT use gh pr comment, glab,
  or any commenting tool.
- Never approve or block the change. Your only output is findings.

## Output contract
Your only machine-readable output is a single marker-delimited JSON block.
Any natural-language commentary you write must come BEFORE the final marker
block. Emit the block exactly once, as the last thing in your response:

${OPENCODE_MARKER_OPEN}
{
  "findings": [
    {
      "file": "packages/server/review.ts",
      "line": 123,
      "end_line": 123,
      "severity": "important",
      "description": "The issue...",
      "reasoning": "Why this is a real issue..."
    }
  ],
  "summary": {
    "correctness": "Issues Found",
    "explanation": "One important issue was found.",
    "confidence": 0.85
  }
}
${OPENCODE_MARKER_CLOSE}

Schema:
- findings: array of objects, each with
  - file: string (path as shown in the diff)
  - line: integer (start line, post-change numbering)
  - end_line: integer (end line; equal to line for a single line)
  - severity: one of "important", "nit", "pre_existing"
  - description: string (one paragraph) — state the IMPACT (what breaks, for
    whom) and the TRIGGER (when it happens); suggest a minimal fix if obvious
  - reasoning: string (how the issue was confirmed)
- summary: object with
  - correctness: string ("Correct" or "Issues Found")
  - explanation: string (one sentence)
  - confidence: number between 0 and 1

Cite file/line from the new (post-change) code. One finding per distinct bug —
do not stack unrelated issues. If no issues are found, return an empty
"findings" array with a valid summary.`;

// ---------------------------------------------------------------------------
// Command builder
// ---------------------------------------------------------------------------

export interface OpencodeCommandResult {
  command: string[];
}

/**
 * Build the `opencode run` command.
 *
 * `--format json` emits NDJSON events we capture on stdout. `--agent plan` is
 * OpenCode's read-oriented agent — a sensible default for review (it does not
 * edit), not a verified safety gate. `--dir <cwd>` matches the spawn cwd. The
 * message (prompt) is the trailing positional arg. `--model` is `provider/model`
 * and is omitted when empty so OpenCode uses the configured default. We never
 * pass `--dangerously-skip-permissions` (headless `run` auto-rejects prompts).
 */
export function buildOpencodeCommand(prompt: string, model?: string, cwd?: string): OpencodeCommandResult {
  const useModel = !!model && model.trim().length > 0;

  return {
    command: [
      "opencode",
      "run",
      "--format",
      "json",
      "--agent",
      "plan",
      ...(useModel ? ["--model", model] : []),
      ...(cwd ? ["--dir", cwd] : []),
      // Message (prompt) is the trailing positional arg.
      prompt,
    ],
  };
}

// ---------------------------------------------------------------------------
// Model discovery — parse `opencode models` output. The spawn is runtime-
// specific (it lives in each server's agent-jobs adapter); this parser is shared.
// ---------------------------------------------------------------------------

export interface OpencodeModel {
  id: string;
  label: string;
}

/**
 * Parse the text output of `opencode models` into a model catalog. The CLI
 * prints one model id per line as `provider/model`. Returns [] when there are no
 * model lines (e.g. unauthenticated / no providers configured).
 */
export function parseOpencodeModelsOutput(stdout: string): OpencodeModel[] {
  if (!stdout) return [];
  const models: OpencodeModel[] = [];
  const seen = new Set<string>();
  for (const rawLine of stdout.split("\n")) {
    const id = rawLine.trim();
    // A model id is `provider/model`: no whitespace, exactly the slash form.
    if (!id || /\s/.test(id) || !/^[^/\s]+\/[^/\s]+$/.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: id });
  }
  return models;
}

// ---------------------------------------------------------------------------
// Stream reduction — line-buffered NDJSON reducer.
// ---------------------------------------------------------------------------

interface OpencodePart {
  type?: string;
  text?: string;
  tool?: string;
  state?: { status?: string; error?: unknown };
  time?: { start?: number; end?: number };
  id?: string;
}

interface OpencodeStreamEvent {
  type?: string;
  sessionID?: string;
  timestamp?: number;
  part?: OpencodePart;
  error?: unknown;
  [key: string]: unknown;
}

export interface OpencodeStreamReduction {
  /** Canonical assistant text — the substrate for marker extraction. */
  canonicalText: string;
  /** Number of NDJSON records that parsed successfully. */
  recordCount: number;
}

/**
 * Reduce a complete `opencode run --format json` stdout buffer into canonical
 * text. Line-buffered: only complete lines are parsed; a trailing partial line
 * with no newline is treated as complete (the process has exited by the time
 * this runs on the accumulated buffer). The canonical text is the concatenation
 * of `part.text` from `type: "text"` events (each emitted once, finalized).
 */
export function reduceOpencodeStreamEvents(stdout: string): OpencodeStreamReduction {
  let canonicalText = "";
  let recordCount = 0;

  if (!stdout) return { canonicalText, recordCount };

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    let event: OpencodeStreamEvent;
    try {
      event = JSON.parse(line) as OpencodeStreamEvent;
    } catch {
      continue; // not a complete/valid NDJSON record — skip
    }
    recordCount++;

    if (event.type === "text" && typeof event.part?.text === "string") {
      canonicalText += event.part.text;
    }
  }

  return { canonicalText, recordCount };
}

// ---------------------------------------------------------------------------
// Marker-block parsing — reduce → take the LAST complete marker block → parse →
// schema-validate. Returns null on any failure (caller fails the job).
// ---------------------------------------------------------------------------

/** Extract the content of the LAST complete marker block from canonical text. */
function extractLastMarkerBlock(text: string): string | null {
  let result: string | null = null;
  let searchFrom = 0;

  while (true) {
    const open = text.indexOf(OPENCODE_MARKER_OPEN, searchFrom);
    if (open === -1) break;
    const contentStart = open + OPENCODE_MARKER_OPEN.length;
    const close = text.indexOf(OPENCODE_MARKER_CLOSE, contentStart);
    if (close === -1) break; // no matching close — block is incomplete
    result = text.slice(contentStart, close);
    searchFrom = close + OPENCODE_MARKER_CLOSE.length;
  }

  return result;
}

/**
 * Parse `opencode run --format json` stdout into a validated review output.
 *
 * Pipeline: line-buffered NDJSON reduce → reconstruct canonical text → take the
 * LAST complete marker block → JSON.parse → schema-validate. Returns null on
 * ANY failure (missing marker, malformed JSON, schema mismatch) so the caller
 * can fail the job.
 */
export function parseOpencodeStreamOutput(stdout: string): OpencodeReviewOutput | null {
  if (!stdout || !stdout.trim()) return null;

  const { canonicalText } = reduceOpencodeStreamEvents(stdout);
  if (!canonicalText) return null;

  const block = extractLastMarkerBlock(canonicalText);
  if (block === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(block.trim());
  } catch {
    return null;
  }

  return validateOpencodeReviewOutput(parsed);
}

// ---------------------------------------------------------------------------
// Live log formatter — maps one NDJSON event to a readable log line.
// ---------------------------------------------------------------------------

/**
 * Format one `opencode run --format json` line for the LiveLogViewer.
 * Returns a human-readable string, or null if the line should be skipped.
 */
export function formatOpencodeLogEvent(line: string): string | null {
  let event: OpencodeStreamEvent;
  try {
    event = JSON.parse(line) as OpencodeStreamEvent;
  } catch {
    return null;
  }

  switch (event.type) {
    case "text": {
      const text = typeof event.part?.text === "string" ? event.part.text.trim() : "";
      return text ? text : null;
    }
    case "tool_use": {
      const tool = typeof event.part?.tool === "string" ? event.part.tool : "tool";
      const status = typeof event.part?.state?.status === "string" ? event.part.state.status : "";
      return `[${tool}] ${status}`.trimEnd();
    }
    case "error": {
      return "[error] session error";
    }
    default:
      // step_start / step_finish / reasoning — skipped for live logs.
      return null;
  }
}

// ---------------------------------------------------------------------------
// Finding transform — OpenCode findings → external annotations.
// Identical shape to transformCursorFindings, with author "OpenCode".
// ---------------------------------------------------------------------------

export interface OpencodeReviewAnnotationInput {
  source: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  type: string;
  side: string;
  scope: string;
  text: string;
  severity: OpencodeSeverity;
  reasoning: string;
  author: string;
}

/** Transform OpenCode findings into the external annotation format. */
export function transformOpencodeFindings(
  findings: OpencodeFinding[],
  source: string,
  cwd?: string,
  pathTransform?: (path: string) => string,
): OpencodeReviewAnnotationInput[] {
  return findings
    .filter((f) => f.file && typeof f.line === "number")
    .map((f) => ({
      source,
      filePath: pathTransform
        ? pathTransform(toRelativePath(f.file, cwd))
        : toRelativePath(f.file, cwd),
      lineStart: f.line,
      lineEnd: f.end_line ?? f.line,
      type: "comment",
      side: "new",
      scope: "line",
      text: `[${f.severity}] ${f.description}`,
      severity: f.severity,
      reasoning: f.reasoning,
      author: "OpenCode",
    }));
}
