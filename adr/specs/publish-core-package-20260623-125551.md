# Spec: Carve `@plannotator/core` + Publish (Phase 7)

Date: 2026-06-23 · Status: Draft (iterate before implementing)

> Implementation spec for Phase 7. Grounded in `SPIKE-publish-core-package-20260623-125551.md` + its synthesis. Decision: single source of truth (no copying). THE LAW: Plannotator stays byte-for-byte unchanged through the carve; the publish is the one outward-facing step — confirm with the user before pushing to any registry.

## Scope
**In:** create `@plannotator/core`, move the universal slice + extract types from node-bound modules, shim `@plannotator/shared`, re-point `@plannotator/ui`, move `wideMode.ts`, add a single `configurePlannotatorUI()` front door, (optionally) ship a precompiled CSS bundle, prep + (on go-ahead) publish `core` + `ui`.
**Out / stays private:** `@plannotator/shared` (Node/git/server grab-bag) and `@plannotator/ai` (ui only needs the `AIContext` type via core).

## Step 1 — Create `packages/core`
- `packages/core/package.json`: `name @plannotator/core`, `version 0.1.0`, `type module`, source-only `exports` map (fine-grained subpaths like `ui`), `files` allowlist (`*.ts`, exclude tests), **no dependencies** (peerDeps none — it's pure JS/Web-API). tsconfig mirroring `ui` (bundler resolution, isolatedModules, allowImportingTsExtensions).
- Add `@plannotator/core` to root `workspaces` (already covered by `packages/*`).
- **Move (git mv) the ~15 pure modules** from `packages/shared` → `packages/core`: `code-file`, `extract-code-paths`, `agents`, `agent-jobs`, `compress`, `crypto`, `external-annotation`, `favicon`, `feedback-templates`, `goal-setup`, `browser-paths`, `project`, `agent-terminal`, `open-in-apps`, `source-save`. (Confirm each is node-free at move time.)
- **Extract types** from the node-bound modules into core type files: `core/config-types.ts` (DefaultDiffType, DiffLineBgIntensity, DiffOptions, …), `core/storage-types.ts` (ArchivedPlan), `core/workspace-status-types.ts` (WorkspaceFileChange, WorkspaceStatusPayload, GitRepositoryInfo). Plus any review types `ui`'s `@plannotator/shared/types` surfaces (verify `review-core`/`review-workspace` usage).
- `core/ai-context.ts`: re-export `AIContext` (move or re-export the pure type from `packages/ai/types.ts`; confirm it's node-free).
- `core/index.ts`: barrel re-export.

## Step 2 — Re-point `@plannotator/shared` (keeps Plannotator unchanged)
- For each **moved pure module**, replace its `packages/shared/X.ts` with a one-line shim: `export * from '@plannotator/core/X';`. Keep `shared`'s `exports` map and `private:true` as-is.
- For each **node-bound module** (`config`, `storage`, `workspace-status`), change its in-file type definitions to **import the types from `@plannotator/core/*-types`** and re-export them, keeping the node implementation. (Types now live once, in core.)
- Add `@plannotator/core: "workspace:*"` to `packages/shared` deps.
- **Verify:** all 99 existing `@plannotator/shared/X` import sites still resolve unchanged; Pi `vendor.sh` needs no edit (vendors the shims).

## Step 3 — Re-point `@plannotator/ui`
- Change every `ui` import of `@plannotator/shared/X` → `@plannotator/core/X`, and `import type { AIContext } from '@plannotator/ai'` → `@plannotator/core`.
- In `packages/ui/package.json`: remove the `@plannotator/shared` and `@plannotator/ai` `workspace:*` deps; add `@plannotator/core: "workspace:*"`. (After publish this becomes a real version range.)
- **Verify:** `grep @plannotator/shared` and `@plannotator/ai` in `packages/ui` (non-test) returns **zero** — ui depends only on `@plannotator/core` internally.

## Step 4 — Move `wideMode.ts`
- `git mv packages/editor/wideMode.ts packages/ui/utils/wideMode.ts` (+ its test). Update the 2 importers (`editor/App.tsx`, the test) to `@plannotator/ui/utils/wideMode`.

## Step 5 — Single config front door (`configurePlannotatorUI`)
The reuse surface currently has **9 global host-override switches** scattered across modules: `setImageSrcResolver`, `setStorageBackend`, `setDocPreviewFetcher`, `setFileTreeBackend`, `setIdentityProvider`, `setDraftTransport`, `setExternalAnnotationTransport`, `setAITransport`, and `configStore.setServerSync`. A consumer shouldn't have to discover and call each.
- Add **one new file** `packages/ui/configure.ts` exporting a typed `PlannotatorUIConfig` and `configurePlannotatorUI(config: PlannotatorUIConfig)` that fans out to those 9 setters (each field optional → only the provided ones are applied). Add to the `ui` `exports` map.
- **Zero risk / additive:** Plannotator never calls it, so nothing changes; the existing setters keep working individually. The per-component prop seams (vscode-diff, save-to-notes, obsidian-detect, version fetchers, editor `mode`, code-path toggle, `ScrollViewportProvider`) are intentionally NOT in the global front door — they're passed where the host renders those components.
- **Later (optional):** migrate the render-time seams to a `<PlannotatorUIProvider>` (React context) if Workspaces wants per-instance config / SSR. The `configure()` facade is the 80/20 now; the Provider is the door it leaves open.
- **Verify:** typecheck; a tiny test that `configurePlannotatorUI({...})` routes to each setter; Plannotator behavior unchanged (it never calls it).

## Step 6 — Precompiled CSS bundle (optional friction-reducer)
Sharing Tailwind-utility components forces the consumer to either scan our source (`@source`) or get a ready-made stylesheet. Ship the stylesheet to smooth the worst integration wrinkle.
- Add a build that emits a single precompiled CSS file for `@plannotator/ui` (theme tokens + the component utility classes), exported as e.g. `@plannotator/ui/styles.css`. The consumer imports one stylesheet instead of wiring Tailwind `@source` to ui internals.
- **Additive:** keep the `@source` glob path documented as the alternative; the source-ships-TS model is unchanged. This is the heavier of the two polish items (needs a small CSS build pipeline) — optional; the `@source` approach already works for the first Workspaces integration.
- **Verify:** the precompiled CSS renders Plannotator-identical visuals in a bare consumer; Plannotator's own build/styling untouched.

## Step 7 — Publish (OUTWARD-FACING — confirm first)
- Decide registry (recommend **public npm**, matching existing flow), versions (recommend **0.1.0**, core+ui together).
- Write/READMEs documenting the consumer requirements: `moduleResolution: bundler`, `allowImportingTsExtensions`, `isolatedModules`, `jsx: react-jsx`, React 19 + Tailwind v4 (`@tailwindcss/vite`), Tailwind `@source` over `node_modules/@plannotator/ui/**/*.tsx`, import `@plannotator/ui/theme`.
- Add a publish job to `.github/workflows/release.yml` for `core` + `ui` (or publish manually the first time: `bun pm pack` each, `npm publish *.tgz --access public`). bun resolves `workspace:*` → real versions at pack time.
- **Do not run the publish until the user explicitly approves** the registry + version + go.

## Definition of done (Phase 7)
- `@plannotator/core` exists, browser-safe, zero deps; the universal slice lives there once.
- `@plannotator/shared` re-exports from core; Plannotator byte-unchanged (full `bun test` 1620/0, typecheck, builds, shipped-bundle hashes identical; `git diff` limited to core/shared/ui/editor packaging + import re-points).
- `@plannotator/ui` depends only on `@plannotator/core` internally; installs standalone (with `core`).
- `wideMode.ts` relocated.
- **`configurePlannotatorUI()` exists** as the single typed front door over the 9 global setters; Plannotator unchanged (never calls it).
- **(Optional) precompiled CSS** shipped so a consumer can import one stylesheet instead of wiring Tailwind `@source`.
- Consumer requirements documented; publish job ready.
- (On explicit go) `core` + `ui` published; Workspaces can `npm install @plannotator/ui @plannotator/core`, call `configurePlannotatorUI({...})` once, import `@plannotator/ui/styles.css`, and build.

## Parity guardrail (run after the carve, before publish)
`bun run typecheck` · `bun test` 1620/0 · `bun run --cwd apps/review build && bun run build:hook && bun run build:opencode` · shipped-bundle hashes vs the Phase-0 baseline (should be identical) · `git diff` confined to the expected packages · Pi `vendor.sh`/typecheck still green.

## Open questions (resolve in ADR)
1. Registry: public npm (recommended) vs private scope.
2. Versions: 0.1.0 (recommended) vs other; core+ui together vs independent.
3. CI publish job now vs manual first publish.
4. Confirm `@plannotator/ai` stays private (no ui value import) and `review-core`/`review-workspace` type handling.
