# Synthesis: Carve `@plannotator/core` and Publish (Phase 7)

Date: 2026-06-23

> Synthesizes `SPIKE-publish-core-package-20260623-125551.md` against ADR 004 and the user decision: **no copying / single source of truth.** Settles Phase 7's shape.

## The decision in one line

Carve a new browser-safe **`@plannotator/core`** package, move the universal slice into it (extracting just the *types* from node-bound modules so nothing duplicates), make `@plannotator/shared` re-export from it so Plannotator is untouched, then publish `core` + `ui`. `@plannotator/shared` and `@plannotator/ai` stay private.

## Why this shape

- **No duplication:** every file/type has exactly one home. Pure modules live in `core`; node-bound *implementations* stay in `shared` but import their *types* from `core`. Today's clean one-copy state is preserved.
- **Plannotator unchanged:** re-export shims in `shared` mean all 99 internal import sites keep working with zero edits. Plannotator's server, editor, review-editor, apps, and the Pi vendor step are untouched.
- **Minimal published surface:** `core` is small, browser-safe, zero-dependency — not the Node/git/PR kitchen sink. Workspaces installs `ui` + `core` and nothing it doesn't run.
- **Naming is honest:** `core` = the universal foundation (runs anywhere), distinct from `ui` (components) and `shared` (the Node/server grab-bag). No `shared`/`ui` stutter.

## The plan

1. **Create `packages/core`** — source-only, browser-safe, zero npm/node deps. Move the ~15 pure modules in. Add extracted type files for the 3-4 node-bound modules (`config`, `storage`, `workspace-status`, and any review types `ui` surfaces). Re-export `AIContext`. Add an `index.ts` barrel and a fine-grained `exports` map (mirroring `ui`'s source-only pattern).
2. **Re-point `@plannotator/shared`** — each moved pure module becomes a one-line shim (`export * from '@plannotator/core/X'`); each node-bound module imports its types from `core` and keeps its node implementation. `shared`'s `exports` map and `private:true` stay. Plannotator's imports don't change.
3. **Re-point `@plannotator/ui`** — change `ui`'s `@plannotator/shared/X` and `@plannotator/ai` imports to `@plannotator/core/X`; replace the `workspace:* @plannotator/shared`/`@plannotator/ai` deps with `@plannotator/core` (the only published dep ui needs). Confirm no remaining `@plannotator/shared`/`@plannotator/ai` reference in ui.
4. **Move `wideMode.ts`** `editor → ui/utils` (2 import edits).
5. **Publish** `core` then `ui` (source-only) — add a CI job (or first-time manual publish), real versions, document the consumer tsconfig/Tailwind requirements in `core`/`ui` READMEs.

## Guardrails (Plannotator stays byte-for-byte unchanged)
- After steps 1-3: full `bun test` stays 1620/0, typecheck passes, all builds byte-identical, **`git diff` touches only `packages/core` (new), `packages/shared` (shims/type-imports), `packages/ui` (import re-points + package.json), and `packages/editor` (wideMode)** — no server/app behavior change.
- The shipped bundle hashes (`apps/hook/dist`, `apps/opencode-plugin`) should stay identical (the re-exports compile to the same code).
- The publish itself is the one outward-facing, hard-to-undo step — **stop and confirm with the user before pushing anything to a registry.**

## Open decisions to lock in the ADR
1. **Registry:** recommend **public npm** (matches the existing `@plannotator/opencode`/`pi-extension` flow, simplest, and `core`/`ui` contain nothing secret). Switch to a private scope only if there's a reason to keep them off the public registry.
2. **Versions:** recommend `0.1.0` for `core` + `ui`, versioned together.
3. **`@plannotator/ai` stays private** (ui only needs the `AIContext` type, re-exported via `core`) — confirm no value import.
4. **CI:** add `core` + `ui` to the `release.yml` npm-publish job (or publish manually first, automate later).

## Sequencing
Do the carve + re-point + verify first (all reversible, Plannotator-unchanged), get the green parity run, **then** make the registry/version call and publish as the final, confirmed step.

## References
- Spike: `adr/research/SPIKE-publish-core-package-20260623-125551.md`
- Governing decision: `adr/decisions/004-reuse-document-ui-as-published-building-blocks-20260622-180627.md`
