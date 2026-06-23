# Spike: Carve `@plannotator/core` and Publish (Phase 7)

Date: 2026-06-23

> Code research for Phase 7 of the `@plannotator/ui` reuse effort (ADR 004). Three probes mapped: (1) exact `@plannotator/core` membership, (2) the import blast radius + zero-churn mechanism, (3) publish toolchain. Decision context: **no copying / no duplication** — carve a single browser-safe package everyone shares. THE LAW: Plannotator stays unchanged.

## The shape

`@plannotator/ui` can't be published while it depends on the private `@plannotator/shared` and `@plannotator/ai`. The chosen fix: **move the browser-safe slice into a new published `@plannotator/core`; `@plannotator/shared` re-exports from it (so Plannotator's 99 import sites don't change); publish `core` + `ui`.** One copy of everything.

## 1. What goes in `@plannotator/core`

The UI references 21 distinct `@plannotator/shared` subpaths (value + type-only). They split three ways:

**A. Pure modules — move wholesale into core (no node, no npm deps, no cross-deps):**
`code-file`, `agents`, `agent-jobs`, `compress`, `crypto`, `external-annotation`, `extract-code-paths` (→ imports `./code-file`, also moves), `favicon`, `feedback-templates`, `goal-setup`, `browser-paths`, `project`, `agent-terminal`, `open-in-apps`, `source-save`. (~15 files.) All verified browser-safe (the apps already bundle them for the browser today).

**B. Node-bound modules the UI imports TYPES from — extract the types into core (the elegant no-duplication move):**
`config.ts` (node:fs/os/child_process), `storage.ts` (node:fs), `workspace-status.ts` (node:child_process). The UI imports only types from these (`DiffLineBgIntensity`, `DefaultDiffType`, `ArchivedPlan`, `WorkspaceFileChange`, `WorkspaceStatusPayload`). **Do NOT move these files** (they'd drag node into a browser package). Instead: **extract their type definitions into `core` (e.g. `core/config-types.ts`), and have `shared/config.ts` import those types back from core** + keep its node implementation. Result: the types live **once** (in core), the node code stays in shared, no duplication.

**C. `AIContext` from `@plannotator/ai`** — a pure type union (verified node-free). Re-export it from `core` (e.g. `core/ai-context.ts`) so `ui` imports `@plannotator/core` instead of `@plannotator/ai`.

**Nuance to verify at implementation:** `shared/types.ts` re-exports from `review-core.ts` / `review-workspace.ts`, which have value-level `node:path` imports. Confirm whether the UI's `@plannotator/shared/types` actually surfaces any of those review types to ui; if so, extract just those types (same technique as B). If not, `core/types.ts` re-exports only the browser-safe set.

**Proposed core size:** ~15 pure files moved + ~3-4 extracted type files + an `index.ts` barrel + `ai-context.ts`. All source-only, browser-safe, **zero npm/node dependencies.**

## 2. Blast radius + zero-churn mechanism

- **99 import sites** across the repo reference these modules: packages/ui (36), packages/server (34), editor (11), review-editor (11), apps/hook (4), opencode (3). Heaviest: `agents` (17), `config` (10), `source-save` (9), `agent-terminal` (8), `types` (8).
- **Re-export shim = zero churn (the key finding):** for each moved module, leave a one-line shim in `shared` — `export * from '@plannotator/core/code-file'`. All 99 sites keep working unchanged; `shared`'s `exports` map stays as-is; works for both `import {}` and `import type`. **Plannotator's server/editor/review-editor/apps need no edits.** (For the type-extracted node modules, `shared/config.ts` etc. import their types from core and re-export — same effect.)
- **Pi-extension `vendor.sh`** copies ~47 shared files at build; with shims it vendors the shim files unchanged → **no vendor.sh change needed.**
- **No tsconfig/build globs** reference `packages/shared/*` — all imports are explicit subpaths. Minimal tooling impact.
- **`wideMode.ts` move** (Phase-7 leftover): `packages/editor/wideMode.ts` → `packages/ui/utils/wideMode.ts`; only 2 import sites (App.tsx + its test); ui doesn't import editor, no cycle. Ultra-low risk.

## 3. Publish toolchain

- **Monorepo:** Bun, `workspaces: ["apps/*","packages/*"]`, public npm. Release is tag-triggered CI (`.github/workflows/release.yml`); today it publishes only `@plannotator/opencode` + `@plannotator/pi-extension` via `bun pm pack` + `npm publish --provenance --access public`. **No ui/core/shared publish job exists yet.**
- **workspace:* resolution:** bun replaces `workspace:*` with the real version at pack time. Blocker today: `@plannotator/ai` + `@plannotator/shared` are `private:true` v0.0.1. After the carve, `ui` depends on `@plannotator/core` (published) — `shared`/`ai` stay private (ui no longer needs them directly once `core` covers its imports, **except** any remaining `import type` from shared that we must route through core).
- **Source-only model:** `ui` (and `core`) ship raw `.ts/.tsx` — no build/dist. An external TS consumer (Workspaces) must set: `moduleResolution: "bundler"`, `allowImportingTsExtensions`, `isolatedModules`, `jsx: "react-jsx"`, React 19 + Tailwind v4 (`@tailwindcss/vite`), and a Tailwind `@source` glob over `node_modules/@plannotator/ui/**/*.tsx`, plus import `@plannotator/ui/theme`. This works (no build needed) but must be documented for the consumer.
- **`ui` packaging after Phase 1:** peerDeps, dompurify, files allowlist all done. Remaining: the workspace-dep blocker (solved by `core`), a real version, and a CI publish job.

## Open decisions (for the ADR)
1. **Registry:** public npm (matches existing opencode/pi-extension, simplest) vs private/scoped (if `ui`/`core` should be Workspaces-only). 
2. **Versions:** keep 0.0.1 vs assign real (e.g. 0.1.0). `core` + `ui` likely version together.
3. **CI:** add a publish job for `core` + `ui` to `release.yml`, or publish manually the first time.
4. **`@plannotator/ai`:** since the UI only needs the `AIContext` type and `core` re-exports it, `ai` can **stay private/unpublished** — confirm the UI has no other `@plannotator/ai` value import.

## Per-area summary
| Area | Finding |
|---|---|
| Core membership | ~15 pure files move; 3-4 node-bound modules contribute extracted types; AIContext re-exported. Zero node/npm in core. |
| Churn | Re-export shims in `shared` → 0 changes to Plannotator's 99 sites; vendor.sh unaffected. |
| Publish | Bun + public npm, tag-triggered CI; need a new publish job; source-only ships, consumer needs documented tsconfig/Tailwind. |
| Decisions | registry, versions, CI job, ai-stays-private. |
