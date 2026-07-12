import { describe, expect, it } from "bun:test";
import {
  PORTABLE_GUIDED_REVIEW_KIND,
  PORTABLE_GUIDED_REVIEW_SCRIPT_ID,
  PORTABLE_GUIDED_REVIEW_VERSION,
  createPortableGuidedReviewFilename,
  createPortableGuidedReviewHtml,
  createSelfContainedGuidedReviewHtml,
  estimatePortableGuidedReviewExportBytes,
  getPortableGuidedReviewExportInfo,
  parsePortableGuidedReviewExportFormat,
  parsePortableGuidedReviewLargeFileChoice,
  parsePortableGuidedReviewJson,
  parsePortableGuidedReviewSnapshot,
  type PortableGuidedReviewSnapshotV1,
} from "./guide-export";

const HTML_OPTIONS = {
  includeLargeFiles: true,
  assetBaseUrl: "https://cdn.example.com/guided-review/v1/",
} as const;

function parseSnapshotFromHtml(html: string): PortableGuidedReviewSnapshotV1 {
  const open = `<script id="${PORTABLE_GUIDED_REVIEW_SCRIPT_ID}" type="application/json">`;
  const start = html.indexOf(open);
  const end = html.indexOf("</script>", start + open.length);
  const parsed = parsePortableGuidedReviewJson(html.slice(start + open.length, end));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function makeSnapshot(): PortableGuidedReviewSnapshotV1 {
  return {
    kind: PORTABLE_GUIDED_REVIEW_KIND,
    version: PORTABLE_GUIDED_REVIEW_VERSION,
    exportedAt: "2026-07-10T12:00:00.000Z",
    guide: {
      title: "Portable </script> guide",
      intent: "Share the **generated walkthrough** safely.",
      sections: [
        {
          title: "Export contract",
          overview: "The snapshot embeds guide prose and the `exact patch`.",
          diffs: [{ file: "src/export.ts", summary: "Builds the portable file." }],
        },
      ],
      reviewed: [true],
    },
    review: {
      rawPatch: [
        "diff --git a/src/export.ts b/src/export.ts",
        "index 1111111..2222222 100644",
        "--- a/src/export.ts",
        "+++ b/src/export.ts",
        "@@ -1 +1 @@",
        "-const html = 'old';",
        "+const html = '</script>';",
      ].join("\n"),
      gitRef: "main...HEAD",
      diffType: "since-base",
      base: "main",
    },
    metadata: { repository: "backnotprop/plannotator" },
    generator: { engine: "claude", model: "sonnet" },
  };
}

describe("portable guided-review snapshots", () => {
  it("parses the versioned contract and normalizes reviewed state to the section count", () => {
    const input = makeSnapshot();
    const result = parsePortableGuidedReviewSnapshot({
      ...input,
      guide: { ...input.guide, reviewed: [] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guide.reviewed).toEqual([false]);
    expect(result.value.review.rawPatch).toContain("diff --git");
  });

  it("rejects unknown fields and unsupported versions at the serialized boundary", () => {
    const unknownField = parsePortableGuidedReviewSnapshot({ ...makeSnapshot(), secret: "nope" });
    expect(unknownField).toEqual({
      ok: false,
      error: {
        _tag: "PortableGuidedReviewParseError",
        path: "$",
        message: "Unknown field: secret",
      },
    });

    const unsupported = parsePortableGuidedReviewSnapshot({ ...makeSnapshot(), version: 2 });
    expect(unsupported.ok).toBe(false);
    if (unsupported.ok) return;
    expect(unsupported.error.path).toBe("$.version");

    const invalidReviewed = makeSnapshot();
    const invalidReviewedResult = parsePortableGuidedReviewSnapshot({
      ...invalidReviewed,
      guide: { ...invalidReviewed.guide, reviewed: [true, "yes"] },
    });
    expect(invalidReviewedResult.ok).toBe(false);
    if (invalidReviewedResult.ok) return;
    expect(invalidReviewedResult.error.path).toBe("$.guide.reviewed[1]");

    const tooManyUnplaced = makeSnapshot();
    const tooManyUnplacedResult = parsePortableGuidedReviewSnapshot({
      ...tooManyUnplaced,
      guide: {
        ...tooManyUnplaced.guide,
        unplacedFiles: new Array(50_000).fill("src/unplaced.ts"),
      },
    });
    expect(tooManyUnplacedResult.ok).toBe(false);
    if (tooManyUnplacedResult.ok) return;
    expect(tooManyUnplacedResult.error.path).toBe("$.guide.unplacedFiles");
  });

  it("round-trips the share payload through the public parser", () => {
    const snapshot = makeSnapshot();
    const parsed = parsePortableGuidedReviewJson(JSON.stringify(snapshot));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.guide.title).toBe(snapshot.guide.title);
    expect(parsed.value.review.rawPatch).toBe(snapshot.review.rawPatch);
  });

  it("renders a compact bootstrap for the versioned production viewer assets", () => {
    const snapshot = makeSnapshot();
    const html = createPortableGuidedReviewHtml(snapshot, HTML_OPTIONS);

    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain("Portable &lt;/script&gt; guide · Guided Review");
    expect(html).toContain('href="https://cdn.example.com/guided-review/v1/viewer.css"');
    expect(html).toContain('defer src="https://cdn.example.com/guided-review/v1/viewer.js"');
    expect(html).toContain("script-src 'wasm-unsafe-eval' https://cdn.example.com");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("worker-src 'none'");
    expect(html).toContain("font-src data: https://cdn.example.com");
    expect(html).not.toContain("fetch(");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("+const html = '</script>'");
    expect(parseSnapshotFromHtml(html)).toEqual(snapshot);
    expect(html.length).toBeLessThan(snapshot.review.rawPatch.length + 3_000);
  });

  it("falls back to the production viewer for an unsafe asset URL", () => {
    const html = createPortableGuidedReviewHtml(makeSnapshot(), {
      includeLargeFiles: true,
      assetBaseUrl: "javascript:alert(1)",
    });

    expect(html).toContain('src="https://plannotator.ai/assets/guided-review-viewer/v1/viewer.js"');
    expect(html).not.toContain("javascript:");
  });

  it("renders the bundled review application as a network-free offline document", () => {
    const snapshot = makeSnapshot();
    const applicationHtml = `<!doctype html>
<html><head>
  <title>Code Review</title>
  <link rel="icon" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">
  <style>body { color: canvastext; }</style>
</head><body><div id="root"></div><script type="module">globalThis.rendered = true;</script></body></html>`;

    const html = createSelfContainedGuidedReviewHtml(snapshot, {
      includeLargeFiles: true,
      applicationHtml,
    });

    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain("Portable &lt;/script&gt; guide · Guided Review");
    expect(html).toContain("script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("worker-src 'none'");
    expect(html).toContain("globalThis.rendered = true");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("fonts.gstatic.com");
    expect(html).not.toContain("/favicon.svg");
    expect(parseSnapshotFromHtml(html)).toEqual(snapshot);
  });

  it("parses supported download formats and estimates both outputs", () => {
    const snapshot = makeSnapshot();

    expect(parsePortableGuidedReviewExportFormat(null)).toBe("small");
    expect(parsePortableGuidedReviewExportFormat("small")).toBe("small");
    expect(parsePortableGuidedReviewExportFormat("offline")).toBe("offline");
    expect(parsePortableGuidedReviewExportFormat("archive")).toBeNull();
    expect(parsePortableGuidedReviewLargeFileChoice("include")).toBe("include");
    expect(parsePortableGuidedReviewLargeFileChoice("exclude")).toBe("exclude");
    expect(parsePortableGuidedReviewLargeFileChoice("all")).toBeNull();

    const estimates = estimatePortableGuidedReviewExportBytes(snapshot, {
      assetBaseUrl: HTML_OPTIONS.assetBaseUrl,
      applicationHtml: "<!doctype html><html><head></head><body></body></html>",
    });
    expect(estimates.small).toBeGreaterThan(snapshot.review.rawPatch.length);
    expect(estimates.offline).toBeGreaterThan(estimates.small);
  });

  it("preflights large patches and only omits them after an explicit exclude choice", () => {
    const snapshot = makeSnapshot();
    const largeLine = `+${"x".repeat(1_100_000)}`;
    const largeSnapshot: PortableGuidedReviewSnapshotV1 = {
      ...snapshot,
      review: {
        ...snapshot.review,
        rawPatch: `${snapshot.review.rawPatch}\n${largeLine}`,
      },
    };

    const info = getPortableGuidedReviewExportInfo(largeSnapshot);
    expect(info.largeFiles).toEqual([
      { path: "src/export.ts", patchBytes: new TextEncoder().encode(largeSnapshot.review.rawPatch).byteLength },
    ]);

    const excluded = createPortableGuidedReviewHtml(largeSnapshot, {
      ...HTML_OPTIONS,
      includeLargeFiles: false,
    });
    expect(parseSnapshotFromHtml(excluded).review.rawPatch).not.toContain("x".repeat(10_000));

    const included = createPortableGuidedReviewHtml(largeSnapshot, HTML_OPTIONS);
    expect(parseSnapshotFromHtml(included).review.rawPatch).toContain("x".repeat(10_000));

    const offlineExcluded = createSelfContainedGuidedReviewHtml(largeSnapshot, {
      includeLargeFiles: false,
      applicationHtml: "<!doctype html><html><head><title>Review</title></head><body></body></html>",
    });
    expect(parseSnapshotFromHtml(offlineExcluded).review.rawPatch).not.toContain("x".repeat(10_000));
  });

  it("creates a bounded filesystem-safe filename", () => {
    expect(createPortableGuidedReviewFilename(" Guided Review: API / UI ✨ ")).toBe("guided-review-api-ui.html");
    expect(createPortableGuidedReviewFilename("💫")).toBe("guided-review.html");
    expect(createPortableGuidedReviewFilename("x".repeat(100))).toBe(`${"x".repeat(80)}.html`);
  });
});
