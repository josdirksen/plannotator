# Folder-annotate — Implementation

> What shipped, for the record. Built on `feat/folder-annotate` (off `feat/ui2-plan`).

## Summary

Every project and worktree row in the app sidebar now has an **"Annotate"** child
row. It opens (or reuses) a folder-annotate session for that folder and navigates to
it. When that session is live, the Annotate row **is** the session — it highlights when
active and is not duplicated as a separate session row.

The daemon + embedded UI already supported folder-annotate end-to-end; the work was
wiring the frontend to launch it, identifying the session in the sidebar, and getting
the row/expand behavior right.

## Changes

### Launch path
- `apps/frontend/src/daemon/api/client.ts` — `createAnnotateFolderSession(cwd)` POSTs
  `{ action: "annotate", mode: "annotate-folder", folderPath: cwd }`.
- `apps/frontend/src/components/sidebar/AppSidebar.tsx` — `FolderAnnotateRow` under each
  project (`project.cwd`) and worktree (`worktree.cwd`), mirroring
  `HistoryRow.handleOpen` (create-or-reuse → navigate). Empty worktrees now render
  (removed the zero-session early return).

### One session per folder, reused (server)
- `packages/server/daemon/session-factory.ts` — folder-annotate matching reuses any
  **live** session (`active`/`idle`/`awaiting-resubmission`) for that folder, not just
  one awaiting resubmission. Single-file / last annotate keep the agent-driven
  resubmit-only semantics. `updateContent` skipped when markdown is empty (folders).

### Fold the session into the Annotate row (no duplicate)
- `packages/shared/daemon-protocol.ts` + `packages/server/daemon/session-store.ts` —
  expose `matchKey` on `DaemonSessionSummary`.
- `AppSidebar.tsx` — `isFolderAnnotateSession` / `folderSessionFor` identify the
  folder's session by match key; it's excluded from session rows + the count and
  represented by the (highlight-on-active) Annotate row.

### Clean worktree open/closed state
- `apps/frontend/src/stores/app-store.ts` — replaced the overloaded `collapsedWorktrees`
  set with `worktreeOpen: Record<cwd, boolean>` (explicit overrides) + `setWorktreeOpen`.
- `AppSidebar.tsx` — `open = override ?? (hasRealSession || containsActive)`. Default
  open only when the worktree has a real session or contains the active session (route
  is the source of truth, so it survives refresh); explicit user toggle wins and sticks.

### Hide the redundant breadcrumb in folder mode
- `packages/ui/components/DocBadges.tsx` + `Viewer.tsx` — `showLinkedDocBadge` flag.
- `packages/plannotator-plan-review/App.tsx` — `showLinkedDocBadge={annotateSource !== 'folder'}`.
  The linked-doc breadcrumb stays in plan / single-file / HTML (only way back); in
  folder mode the sidebar file browser is the way back, so it's hidden. `linkedDocInfo`
  is kept intact (still drives the Copy label + Ask AI source).

## Verified

- `tsc` clean (frontend, shared, server). Daemon session tests 26/26.
- API: same folder → same session (reuse); different folders → distinct sessions.
- Summary exposes `matchKey`; folder session folds into the Annotate row, not a
  duplicate row.
