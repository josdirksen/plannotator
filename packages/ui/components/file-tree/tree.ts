export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileTreeNode[];
  sizeBytes?: number;
}

export interface FileTreeFileEntry {
  path: string;
  name?: string;
  sizeBytes?: number;
}

export function buildFileTree(files: FileTreeFileEntry[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let current = root;
    let pathSoFar = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
      const isFile = i === parts.length - 1;
      let node = current.find(
        n => n.name === part && n.type === (isFile ? "file" : "folder"),
      );

      if (!node) {
        node = {
          name: isFile ? file.name ?? part : part,
          path: pathSoFar,
          type: isFile ? "file" : "folder",
          ...(isFile && file.sizeBytes !== undefined ? { sizeBytes: file.sizeBytes } : {}),
        };
        if (!isFile) node.children = [];
        current.push(node);
      }

      if (!isFile) current = node.children!;
    }
  }

  sortFileTree(root);
  return root;
}

export function sortFileTree(nodes: FileTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.children) sortFileTree(node.children);
  }
}

export function collectFilePaths(node: FileTreeNode): string[] {
  if (node.type === "file") return [node.path];
  return (node.children ?? []).flatMap(collectFilePaths);
}

export function collectFolderPaths(nodes: FileTreeNode[]): string[] {
  const result: string[] = [];
  const walk = (node: FileTreeNode) => {
    if (node.type !== "folder") return;
    result.push(node.path);
    for (const child of node.children ?? []) walk(child);
  };
  for (const node of nodes) walk(node);
  return result;
}

export function sumFileCounts<T extends FileTreeNode>(
  node: T,
  counts: Map<string, number>,
  getFilePath: (node: T) => string = n => n.path,
): number {
  if (node.type === "file") return counts.get(getFilePath(node)) ?? 0;
  let total = 0;
  for (const child of (node.children ?? []) as T[]) {
    total += sumFileCounts(child, counts, getFilePath);
  }
  return total;
}
