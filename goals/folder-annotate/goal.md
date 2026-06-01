# Folder-annotate sessions from the sidebar

## The idea (one line)

Every folder row in the sidebar — **project or worktree** — is clickable and opens
its own reused **folder-annotate** session, straight into the file browser.

## Why

The landing page can only launch **review** today, because review is the only flow a
user can start cold (it just needs a repo path; the daemon runs the diff itself).
Plans and annotations are normally pushed in from an agent or a command, so there's
nothing to "launch" for them from the dashboard.

Folder-annotate changes that for annotate: a folder is something the daemon can open
on demand. So a folder becomes a launchable thing — which means **no project or
worktree is ever a dead row**. You can always click it and get a session.

## Decisions

1. **Clicking a folder row opens a folder-annotate session for that folder.** Applies
   to both project rows and worktree rows.
2. **One session per folder, reused.** Click the same folder again → land back in the
   *same* annotate session, not a new one. (Natural — the `folder:<path>` match key
   already does this.)
3. **Project and worktree: same mechanism, always separate sessions.** Handled by the
   same code path, but each is keyed by its own distinct path, so a project folder and
   a worktree under it get **different** annotate sessions. Never shared.
4. **Additive.** Does not change how plan/review sessions appear in the sidebar. It
   only makes the folder row itself do something when it previously did nothing.
5. **Click goes straight into the annotate experience** (the file browser for that
   folder). No folder overview / landing screen first — for now.

## Open questions

- Which branch this gets built on (the plan worktree vs the code-review worktree).
- UX of the folder-row click vs. its expand/collapse affordance: a folder row also
  expands to show its sessions, so "click = open annotate" and "click = expand" need
  reconciling (e.g. click name = open, click chevron/area = expand).
- Whether the daemon client gets a new `createFolderAnnotateSession(cwd, folderPath)`
  or the existing `createAnnotateSession` is extended to carry the folder mode.
