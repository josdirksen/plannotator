import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { handleFileBrowserFiles, handleDoc } from "./reference-handlers";

let tempDirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "plannotator-reference-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
	tempDirs = [];
});

describe("handleFileBrowserFiles", () => {
	test("resolves relative directories against the session project root", async () => {
		const root = tempDir();
		const project = join(root, "project");
		const docs = join(project, "docs");
		mkdirSync(docs, { recursive: true });
		writeFileSync(join(docs, "guide.md"), "# Guide\n", "utf-8");

		const res = await handleFileBrowserFiles(
			new Request("http://localhost/api/file-browser/files?dirPath=docs"),
			project,
		);
		const bodyText = JSON.stringify(await res.json());

		expect(res.status).toBe(200);
		expect(bodyText).toContain("guide.md");
	});
});

describe("handleDoc — HTML files", () => {
	test("returns raw HTML + renderAs:html by default", async () => {
		const project = tempDir();
		writeFileSync(join(project, "page.html"), "<main><h1>Hello</h1></main>", "utf-8");

		const res = await handleDoc(
			new Request(`http://localhost/api/doc?path=page.html&base=${encodeURIComponent(project)}`),
			{ projectRoot: project },
		);
		const body = await res.json();
		expect(body.renderAs).toBe("html");
		expect(body.rawHtml).toContain("<h1>Hello</h1>");
		expect(body.markdown).toBeUndefined();
	});

	test("converts to markdown when ?convert=1", async () => {
		const project = tempDir();
		writeFileSync(join(project, "page.html"), "<main><h1>Hello</h1></main>", "utf-8");

		const res = await handleDoc(
			new Request(`http://localhost/api/doc?path=page.html&base=${encodeURIComponent(project)}&convert=1`),
			{ projectRoot: project },
		);
		const body = await res.json();
		expect(body.renderAs).toBe("markdown");
		expect(body.isConverted).toBe(true);
		expect(body.markdown).toContain("Hello");
		expect(body.rawHtml).toBeUndefined();
	});

	test("markdown files are unaffected (renderAs:markdown)", async () => {
		const project = tempDir();
		writeFileSync(join(project, "notes.md"), "# Notes\n", "utf-8");

		const res = await handleDoc(
			new Request(`http://localhost/api/doc?path=notes.md&base=${encodeURIComponent(project)}`),
			{ projectRoot: project },
		);
		const body = await res.json();
		expect(body.renderAs).toBe("markdown");
		expect(body.markdown).toContain("# Notes");
	});
});
