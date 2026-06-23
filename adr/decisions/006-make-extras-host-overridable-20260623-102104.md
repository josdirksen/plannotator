# 006. Make Extras (Versions, Settings, Sharing, Ask AI) Host-Overridable (Phase 6)

Date: 2026-06-23

## Status

Accepted

## Context

ADR 004 set the plan: make `@plannotator/ui` reusable by Workspaces by lifting each Plannotator wire up to an optional override defaulting to today's behavior, never changing Plannotator. Phases 0–5 did this for packaging, image/storage, rendering, file tree, and comments. Phase 6 is the remaining "extras": versions/plan diff, settings/config, sharing/export/notes, and Ask AI.

Five-research probes (`adr/research/SPIKE-document-ui-extras-system-20260623-100827.md`, synthesized in `adr/research/synthesis-document-ui-extras-20260623-100827.md`) found these four subsystems are **mostly already portable** — `planDiffEngine` and all plan-diff render components, the sharing utils/`useSharing`/`ImportModal`, the notes-app helpers, `settings.ts`, the AI chat components, and `aiProvider`/`aiChatFormat` are pure or prop-driven. The actual coupling is a small set of wires, plus one CSS wrinkle: the block-level/raw plan-diff CSS lives in the app shell (`packages/editor/index.css`), not the package.

## Decision

Make the extras host-overridable through **five seams plus one CSS move**, each defaulting to today's behavior; Plannotator passes nothing and stays byte-for-byte unchanged. Land per-seam, verify-gated, lowest-risk first.

1. **Versions / diff.** Optional version fetchers on `usePlanDiff` (default → `/api/plan/version(s)`, keeping the `selectBaseVersion` alert vs `fetchVersions` silent error asymmetry verbatim) and an optional `onOpenVscodeDiff?` on `PlanDiffViewer` (default → `/api/plan/vscode-diff`). **CSS move:** relocate the block-level/raw diff classes (`.plan-diff-added/removed/modified/unchanged`, `.plan-diff-line-*`) and `.annotation-highlight*` from `editor/index.css` into `packages/ui/theme.css` (co-located with `.plan-diff-word-*`); Plannotator imports `theme.css`, so its diff and highlights render identically while the components become reusable without app-shell CSS.

2. **Settings / config.** `configStore.setServerSync(fn)` injecting only the final `/api/config` POST, keeping the singleton construction, eager cookie reads, 300ms debounce, and `deepMerge` batching byte-identical. Optional `onDetectObsidianVaults?` on `Settings`, keeping the `[obsidian.enabled]` effect dep and auto-select-first-vault verbatim.

3. **Sharing / notes.** Optional `onSaveToNotes?` on `ExportModal` (matching today's `{results:{success,error}}` shape), keeping `showNotesTab = isApiMode && !!markdown` byte-for-byte. (Sharing utils, `useSharing`, `ImportModal`, and the notes-app helpers are confirmed noop.)

4. **Ask AI (last, riskiest).** Inject an `AITransport` (session/query/abort/permission) into `useAIChat`, default = today's five `/api/ai/*` fetches. **The SSE reader loop, the epoch/createRequest guards, and the supersede-abort fetch position inside `createSession` stay untouched in the hook** — only the wire is parametrized. Capabilities fetch and provider resolution stay host-owned (already in App.tsx).

**Out of Phase 6 (Plannotator-only — they stay home, no work):** `OpenInAppButton` (local CLI), `HooksTab` (plan-mode hooks), `useUpdateCheck` (hardcoded github release check), `useAgents` and `useAgentJobs` (code-review agent jobs). A reusing host simply does not import them.

## Consequences

- Workspaces can optionally reuse version-diff review, the settings panel, save-to-notes, and the AI chat by implementing the corresponding fetchers/callbacks/transport — but none of it is required for the already-shipped core (docs, tree, editing, comments).
- Plannotator is unchanged: every seam defaults to today's literal behavior; the AI streaming state machine and configStore batching move nowhere; the CSS relocation is a pure cut-and-paste that Plannotator still imports via `theme.css`.
- The diff components (and the Viewer's annotation highlights) become self-styling from the package — closing a latent CSS-contract gap from earlier phases.
- The parity bar per seam: full `bun test` stays at baseline (1620/0), typecheck and builds pass, `packages/editor/App.tsx` changes stay minimal/empty, and an eyeball confirms the surface — plan diff (all modes + VS Code + diff annotations), settings persistence + obsidian detect, save-to-notes, and AI chat (stream / permission / abort / mid-stream supersede).
- After Phase 6, the document UI is feature-complete for reuse; the remaining work is Phase 7 (publish) and the parked `@plannotator/ai` / `@plannotator/shared` publish-vs-inline decision.

## References

- Spike: `adr/research/SPIKE-document-ui-extras-system-20260623-100827.md`
- Synthesis: `adr/research/synthesis-document-ui-extras-20260623-100827.md`
- Spec: `adr/specs/document-ui-extras-seam-20260623-100827.md`
- Governing decision: `adr/decisions/004-reuse-document-ui-as-published-building-blocks-20260622-180637.md`
