import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve as resolvePath, posix as pathPosix } from "node:path";
import {
  htmlAssetContentType,
  rewriteCssAssetReferences,
  rewriteHtmlAssetReferences,
} from "./html-assets";

export const MAX_HTML_ASSET_BYTES = 50 * 1024 * 1024;

export function inlineHtmlLocalAssets(html: string, htmlFilePath: string): string {
  if (/^https?:\/\//i.test(htmlFilePath)) return html;

  try {
    const root = dirname(resolvePath(htmlFilePath));
    const activeCss = new Set<string>();

    const dataUrlFor = (assetPath: string): string | null => {
      try {
        const contentType = htmlAssetContentType(assetPath);
        if (!contentType) return null;

        const resolved = resolvePath(root, assetPath);
        if (!isWithinDirectory(resolved, root)) return null;
        if (!existsSync(resolved)) return null;

        const stat = statSync(resolved);
        if (!stat.isFile() || stat.size > MAX_HTML_ASSET_BYTES) return null;

        let bytes = readFileSync(resolved);
        if (contentType.startsWith("text/css") && !activeCss.has(assetPath)) {
          activeCss.add(assetPath);
          try {
            const cssBase = pathPosix.dirname(assetPath);
            const rewrittenCss = rewriteCssAssetReferences(
              bytes.toString("utf-8"),
              dataUrlFor,
              cssBase === "." ? "" : cssBase,
            );
            bytes = Buffer.from(rewrittenCss, "utf-8");
          } finally {
            activeCss.delete(assetPath);
          }
        }

        return `data:${contentType.replace(/;\s*/g, ";")};base64,${Buffer.from(bytes).toString("base64")}`;
      } catch {
        return null;
      }
    };

    return rewriteHtmlAssetReferences(html, dataUrlFor);
  } catch {
    return html;
  }
}

/**
 * Single source of truth for "is this file inside this root?" containment used
 * by every HTML asset / share-html sink (Bun route handler, share inliner, and
 * the Pi server via the vendored copy). Resolves symlinks on BOTH the root and
 * the target so an in-directory symlink pointing outside the root cannot escape.
 * Keep all sinks importing this — duplicating it is how the escape was missed in
 * one runtime before (#927/#929).
 */
export function isWithinDirectory(filePath: string, root: string): boolean {
  let resolvedRoot: string;
  try {
    resolvedRoot = realpathSync(resolvePath(root));
  } catch {
    return false;
  }
  // Resolve symlinks on the asset so an in-directory symlink pointing outside
  // the root (e.g. evil.css -> ~/.ssh/id_rsa) is rejected, not followed. A
  // nonexistent target keeps the lexical path; the later read simply fails.
  let resolved = resolvePath(filePath);
  try {
    resolved = realpathSync(resolved);
  } catch {
    // asset does not exist yet — fall through with the lexical path
  }
  const rel = relative(resolvedRoot, resolved);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Resolve the absolute file an /api/open-in request may launch and confirm it
 * stays within an allowed root — the security boundary for the open-in
 * endpoints, shared by the Bun and Pi servers so the resolve + containment
 * can't drift between runtimes (same reason isWithinDirectory is single-sourced).
 *
 * `resolveRoot` may return one root or several: annotate scopes opens to the
 * same set of reference roots `/api/doc` serves from, so any linked doc the
 * user can view can also be opened. Root precedence: server-supplied root(s)
 * override the client `base`; then `base`; then an absolute `filePath`'s own
 * directory; then cwd. Relative paths resolve against the first root. Returns
 * the absolute path, or null when it escapes every allowed root.
 */
export function resolveOpenInTarget(
  filePath: string,
  base: string | null,
  resolveRoot?: () => string | string[],
): string | null {
  const provided = resolveRoot?.();
  const roots = (
    provided == null
      ? [
          base
            ? resolvePath(base)
            : isAbsolute(filePath)
              ? dirname(resolvePath(filePath))
              : resolvePath(process.cwd()),
        ]
      : Array.isArray(provided)
        ? provided
        : [provided]
  )
    .filter((r): r is string => !!r)
    .map((r) => resolvePath(r));
  if (roots.length === 0) return null;
  const abs = resolvePath(roots[0], filePath);
  return roots.some((r) => isWithinDirectory(abs, r)) ? abs : null;
}
