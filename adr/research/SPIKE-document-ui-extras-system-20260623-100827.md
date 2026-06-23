# Spike: Phase 6 Extras — Versions/Diff, Settings, Sharing/Export, Ask AI

Date: 2026-06-23

> Code research for Phase 6 of the `@plannotator/ui` reuse effort (ADR 004; roadmap `adr/implementation/document-ui-extraction-roadmap-20260622.md`). Five parallel probes mapped the four extra subsystems. THE LAW: move + decouple, never rewrite; Plannotator's experience cannot change.

## Headline

Phase 6 is **mostly already portable** — the same pattern as the sidebar/comment-UI noops. The actual work is a small set of seams plus **one CSS wrinkle** (block-level diff styles live in the app shell, not the package). The fragile pieces are narrow: the AI streaming reader loop (do-not-touch) and the configStore write-back batching (keep verbatim).

## Subsystem 1 — Versions / plan diff

**Files:** `packages/ui/hooks/usePlanDiff.ts`, `utils/planDiffEngine.ts`, `components/plan-diff/*`. CSS: `packages/editor/index.css` + `packages/ui/theme.css`.

- **Seam A — version fetchers:** `usePlanDiff` hard-codes `fetch('/api/plan/version?v=N')` (L98) and `fetch('/api/plan/versions')` (L119). Inject optional fetchers, default = today's literals. **Keep error asymmetry verbatim:** `selectBaseVersion` `alert()`s on failure (L100, L107); `fetchVersions` is silent (L127-131).
- **Seam B — VS Code diff:** `PlanDiffViewer.tsx` POSTs `/api/plan/vscode-diff` (L65). Optional `onOpenVscodeDiff?` prop; default = today's fetch (or omit the button when not provided).
- **Already portable:** `planDiffEngine.ts` (pure `computePlanDiff`/`computeInlineDiff`), `PlanDiffBadge`, `PlanCleanDiffView`, `PlanRawDiffView`, `PlanDiffModeSwitcher` — all prop-driven.
- **THE CSS WRINKLE (confirmed):** the *word-level* classes `.plan-diff-word-*` live in the package (`theme.css` L451-480), but the *block-level* and *raw* diff classes — `.plan-diff-added/removed/modified/unchanged` (`editor/index.css` L168-211) and `.plan-diff-line-added/removed` (L213-230) — live in the **app shell**, not the package. Also `.annotation-highlight*` (L119-157) lives in the app shell (used by the regular Viewer too, so this is broader than diff). Without these, a host's diff renders unstyled (no borders/backgrounds → unreadable). Fix: move the `.plan-diff-*` block/raw classes into `packages/ui/theme.css` (co-located with `.plan-diff-word-*`); Plannotator imports `theme.css` so it stays identical. `.annotation-highlight` is a broader CSS-contract item (Viewer needs it in any host).

## Subsystem 2 — Settings / config

**Files:** `packages/ui/config/configStore.ts`, `config/settings.ts`, `components/Settings.tsx`, `components/settings/HooksTab.tsx`.

- **Seam A — config write-back:** `configStore.scheduleServerSync` POSTs `/api/config` (L118) after a 300ms debounce with `deepMerge` batching. Inject **only the final fetch** via `setServerSync(fn)`; **keep singleton construction, eager cookie reads (constructor L44-59), the 300ms debounce, and `deepMerge` byte-identical** — a naive per-`set()` fetch breaks multi-setting batching.
- **Seam B — obsidian vault detect:** `Settings.tsx` `fetch('/api/obsidian/vaults')` (L745-760). Optional `onDetectObsidianVaults?`; **keep the `useEffect [obsidian.enabled]` dep and the auto-select-first-vault branch verbatim** (changing the dep re-triggers or kills auto-select).
- **Already host-controllable:** cookie storage is swappable (Phase 2 `setStorageBackend`, literal `plannotator-*` keys); identity is swappable (Phase 5 `setIdentityProvider`); `settings.ts` is pure (no fetch); server identity seeded via `configStore.init(serverConfig)`.
- **PLANNOTATOR-ONLY (out of scope):** `HooksTab.tsx` (`/api/hooks/status`, `/api/config` pfmReminder) — mounted only `mode==='plan'`, never exported to hosts.

## Subsystem 3 — Sharing / export / notes

**Files:** `components/ExportModal.tsx`, `utils/sharing.ts`, `hooks/useSharing.ts`, `components/ImportModal.tsx`, `components/OpenInAppButton.tsx`, `utils/{obsidian,bear,octarine,callback,defaultNotesApp}.ts`.

- **Seam — save to notes:** `ExportModal.tsx` `fetch('/api/save-notes')` (L150). Optional `onSaveToNotes?` returning `{success, error}`; **keep `showNotesTab = isApiMode && !!markdown` (L83) byte-for-byte** — do not re-base the gate on the new prop.
- **Already portable:** `sharing.ts` is fully parameterized (`shareBaseUrl`/`pasteApiUrl` params, defaults to Plannotator URLs); `useSharing` is prop-driven; `ImportModal` is callback-driven (`onImport`); `obsidian/bear/octarine/callback/defaultNotesApp` are pure storage/format helpers. The `/p/<id>` short-URL routing in `useSharing` is Plannotator's convention but is `pasteApiUrl`-injectable.
- **PLANNOTATOR-ONLY (out of scope):** `OpenInAppButton.tsx` (`/api/open-in`, `/api/open-in/apps`, local-CLI file opening) — host-only, stub/omit for other hosts.

## Subsystem 4 — Ask AI (riskiest)

**Files:** `packages/ui/hooks/useAIChat.ts`, `components/ai/*`, `utils/aiProvider.ts`, `utils/aiChatFormat.ts`.

- **Seam — AI transport:** five `/api/ai/*` fetches in `useAIChat`: `/api/ai/session` (L134), `/api/ai/query` (L213), `/api/ai/abort` (L153 supersede + L350 standalone), `/api/ai/permission` (L365). Inject an `AITransport` (session/query/abort/permission), default = today's fetches.
- **DO NOT TOUCH (verbatim, stays in hook):** the **SSE reader loop** (L233-304 — buffers partial lines, dispatches `text_delta|text|permission_request|error|result`, mutates React state per message); the **epoch/createRequest guards** (refs L109-110; checks L152, L208; resets L376-390); the **supersede-abort fetch position** (L153-158 — must stay inside `createSession` immediately after the epoch check, or the orphaned session leaks). Only the *transport* (the fetch calls) is parametrized; the streaming consumption is not.
- **HOST-OWNED (stays in App.tsx, not the lib):** `/api/ai/capabilities` (only called by App.tsx — editor L2261, review L499); `resolveAIProviderSelection` + cookie `aiConfig` init (`aiProvider.ts`, read by App.tsx). The hook never reads cookies or calls capabilities.
- **Already portable:** `DocumentAIChatPanel`, `AIProviderBar` (fully prop-driven); `aiProvider.ts`, `aiChatFormat.ts` (pure).
- **Existing reuse:** `review-editor` already reuses `useAIChat` via a thin patch-wrapper (`review-editor/hooks/useAIChat.ts` → `context: {mode:'code-review', review:{patch}}`).

## Explicitly OUT of Phase 6 scope (Plannotator-only / different feature)
- `OpenInAppButton` (local CLI), `HooksTab` (plan-mode hooks), `useUpdateCheck` (hardcoded github.com/backnotprop release check — no seam), `useAgents`/`useAgentJobs` (code-review agent jobs — a review-editor feature, not document-UI). These stay host-owned; a reusing host simply doesn't mount them.

## Per-seam summary
| Subsystem | Seam | Wire | Verbatim-keep |
|---|---|---|---|
| Versions | usePlanDiff fetchers + PlanDiffViewer vscode | `/api/plan/version(s)`, `/api/plan/vscode-diff` | alert/silent error asymmetry; + move block/raw diff CSS into the package |
| Settings | configStore `setServerSync`; Settings obsidian-detect | `/api/config`, `/api/obsidian/vaults` | 300ms debounce + deepMerge + constructor; `[obsidian.enabled]` dep + auto-select |
| Sharing | ExportModal `onSaveToNotes` | `/api/save-notes` | `showNotesTab` gate (L83) |
| Ask AI | useAIChat `AITransport` | 5× `/api/ai/*` | SSE reader loop, epoch guards, supersede-abort position; capabilities/provider-resolution stay host |
