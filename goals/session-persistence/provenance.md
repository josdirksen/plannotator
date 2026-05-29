# feat/single-server-runtime — Full Provenance Record

PR #733 into `main`. This document tracks every PR in this stack — 13 total across an 8-layer deep chain that was progressively collapsed.

## The Full Stack

The original work was an 8-layer stacked PR chain (#734 → #738 → #744 → #753 → #755 → #758 → #759 → #766/#770). Each layer built on the previous. They were squash-merged downward into #734, which landed on `feat/single-server-runtime`. Then 4 more PRs landed directly on the branch.

```
main
 └── #733 feat/single-server-runtime (OPEN → main)
      │
      │   ┌─── Original 8-layer stack (collapsed into #734) ───┐
      │   │                                                     │
      └── #734 daemon runtime ◄─────────────────────────────────┘
           └── #738 debug shell + simulator
                └── #744 WebSocket event hub
                     └── #753 production frontend + initial view
                          └── #755 embed code review surface
                               └── #758 embed plan review surface
                                    └── #759 session lifecycle + worktree projects
                                         ├── #766 unified settings + Zustand review store
                                         └── #770 session persistence
      │
      │   ┌─── Post-collapse PRs (directly on branch) ─────────┐
      │   │                                                     │
      ├── #797  Remove legacy standalone apps (-32,885 lines)
      ├── #801  Simplify extensions to thin wrappers
      ├── #806  Start daemon on install
      └── #808  Replace ConfigStore with Zustand vanilla store
```

## All 13 PRs

| # | PR | Title | Files | Lines | Base |
|---|-----|-------|-------|-------|------|
| 1 | #734 | Add long-running Plannotator daemon runtime | 331 | +44,032 / -2,314 | feat/single-server-runtime |
| 2 | #738 | Add daemon debug shell and simulator | 296 | +38,855 / -1,266 | ← #734 |
| 3 | #744 | Add daemon WebSocket event hub | 350 | +36,890 / -5,965 | ← #738 |
| 4 | #753 | Add production frontend with initial view | 260 | +33,929 / -461 | ← #744 |
| 5 | #755 | Embed code review surface in frontend app | 237 | +29,834 / -839 | ← #753 |
| 6 | #758 | Embed plan review surface and fix cross-surface issues | 128 | +7,585 / -1,137 | ← #755 |
| 7 | #759 | Session lifecycle, worktree projects, and directory picker | 117 | +7,348 / -921 | ← #758 |
| 8 | #766 | Unified settings, performance optimizations, and Zustand review store | 84 | +4,811 / -706 | ← #759 |
| 9 | #770 | Session persistence: denied sessions stay alive for resubmission | 24 | +1,011 / -170 | ← #759 |
| 10 | #797 | Remove legacy standalone apps, archive, and integrations | 238 | +735 / -32,885 | feat/single-server-runtime |
| 11 | #801 | Simplify extensions to thin wrappers: server-owned prompts, vendor trim, dumb-pipe CLI | 22 | +244 / -315 | feat/single-server-runtime |
| 12 | #806 | Start daemon on install so hooks work immediately | 3 | +24 / -15 | feat/single-server-runtime |
| 13 | #808 | Replace ConfigStore with Zustand vanilla store | 15 | +139 / -152 | feat/single-server-runtime |

## Net Impact

442 files changed, +24,920 / -17,622 lines vs main.

---

## PR #734 — Add long-running Plannotator daemon runtime

**Merged:** 2026-05-27  
**Scope:** 331 files, +44,032 / -2,314

The foundational PR. Introduced the daemon architecture: one long-running `plannotator` process per machine that serves the frontend SPA and manages all sessions.

**What it built:**
- Daemon runtime (`packages/server/daemon/`) — HTTP server, WebSocket hub, session store, state files, lock management
- Session factory — creates plan/review/annotate sessions from plugin protocol requests
- Daemon client — discovery, health checks, start/stop, protocol compatibility
- Single frontend app (`apps/frontend/`) — TanStack Router SPA that mounts plan review and code review surfaces as embedded routes
- Session persistence — sessions survive feedback submission, enter `awaiting-resubmission` status, reactivate on agent resubmission
- Plugin protocol (`packages/shared/plugin-protocol.ts`, `plugin-binary.ts`, `plugin-client.ts`) — typed wire format for binary ↔ extension communication
- Binary discovery and auto-install for Pi and OpenCode extensions
- Smart session opening — daemon decides browser-open vs WebSocket notify based on frontend connection state

**What it replaced:**
- Old architecture: each hook invocation started a new Bun server on a random port, opened a browser tab, served a standalone HTML file, and died after one decision
- No daemon, no session reuse, no persistent UI

---

## PR #797 — Remove legacy standalone apps, archive, and integrations

**Merged:** 2026-05-27  
**Scope:** 238 files, +735 / -32,885

Deleted ~28,000 lines of code that the daemon architecture made obsolete.

**What it removed:**
- `packages/editor/` — standalone plan review HTML app
- `packages/review-editor/` — standalone code review HTML app
- `apps/review/` — standalone review server
- `apps/archive/` — plan archive browser
- `packages/shared/integrations-common.ts` and all Obsidian/Bear/Apple Notes integration code
- Legacy standalone server entry points (`packages/server/standalone.ts`, `handleServerReady`, `handleReviewServerReady`)
- Duplicate type definitions, unused exports, stale test fixtures

**What it preserved:**
- All daemon-backed functionality
- All extension code (Pi, OpenCode, CLI)
- All shared packages used by the daemon

---

## PR #801 — Simplify extensions to thin wrappers: server-owned prompts, vendor trim, dumb-pipe CLI

**Merged:** 2026-05-28  
**Scope:** 22 files, +244 / -315 (originally 10 commits, grew to 20 through review cycles)

Moved all feedback prompt generation from 3 client surfaces (CLI, Pi, OpenCode) into the daemon's session servers. Made the CLI a pure dumb pipe.

**What it changed:**
- Server-owned prompts: plan denied, review approved/denied, annotate file/folder/message — all composed server-side and returned as `result.prompt`
- CLI removed all prompt function imports, Jina config resolution, review arg parsing
- Pi vendor trim: 20+ vendored files → 9 (replaced full arg parsers with `includes()` checks, raw-args binary calls)
- OpenCode removed local prompt composition
- Improve-context moved from CLI local file reads to daemon HTTP endpoint (`/daemon/improve-context`)
- Annotate-last anchoring: server composes blockquoted excerpt of original message
- Plugin protocol version bumped to 2 for the `prompt` field contract change
- `--json` and `--hook` annotate output preserves raw feedback (not composed prompt) for backward compat
- Gemini plan file path threaded through daemon to restore `planFileRule` guidance

**Review cycles:** 5 rounds of Plannotator review, 1 interrogation (4 models), multiple self-reviews. Key fixes caught by review:
- `emitAnnotateOutcome` ignoring `result.prompt` (bug)
- `ensureDaemonClient` calling `process.exit` instead of throwing under `bestEffort` (bug)
- `cleanupDaemonStateForSessionCommand` not respecting `bestEffort` (bug)
- Plan file rule regression for Gemini (regression)
- `--json`/`--hook` output format change (regression)
- Dead code cleanup (2 unused Pi functions, duplicated inline types)

---

## PR #806 — Start daemon on install so hooks work immediately

**Merged:** 2026-05-28  
**Scope:** 3 files, +24 / -15

Install scripts now stop any existing daemon before replacing the binary, then start a fresh one after.

**What it changed:**
- `scripts/install.sh` — `daemon stop` (silent) before `rm`/`mv`, `daemon start` (backgrounded) after
- `scripts/install.ps1` — `daemon stop` with `-PassThru` and 10s `WaitForExit` timeout before `Move-Item`, `daemon start` fire-and-forget after
- Backlog items #6 (smart session opening) and #14 (daemon on install) marked DONE

**Why it matters:**
- The `improve-context` hook fires on `EnterPlanMode` before any session exists — needs a running daemon
- Windows exe file locking requires stopping the daemon before replacing the binary
- Unix upgrades need daemon cycling so the old daemon doesn't serve stale code from memory

**Review finding fixed:** Windows `-Wait` with no timeout → replaced with `WaitForExit(10000)` + `Kill()` fallback

---

## PR #808 — Replace ConfigStore with Zustand vanilla store

**Merged:** 2026-05-28  
**Scope:** 15 files, +139 / -152

Performance fix: the hand-rolled `configStore` broadcast to all ~60 subscribers on any setting change. Zustand's selector-based subscriptions ensure components only re-render when their specific key changes.

**What it changed:**
- `packages/ui/config/configStore.ts` — `ConfigStore` class → `createStore` from `zustand/vanilla` with flat state + `get`/`set`/`init` actions
- `packages/ui/config/useConfig.ts` — `useSyncExternalStore` → `useConfigStore(selector)`
- `useConfigValue('key')` signature unchanged — zero consumer API changes
- Cookie persistence and 300ms debounced server sync identical
- 8 consumer files: `configStore.set()` → `configStore.getState().set()`
- `AnnotationPanel` — passes `isMe` as prop to child card components (memo-safe)
- `ReviewSidebar` — subscribes to `displayName`, uses it directly instead of `isCurrentUser()`

**Review findings fixed:**
- `ReviewSidebar` missing `displayName` subscription (3 models caught this)
- `set`/`get` Zustand parameter shadowing renamed to `setState`/`getState` (2 models)
- `AnnotationPanel` subscription moved from fragile parent-level hook to proper prop flow (1 model)

---

## Architectural Facts Established

Documented in `goals/session-persistence/decisions.md`:

1. One binary, one daemon, one frontend, many entry points
2. Daemon starts on install and is always running
3. Server is single source of truth for feedback prompt generation
4. Extensions are thin wrappers — they pipe `result.prompt`, never rebuild prompts
5. Sessions never die — no timeouts, no auto-cleanup
6. Annotate-last anchors feedback to the original message via server-composed excerpt
7. Plan mode prompts are the exception — host-specific (Pi phases, OpenCode line numbers)

## Post-Stack Work (after the 13-PR stack)

After the stack collapsed into #733, four review-driven PRs plus a `main` merge landed on the branch:

| PR | Title | Result |
|----|-------|--------|
| #813 | AddProjectDialog → Radix Dialog | merged |
| #814 | GitLab support: custom-domain detection + MR list/detailed | merged |
| #815 | Fix order-dependent PR-stack grouping (leaf-rooting) | merged |
| #816 | Fix PR review reactivation posting against stale head commit (the P1) | merged |

Each ran the full validate → adversarial-review → fix loop (8-model interrogations on #801/#808; per-PR code-review + interrogate on the batch). Then:

- **`main` merged into the branch** (origin/main `0d86d0ee`), clearing the long-standing PR #733 conflicts. Done on an isolated `merge/main-into-ssr` branch via an analyze → port → verify workflow, then fast-forwarded in. It carried main's 35 commits **and** hand-ported three features that lived in deleted code — #763 Ask-AI-in-plan/annotate, #795 `PLANNOTATOR_DATA_DIR`, #792 Windows Pi shim — without dropping main's work or regressing the new system. Inventory: `goals/merge-to-main/carry-in-inventory.md`.
- **Amp plugin** refactored to a conforming thin wrapper (`plugin-client`), eliminating its `PLANNOTATOR_READY_FILE` hang; dead pi-server orphan removed.
- **CI green:** fixed stale release smokes (daemon auth token on Linux; IPv4 session URL on Windows) and deleted dead `@vitest/browser-playwright` scaffolding. PR #733 is now conflict-free and mergeable.

## Open Items (Backlog)

**Done since this record was first written:** GitLab detection + MR listing (#814), PR-stack order-dependence (#815), AddProjectDialog → Radix (#813), PR-review stale-metadata P1 (#816), configStore → Zustand (#808), daemon-on-install (#806), tab-mode config.

**Still open:**
- **Performance** — 29 of 39 findings open (`goals/performance/findings.md`, re-inventoried 2026-05-28): code-splitting, session eviction, App.tsx monolith/memoization, lazy diagram libs, memory-leak/poller cleanup. The global-keyboard-registry cleanup folds into this.
- Sidebar design (session grouping by project vs mode) — needs a decision
- Notify the user when a session updates live
- Amp plugin: bundled `dist` for standalone (curl) install
- Minor deferred (`decisions.md`): gate flag on resubmission, stale-session provenance timestamps, `onCancel` on awaiting banner
- Post-merge human verification: eyeball the Add-Project dialog + GitLab dashboard
