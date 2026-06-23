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

## Decisions locked (post-interrogation, 2026-06-23)
- **Ship TS source for the JS, NOT a compiled build.** Rationale: the only consumer (Workspaces) is internal and on a controlled stack (Vite/Cloudflare). A `tsup`/lib build exists only to insulate unknown/arbitrary-toolchain consumers — that insulation buys ~nothing here, and shipping source avoids a build pipeline to maintain and avoids a `dist` artifact that can drift from what Plannotator actually runs. Door stays open: add a build later if/when an external consumer appears. (Contested in review — one reviewer assumed a public lib; this is the deliberate call for the internal case.)
- **Precompiled CSS is REQUIRED, not optional** (Step 6). Even internally, the `@source` glob into `node_modules/@plannotator/ui/**/*.tsx` is fragile (pnpm symlinks break it) and a per-build perf cost. Ship the stylesheet.
- **`@plannotator/core` gets a node-free CI typecheck** (Step 1) so a stray `node:*` import fails the build — turns "confirm node-free by hand" into an enforced invariant.
- **Pin `@plannotator/ui` → `@plannotator/core` to an EXACT version** (not a range) during 0.x, so a consumer can't end up with mismatched copies (and silently diverge the annotation serializers).

## Step 6 — Precompiled CSS bundle (REQUIRED)
Tailwind-utility components force the consumer to either scan our source (`@source`) or get a ready-made stylesheet. Ship the stylesheet — the `@source` route is fragile (pnpm symlinks) and costs every consumer build time.
- Add a CSS-only build that emits a single precompiled `@plannotator/ui/styles.css` (theme tokens + the component utility classes). This is a CSS pipeline only — the JS still ships as source (per the decision above).
- Keep the `@source` glob documented as the fallback for a consumer who wants to scan source, but the stylesheet is the supported default.
- **Verify:** the precompiled CSS renders Plannotator-identical visuals in a bare consumer; Plannotator's own build/styling untouched.

## Step 7 — Publish (OUTWARD-FACING — confirm first)
- JS ships as **source** (no build); CSS ships **precompiled** (Step 6). `core` + `ui` `exports` stay source-only for `.ts`/`.tsx`, plus the `styles.css` entry.
- Decide registry (recommend **public npm**, matching existing flow), versions (recommend **0.1.0**, core+ui together), with `ui`→`core` pinned **exact**.
- Write/READMEs documenting consumer requirements: `moduleResolution: bundler`, `allowImportingTsExtensions`, `isolatedModules`, `jsx: react-jsx`, React 19, and **import `@plannotator/ui/styles.css`** (the `@source` glob is the documented fallback, not the default).
- Add a publish job to `.github/workflows/release.yml` for `core` + `ui` (or publish manually the first time: `bun pm pack` each, `npm publish *.tgz --access public`). bun resolves `workspace:*` → real versions at pack time.
- **Do not run the publish until the user explicitly approves** the registry + version + go.

## Carried-over review fixes (do before publish; NOT Phase-7 architecture)
These are small bugs/gaps the interrogation found in already-committed Phase-5 code. None affect Plannotator (override-path only); fix before a real consumer wires the seams:
1. **`useExternalAnnotations` split-transport** — the effect captures `transport` at mount for subscribe/poll, but the CRUD callbacks read the module global live → reads and writes can hit different backends if the transport is set after mount. Read consistently in both paths. (Check `useFileBrowser` for the same shape.)
2. **`useExternalAnnotations` `fallbackRef`/`receivedSnapshotRef` not reset on effect re-run** — if `enabled` toggles false→true (Workspaces auth/loading), the hook silently stops updating. Reset both at the top of the effect.
3. **Override path untested** — add one small test per seam that calls `setX(fake)`, drives the hook/component, asserts the contract, then `resetX()`. Makes the dead `reset*()` functions live and pins the subtle contracts (draft generation, SSE fallback).
4. **(in scope — Workspaces needs it)** Complete the settings provider: `setStorageBackend` only redirects setting *writes*; the initial *load* runs against cookies at module-init. Workspaces uses the same UI settings stored in its own backend → add `loadFromBackend()`. Model: **prefetch + synchronous backend** (host fetches settings → installs a sync backend serving from that data → calls `loadFromBackend()`); no async plumbing in `configStore`; Plannotator's eager cookie default unchanged (never calls it).

## Definition of done (Phase 7)
- `@plannotator/core` exists, browser-safe, zero deps; the universal slice lives there once; **CI typechecks it node-free** (no `@types/node`).
- `@plannotator/shared` re-exports from core; Plannotator byte-unchanged (full `bun test` 1620/0, typecheck, builds, shipped-bundle hashes identical; `git diff` limited to core/shared/ui/editor packaging + import re-points).
- `@plannotator/ui` depends only on `@plannotator/core` internally, **pinned exact**; JS ships as source; installs standalone (with `core`).
- `wideMode.ts` relocated.
- **`configurePlannotatorUI()` exists** as the single typed front door over the 9 global setters; Plannotator unchanged (never calls it).
- **Precompiled CSS (`@plannotator/ui/styles.css`) shipped** (required).
- The carried-over review fixes (split-transport, fallbackRef reset, per-seam override tests) are done.
- Consumer requirements documented; publish job ready.
- (On explicit go) `core` + `ui` published; Workspaces can `npm install @plannotator/ui @plannotator/core`, call `configurePlannotatorUI({...})` once, import `@plannotator/ui/styles.css`, and build.

## Parity guardrail (run after the carve, before publish)
`bun run typecheck` · `bun test` 1620/0 · `bun run --cwd apps/review build && bun run build:hook && bun run build:opencode` · shipped-bundle hashes vs the Phase-0 baseline (should be identical) · `git diff` confined to the expected packages · Pi `vendor.sh`/typecheck still green.

## Decided (locked in ADR 007)
- **Registry: public npm.**
- **Versions: lockstep at repo version `0.21.0`; `ui`→`core` pinned exact.**
- **JS ships as source, not a build** (single internal consumer on a controlled stack).
- **Precompiled CSS required.**
- **`core` CI typecheck node-free.**
- **`@plannotator/ai` stays unpublished-to-npm** (`private:true`; UI doesn't need it — only `AIContext`, re-exported via `core`).
- **Settings provider completed** (`loadFromBackend()`, prefetch+sync) — in scope.
- **CI publish job wired**, but **validate artifacts on the branch first** (`bun pm pack` + inspect + `npm publish --dry-run`) before merge; first real publish gated on explicit go.

## Still to verify at implementation
- `review-core`/`review-workspace` type handling (whether `ui`'s `@plannotator/shared/types` surfaces any node-bound review types → extract if so).
5. In-scope or not: `configStore.loadFromBackend()` (only if Workspaces wants its own settings persistence).
