import { parseDiffFilePathLines, parseDiffGitHeader, parseDiffMetadataPathLines } from "./diff-paths";
import type { CodeGuideData, GuideDiffRef, GuideSection } from "./guide";

/** Discriminator for a portable guided-review snapshot. */
export const PORTABLE_GUIDED_REVIEW_KIND = "plannotator-guided-review" as const;

/** Current portable guided-review snapshot schema version. */
export const PORTABLE_GUIDED_REVIEW_VERSION = 1 as const;

/** DOM id used for the inert snapshot payload consumed by the CDN viewer. */
export const PORTABLE_GUIDED_REVIEW_SCRIPT_ID = "plannotator-guided-review-snapshot";

/** Default versioned viewer location used by compact HTML exports. */
export const PORTABLE_GUIDED_REVIEW_ASSET_BASE_URL =
  "https://plannotator.ai/assets/guided-review-viewer/v1/";

/** Supported guided-review HTML download formats. */
export const PORTABLE_GUIDED_REVIEW_EXPORT_FORMATS = ["small", "offline"] as const;

/** Explicit choices offered when one or more file patches exceed 1 MB. */
export const PORTABLE_GUIDED_REVIEW_LARGE_FILE_CHOICES = ["include", "exclude"] as const;

const MAX_GUIDE_SECTIONS = 100;
const MAX_GUIDE_DIFF_REFS = 50_000;
const LARGE_FILE_PATCH_BYTES = 1_000_000;

/** The exact review snapshot whose files a generated guide describes. */
export interface PortableGuidedReviewContext {
  readonly rawPatch: string;
  readonly gitRef: string;
  readonly diffType?: string;
  readonly base?: string;
}

/** Optional human-facing source metadata included in a portable export. */
export interface PortableGuidedReviewMetadata {
  readonly repository?: string;
  readonly prUrl?: string;
}

/** Optional generator metadata shown alongside the exported guide. */
export interface PortableGuidedReviewGenerator {
  readonly engine?: string;
  readonly model?: string;
}

/** A captured file patch large enough to materially inflate a portable export. */
export interface PortableGuidedReviewLargeFile {
  readonly path: string;
  readonly patchBytes: number;
}

/** Preflight information used to request an explicit large-file export choice. */
export interface PortableGuidedReviewExportInfo {
  readonly totalPatchBytes: number;
  readonly largeFiles: ReadonlyArray<PortableGuidedReviewLargeFile>;
}

/** Approximate download sizes shown before choosing an export format. */
export interface PortableGuidedReviewExportEstimates {
  readonly small: number;
  readonly offline: number;
}

/** Serialized export preflight returned to the Guided Review share menu. */
export interface PortableGuidedReviewExportPreflight extends PortableGuidedReviewExportInfo {
  readonly estimatedBytes: PortableGuidedReviewExportEstimates;
}

export type PortableGuidedReviewExportFormat =
  (typeof PORTABLE_GUIDED_REVIEW_EXPORT_FORMATS)[number];

export type PortableGuidedReviewLargeFileChoice =
  (typeof PORTABLE_GUIDED_REVIEW_LARGE_FILE_CHOICES)[number];

/** Explicit policy for large patches in a static HTML export. */
export interface PortableGuidedReviewHtmlOptions {
  readonly includeLargeFiles: boolean;
  readonly assetBaseUrl: string;
}

/** Inputs for rendering a fully self-contained Guided Review document. */
export interface SelfContainedGuidedReviewHtmlOptions {
  readonly includeLargeFiles: boolean;
  readonly applicationHtml: string;
}

/** Versioned data contract shared by static downloads and future hosted viewers. */
export interface PortableGuidedReviewSnapshotV1 {
  readonly kind: typeof PORTABLE_GUIDED_REVIEW_KIND;
  readonly version: typeof PORTABLE_GUIDED_REVIEW_VERSION;
  readonly exportedAt: string;
  readonly guide: CodeGuideData;
  readonly review: PortableGuidedReviewContext;
  readonly metadata?: PortableGuidedReviewMetadata;
  readonly generator?: PortableGuidedReviewGenerator;
}

/** Stable parse failure for malformed or unsupported portable guide data. */
export interface PortableGuidedReviewParseError {
  readonly _tag: "PortableGuidedReviewParseError";
  readonly message: string;
  readonly path: string;
}

/** Result of parsing serialized portable guided-review data. */
export type PortableGuidedReviewParseResult =
  | { readonly ok: true; readonly value: PortableGuidedReviewSnapshotV1 }
  | { readonly ok: false; readonly error: PortableGuidedReviewParseError };

type ParsedValue<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PortableGuidedReviewParseError };

interface ExportPatchFile {
  readonly path: string;
  readonly patch: string;
}

function parseFailure(path: string, message: string): ParsedValue<never> {
  return {
    ok: false,
    error: { _tag: "PortableGuidedReviewParseError", path, message },
  };
}

function asRecord(input: unknown, path: string): ParsedValue<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return parseFailure(path, "Expected an object");
  }
  // SAFETY: the object/null/array checks above establish a string-keyable object shape.
  return { ok: true, value: input as Record<string, unknown> };
}

function rejectUnknownFields(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): ParsedValue<Record<string, unknown>> {
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    return parseFailure(path, `Unknown field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
  }
  return { ok: true, value: record };
}

function parseString(
  input: unknown,
  path: string,
  options?: { readonly nonEmpty?: boolean },
): ParsedValue<string> {
  if (typeof input !== "string") return parseFailure(path, "Expected a string");
  if (options?.nonEmpty && input.trim().length === 0) return parseFailure(path, "Expected a non-empty string");
  return { ok: true, value: input };
}

function parseOptionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): ParsedValue<string | undefined> {
  const input = record[key];
  if (input === undefined) return { ok: true, value: undefined };
  return parseString(input, `${path}.${key}`);
}

function parseGuideDiffRef(input: unknown, path: string): ParsedValue<GuideDiffRef> {
  const object = asRecord(input, path);
  if (!object.ok) return object;
  const strict = rejectUnknownFields(object.value, new Set(["file", "summary"]), path);
  if (!strict.ok) return strict;
  const file = parseString(strict.value.file, `${path}.file`, { nonEmpty: true });
  if (!file.ok) return file;
  const summary = parseOptionalString(strict.value, "summary", path);
  if (!summary.ok) return summary;
  return {
    ok: true,
    value: summary.value === undefined ? { file: file.value } : { file: file.value, summary: summary.value },
  };
}

function parseGuideSection(input: unknown, path: string): ParsedValue<GuideSection> {
  const object = asRecord(input, path);
  if (!object.ok) return object;
  const strict = rejectUnknownFields(object.value, new Set(["title", "overview", "diffs"]), path);
  if (!strict.ok) return strict;
  const title = parseString(strict.value.title, `${path}.title`, { nonEmpty: true });
  if (!title.ok) return title;
  const overview = parseString(strict.value.overview, `${path}.overview`);
  if (!overview.ok) return overview;
  if (!Array.isArray(strict.value.diffs)) return parseFailure(`${path}.diffs`, "Expected an array");
  if (strict.value.diffs.length > MAX_GUIDE_DIFF_REFS) {
    return parseFailure(`${path}.diffs`, `Section exceeds the ${MAX_GUIDE_DIFF_REFS}-file-reference limit`);
  }

  const diffs: GuideDiffRef[] = [];
  for (let index = 0; index < strict.value.diffs.length; index++) {
    const diff = parseGuideDiffRef(strict.value.diffs[index], `${path}.diffs[${index}]`);
    if (!diff.ok) return diff;
    diffs.push(diff.value);
  }
  return { ok: true, value: { title: title.value, overview: overview.value, diffs } };
}

function parseGuide(input: unknown): ParsedValue<CodeGuideData> {
  const object = asRecord(input, "$.guide");
  if (!object.ok) return object;
  const strict = rejectUnknownFields(
    object.value,
    new Set(["title", "intent", "sections", "unplacedFiles", "reviewed"]),
    "$.guide",
  );
  if (!strict.ok) return strict;
  const title = parseString(strict.value.title, "$.guide.title", { nonEmpty: true });
  if (!title.ok) return title;
  const intent = parseString(strict.value.intent, "$.guide.intent");
  if (!intent.ok) return intent;
  if (!Array.isArray(strict.value.sections)) return parseFailure("$.guide.sections", "Expected an array");
  if (strict.value.sections.length === 0) return parseFailure("$.guide.sections", "Expected at least one section");
  if (strict.value.sections.length > MAX_GUIDE_SECTIONS) {
    return parseFailure("$.guide.sections", `Guide exceeds the ${MAX_GUIDE_SECTIONS}-section limit`);
  }

  const sections: GuideSection[] = [];
  let diffRefCount = 0;
  for (let index = 0; index < strict.value.sections.length; index++) {
    const section = parseGuideSection(strict.value.sections[index], `$.guide.sections[${index}]`);
    if (!section.ok) return section;
    diffRefCount += section.value.diffs.length;
    if (diffRefCount > MAX_GUIDE_DIFF_REFS) {
      return parseFailure("$.guide.sections", `Guide exceeds the ${MAX_GUIDE_DIFF_REFS}-file-reference limit`);
    }
    sections.push(section.value);
  }

  let unplacedFiles: string[] | undefined;
  if (strict.value.unplacedFiles !== undefined) {
    if (!Array.isArray(strict.value.unplacedFiles)) {
      return parseFailure("$.guide.unplacedFiles", "Expected an array");
    }
    if (diffRefCount + strict.value.unplacedFiles.length > MAX_GUIDE_DIFF_REFS) {
      return parseFailure(
        "$.guide.unplacedFiles",
        `Guide exceeds the ${MAX_GUIDE_DIFF_REFS}-file-reference limit`,
      );
    }
    unplacedFiles = [];
    for (let index = 0; index < strict.value.unplacedFiles.length; index++) {
      const file = parseString(strict.value.unplacedFiles[index], `$.guide.unplacedFiles[${index}]`, {
        nonEmpty: true,
      });
      if (!file.ok) return file;
      unplacedFiles.push(file.value);
    }
  }

  if (!Array.isArray(strict.value.reviewed)) return parseFailure("$.guide.reviewed", "Expected an array");
  if (strict.value.reviewed.length > MAX_GUIDE_SECTIONS) {
    return parseFailure("$.guide.reviewed", `Reviewed state exceeds the ${MAX_GUIDE_SECTIONS}-section limit`);
  }
  const reviewed = new Array<boolean>(sections.length).fill(false);
  for (let index = 0; index < strict.value.reviewed.length; index++) {
    const value = strict.value.reviewed[index];
    if (typeof value !== "boolean") return parseFailure(`$.guide.reviewed[${index}]`, "Expected a boolean");
    if (index < sections.length) reviewed[index] = value;
  }

  return {
    ok: true,
    value: {
      title: title.value,
      intent: intent.value,
      sections,
      ...(unplacedFiles !== undefined && { unplacedFiles }),
      reviewed,
    },
  };
}

function parseReviewContext(input: unknown): ParsedValue<PortableGuidedReviewContext> {
  const object = asRecord(input, "$.review");
  if (!object.ok) return object;
  const strict = rejectUnknownFields(object.value, new Set(["rawPatch", "gitRef", "diffType", "base"]), "$.review");
  if (!strict.ok) return strict;
  const rawPatch = parseString(strict.value.rawPatch, "$.review.rawPatch");
  if (!rawPatch.ok) return rawPatch;
  const gitRef = parseString(strict.value.gitRef, "$.review.gitRef");
  if (!gitRef.ok) return gitRef;
  const diffType = parseOptionalString(strict.value, "diffType", "$.review");
  if (!diffType.ok) return diffType;
  const base = parseOptionalString(strict.value, "base", "$.review");
  if (!base.ok) return base;
  return {
    ok: true,
    value: {
      rawPatch: rawPatch.value,
      gitRef: gitRef.value,
      ...(diffType.value !== undefined && { diffType: diffType.value }),
      ...(base.value !== undefined && { base: base.value }),
    },
  };
}

function parseOptionalMetadata(input: unknown): ParsedValue<PortableGuidedReviewMetadata | undefined> {
  if (input === undefined) return { ok: true, value: undefined };
  const object = asRecord(input, "$.metadata");
  if (!object.ok) return object;
  const strict = rejectUnknownFields(object.value, new Set(["repository", "prUrl"]), "$.metadata");
  if (!strict.ok) return strict;
  const repository = parseOptionalString(strict.value, "repository", "$.metadata");
  if (!repository.ok) return repository;
  const prUrl = parseOptionalString(strict.value, "prUrl", "$.metadata");
  if (!prUrl.ok) return prUrl;
  return {
    ok: true,
    value: {
      ...(repository.value !== undefined && { repository: repository.value }),
      ...(prUrl.value !== undefined && { prUrl: prUrl.value }),
    },
  };
}

function parseOptionalGenerator(input: unknown): ParsedValue<PortableGuidedReviewGenerator | undefined> {
  if (input === undefined) return { ok: true, value: undefined };
  const object = asRecord(input, "$.generator");
  if (!object.ok) return object;
  const strict = rejectUnknownFields(object.value, new Set(["engine", "model"]), "$.generator");
  if (!strict.ok) return strict;
  const engine = parseOptionalString(strict.value, "engine", "$.generator");
  if (!engine.ok) return engine;
  const model = parseOptionalString(strict.value, "model", "$.generator");
  if (!model.ok) return model;
  return {
    ok: true,
    value: {
      ...(engine.value !== undefined && { engine: engine.value }),
      ...(model.value !== undefined && { model: model.value }),
    },
  };
}

/** Parse an unknown value into the current portable guided-review snapshot contract. */
export function parsePortableGuidedReviewSnapshot(input: unknown): PortableGuidedReviewParseResult {
  const object = asRecord(input, "$");
  if (!object.ok) return object;
  const strict = rejectUnknownFields(
    object.value,
    new Set(["kind", "version", "exportedAt", "guide", "review", "metadata", "generator"]),
    "$",
  );
  if (!strict.ok) return strict;
  if (strict.value.kind !== PORTABLE_GUIDED_REVIEW_KIND) {
    return parseFailure("$.kind", `Expected ${PORTABLE_GUIDED_REVIEW_KIND}`);
  }
  if (strict.value.version !== PORTABLE_GUIDED_REVIEW_VERSION) {
    return parseFailure("$.version", `Unsupported snapshot version: ${String(strict.value.version)}`);
  }
  const exportedAt = parseString(strict.value.exportedAt, "$.exportedAt", { nonEmpty: true });
  if (!exportedAt.ok) return exportedAt;
  if (!Number.isFinite(Date.parse(exportedAt.value))) {
    return parseFailure("$.exportedAt", "Expected an ISO-compatible timestamp");
  }
  const guide = parseGuide(strict.value.guide);
  if (!guide.ok) return guide;
  const review = parseReviewContext(strict.value.review);
  if (!review.ok) return review;
  const metadata = parseOptionalMetadata(strict.value.metadata);
  if (!metadata.ok) return metadata;
  const generator = parseOptionalGenerator(strict.value.generator);
  if (!generator.ok) return generator;

  return {
    ok: true,
    value: {
      kind: PORTABLE_GUIDED_REVIEW_KIND,
      version: PORTABLE_GUIDED_REVIEW_VERSION,
      exportedAt: exportedAt.value,
      guide: guide.value,
      review: review.value,
      ...(metadata.value !== undefined && { metadata: metadata.value }),
      ...(generator.value !== undefined && { generator: generator.value }),
    },
  };
}

/** Parse serialized JSON into the current portable guided-review snapshot contract. */
export function parsePortableGuidedReviewJson(text: string): PortableGuidedReviewParseResult {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return parseFailure("$", "Snapshot is not valid JSON");
  }
  return parsePortableGuidedReviewSnapshot(input);
}

function escapeHtmlText(input: string): string {
  return input.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(input: string): string {
  return escapeHtmlText(input).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeJsonForHtmlScript(input: string): string {
  return input
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

/** Parse the optional HTTP query value used to select an export format. */
export function parsePortableGuidedReviewExportFormat(
  input: string | null,
): PortableGuidedReviewExportFormat | null {
  if (input === null || input === "small") return "small";
  if (input === "offline") return "offline";
  return null;
}

/** Parse the optional HTTP query value used to include or omit large patches. */
export function parsePortableGuidedReviewLargeFileChoice(
  input: string | null,
): PortableGuidedReviewLargeFileChoice | null {
  if (input === "include" || input === "exclude") return input;
  return null;
}

function splitDiffChunks(rawPatch: string): string[] {
  const matches = [...rawPatch.matchAll(/^diff --git /gm)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? rawPatch.length;
    return rawPatch.slice(start, end).replace(/\n+$/, "");
  });
}

function parsePatchFiles(rawPatch: string): ExportPatchFile[] {
  const files: ExportPatchFile[] = [];
  for (const patch of splitDiffChunks(rawPatch)) {
    const lines = patch.split("\n");
    const filePaths = parseDiffFilePathLines(lines);
    const metadataPaths = parseDiffMetadataPathLines(lines);
    const headerPaths = parseDiffGitHeader(lines[0] ?? "");
    const oldPath = filePaths.oldPath ?? metadataPaths.oldPath ?? headerPaths.oldPath;
    const newPath = filePaths.newPath ?? metadataPaths.newPath ?? headerPaths.newPath;
    const path = newPath ?? oldPath;
    if (!path) continue;

    files.push({ path, patch });
  }
  return files;
}

function normalizeAssetBaseUrl(input: string): URL {
  const fallback = new URL(PORTABLE_GUIDED_REVIEW_ASSET_BASE_URL);
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return fallback;
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
    return parsed;
  } catch {
    return fallback;
  }
}

function snapshotForExport(
  snapshot: PortableGuidedReviewSnapshotV1,
  includeLargeFiles: boolean,
): PortableGuidedReviewSnapshotV1 {
  if (includeLargeFiles) return snapshot;
  const retainedPatch = parsePatchFiles(snapshot.review.rawPatch)
    .filter((file) => new TextEncoder().encode(file.patch).byteLength <= LARGE_FILE_PATCH_BYTES)
    .map((file) => file.patch)
    .join("\n");
  return {
    ...snapshot,
    review: { ...snapshot.review, rawPatch: retainedPatch },
  };
}

/** Inspect a snapshot for file patches that require an explicit export-size choice. */
export function getPortableGuidedReviewExportInfo(
  snapshot: PortableGuidedReviewSnapshotV1,
): PortableGuidedReviewExportInfo {
  const patchFiles = parsePatchFiles(snapshot.review.rawPatch);
  let totalPatchBytes = 0;
  const largeFiles: PortableGuidedReviewLargeFile[] = [];
  for (const file of patchFiles) {
    const patchBytes = new TextEncoder().encode(file.patch).byteLength;
    totalPatchBytes += patchBytes;
    if (patchBytes > LARGE_FILE_PATCH_BYTES) largeFiles.push({ path: file.path, patchBytes });
  }
  return { totalPatchBytes, largeFiles };
}

/** Render a small bootstrap document that loads the production Guided Review UI from versioned assets. */
export function createPortableGuidedReviewHtml(
  snapshot: PortableGuidedReviewSnapshotV1,
  options: PortableGuidedReviewHtmlOptions,
): string {
  const assetBase = normalizeAssetBaseUrl(options.assetBaseUrl);
  const assetOrigin = escapeHtmlAttribute(assetBase.origin);
  const stylesheetUrl = escapeHtmlAttribute(new URL("viewer.css", assetBase).href);
  const scriptUrl = escapeHtmlAttribute(new URL("viewer.js", assetBase).href);
  const exportSnapshot = snapshotForExport(snapshot, options.includeLargeFiles);
  const serialized = escapeJsonForHtmlScript(JSON.stringify(exportSnapshot));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="plannotator-export" content="guided-review-v1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'wasm-unsafe-eval' ${assetOrigin}; style-src 'unsafe-inline' ${assetOrigin}; img-src data: blob: ${assetOrigin}; font-src data: ${assetOrigin}; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'">
  <title>${escapeHtmlText(snapshot.guide.title)} · Guided Review</title>
  <link rel="stylesheet" href="${stylesheetUrl}">
</head>
<body class="min-h-screen antialiased">
  <div id="root" class="h-full"></div>
  <script id="${PORTABLE_GUIDED_REVIEW_SCRIPT_ID}" type="application/json">${serialized}</script>
  <script defer src="${scriptUrl}"></script>
</body>
</html>`;
}

function removeNetworkDependentApplicationLinks(applicationHtml: string): string {
  return applicationHtml.replace(
    /\s*<link\b[^>]*\bhref=["'](?:https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"']*|\/favicon\.svg)["'][^>]*>/gi,
    "",
  );
}

/** Render the bundled review application and snapshot as one offline HTML file. */
export function createSelfContainedGuidedReviewHtml(
  snapshot: PortableGuidedReviewSnapshotV1,
  options: SelfContainedGuidedReviewHtmlOptions,
): string {
  const exportSnapshot = snapshotForExport(snapshot, options.includeLargeFiles);
  const serialized = escapeJsonForHtmlScript(JSON.stringify(exportSnapshot));
  const applicationHtml = removeNetworkDependentApplicationLinks(options.applicationHtml);
  const headMatch = /<head(?:\s[^>]*)?>/i.exec(applicationHtml);
  if (!headMatch || headMatch.index === undefined) {
    throw new Error("Bundled review application is missing its head element");
  }

  const headEnd = headMatch.index + headMatch[0].length;
  const portableHead = `<meta name="plannotator-export" content="guided-review-v1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'">
    <script id="${PORTABLE_GUIDED_REVIEW_SCRIPT_ID}" type="application/json">${serialized}</script>`;
  const withPortableHead = `${applicationHtml.slice(0, headEnd)}${portableHead}${applicationHtml.slice(headEnd)}`;
  return withPortableHead.replace(
    /<title>[^<]*<\/title>/i,
    `<title>${escapeHtmlText(snapshot.guide.title)} · Guided Review</title>`,
  );
}

/** Estimate both export formats without constructing the large offline document. */
export function estimatePortableGuidedReviewExportBytes(
  snapshot: PortableGuidedReviewSnapshotV1,
  options: { readonly assetBaseUrl: string; readonly applicationHtml: string },
): PortableGuidedReviewExportEstimates {
  const smallHtml = createPortableGuidedReviewHtml(snapshot, {
    includeLargeFiles: true,
    assetBaseUrl: options.assetBaseUrl,
  });
  const encoder = new TextEncoder();
  const small = encoder.encode(smallHtml).byteLength;
  // The small bootstrap and the offline injection carry equivalent snapshot
  // data. Adding the bundled app slightly overestimates the offline result and
  // avoids constructing or UTF-8 encoding another ~17 MB value during
  // preflight. The UI labels this as an estimate, so UTF-16 code-unit length is
  // sufficiently close for the already-minified application shell.
  const offline = small + options.applicationHtml.length;
  return { small, offline };
}

/** Create a bounded filesystem-safe HTML filename from a guide title. */
export function createPortableGuidedReviewFilename(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return `${slug || "guided-review"}.html`;
}
