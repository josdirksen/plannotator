import { describe, expect, test } from "bun:test";
import {
  buildFileTree,
  collectFilePaths,
  collectFolderPaths,
  sumFileCounts,
} from "./tree";

describe("FileTree helpers", () => {
  test("buildFileTree sorts folders before files and preserves file metadata", () => {
    const tree = buildFileTree([
      { path: "README.md", sizeBytes: 10 },
      { path: "guides/start.md", sizeBytes: 20 },
      { path: "design/architecture.md", sizeBytes: 30 },
      { path: "design/decisions.md", name: "decisions.md", sizeBytes: 40 },
    ]);

    expect(tree.map(n => `${n.type}:${n.path}`)).toEqual([
      "folder:design",
      "folder:guides",
      "file:README.md",
    ]);
    expect(tree[0].children?.map(n => n.path)).toEqual([
      "design/architecture.md",
      "design/decisions.md",
    ]);
    expect(tree[0].children?.[1].sizeBytes).toBe(40);
  });

  test("collectFilePaths and collectFolderPaths walk nested trees", () => {
    const tree = buildFileTree([
      { path: "a/b/c.md" },
      { path: "a/d.md" },
      { path: "root.md" },
    ]);

    expect(collectFolderPaths(tree)).toEqual(["a", "a/b"]);
    expect(collectFilePaths(tree[0])).toEqual(["a/b/c.md", "a/d.md"]);
  });

  test("sumFileCounts aggregates descendant file counts", () => {
    const tree = buildFileTree([
      { path: "a/b.md" },
      { path: "a/c.md" },
      { path: "d.md" },
    ]);
    const counts = new Map([
      ["a/b.md", 2],
      ["d.md", 1],
    ]);

    expect(sumFileCounts(tree[0], counts)).toBe(2);
    expect(sumFileCounts(tree[1], counts)).toBe(1);
  });
});
