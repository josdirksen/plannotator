# Spec: Phase 6 Extras Seams

Date: 2026-06-23 · Status: Draft (iterate before implementing)

> Implementation spec for Phase 6 of the `@plannotator/ui` reuse effort. Grounded in `SPIKE-document-ui-extras-system-20260623-100827.md` + its synthesis. Governed by ADR 004. THE LAW: each seam defaults to today's literal behavior; Plannotator passes nothing and is byte-for-byte unchanged. Move + decouple, never rewrite — especially the AI reader loop and the configStore batching.

## Scope
**In (5 seams + 1 CSS move):** version fetchers, vscode-diff action, the block/raw diff CSS relocation, config write-back, obsidian-detect, save-to-notes, AI transport.
**Confirmed noop (already portable):** planDiffEngine + all plan-diff render components, sharing.ts/useSharing/ImportModal, obsidian/bear/octarine/callback/defaultNotesApp utils, settings.ts, DocumentAIChatPanel/AIProviderBar, aiProvider/aiChatFormat.
**Out (Plannotator-only, stay home):** OpenInAppButton, HooksTab, useUpdateCheck, useAgents, useAgentJobs.

## Order of work (lowest risk first; AI last)

### Step 1 — Versions / diff
**Files:** `packages/ui/hooks/usePlanDiff.ts`, `packages/ui/components/plan-diff/PlanDiffViewer.tsx`, `packages/editor/index.css` → `packages/ui/theme.css`.
- **1a. Version fetchers.** Add an optional `fetchers?: { fetchVersion?, fetchVersions? }` arg to `usePlanDiff` (or module-level setters following the seam pattern). Default = today's `fetch('/api/plan/version?v=N')` and `fetch('/api/plan/versions')` verbatim. **Keep error asymmetry:** `selectBaseVersion` still `alert()`s on failure; `fetchVersions` still silent.
- **1b. VS Code diff.** Add optional `onOpenVscodeDiff?: (baseVersion: number) => Promise<{ ok?: boolean; error?: string }>` to `PlanDiffViewer`; default = today's `fetch('/api/plan/vscode-diff')`. Plannotator passes nothing → unchanged (button still works).
- **1c. CSS move.** Cut `.plan-diff-added/removed/modified/unchanged` and `.plan-diff-line-added/removed` from `editor/index.css` (L168-230) into `packages/ui/theme.css` (next to `.plan-diff-word-*`). Also move `.annotation-highlight*` (L119-157) into `theme.css` (it's required by the shared Viewer in any host — closes a latent gap). Plannotator imports `theme.css`, so it stays identical; verify no double-definition remains in `index.css`.
- **Parity guardrail:** Plannotator's plan diff renders pixel-identical (block borders, raw +/-, word-level, annotation highlights); no caller passes fetchers/onOpenVscodeDiff. Eyeball: deny→resubmit a plan, toggle diff (clean/classic/raw), annotate a diff block, VS Code button still works.

### Step 2 — Settings / config
**Files:** `packages/ui/config/configStore.ts`, `packages/ui/components/Settings.tsx`.
- **2a. Config write-back.** Add `setServerSync(fn)` (and a default = the current inline `fetch('/api/config', POST)`); `scheduleServerSync` calls the injected fn for the final POST only. **Keep the 300ms debounce, `pendingServerWrites` deepMerge batching, singleton construction, and eager cookie reads byte-identical.**
- **2b. Obsidian detect.** Add optional `onDetectObsidianVaults?: () => Promise<string[]>` to `Settings`; default = today's `fetch('/api/obsidian/vaults')`. **Keep the `useEffect` dep `[obsidian.enabled]` and the auto-select-first-vault branch verbatim.**
- **Parity guardrail:** settings still POST `/api/config` with identical batching/timing; vault auto-select still fires on enable. No caller overrides. Eyeball: change a setting → it persists; enable Obsidian → vaults detected + first auto-selected.

### Step 3 — Sharing / export / notes
**Files:** `packages/ui/components/ExportModal.tsx`.
- Add optional `onSaveToNotes?: (payload) => Promise<{ results?: Record<string,{success?:boolean;error?:string}> }>` (match today's response shape); default = today's `fetch('/api/save-notes')`. **Keep `showNotesTab = isApiMode && !!markdown` (L83) byte-for-byte** — do not re-base on the new prop.
- (sharing.ts/useSharing/ImportModal/notes-app utils confirmed noop.)
- **Parity guardrail:** notes tab visibility unchanged; save returns identical `{success, error}`. Eyeball: Export → Notes tab shows when expected → save to Obsidian works.

### Step 4 — Ask AI (riskiest, last)
**Files:** `packages/ui/hooks/useAIChat.ts`.
- Add an `AITransport` (session/query/abort/permission) + module-level default reproducing today's five `/api/ai/*` fetches verbatim. Route the fetch calls through it.
- **DO NOT TOUCH:** the SSE reader loop (L233-304), the epoch/createRequest guards (refs L109-110; checks L152/L208; resets L376-390), and the supersede-abort fetch **inside `createSession` immediately after the epoch check** (L153-158). Only the wire is parametrized.
- **Stays host-owned:** `/api/ai/capabilities` and `resolveAIProviderSelection`/cookie `aiConfig` (already in App.tsx — do not pull into the lib).
- **Parity guardrail:** identical AI traffic; streaming, permissions, abort, and session-supersede all behave as today. No caller overrides. Eyeball: ask the AI a question (streams), trigger a permission, switch questions mid-stream (supersede), abort.

## Definition of done (Phase 6)
- The five seams are host-overridable, each defaulting to today's behavior; the diff CSS lives in the package.
- Plannotator byte-unchanged: full `bun test` ≥ baseline (1620/0); typecheck; builds; `App.tsx` changes minimal/empty (ideally zero — module-level/optional-prop defaults).
- Eyeball: plan diff (all modes + vscode + annotate), settings persist + obsidian detect, save-to-notes, AI chat (stream/permission/abort/supersede).
- The five Plannotator-only pieces remain host-owned (untouched).

## Per-step parity guardrail (run after each)
`bun run typecheck` · `bun test` ≥ 1620/0 (+ touched suite green) · `bun run --cwd apps/review build && bun run build:hook` · `git diff packages/editor/App.tsx` minimal/empty · the step's manual eyeball.

## Open questions (resolve in ADR)
1. CSS: move `.plan-diff-*` + `.annotation-highlight` into `theme.css` (recommended) vs. document-as-contract.
2. Confirm the five Plannotator-only exclusions (recommended).
3. Per-seam commits (recommended) vs. one PR.
4. usePlanDiff seam shape: extra hook arg vs. module-level setter (lean: optional arg for the fetchers since usePlanDiff already takes args; module-level setters elsewhere).
