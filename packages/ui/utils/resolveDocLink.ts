/** Resolve a relative link target against a document's directory path. */
export function resolveDocLink(href: string, currentDocPath?: string): string {
  if (!currentDocPath || href.startsWith('/')) return href;
  const dir = currentDocPath.includes('/') ? currentDocPath.replace(/\/[^/]+$/, '') : '';
  const parts = (dir ? `${dir}/${href}` : href).split('/');
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === '..') resolved.pop();
    else if (p !== '.') resolved.push(p);
  }
  return resolved.join('/');
}
