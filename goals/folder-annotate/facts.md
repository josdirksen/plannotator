# Folder-annotate — Fact Sheet

> Verified against the code on the `feat/ui2-plan` branch.

## Annotate-on-folder is a real, supported mode

- Annotate can run on a whole **folder**, not just a single file. The mode exists in
  the protocol and the server: `mode: "annotate-folder"` with a `folderPath`
  (`packages/shared/plugin-protocol.ts`, `packages/server/annotate.ts:49,51`).
- In folder mode the annotate server opens a **file browser** rooted at that folder;
  files are converted/annotated on demand. (CLAUDE.md "Annotate Flow": `folder/` →
  file browser opened.)
- Folder annotate has **no single-document version history** — that's single-file
  annotate only (`annotate.ts:144`).

## Stable per-folder match key (gives us "one session per folder, reused")

- Folder-annotate's session match key is `folder:<resolvedPath>`
  (`packages/server/annotate.ts:124-125`).
- Same folder → same key → the daemon **reactivates the existing session** instead of
  creating a new one. This is the same persistence/resubmission mechanism plans and
  reviews use ("sessions never die").

## Why only review is launchable from the landing page today

- `LandingPage.tsx`'s only launch action is `handleAction("review")`, which calls
  `daemonApiClient.createReviewSession(sel.cwd, sel.prUrl)` (LandingPage.tsx:82-92).
- Review only needs a repo path (or a PR URL); the daemon produces the diff itself —
  so it's the one flow a user can start cold from a dashboard.
- Plans/annotations are normally created by an agent (Claude Code plan-mode → hook) or
  a command (`plannotator annotate <file>`), so there is nothing for the dashboard to
  "launch" for them today.

## What exists vs. what's missing on the client

- The frontend daemon client has `createReviewSession(cwd, prUrl)` and a **single-file**
  `createAnnotateSession(cwd, filePath)` (`apps/frontend/src/daemon/api/client.ts`).
- There is **no folder-annotate launcher on the client yet** — i.e. nothing that sends
  `mode: "annotate-folder"` + `folderPath`. That's the main missing piece.
- The daemon session factory already knows the `annotate` action and routes to
  `createAnnotateSession` (`packages/server/daemon/session-factory.ts`); the folder
  mode flows through the same plugin-protocol fields.

## Sidebar rows that would become clickable

- Project rows and worktree rows both carry a `cwd` (absolute path). Both are folders.
- They render in the app sidebar tree (`buildSessionTree` → project → worktree →
  session), and a row currently expands to show its sessions — which is the affordance
  that needs reconciling with a new "click = open annotate" behavior.
