# 007. Carve `@plannotator/core`, complete the settings provider, and publish `core` + `ui`

Date: 2026-06-23

## Status

Accepted

## Context

Phases 0–6 (ADRs 004–006) made Plannotator's document UI (`packages/ui` = `@plannotator/ui`) host-overridable through optional seams that default to today's behavior, with Plannotator verified byte-for-byte unchanged. The remaining work (Phase 7) is to make `@plannotator/ui` actually installable by a separate consumer (the commercial "Workspaces"/Enterprise app) and publish it.

Two facts force the shape of this phase:

1. **`@plannotator/ui` can't be published as-is.** It depends on `@plannotator/shared` and `@plannotator/ai`, both unpublished workspace packages. `@plannotator/shared` is a Node/git/server kitchen sink we don't want on npm. An external installer must resolve every dependency from the registry, so the dependency tail has to be dealt with — without copying (the user's hard requirement: single source of truth, no duplication).

2. **Workspaces will use the same UI settings, stored in its own backend.** The storage seam (`setStorageBackend`, Phase 2) already redirects setting *writes*. But the initial settings *load* runs against cookies at module-init, before a host can install its backend — so Workspaces' saved settings wouldn't load. The settings provider is half-built.

An adversarial multi-model review (the `interrogate` pass) confirmed Phases 0–6 are sound and proportionate, found no Plannotator-affecting issues, and surfaced a small set of override-path fixes plus publish-toolchain decisions. The one contested decision (ship TS source vs. a compiled build) was resolved deliberately for the internal-consumer case.

Supporting docs: `adr/research/SPIKE-publish-core-package-20260623-125551.md`, `adr/research/synthesis-publish-core-package-20260623-125551.md`, `adr/specs/publish-core-package-20260623-125551.md`.

## Decision

**1. Carve a new browser-safe `@plannotator/core` package (single source of truth).**
- Move the ~15 pure browser-safe modules the UI uses out of `@plannotator/shared` into `@plannotator/core` (`code-file`, `extract-code-paths`, `agents`, `agent-jobs`, `compress`, `crypto`, `external-annotation`, `favicon`, `feedback-templates`, `goal-setup`, `browser-paths`, `project`, `agent-terminal`, `open-in-apps`, `source-save`).
- For the node-bound modules the UI imports only *types* from (`config`, `storage`, `workspace-status`, and any review types `ui` surfaces): extract the type definitions into `core`; the Node implementation stays in `shared` and imports its types back from `core`. Types live once; nothing is duplicated.
- Re-export `AIContext` from `core` so `ui` no longer imports `@plannotator/ai`.
- `@plannotator/shared` re-exports each moved module via one-line shims, so all ~99 internal import sites and the Pi `vendor.sh` step keep working unchanged. Plannotator stays untouched.
- `core` is source-only, browser-safe, zero npm/node deps. **CI typechecks `core` with no `@types/node`** so a stray `node:*` import fails the build.

**2. Complete the settings provider (in scope — Workspaces needs it).**
- Add a `loadFromBackend()` path so the initial settings load routes through the installed `StorageBackend`, not only cookies.
- Use the **prefetch + synchronous backend** model: a host fetches its settings, installs a sync backend that serves from that prefetched data, then calls `loadFromBackend()`. No async plumbing inside `configStore`; Plannotator's eager cookie default is unchanged (it never calls `loadFromBackend()`).

**3. Single configuration front door.**
- Add `configurePlannotatorUI(config)`: one typed call that fans out to the 9 global host-override setters (image, storage, doc-preview, file-tree, identity, draft, external-annotations, AI, config-sync) plus the settings load. Render-time prop seams stay as props. A `<PlannotatorUIProvider>` (React context) is the documented later upgrade if per-instance/SSR config is ever needed.

**4. Ship TS source for JS; ship precompiled CSS.**
- Publish `core` + `ui` as TS source (no compiled build). Rationale: the only consumer is internal on a controlled stack (Vite/Cloudflare); a build exists to insulate unknown toolchains and buys ~nothing here, while avoiding a build pipeline and a `dist` artifact that can drift from what Plannotator runs. Revisit only if an external/arbitrary-stack consumer appears.
- Ship a **required** precompiled `@plannotator/ui/styles.css` (CSS-only build). The Tailwind `@source` glob into `node_modules` is fragile (pnpm symlinks) and a per-build cost; the stylesheet is the supported default, `@source` the documented fallback.

**5. Publishing.**
- **Public npm** (open-source project; matches the existing `@plannotator/opencode` / `@plannotator/pi-extension` flow).
- **Lockstep versioning at the repo version (`0.21.0`)**, consistent with the other published packages; `core` + `ui` move together; `ui` → `core` pinned **exact**.
- `@plannotator/ai` stays unpublished-to-npm (npm `private: true`); the UI doesn't need it. (This is an npm-registry flag only — the code stays open on GitHub like everything else.)
- **Wire a CI publish job** for `core` + `ui` in `release.yml`. Before merging to main, **validate the artifacts on the branch**: `bun pm pack` each, inspect the tarball, and `npm publish --dry-run`. The first real publish goes out only on explicit go.

**6. Pre-publish fixes (override-path only; none affect Plannotator), from the interrogation:**
- Fix `useExternalAnnotations` split-transport (reads/writes can hit different backends if the transport is set after mount); check `useFileBrowser` for the same shape.
- Reset `fallbackRef`/`receivedSnapshotRef` on effect re-run so a `false→true` `enabled` toggle doesn't silently stop updates.
- Add one override test per seam (`setX(fake)` → drive → assert → `resetX()`), which also makes the `reset*()` functions live.

## Consequences

- `@plannotator/ui` becomes installable: a consumer runs `npm install @plannotator/ui @plannotator/core`, calls `configurePlannotatorUI({...})` once, imports `@plannotator/ui/styles.css`, and builds — with the same UI settings persisted through its own backend.
- One copy of every shared module/type remains; `@plannotator/shared` and `@plannotator/ai` stay private to the monorepo. Plannotator's server, apps, editor, review-editor, and Pi build are unchanged.
- The carve + provider completion + fixes are all reversible and keep Plannotator byte-for-byte identical (parity gate: `bun test` 1620/0, typecheck, byte-identical shipped bundles, `git diff` confined to `core`/`shared`/`ui`/`editor`). The publish is the one outward-facing, hard-to-undo step and is gated on explicit approval after branch-validation.
- Shipping source couples consumers to a documented tsconfig/bundler setup; acceptable for the internal consumer, and the door to a compiled build stays open.
- New maintenance surface: a small published `@plannotator/core`, a CSS-only build, exact-version coupling between `core` and `ui`, and a node-free CI check on `core`.

## References
- Spec: `adr/specs/publish-core-package-20260623-125551.md`
- Synthesis: `adr/research/synthesis-publish-core-package-20260623-125551.md`
- Spike: `adr/research/SPIKE-publish-core-package-20260623-125551.md`
- Governing decision: `adr/decisions/004-reuse-document-ui-as-published-building-blocks-20260622-180637.md`
