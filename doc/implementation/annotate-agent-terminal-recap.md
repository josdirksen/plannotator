# Annotate Agent Terminal Recap

Status: implemented, verified, committed, and opened as PR 941.

PR: https://github.com/backnotprop/plannotator/pull/941

Primary commit: `42021708 feat(annotate): wire WebTUI agent into annotate UI`

## What Changed

Plannotator annotate mode now supports an optional terminal-backed coding agent panel for single-file and folder annotation sessions.

The feature is intentionally narrow:

- Available in `plannotator annotate <file>` and `plannotator annotate <folder>`.
- Not enabled for plan review, archive, code review, goal setup, or annotate-last.
- The agent does not start automatically.
- The user opens the panel from the top-left agent icon, chooses an available agent, and clicks start.
- Only one terminal-backed agent session runs at a time for the annotate UI.
- Closing the panel can hide the panel without killing the session; stopping kills the PTY.
- The terminal launches in the directory Plannotator was launched from.
- The terminal is a separate UI panel to the left of the file sidebar. It does not merge with the file tree.

## WebTUI Package

WebTUI is no longer consumed through a local file dependency.

Plannotator now depends on:

```json
"@plannotator/webtui": "^0.1.0"
```

This is used by:

- `packages/editor`
- `packages/server`
- `apps/pi-extension`

The npm package keeps React and ReactDOM as peer dependencies, so Plannotator continues to own the React runtime. That avoids duplicate-React issues in the app.

Because the package was newly published, `@plannotator/webtui` was added to `bunfig.toml` `minimumReleaseAgeExcludes`. Without that, Bun's seven-day release-age guard blocks the package during install.

## Runtime Shape

The browser talks to the Plannotator server over the same origin it already uses.

The terminal WebSocket path is:

```text
/api/agent-terminal/pty
```

There is no public second PTY port.

### Bun Server

The Bun annotate server cannot use WebTUI's Node PTY backend directly for reliable terminal output. The implemented shape is:

1. Annotate server reports terminal capability through `/api/plan`.
2. Browser opens a same-origin WebSocket to `/api/agent-terminal/pty` only after the user starts an agent.
3. Bun starts a lazy Node sidecar on first terminal connection.
4. The sidecar binds a loopback-only internal WebSocket server.
5. Bun proxies bytes between the browser WebSocket and the sidecar WebSocket.
6. The sidecar launches the selected WebTUI built-in agent in the configured Plannotator cwd.

Important files:

- `packages/server/annotate.ts`
- `packages/server/agent-terminal.ts`
- `packages/server/agent-terminal-node-sidecar.mjs`

### Pi Node Server

The Pi extension runs on Node, so it can attach WebTUI's Node PTY WebSocket support directly to the existing HTTP server without the Bun sidecar.

Important files:

- `apps/pi-extension/server/serverAnnotate.ts`
- `apps/pi-extension/server/agent-terminal.ts`
- `apps/pi-extension/server/handlers.ts`

## UI Behavior

The UI adds an agent toggle near the existing top-left sidebar controls. It uses the existing agent bot icon style from code review.

The panel includes:

- Agent selector.
- Start action.
- Stop action.
- Display settings popover.
- WebTUI terminal surface.

The panel intentionally removes redundant chrome. The first visible row is the running agent and cwd context plus compact controls.

The terminal fills the panel edge to edge:

- No rounded border around the xterm surface.
- No extra panel padding around the terminal.
- xterm scrollbar gap is hidden so the terminal does not reserve an empty bar on the right.

Important files:

- `packages/editor/App.tsx`
- `packages/editor/components/AnnotateAgentTerminalPanel.tsx`
- `packages/editor/index.css`

## Theming

The terminal now derives its colors from Plannotator's active CSS theme tokens instead of using a separate fixed WebTUI theme.

That matters because Plannotator has many themes, including themes that switch cleanly between light and dark mode. The terminal should match the current app theme background and foreground instead of falling back to a generic gray, brown, or dark xterm palette.

Important files:

- `packages/editor/components/annotateAgentTerminalTheme.ts`
- `packages/editor/components/annotateAgentTerminalTheme.test.ts`
- `packages/ui/theme.css`

The theme implementation prefers live CSS variables when the browser can read them. Static presets are now fallback data, not the main source of truth.

## Sending Ask AI To The Agent

Ask AI keeps the existing provider-backed path when no terminal agent is available.

When an annotate terminal agent is running and ready, Ask AI can send the question directly into that agent through WebTUI instead.

For file-backed annotate sessions, the prompt tells the agent to read the active file from disk and includes the selected/context text. This avoids relying only on stale inline text while still giving the agent the exact part the user asked about.

Important files:

- `packages/editor/App.tsx`
- `packages/editor/agentTerminalIntegration.ts`
- `packages/editor/agentTerminalIntegration.test.ts`
- `packages/ui/components/CommentPopover.tsx`

## Sending Annotations To The Agent

Send Annotations also supports the terminal-agent path when an annotate agent is open and ready.

The behavior is:

- If a terminal agent is ready, send the exported annotation feedback into that agent.
- Avoid duplicate sends for the same terminal session, target, and feedback body.
- Close the comment popover after sending to the terminal.
- Do not show extra toast noise for successful in-panel sends.
- Keep existing non-terminal feedback behavior available when no terminal agent path is active.

This keeps the integrated experience direct: the user can annotate and then send the work to the visible agent in the same UI.

## Draft Safety Fixes

During the integration work, draft persistence was hardened to avoid stale autosave races.

The problem:

- A delayed autosave could arrive after send/delete.
- That stale save could resurrect a draft the user already submitted.

The fix:

- Drafts now carry a generation value.
- Deletes can leave a tombstone generation.
- Older generated saves are rejected after a newer delete or newer draft exists.
- Legacy drafts remain compatible.

Important files:

- `packages/shared/draft.ts`
- `packages/shared/draft.test.ts`
- `packages/ui/hooks/useAnnotationDraft.ts`
- `packages/ui/hooks/useCodeAnnotationDraft.ts`
- `packages/ui/annotationDraftPersistence.test.tsx`
- `packages/server/draft.ts`

## Feedback Template Cleanup

Annotate feedback formatting was centralized so multiple runtimes can share the same prompt shape.

Important files:

- `packages/shared/feedback-templates.ts`
- `packages/shared/feedback-templates.test.ts`
- `packages/server/index.ts`
- `packages/server/review.ts`
- `packages/server/shared-handlers.ts`
- `apps/pi-extension/server/serverPlan.ts`
- `apps/pi-extension/server/serverReview.ts`

## What Was Not Added

This PR does not add:

- A raw arbitrary terminal command box.
- Multiple simultaneous annotate agents.
- Terminal session persistence.
- Terminal scrollback persistence.
- File tree watching.
- Git-based workspace change badges.
- Agent attribution for disk edits.
- A custom cloud runner.
- Any temporary local notes.

## Verification

The final PR was verified with:

```bash
bun install
bun run typecheck
bun test packages/editor/agentTerminalIntegration.test.ts packages/editor/components/annotateAgentTerminalTheme.test.ts
DOM_TESTS=1 bun test packages/ui/annotationDraftPersistence.test.tsx packages/shared/draft.test.ts packages/shared/feedback-templates.test.ts
bun run build:hook
bun run build:pi
git diff --check
```

Additional checks:

- Confirmed `@plannotator/webtui@0.1.0` is visible on npm.
- Confirmed installed WebTUI package lists React/ReactDOM as peer dependencies and not dependencies.
- Confirmed no `file:/Users/ramos/oss/webtui` dependency remains in package manifests or lockfile.
- Confirmed no unscoped `webtui/...` imports remain.
- Confirmed staged PR contents only included implementation files, tests, and product docs.

## Current Local Test Server

At the time this recap was written, a local annotate-folder server from this branch was running at:

```text
http://127.0.0.1:50986
```

It was launched from:

```text
/Users/ramos/plannotator/feat-tui-in-a-gui
```

This server is only for local testing and is not part of the committed feature.

## Follow-Up Work

Useful next work, separate from this PR:

- Add live file tree watching for annotate folders.
- Add git-backed changed-file badges and lazy diffs.
- Add editor reload/conflict UI when files change on disk.
- Decide whether terminal sessions should ever persist scrollback.
- Add broader browser automation around panel layout and terminal theme matching.
