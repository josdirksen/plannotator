import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { handleDocExists } from "./reference-handlers";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function writeTempFile(root: string, relativePath: string, content = "x"): string {
	const full = join(root, relativePath);
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, content);
	return full;
}

async function postDocExists(body: unknown, rootPath: string) {
	const res = await handleDocExists(
		new Request("http://localhost/api/doc/exists", {
			method: "POST",
			body: JSON.stringify(body),
		}),
		{ rootPath },
	);
	return res.json() as Promise<{
		results: Record<string, { status: "found"; resolved: string } | { status: "missing" }>;
	}>;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("handleDocExists", () => {
	test("does not reveal absolute files outside the allowed root", async () => {
		const root = makeTempDir("plannotator-doc-exists-root-");
		const outside = makeTempDir("plannotator-doc-exists-outside-");
		const secret = writeTempFile(outside, "secret.ts", "secret");

		const data = await postDocExists({ paths: [secret] }, root);

		expect(data.results[secret]).toEqual({ status: "missing" });
	});

	test("allows absolute files inside the allowed root", async () => {
		const root = makeTempDir("plannotator-doc-exists-root-");
		const file = writeTempFile(root, "src/app.ts", "app");

		const data = await postDocExists({ paths: [file] }, root);

		expect(data.results[file]).toEqual({ status: "found", resolved: file });
	});

	test("ignores an out-of-root base directory", async () => {
		const root = makeTempDir("plannotator-doc-exists-root-");
		const outside = makeTempDir("plannotator-doc-exists-outside-");
		writeTempFile(outside, "secret.ts", "secret");

		const data = await postDocExists({ base: outside, paths: ["secret.ts"] }, root);

		expect(data.results["secret.ts"]).toEqual({ status: "missing" });
	});

	test("resolves relative paths from an in-root base directory", async () => {
		const root = makeTempDir("plannotator-doc-exists-root-");
		const app = writeTempFile(root, "src/app.ts", "app");
		const base = resolve(root, "docs/nested");
		mkdirSync(base, { recursive: true });

		const data = await postDocExists({ base, paths: ["../../src/app.ts"] }, root);

		expect(data.results["../../src/app.ts"]).toEqual({ status: "found", resolved: app });
	});
});
