import { describe, expect, test } from "bun:test";
import { fetchGlMR, parsePaginatedArray } from "./pr-gitlab";
import type { PRRuntime } from "./pr-types";

describe("parsePaginatedArray", () => {
  test("parses a single-page array", () => {
    const stdout = JSON.stringify([{ a: 1 }, { a: 2 }]);
    expect(parsePaginatedArray<{ a: number }>(stdout)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  test("merges adjacent JSON arrays from --paginate output", () => {
    const stdout = JSON.stringify([{ a: 1 }]) + JSON.stringify([{ a: 2 }, { a: 3 }]);
    expect(parsePaginatedArray<{ a: number }>(stdout)).toEqual([
      { a: 1 },
      { a: 2 },
      { a: 3 },
    ]);
  });

  test("merges three or more pages with whitespace between them", () => {
    const stdout = [
      JSON.stringify([1, 2]),
      JSON.stringify([3, 4]),
      JSON.stringify([5]),
    ].join("\n");
    expect(parsePaginatedArray<number>(stdout)).toEqual([1, 2, 3, 4, 5]);
  });

  test("handles strings containing brackets without splitting prematurely", () => {
    // Diff content frequently contains `][` inside JSON strings — must not be
    // confused with a page boundary.
    const page1 = [{ diff: "before][after", new_path: "a" }];
    const page2 = [{ diff: "second", new_path: "b" }];
    const stdout = JSON.stringify(page1) + JSON.stringify(page2);
    expect(parsePaginatedArray(stdout)).toEqual([...page1, ...page2]);
  });

  test("handles escaped quotes inside strings", () => {
    const page1 = [{ diff: 'has \\"quote\\" and ] bracket', new_path: "a" }];
    const page2 = [{ diff: "second", new_path: "b" }];
    const stdout = JSON.stringify(page1) + JSON.stringify(page2);
    expect(parsePaginatedArray(stdout)).toEqual([...page1, ...page2]);
  });

  test("returns empty array for empty input", () => {
    expect(parsePaginatedArray("")).toEqual([]);
    expect(parsePaginatedArray("   \n")).toEqual([]);
  });

  test("handles empty pages mixed with non-empty ones", () => {
    const stdout = "[]" + JSON.stringify([{ a: 1 }]) + "[]";
    expect(parsePaginatedArray<{ a: number }>(stdout)).toEqual([{ a: 1 }]);
  });
});

describe("fetchGlMR", () => {
  test("reconstructs a unified patch that can flow into semantic diff", async () => {
    const calls: string[] = [];
    const runtime: PRRuntime = {
      async runCommand(command, args) {
        calls.push([command, ...args].join(" "));
        const endpoint = args[1];
        if (endpoint === "projects/group%2Fproject/merge_requests/42/diffs?per_page=100") {
          return {
            stdout: JSON.stringify([
              {
                diff: "@@ -0,0 +1,3 @@\n+export function created() {\n+  return true;\n+}\n",
                old_path: "src/app.ts",
                new_path: "src/app.ts",
                new_file: true,
                deleted_file: false,
                renamed_file: false,
              },
            ]),
            stderr: "",
            exitCode: 0,
          };
        }
        if (endpoint === "projects/group%2Fproject/merge_requests/42") {
          return {
            stdout: JSON.stringify({
              title: "Add app",
              author: { username: "reviewer" },
              source_branch: "feature/app",
              target_branch: "main",
              diff_refs: {
                base_sha: "a".repeat(40),
                head_sha: "b".repeat(40),
                start_sha: "a".repeat(40),
              },
              web_url: "https://gitlab.com/group/project/-/merge_requests/42",
            }),
            stderr: "",
            exitCode: 0,
          };
        }
        if (endpoint === "projects/group%2Fproject") {
          return {
            stdout: JSON.stringify({ default_branch: "main" }),
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: `unexpected endpoint: ${endpoint}`, exitCode: 1 };
      },
    };

    const result = await fetchGlMR(runtime, {
      platform: "gitlab",
      host: "gitlab.com",
      projectPath: "group/project",
      iid: 42,
    });

    expect(result.metadata).toMatchObject({
      platform: "gitlab",
      projectPath: "group/project",
      iid: 42,
      baseBranch: "main",
      headBranch: "feature/app",
    });
    expect(result.rawPatch).toContain("diff --git a/src/app.ts b/src/app.ts");
    expect(result.rawPatch).toContain("new file mode 100644");
    expect(result.rawPatch).toContain("--- /dev/null");
    expect(result.rawPatch).toContain("+++ b/src/app.ts");
    expect(result.rawPatch).toContain("@@ -0,0 +1,3 @@");
    expect(calls).toContain("glab api projects/group%2Fproject/merge_requests/42/diffs?per_page=100 --paginate");
  });
});
