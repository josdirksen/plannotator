# Synthesis: Phase 6 Extras

Date: 2026-06-23

> Synthesizes `SPIKE-document-ui-extras-system-20260623-100827.md` against the verified plan and ADR 004. Settles Phase 6's shape.

## The shape

Phase 6 follows the now-proven pattern: a handful of module-level/prop seams, each defaulting to today's behavior. The research confirms most of these four subsystems is **already portable** (pure utils, prop-driven components, parameterized sharing). The real work is **five seams + one CSS move**, and a clear list of **Plannotator-only pieces that simply stay home**.

## What we will do

### 1. Versions / diff (do first — highest value, has the CSS wrinkle)
- Inject optional version fetchers into `usePlanDiff` (default → `/api/plan/version(s)`), keeping the alert/silent error asymmetry verbatim.
- Optional `onOpenVscodeDiff?` on `PlanDiffViewer` (default → `/api/plan/vscode-diff`).
- **CSS move:** relocate the block-level/raw diff classes (`.plan-diff-added/removed/modified/unchanged`, `.plan-diff-line-*`) from `packages/editor/index.css` into `packages/ui/theme.css`, co-located with the existing `.plan-diff-word-*`. Plannotator imports `theme.css`, so it stays byte-identical; the diff components become reusable without app-shell CSS. (Verify Plannotator's build doesn't double-define / drops the index.css copies.)

### 2. Settings / config
- `configStore.setServerSync(fn)` injecting only the final `/api/config` POST; keep singleton, eager cookie reads, 300ms debounce, and `deepMerge` verbatim.
- Optional `onDetectObsidianVaults?` on `Settings`; keep the `[obsidian.enabled]` effect dep and auto-select-first-vault verbatim.
- (Storage + identity already swappable; `settings.ts` pure — nothing to do there.)

### 3. Sharing / export / notes
- Optional `onSaveToNotes?` on `ExportModal`; keep `showNotesTab = isApiMode && !!markdown` verbatim.
- (Sharing utils + `useSharing` + `ImportModal` + the notes-app helpers are already portable — confirm noop.)

### 4. Ask AI (last, riskiest)
- Inject an `AITransport` (session/query/abort/permission) into `useAIChat`, default = today's five fetches. **Leave the SSE reader loop, epoch/createRequest guards, and the supersede-abort position untouched in the hook.** Capabilities fetch and provider resolution stay host-owned (they already live in App.tsx).

## What we will NOT do (Plannotator-only — they stay home)
`OpenInAppButton` (local CLI), `HooksTab` (plan-mode hooks), `useUpdateCheck` (hardcoded github release check), `useAgents`/`useAgentJobs` (code-review agent jobs). A reusing host doesn't import them. No work.

## Risk read & ordering
- **Versions/diff** — low logic risk; the CSS move is the only non-trivial bit (verify Plannotator's diff still renders identically after relocating the classes). Do first.
- **Settings** — low; mind the debounce/deepMerge (don't move them) and the obsidian effect dep.
- **Sharing** — small (one seam); rest is noop.
- **Ask AI** — the riskiest by far: a streaming state machine. Treat exactly like the Phase-5 external transport — wrap only the wire, copy nothing, leave the reader loop and epoch guards verbatim. Do last, eyeball the AI panel end-to-end.

## Open decisions for the spec/ADR
1. **CSS move vs. document-as-contract.** Recommend **move** (`.plan-diff-*` into `theme.css`) — it's a pure relocation that keeps Plannotator identical and makes the diff truly reusable. The broader `.annotation-highlight` CSS (used by the Viewer everywhere) is a related contract; recommend moving it into `theme.css` too in the same pass, since it's required by the already-shipped Viewer in any host (closes a latent gap from Phases 3/5). Confirm in spec.
2. **Scope confirmation:** agree the five Plannotator-only pieces are out (recommended).
3. **One PR or per-seam commits:** recommend per-seam verify-gated commits (versions → settings → sharing → AI), like Phase 5.

## References
- Spike: `adr/research/SPIKE-document-ui-extras-system-20260623-100827.md`
- Verified plan (Phase 6 / steps 6-8,12): `adr/specs/document-ui-extraction-plan-verified-20260622-184500.md`
- Decision: `adr/decisions/004-reuse-document-ui-as-published-building-blocks-20260622-180637.md`
