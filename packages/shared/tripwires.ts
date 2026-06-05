/**
 * Tripwires — slop-free zones.
 *
 * A tripwire declares a region of the codebase (by glob, optionally narrowed to
 * symbols) that agents and people must not casually touch. When a diff touches a
 * tripwired file or symbol — adding, editing, deleting, or renaming — the wire
 * trips and an informational annotation surfaces in the review UI.
 *
 * Pure and runtime-agnostic: no node:fs, no Bun globals, no spawning, and no
 * intra-shared imports. This file is vendored verbatim into the Pi extension,
 * so it must stay fully self-contained.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TripwireRule {
  /** Stable identifier (defaulted to `rule-<index>` when absent on parse). */
  id: string;
  /** Repo-relative globs. Required and non-empty. */
  globs: string[];
  /** Optional symbol names to narrow the match within a file. */
  symbols?: string[];
  /** Optional human-readable note shown on the surfaced annotation. */
  note?: string;
}

export interface TripwiresConfig {
  rules: TripwireRule[];
}

/** A single tripped wire, ready to be mapped to a review annotation. */
export interface TripwireHit {
  /** The rule that tripped. */
  ruleId: string;
  /** Repo-relative path of the file that touched the zone (new path for renames). */
  filePath: string;
  /** Note to display. Always non-empty (defaulted to "Touches a slop-free zone"). */
  note: string;
  /** "file" when there is no line anchor (e.g. a rename), "line" otherwise. */
  scope: "line" | "file";
  /** Side of the diff the anchor lives on. Omitted for file-scope hits. */
  side?: "old" | "new";
  /** Anchor line number (1-based). Omitted for file-scope hits. */
  line?: number;
}

/** A single changed line extracted from a unified diff. */
export interface ChangedLine {
  filePath: string;
  lineNumber: number;
  side: "old" | "new";
  content: string;
}

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

/** Hard cap on glob length. Defends matching against pathological inputs. */
export const MAX_GLOB_LENGTH = 256;

/**
 * A compiled glob token.
 * - `segGlob`: a `**` followed by `/` (a `**​/` or `/**​/` path component) —
 *   matches zero or more complete path segments, each terminated by a slash
 *   (equivalent to the regex `(?:[^/]+/)`-star). This is what lets `a/**​/b`
 *   also match `a/b` (zero intervening segments), matching git pathspec /
 *   minimatch and the leading-`**​/` convenience.
 * - `anyChar`: a free-standing `**` (e.g. `a**b`, or a trailing `/**`) —
 *   matches any run of characters including slash (equivalent to `.`-star).
 *   Preserves the historical behavior for a `**` that is not a path component.
 * - `star`: `*` — a run of non-slash characters.
 * - `single`: `?` — a single non-slash character.
 * - `literal`: matched verbatim.
 */
type GlobToken =
  | { kind: "segGlob" }
  | { kind: "anyChar" }
  | { kind: "star" }
  | { kind: "single" }
  | { kind: "literal"; value: string };

/**
 * Compile a glob string into a flat token list.
 *
 * Consecutive `*`/`**` are collapsed (a `**` wins over a `*`), so the token list
 * never holds two adjacent unbounded wildcards — the catastrophic-backtracking
 * shape in a naive regex translation. A `**` that forms a full path component
 * (bounded by `/` or the string ends on its leading side) compiles to a
 * `segGlob` that can match zero segments; any other `**` stays a cross-`/`
 * `anyChar`.
 */
function compileGlob(glob: string): GlobToken[] {
  const tokens: GlobToken[] = [];
  let literal = "";
  const flushLiteral = () => {
    if (literal.length > 0) {
      tokens.push({ kind: "literal", value: literal });
      literal = "";
    }
  };

  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      // Greedily consume a run of `*`; two or more means `**` (globstar).
      let stars = 1;
      while (glob[i + 1] === "*") {
        stars++;
        i++;
      }
      if (stars >= 2) {
        const prevChar = glob[i - stars]; // char immediately before the run
        const nextChar = glob[i + 1]; // char immediately after the run
        const leadingBoundary = prevChar === "/" || prevChar === undefined;
        // `**/` or `/**/` path component: zero-or-more *complete* segments
        // (`segGlob` == `(?:[^/]+/)*`). The leading separator stays in the
        // preceding literal (so `a/` is required), and the component's own
        // trailing `/` is swallowed — this is what makes `a/**​/b` match both
        // `a/b` (zero segments) and `a/x/b`. Only applies when a `/` follows the
        // run; a trailing `**` (end of glob) keeps the historical `anyChar`
        // cross-`/` semantics so `src/auth/**` still matches `src/auth/x.ts`.
        if (leadingBoundary && nextChar === "/") {
          flushLiteral();
          tokens.push({ kind: "segGlob" });
          i++; // swallow the component's trailing slash
        } else {
          // A `**` glued to non-slash chars (e.g. `a**b`, `**.ts`) or a trailing
          // `/**` / bare `**`. Keep the historical cross-`/` semantics.
          flushLiteral();
          tokens.push({ kind: "anyChar" });
        }
      } else {
        flushLiteral();
        tokens.push({ kind: "star" });
      }
    } else if (c === "?") {
      flushLiteral();
      tokens.push({ kind: "single" });
    } else {
      literal += c;
    }
  }
  flushLiteral();
  return tokens;
}

/**
 * A character-level matcher state. Literal runs are expanded to one `lit` state
 * per char so the matcher can advance exactly one path character per step.
 *
 * Wildcard states loop:
 * - `single` (`?`): exactly one non-slash char.
 * - `anySeg` (`*`): zero+ non-slash chars.
 * - `anyChar` (`**` not forming a `/**​/` component): zero+ of any char.
 * - `segHead`/`segBody`: a `/**​/` component = `(?:[^/]+/)*`, zero or more
 *   complete path segments. `segHead` is the loop boundary (may exit with zero
 *   segments); `segBody` is "inside a segment, owe a trailing slash". They are
 *   always emitted as an adjacent pair.
 */
type MatchState =
  | { kind: "lit"; ch: string }
  | { kind: "single" }
  | { kind: "anySeg" }
  | { kind: "anyChar" }
  | { kind: "segHead" }
  | { kind: "segBody" };

/** Expand compiled glob tokens into a flat character-level state list. */
function tokensToStates(tokens: GlobToken[]): MatchState[] {
  const states: MatchState[] = [];
  for (const token of tokens) {
    if (token.kind === "literal") {
      for (const ch of token.value) states.push({ kind: "lit", ch });
    } else if (token.kind === "single") {
      states.push({ kind: "single" });
    } else if (token.kind === "star") {
      states.push({ kind: "anySeg" });
    } else if (token.kind === "anyChar") {
      states.push({ kind: "anyChar" });
    } else {
      // segGlob — a `(?:[^/]+/)*` component, encoded as a head/body pair.
      states.push({ kind: "segHead" });
      states.push({ kind: "segBody" });
    }
  }
  return states;
}

/**
 * Glob matcher with no catastrophic backtracking. Models the glob as a tiny NFA
 * and advances a *set* of reachable states one path character at a time, so its
 * cost is O(states × path.length) in the worst case — never exponential — no
 * matter how many wildcards the glob contains. This is what makes a hostile
 * `.plannotator/tripwires.json` unable to wedge the event loop (see the ReDoS
 * notes on the old single-regex translation).
 */
function matchStates(states: MatchState[], path: string): boolean {
  const n = states.length;
  let active = new Array<boolean>(n + 1).fill(false);
  let next = new Array<boolean>(n + 1).fill(false);

  // Epsilon closure: a state that can match zero chars also reaches the next
  // state. `anySeg`/`anyChar` are zero-or-more; `segHead` may exit the loop
  // with zero segments (its `segBody` companion is skipped to land on `i+2`).
  const addState = (set: boolean[], i: number) => {
    let cur = i;
    while (cur <= n && !set[cur]) {
      set[cur] = true;
      const s = states[cur];
      if (s && (s.kind === "anySeg" || s.kind === "anyChar")) {
        cur++; // wildcard may consume zero chars
        continue;
      }
      if (s && s.kind === "segHead") {
        cur += 2; // skip both head and body — zero segments
        continue;
      }
      break;
    }
  };

  addState(active, 0);

  for (let pi = 0; pi < path.length; pi++) {
    const ch = path[pi];
    next.fill(false);
    let any = false;
    for (let i = 0; i < n; i++) {
      if (!active[i]) continue;
      const s = states[i];
      if (s.kind === "lit") {
        if (ch === s.ch) {
          addState(next, i + 1);
          any = true;
        }
      } else if (s.kind === "single") {
        if (ch !== "/") {
          addState(next, i + 1);
          any = true;
        }
      } else if (s.kind === "anySeg") {
        if (ch !== "/") {
          addState(next, i); // consume one non-slash char and stay
          any = true;
        }
      } else if (s.kind === "anyChar") {
        // `**`: consume any char, including `/`.
        addState(next, i);
        any = true;
      } else if (s.kind === "segHead") {
        // Start of a segment: first char must be non-slash (`[^/]+`).
        if (ch !== "/") {
          addState(next, i + 1); // enter the body
          any = true;
        }
      } else {
        // segBody — inside a `[^/]+/` segment.
        if (ch === "/") {
          addState(next, i - 1); // segment complete — back to the loop head
          any = true;
        } else {
          addState(next, i); // still consuming the segment's non-slash chars
          any = true;
        }
      }
    }
    if (!any) return false;
    const tmp = active;
    active = next;
    next = tmp;
  }

  return active[n];
}

/** Compile + match a single glob against a path (no backtracking). */
function matchTokens(tokens: GlobToken[], path: string): boolean {
  return matchStates(tokensToStates(tokens), path);
}

/**
 * Convert a glob to an anchored, full-match RegExp.
 *
 * Supports `**` (any path segments incl. `/`), `*` (any non-`/` run), and `?` (a
 * single non-`/` char). A `**` that forms a `/**​/` path component matches zero
 * or more segments, so both a leading `**​/foo.ts` and a mid-path `a/**​/foo.ts`
 * match the zero-segment case (`foo.ts`, `a/foo.ts`).
 *
 * IMPORTANT: this still emits `.*` for a free-standing `**` (e.g. `a**b`), so a
 * pathological glob (`**a**a**a…`) compiles to a catastrophic-backtracking
 * regex. Do NOT run `globToRegExp(...).test(...)` on untrusted globs. The
 * tripwire runtime never does — it matches via {@link matchesAnyGlob}, which
 * uses a linear, backtracking-free NFA matcher and caps glob length.
 */
export function globToRegExp(glob: string): RegExp {
  const tokens = compileGlob(glob);
  let pattern = "";
  for (const token of tokens) {
    if (token.kind === "literal") {
      pattern += token.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (token.kind === "single") {
      pattern += "[^/]";
    } else if (token.kind === "star") {
      pattern += "[^/]*";
    } else if (token.kind === "anyChar") {
      pattern += ".*";
    } else {
      // segGlob — a `/**​/` component: zero or more complete segments. No
      // adjacent unbounded quantifiers, so not the catastrophic shape.
      pattern += "(?:[^/]+/)*";
    }
  }
  return new RegExp("^" + pattern + "$");
}

/** True when `filePath` matches at least one glob. */
export function matchesAnyGlob(filePath: string, globs: string[]): boolean {
  for (const glob of globs) {
    if (glob.length > MAX_GLOB_LENGTH) continue; // skip pathological globs
    if (matchTokens(compileGlob(glob), filePath)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Patch parsing
// ---------------------------------------------------------------------------

// Hunk header: @@ -oldStart,oldCount +newStart,newCount @@ [trailing context]
// Mirrors packages/review-editor/utils/patchParser.ts (the @@ regex) but also
// captures the trailing function-context text after the closing @@.
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

interface FileSpan {
  /** New-side path (post-image). Falls back to old path for pure deletions. */
  filePath: string;
  /** Old-side path (pre-image). Differs from filePath on renames. */
  oldPath: string;
  /** True when the file is renamed (old path differs from new path). */
  renamed: boolean;
  changed: ChangedLine[];
  /** Trailing hunk-context text per hunk (the bit after the closing @@). */
  hunkContexts: string[];
}

/**
 * Decode git's C-style path quoting. Git wraps a path in double quotes and
 * backslash-escapes special bytes when the name contains a tab, newline, double
 * quote, or backslash — even under `core.quotePath=false` (which the review
 * server sets). An unquoted string is returned unchanged.
 *
 * Handles `\"`, `\\`, `\t`, `\n`, `\r`, `\f`, `\b`, `\a`, `\v`, and octal
 * `\NNN` escapes, matching how git apply / full diff viewers read these names.
 */
function unquoteGitPath(raw: string): string {
  if (raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"') return raw;
  const body = raw.slice(1, -1);
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = body[i + 1];
    if (n === undefined) {
      out += "\\";
      break;
    }
    if (n >= "0" && n <= "7") {
      // Octal escape: up to three digits.
      let oct = n;
      let j = i + 2;
      while (oct.length < 3 && body[j] >= "0" && body[j] <= "7") {
        oct += body[j];
        j++;
      }
      out += String.fromCharCode(parseInt(oct, 8));
      i = j - 1;
      continue;
    }
    const simple: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      t: "\t",
      n: "\n",
      r: "\r",
      f: "\f",
      b: "\b",
      a: "\x07",
      v: "\v",
    };
    out += simple[n] ?? n;
    i++;
  }
  return out;
}

/**
 * Parse the two paths from a `diff --git a/<old> b/<new>` header. Returns null
 * when the paths can't be recovered unambiguously (e.g. unquoted names with
 * spaces — git itself relies on the `---`/`+++` lines in that case). Used to
 * recover a path for binary / mode-only changes, which carry no `+++` line.
 */
function parseDiffGitHeader(line: string): { oldPath: string; newPath: string } | null {
  const rest = line.slice("diff --git ".length);
  // Both paths quoted: `"a/x" "b/y"`.
  if (rest.startsWith('"')) {
    const end = rest.indexOf('" ', 1);
    if (end === -1) return null;
    const first = unquoteGitPath(rest.slice(0, end + 1));
    const second = unquoteGitPath(rest.slice(end + 2).trim());
    return stripPair(first, second);
  }
  // Unquoted: `a/<old> b/<new>`. Split on ` b/` — unambiguous only when the old
  // path has no space (git would quote otherwise). Find the LAST ` b/` so an
  // old path that itself contains ` b/` chooses the boundary git intended only
  // in the common no-space case.
  const sep = rest.lastIndexOf(" b/");
  if (sep === -1) return null;
  const first = rest.slice(0, sep);
  const second = rest.slice(sep + 1);
  if (!first.startsWith("a/") || first.includes(" ")) return null;
  return stripPair(first, second);
}

function stripPair(first: string, second: string): { oldPath: string; newPath: string } | null {
  const strip = (p: string) =>
    p.startsWith("a/") || p.startsWith("b/") ? p.slice(2) : p;
  return { oldPath: strip(first), newPath: strip(second) };
}

/**
 * Parse a unified diff into changed lines, tracking file paths across renames
 * and /dev/null (added/deleted) headers. Returns one FileSpan per file.
 *
 * Also surfaces metadata-only changes that carry no hunks — binary-file edits
 * (`Binary files ... differ` / `GIT binary patch`) and mode-only changes
 * (`old mode` / `new mode`) — as zero-`changed` file spans, so glob-only rules
 * still trip on them.
 */
export function parseChangedLines(patch: string): FileSpan[] {
  const spans: FileSpan[] = [];
  if (!patch) return spans;

  const lines = patch.split("\n");
  let current: FileSpan | null = null;
  let oldLine = 0;
  let newLine = 0;
  // Rename headers carry the paths before the `+++/---` lines appear.
  let pendingRenameFrom: string | null = null;
  let pendingRenameTo: string | null = null;
  // The `--- a/<path>` header precedes `+++ b/<path>`; remember it so we can
  // recover the old path even when the new side is /dev/null (a deletion).
  let pendingOldPath: string | null = null;
  // Paths from the current block's `diff --git` header — the only path source
  // for binary / mode-only changes, which have no `---`/`+++` lines.
  let headerOldPath: string | null = null;
  let headerNewPath: string | null = null;
  // True when the current block has seen a mode change but not yet a span/hunk.
  let pendingModeOnly = false;

  const startFile = (oldPath: string, newPath: string): FileSpan => {
    const span: FileSpan = {
      filePath: newPath,
      oldPath,
      renamed: oldPath !== newPath && oldPath !== "/dev/null" && newPath !== "/dev/null",
      changed: [],
      hunkContexts: [],
    };
    spans.push(span);
    return span;
  };

  // Emit a file-scope span for the block's header path if nothing else has.
  // Covers mode-only changes detected at the block boundary.
  const finalizeBlock = () => {
    if (pendingModeOnly && !current && headerNewPath) {
      startFile(headerOldPath ?? headerNewPath, headerNewPath);
    }
  };

  // Strip the `a/` or `b/` prefix git puts on diff paths, decoding C-quoting.
  const stripPrefix = (raw: string): string => {
    const trimmed = unquoteGitPath(raw.trim());
    if (trimmed === "/dev/null") return "/dev/null";
    if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) return trimmed.slice(2);
    return trimmed;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      finalizeBlock();
      current = null;
      oldLine = 0;
      newLine = 0;
      pendingRenameFrom = null;
      pendingRenameTo = null;
      pendingOldPath = null;
      pendingModeOnly = false;
      const header = parseDiffGitHeader(line);
      headerOldPath = header?.oldPath ?? null;
      headerNewPath = header?.newPath ?? null;
      continue;
    }

    if (line.startsWith("rename from ")) {
      pendingRenameFrom = unquoteGitPath(line.slice("rename from ".length).trim());
      continue;
    }
    if (line.startsWith("rename to ")) {
      pendingRenameTo = unquoteGitPath(line.slice("rename to ".length).trim());
      // A rename can be pure (no hunks); record a span eagerly so it still
      // surfaces a file-scope hit even with zero edited lines.
      if (pendingRenameFrom !== null && !current) {
        current = startFile(pendingRenameFrom, pendingRenameTo);
      }
      continue;
    }

    // Mode-only changes (chmod) carry `old mode`/`new mode` but no hunks; mark
    // the block so finalizeBlock can emit a file-scope span from the header.
    if (line.startsWith("old mode ") || line.startsWith("new mode ")) {
      pendingModeOnly = true;
      continue;
    }

    // Binary changes carry no `---`/`+++` and no hunks. Emit a file-scope span
    // eagerly from the `diff --git` header path so glob-only rules still trip.
    if (
      line.startsWith("Binary files ") ||
      line.startsWith("GIT binary patch") ||
      line === "GIT binary patch"
    ) {
      if (!current && headerNewPath) {
        current = startFile(headerOldPath ?? headerNewPath, headerNewPath);
      }
      pendingModeOnly = false; // a span now exists; don't double-emit
      continue;
    }

    if (line.startsWith("--- ")) {
      // Remember the old path; defer span creation until we also see `+++`.
      pendingOldPath = stripPrefix(line.slice(4));
      continue;
    }
    if (line.startsWith("+++ ")) {
      const newPath = stripPrefix(line.slice(4));
      // Recover the old path from the `---` header (falling back to rename
      // metadata, then the new path) so deletions and renames keep both sides.
      let oldPath = pendingOldPath ?? pendingRenameFrom ?? newPath;
      if (oldPath === "/dev/null") oldPath = pendingRenameFrom ?? newPath;
      if (!(current && (current.renamed || current.filePath === newPath))) {
        current = startFile(oldPath, newPath);
      }
      pendingRenameFrom = null;
      pendingRenameTo = null;
      pendingOldPath = null;
      pendingModeOnly = false; // a content span exists; don't also emit mode-only
      continue;
    }

    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      oldLine = parseInt(hunk[1], 10);
      newLine = parseInt(hunk[2], 10);
      if (current) current.hunkContexts.push(hunk[3].trim());
      continue;
    }

    if (!current) continue;

    const prefix = line[0];
    const content = line.slice(1);
    if (prefix === "+") {
      current.changed.push({
        filePath: current.filePath,
        lineNumber: newLine,
        side: "new",
        content,
      });
      newLine++;
    } else if (prefix === "-") {
      current.changed.push({
        filePath: current.oldPath,
        lineNumber: oldLine,
        side: "old",
        content,
      });
      oldLine++;
    } else if (prefix === " ") {
      oldLine++;
      newLine++;
    }
    // Ignore "\ No newline at end of file" and any other metadata lines.
  }

  finalizeBlock(); // flush a trailing mode-only block
  return spans;
}

// ---------------------------------------------------------------------------
// Config parsing
// ---------------------------------------------------------------------------

const DEFAULT_NOTE = "Touches a slop-free zone";

/**
 * Parse a tripwires config from raw JSON text. Fail-open: any parse error,
 * malformed shape, or invalid rule yields a safe config — one bad rule never
 * discards its siblings.
 */
export function parseTripwiresConfig(raw: string | null | undefined): TripwiresConfig {
  if (!raw || typeof raw !== "string") return { rules: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("[tripwires] failed to parse tripwires.json:", err);
    return { rules: [] };
  }

  if (!parsed || typeof parsed !== "object") return { rules: [] };
  const rawRules = (parsed as { rules?: unknown }).rules;
  if (!Array.isArray(rawRules)) return { rules: [] };

  const rules: TripwireRule[] = [];
  for (let i = 0; i < rawRules.length; i++) {
    const rule = rawRules[i];
    if (!rule || typeof rule !== "object") continue;
    const r = rule as Record<string, unknown>;

    // globs is required and must contain at least one non-empty string.
    if (!Array.isArray(r.globs)) continue;
    const globs = r.globs.filter((g): g is string => typeof g === "string" && g.length > 0);
    if (globs.length === 0) continue;

    const symbols = Array.isArray(r.symbols)
      ? r.symbols.filter((s): s is string => typeof s === "string" && s.length > 0)
      : undefined;

    rules.push({
      id: typeof r.id === "string" && r.id.length > 0 ? r.id : `rule-${i}`,
      globs,
      ...(symbols && symbols.length > 0 ? { symbols } : {}),
      ...(typeof r.note === "string" && r.note.length > 0 ? { note: r.note } : {}),
    });
  }

  return { rules };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface EvaluateOptions {
  /** Repo root (informational; evaluation is pure on the patch text). */
  cwd?: string;
}

/** True when `content` contains `symbol` as a whole word. */
function lineMentionsSymbol(content: string, symbol: string): boolean {
  // Cheap substring pre-filter: the boundary regex can only match if the symbol
  // appears verbatim, so skip the (relatively expensive) regex build + scan for
  // the overwhelming majority of lines that don't mention it. This keeps the
  // O(rules × changedLines × symbols) symbol pass fast on large diffs.
  if (!content.includes(symbol)) return false;
  // Escape regex specials in the symbol so e.g. `foo$bar` is literal.
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Word-ish boundary: allow `_` and alnum to count as identifier chars.
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(content);
}

/**
 * Evaluate a patch against a tripwires config. Pure — never throws (returns []
 * on any internal error).
 *
 * Semantics:
 *   1. A rule with no `symbols` trips on any change to a matching file. The hit
 *      anchors to the first changed line (file-scope if the file had no edited
 *      lines, e.g. a pure rename).
 *   2. A rule with `symbols` trips only on changed lines (or hunk context) that
 *      mention one of the symbols, anchored to that line.
 *   3. A rule matches against both the new path and the old path, so moving a
 *      tripwired file out of its zone (rename) or deleting it still trips.
 *   4. Hits are deduplicated per (ruleId, filePath, side, line).
 */
export function evaluateTripwires(
  patch: string,
  config: TripwiresConfig,
  _opts?: EvaluateOptions,
): TripwireHit[] {
  try {
    if (!patch || !config || !Array.isArray(config.rules) || config.rules.length === 0) {
      return [];
    }

    const spans = parseChangedLines(patch);
    if (spans.length === 0) return [];

    const hits: TripwireHit[] = [];
    const seen = new Set<string>();

    const push = (hit: TripwireHit) => {
      const key = `${hit.ruleId} ${hit.filePath} ${hit.side ?? ""} ${hit.line ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      hits.push(hit);
    };

    for (const rule of config.rules) {
      const note = rule.note && rule.note.length > 0 ? rule.note : DEFAULT_NOTE;

      for (const span of spans) {
        // A rule matches a file if its new path or its old path is in the zone.
        // Checking both covers renames (moving out of a zone) and deletions
        // (where the new side is /dev/null).
        const newReal = span.filePath !== "/dev/null";
        const oldReal = span.oldPath !== "/dev/null";
        const matchesNew = newReal && matchesAnyGlob(span.filePath, rule.globs);
        const matchesOld =
          oldReal && span.oldPath !== span.filePath && matchesAnyGlob(span.oldPath, rule.globs);
        if (!matchesNew && !matchesOld) continue;

        // The human-meaningful path for file-scope hits: prefer the new path,
        // falling back to the old path for deletions.
        const displayPath = newReal ? span.filePath : span.oldPath;

        const symbols = rule.symbols;
        if (!symbols || symbols.length === 0) {
          // Globs-only: any touch trips. Anchor to the first changed line, or
          // emit a file-scope hit when there are no edited lines (pure rename).
          if (span.changed.length > 0) {
            const first = span.changed[0];
            push({
              // Always surface the new-side (display) path so the hit joins the
              // review UI's file list, which keys files by the new path. An
              // old-side anchor (a leading `-` line on a renamed+edited file)
              // would otherwise stamp the OLD path and orphan the annotation.
              // `side`/`line` still come from the matched line for gutter
              // placement.
              ruleId: rule.id,
              filePath: displayPath,
              note,
              scope: "line",
              side: first.side,
              line: first.lineNumber,
            });
          } else {
            push({
              ruleId: rule.id,
              filePath: displayPath,
              note,
              scope: "file",
            });
          }
          continue;
        }

        // Symbol-narrowed: trip on changed lines (or hunk context) mentioning a
        // symbol. Anchor to the matching changed line; hunk-context matches with
        // no matching changed line fall back to a file-scope hit.
        let anchored = false;
        for (const cl of span.changed) {
          if (symbols.some((s) => lineMentionsSymbol(cl.content, s))) {
            push({
              // Same as the globs-only branch: surface the new-side path so a
              // symbol match on an old-side line of a renamed+edited file still
              // keys to the file the UI knows about.
              ruleId: rule.id,
              filePath: displayPath,
              note,
              scope: "line",
              side: cl.side,
              line: cl.lineNumber,
            });
            anchored = true;
          }
        }

        if (!anchored) {
          const contextHit = span.hunkContexts.some((ctx) =>
            symbols.some((s) => lineMentionsSymbol(ctx, s)),
          );
          if (contextHit) {
            push({
              ruleId: rule.id,
              filePath: displayPath,
              note,
              scope: "file",
            });
          }
        }
      }
    }

    return hits;
  } catch {
    // Pure and fail-open: never throw.
    return [];
  }
}

// ---------------------------------------------------------------------------
// Annotation mapping
// ---------------------------------------------------------------------------

/** Source identifier stamped on every tripwire annotation. */
export const TRIPWIRE_SOURCE = "tripwire";

/**
 * The review-annotation input shape accepted by `transformReviewInput` in
 * external-annotation.ts. Line fields are omitted for file-scope hits.
 */
export interface TripwireReviewAnnotationInput {
  source: typeof TRIPWIRE_SOURCE;
  type: "concern";
  scope: "line" | "file";
  side?: "old" | "new";
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  text: string;
  author: "Tripwire";
}

/** Map a tripwire hit to the external review-annotation input shape. */
export function tripwireHitToReviewAnnotation(hit: TripwireHit): TripwireReviewAnnotationInput {
  const input: TripwireReviewAnnotationInput = {
    source: TRIPWIRE_SOURCE,
    type: "concern",
    scope: hit.scope,
    filePath: hit.filePath,
    text: hit.note,
    author: "Tripwire",
  };
  if (hit.scope === "line" && typeof hit.line === "number") {
    input.side = hit.side;
    input.lineStart = hit.line;
    input.lineEnd = hit.line;
  }
  return input;
}
