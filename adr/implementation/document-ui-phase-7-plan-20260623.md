# Phase 7 — Implementation Plan: Carve `@plannotator/core` + Publish Prep

Branch: `feat/pkg-document-ui`. Authoritative: ADR 007 + spec `publish-core-package-20260623-125551.md`.

**THE LAW (ADR 004):** Plannotator stays byte-for-byte unchanged. The carve is `git mv` + one-line
re-export shims + type extraction. Single source of truth — NO copying, NO rewriting. `packages/editor`,
`packages/server`, `packages/review-editor`, and all `apps/*` source stays untouched except the ONE
`wideMode` importer in Step 3.

**Global rules for every step:**
- Each step leaves the tree typecheck-green **for what it touched** and ends with **one local commit** (`git commit`, NO `git push`, NO publish, NO merge).
- Work on the current branch `feat/pkg-document-ui` (already a feature branch — do not branch again).
- Repo version is `0.21.0`. `@plannotator/core` ships lockstep at `0.21.0`; `ui` → `core` pinned EXACT.
- Use `git mv` for all moves so history follows. Never delete a working file until parity is human-confirmed.
- `export *` re-exports values AND types but NOT defaults; all 15 moved modules are named-export-only (confirmed). If a default is ever found, add `export { default } from '@plannotator/core/X';`.
- **Byte-for-byte type moves:** when extracting type declarations into `packages/core/*-types.ts`, copy the source bytes **verbatim** — preserve original indentation (the `workspace-status` cluster uses TAB indentation; do NOT reflow to spaces). A pure move must produce a pure move in the diff; gratuitous reformatting is forbidden because the parity gate (item 4) scrutinizes the diff.
- **Workspace registration before typecheck:** `@plannotator/core` is a BRAND-NEW workspace package. There is no `node_modules/@plannotator` symlink dir in this repo; Bun resolves workspaces through its lockfile catalog (verified: `bun pm ls` lists workspaces, `packages/server/tsconfig.json` has no `paths` map yet resolves `@plannotator/shared/*` purely via that catalog). `packages/shared/tsconfig.json` and `packages/ai/tsconfig.json` have `moduleResolution: bundler` and NO `paths` map, so they will resolve the new `@plannotator/core/*` bare specifiers ONLY after `bun install` registers core in the catalog. Therefore `bun install` is required after Step 1a (and re-run after Step 2c) before any `tsc` verification that touches the new specifiers.

---

## STEP 1 — The carve: create `@plannotator/core`, move modules, extract types, shim `shared` (CRITICAL / opus)

Goal: `packages/core` exists with the 15 pure modules + 5 extracted type files; `packages/shared` is rewired (15 one-line shims + 4 node-bound/types modules importing types back from core); `ai/types.ts` imports the `AIContext` family (including `AIContextMode`) back from core. End state: `core` typecheck (node-free) green AND `shared` typecheck green AND `ai` typecheck green AND Pi typecheck green.

### 1a. Create `packages/core/package.json` + register the workspace
New file `packages/core/package.json` (exact):
```json
{
  "name": "@plannotator/core",
  "version": "0.21.0",
  "type": "module",
  "exports": {
    "./agents": "./agents.ts",
    "./agent-jobs": "./agent-jobs.ts",
    "./agent-terminal": "./agent-terminal.ts",
    "./browser-paths": "./browser-paths.ts",
    "./code-file": "./code-file.ts",
    "./compress": "./compress.ts",
    "./crypto": "./crypto.ts",
    "./external-annotation": "./external-annotation.ts",
    "./extract-code-paths": "./extract-code-paths.ts",
    "./favicon": "./favicon.ts",
    "./feedback-templates": "./feedback-templates.ts",
    "./goal-setup": "./goal-setup.ts",
    "./open-in-apps": "./open-in-apps.ts",
    "./project": "./project.ts",
    "./source-save": "./source-save.ts",
    "./config-types": "./config-types.ts",
    "./storage-types": "./storage-types.ts",
    "./workspace-status-types": "./workspace-status-types.ts",
    "./ai-context": "./ai-context.ts",
    "./types": "./types.ts",
    ".": "./index.ts"
  },
  "files": ["**/*.ts", "!**/*.test.ts"],
  "dependencies": {},
  "devDependencies": {
    "typescript": "~5.8.2"
  }
}
```
Constraints: NO `private`, NO `peerDependencies`, NO `@types/node`, NO `@types/bun`.

**Then wire deps (1h below) and run `bun install`** so the workspace catalog registers `@plannotator/core`. This is load-bearing: without it, the Step 1k `tsc` on `shared`/`ai` cannot resolve the new `@plannotator/core/*` specifiers (no `paths` map on those packages). Run order within Step 1: create core files (1a–1g) → edit deps (1h) → `bun install` → wire typecheck (1i) → fix vendor (1j) → verify (1k).

### 1b. Create `packages/core/tsconfig.json` (node-free — DOM-only lib, no node/bun types)
New file `packages/core/tsconfig.json` (exact):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "strict": false,
    "noImplicitAny": false,
    "strictNullChecks": false,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```
Critical: NO `"types": ["bun"]`, NO `"types": ["@types/node"]`, NO `"paths"`. This is the node-free invariant — a stray `node:*` import yields `TS2307`.

### 1c. `git mv` the 15 pure modules `packages/shared/X.ts` → `packages/core/X.ts`
Exact list (each verified node-free; the only intra-set dep is `extract-code-paths → ./code-file`, which moves together so the relative import stays valid):
```
code-file  extract-code-paths  agents  agent-jobs  compress  crypto
external-annotation  favicon  feedback-templates  goal-setup  browser-paths
project  agent-terminal  open-in-apps  source-save
```
Do NOT move `source-save-node.ts` (node-bound — stays in shared). `project` here is the PURE `packages/shared/project.ts`, NOT `packages/server/project.ts`.

### 1d. Create the 5 extracted type files in core (single source — definitions move here, byte-for-byte)

`packages/core/config-types.ts` — move the pure type decls from `shared/config.ts:13-30`:
```ts
export type DefaultDiffType = 'uncommitted' | 'unstaged' | 'staged' | 'merge-base' | 'all';
export type DiffLineBgIntensity = 'subtle' | 'normal' | 'strong';
// plus DiffOptions (config.ts:16-30) — self-contained, references the two above; move for the diff-option family
```
(UI needs only `DefaultDiffType` + `DiffLineBgIntensity`; `DiffOptions` is moved for tidiness, self-contained.) Do NOT move `CCLabelConfig`, `PromptConfig`, `PromptRuntime`, etc.

`packages/core/storage-types.ts` — move `ArchivedPlan` (shared/storage.ts:107-114):
```ts
export interface ArchivedPlan {
  filename: string; title: string; date: string; timestamp: string;
  status: "approved" | "denied" | "unknown"; size: number;
}
```

`packages/core/workspace-status-types.ts` — move the cluster (shared/workspace-status.ts:6-44): `WorkspaceFileStatus`, `WorkspaceFileChange`, `WorkspaceStatusPayload`, `GitRepositoryInfo`. (`WorkspaceFileStatus` is required transitively by `WorkspaceFileChange`.) Do NOT move `GitResult`, `WorkspaceStatusFlight` (file-private, node-adjacent). **Copy the declarations byte-for-byte — these use TAB indentation in the source; preserve the tabs, do NOT reflow to spaces.**

`packages/core/types.ts` — move the `EditorAnnotation` interface (shared/types.ts:2-10, pure). This file exports ONLY `EditorAnnotation`. Do NOT re-export anything from `review-core`/`review-workspace` (they import `node:path`).

`packages/core/ai-context.ts` — MOVE (not re-export) the AI context type family from `packages/ai/types.ts:14-89`. **This family INCLUDES `AIContextMode` (at `ai/types.ts:14`).** Move ALL six names: `AIContextMode`, `ParentSession`, `PlanContext`, `CodeReviewContext`, `AnnotateContext`, `AIContext`. All verified node-free. The literal first line moved is:
```ts
export type AIContextMode = "plan-review" | "code-review" | "annotate";
```
Do NOT do `export … from '@plannotator/ai'` — that would give core a dep on private `ai` and break the zero-dep CI gate.

> **Why `AIContextMode` is mandatory here:** it is consumed inside the `ai` package itself — `ai/index.ts:68` re-exports it from `./types.ts`, and `ai/session-manager.ts:16,26,65` import and use it. If it is moved out of `ai/types.ts` but not re-exported back (see 1g), the `ai` package fails to typecheck (`TS2305 'no exported member AIContextMode'`), cascading to editor/server. UI does NOT import `AIContextMode` (verified zero usage), so no Step 2 change is needed for it.

### 1e. Create `packages/core/index.ts` (barrel)
Re-export the public surface so `import … from '@plannotator/core'` works (notably `AIContext` for UI):
```ts
export * from './ai-context';
export type { EditorAnnotation } from './types';
// (re-export others as convenient; AIContext is the load-bearing one for ui/useAIChat)
```
`export * from './ai-context'` re-exports `AIContextMode`, `AIContext`, `ParentSession`, `PlanContext`, `CodeReviewContext`, `AnnotateContext` from the barrel.

### 1f. Replace the 15 moved `shared/X.ts` files with one-line shims
After `git mv`, recreate each `packages/shared/X.ts` containing exactly:
```ts
export * from '@plannotator/core/X';
```
(15 files: code-file, extract-code-paths, agents, agent-jobs, compress, crypto, external-annotation, favicon, feedback-templates, goal-setup, browser-paths, project, agent-terminal, open-in-apps, source-save.) `shared`'s `exports` map and `private:true` stay unchanged — every subpath still resolves to `./X.ts`.
Note: the intra-shared relative importers (`shared/resolve-file.ts → ./code-file`, `shared/storage.ts → ./project`, `shared/source-save-node.ts → ./source-save`) resolve to the shim and forward to core — NO edits needed to those three.

### 1g. Rewire the node-bound shared modules + `ai/types.ts` to import types back from core
`packages/shared/config.ts` — replace the inline `DefaultDiffType`/`DiffLineBgIntensity`/`DiffOptions` decls with:
```ts
export type { DefaultDiffType, DiffLineBgIntensity, DiffOptions } from '@plannotator/core/config-types';
```
(keep all node impl/functions unchanged.)

`packages/shared/storage.ts` — replace the inline `export interface ArchivedPlan {…}` with:
```ts
import type { ArchivedPlan } from '@plannotator/core/storage-types';
export type { ArchivedPlan };
```
(internal functions keep referencing `ArchivedPlan`; node:fs impl unchanged.)

`packages/shared/workspace-status.ts` — replace the inline cluster with:
```ts
import type { WorkspaceFileChange, WorkspaceStatusPayload, GitRepositoryInfo, WorkspaceFileStatus } from '@plannotator/core/workspace-status-types';
export type { WorkspaceFileChange, WorkspaceStatusPayload, GitRepositoryInfo, WorkspaceFileStatus };
```
(node:child_process/fs impl unchanged.)

`packages/shared/types.ts` — replace the inline `EditorAnnotation` interface with:
```ts
export type { EditorAnnotation } from '@plannotator/core/types';
```
(keep its existing `review-core`/`review-workspace` re-exports as-is.)

`packages/ai/types.ts` — replace the inline AIContext family with import-back. **This line MUST include `AIContextMode`** (it was moved in 1d and is re-exported by `ai/index.ts:68`):
```ts
export type { AIContext, AIContextMode, PlanContext, CodeReviewContext, AnnotateContext, ParentSession } from '@plannotator/core/ai-context';
```
This keeps `ai/index.ts`'s existing re-export (which lists `AIContextMode` at line 68) resolving, keeps `session-manager.ts`'s `import type { ..., AIContextMode } from "./types.ts"` resolving, AND keeps `editor/App.tsx:95`'s `import type { AIContext } from '@plannotator/ai'` resolving — **`ai`, `editor`, and `server` stay byte-for-byte unchanged.**

### 1h. package.json dep edits for `shared` and `ai`
- `packages/shared/package.json` deps: add `"@plannotator/core": "workspace:*"`. Keep `private:true`, keep the full `exports` map unchanged.
- `packages/ai/package.json` deps: add `"@plannotator/core": "workspace:*"`. Keep `private:true`.

**After 1h: run `bun install`** (registers `@plannotator/core` in the Bun workspace catalog). This is the resolution mechanism for `shared`/`ai`'s new `@plannotator/core/*` imports — those packages have no `paths` map. Without this, Step 1k's `tsc -p packages/shared/tsconfig.json` / `packages/ai/tsconfig.json` cannot resolve the new bare specifiers.

### 1i. Wire core into the root typecheck (node-free typecheck FIRST so a node leak fails fast)
Root `package.json` `typecheck` script (line 36) — insert core's typecheck before shared's:
```
"typecheck": "bash apps/pi-extension/vendor.sh && tsc --noEmit -p packages/core/tsconfig.json && tsc --noEmit -p packages/shared/tsconfig.json && tsc --noEmit -p packages/ai/tsconfig.json && tsc --noEmit -p packages/server/tsconfig.json && tsc --noEmit -p packages/ui/tsconfig.json && tsc --noEmit -p apps/pi-extension/tsconfig.json"
```
(Leave the vendor.sh prefix in place; vendor.sh itself is fixed in 1j.)

### 1j. Fix Pi `vendor.sh` (the ADR/spec "no change" claim is FALSE — confirmed)

**Why it breaks (verified against `apps/pi-extension/vendor.sh`):**
1. The main loop (vendor.sh:10) copies file CONTENT verbatim from `packages/shared/$f.ts` for a flat list that INCLUDES 9 moved-pure modules (`code-file`, `agent-jobs`, `external-annotation`, `favicon`, `feedback-templates`, `project`, `agent-terminal`, `open-in-apps`, `source-save`) AND 3 node-bound modules (`config`, `storage`, `workspace-status`). After the carve, the 9 pure files are bare shims (`export * from '@plannotator/core/X'`) and the 3 node-bound files import `@plannotator/core/<x>-types` — all unresolvable in Pi's flat `generated/` layout (no bundler resolution to packages, no `@plannotator/core` dep, `moduleResolution: bundler` with no `paths`/`baseUrl`).
2. The **ai loop** (vendor.sh:40) copies `index types provider session-manager endpoints context base-session` VERBATIM from `packages/ai/$f.ts` with NO sed rewrites. After 1g, `packages/ai/types.ts` contains `export type { … } from '@plannotator/core/ai-context'` — vendored verbatim into `generated/ai/types.ts`, where that bare specifier cannot resolve (`TS2307`). This works today ONLY because `ai/types.ts` currently has zero `@plannotator/*` imports.

`workspace-status` IS imported by `apps/pi-extension/server/reference.ts` and `file-browser-watch.ts` (confirmed), so a silent break here is a real runtime/typecheck failure.

**The exact restructured `vendor.sh` (write this as runnable shell — do not infer):**

(a) In the main loop, split the 9 moved-pure modules out of the `packages/shared/` source and source them from `packages/core/` instead. Replace the single loop (vendor.sh:10-13) so the 9 moved modules read from core, the 3 node-bound modules read from shared **and** get a sed rewrite, and everything else stays as-is:

```bash
# Modules that MOVED to @plannotator/core — vendor the real impl from core.
for f in feedback-templates project favicon code-file external-annotation agent-jobs agent-terminal source-save open-in-apps; do
  src="../../packages/core/$f.ts"
  printf '// @generated — DO NOT EDIT. Source: packages/core/%s.ts\n' "$f" | cat - "$src" > "generated/$f.ts"
done

# Node-bound shared modules that now import types from @plannotator/core/*-types —
# vendor from shared, rewrite the bare core specifier to the flat relative path.
for f in config storage workspace-status; do
  src="../../packages/shared/$f.ts"
  printf '// @generated — DO NOT EDIT. Source: packages/shared/%s.ts\n' "$f" | cat - "$src" \
    | sed 's|from "@plannotator/core/\([^"]*\)-types"|from "./\1-types.js"|g' \
    > "generated/$f.ts"
done

# Extracted type files those node-bound modules now depend on — vendor from core.
for f in config-types storage-types workspace-status-types; do
  src="../../packages/core/$f.ts"
  printf '// @generated — DO NOT EDIT. Source: packages/core/%s.ts\n' "$f" | cat - "$src" > "generated/$f.ts"
done

# Everything else in the original flat list stays sourced from packages/shared.
for f in prompts review-core diff-paths cli-pagination jj-core vcs-core review-args draft pr-types pr-provider pr-stack pr-github pr-gitlab checklist integrations-common repo reference-common resolve-file annotate-reference-roots-node worktree worktree-pool html-to-markdown html-assets html-assets-node url-to-markdown tour annotate-args at-reference review-workspace-node review-workspace pfm-reminder improvement-hooks code-nav data-dir semantic-diff-types semantic-diff source-save-node; do
  src="../../packages/shared/$f.ts"
  printf '// @generated — DO NOT EDIT. Source: packages/shared/%s.ts\n' "$f" | cat - "$src" > "generated/$f.ts"
done
```
> The relative-import chains stay valid: `resolve-file → ./code-file`, `source-save-node → ./source-save`, `storage → ./project` all resolve to the flat `generated/<name>.ts` files, which now hold the real core impl. Confirm the original line-10 list is fully partitioned across the four loops above with no module dropped (diff the old list against the union of the four new lists).

(b) Extend the **ai loop** (vendor.sh:40-43) to vendor `ai-context` from core and sed-rewrite the `@plannotator/core/ai-context` specifier in `generated/ai/types.ts` to `./ai-context.js`:

```bash
# Vendor the moved AI context types from core into generated/ai/.
printf '// @generated — DO NOT EDIT. Source: packages/core/ai-context.ts\n' \
  | cat - "../../packages/core/ai-context.ts" > "generated/ai/ai-context.ts"

for f in index types provider session-manager endpoints context base-session; do
  src="../../packages/ai/$f.ts"
  printf '// @generated — DO NOT EDIT. Source: packages/ai/%s.ts\n' "$f" | cat - "$src" \
    | sed 's|from "@plannotator/core/ai-context"|from "./ai-context.js"|g' \
    > "generated/ai/$f.ts"
done
```
> Only `generated/ai/types.ts` actually contains the `@plannotator/core/ai-context` specifier today, but applying the sed to all 7 ai files is harmless (no-op where absent) and future-proofs the vendor.

### 1k. Verify (run at end of Step 1)
```
bun install   # MUST run first — registers @plannotator/core in the workspace catalog
tsc --noEmit -p packages/core/tsconfig.json && tsc --noEmit -p packages/shared/tsconfig.json && tsc --noEmit -p packages/ai/tsconfig.json
# Node-free proof: temporarily add `import 'node:fs'` to a core/*.ts → tsc on core MUST fail TS2307 → remove it.
bash apps/pi-extension/vendor.sh && tsc --noEmit -p apps/pi-extension/tsconfig.json   # MUST be green — confirms generated/ai/types.ts + generated/{config,storage,workspace-status}.ts resolve their rewritten relative specifiers
git diff --name-only   # confined to packages/{core,shared,ai} + apps/pi-extension/vendor.sh + root package.json + bun.lock
```

### Commit
```
feat(core): carve @plannotator/core — move pure modules, extract node-bound types, shim shared (Phase 7 step 1)
```

---

## STEP 2 — Re-point `@plannotator/ui` to `@plannotator/core` (CRITICAL / opus)

Goal: every non-test `ui` import of `@plannotator/shared/*` and `@plannotator/ai` becomes `@plannotator/core/*`; ui `package.json` drops shared+ai, adds core EXACT. End: grep returns zero; ui typecheck green.

### 2a. Re-point the 35 import sites (31 files)
Mechanical rule: `@plannotator/shared/X` → `@plannotator/core/X` (same subpath), with these EXACT remaps for the type-extraction cases:
- `@plannotator/shared/config` → `@plannotator/core/config-types`
- `@plannotator/shared/storage` → `@plannotator/core/storage-types`
- `@plannotator/shared/workspace-status` → `@plannotator/core/workspace-status-types`
- `@plannotator/shared/types` (the `EditorAnnotation` re-export at `ui/types.ts:209`) → `@plannotator/core/types`
- `import type { AIContext } from '@plannotator/ai'` (`ui/hooks/useAIChat.ts:2`) → `from '@plannotator/core'`

Files + lines (from scope-rewire §1, authoritative):
- `ui/types.ts:209` EditorAnnotation → `@plannotator/core/types`
- `ui/types.ts:211-213` ExternalAnnotationEvent → `@plannotator/core/external-annotation`
- `ui/types.ts:215-221` AgentJob*/AgentCapabilit* → `@plannotator/core/agent-jobs`
- `ui/config/settings.ts:12` DiffLineBgIntensity → `@plannotator/core/config-types`
- `ui/utils/parser.ts:2` planDenyFeedback → `@plannotator/core/feedback-templates`
- `ui/utils/annotateAgentTerminal.ts:1` AgentTerminalAgent → `@plannotator/core/agent-terminal`
- `ui/utils/aiProvider.ts:10` AGENT_CONFIG/getAgentAIProviderTypes/Origin → `@plannotator/core/agents`
- `ui/utils/sharing.ts:12` compress/decompress → `@plannotator/core/compress`
- `ui/utils/sharing.ts:13` encrypt/decrypt → `@plannotator/core/crypto`
- `ui/components/InlineMarkdown.tsx:4` isCodeFilePath/… → `@plannotator/core/code-file`
- `ui/components/OpenInAppButton.tsx:5` OpenInKind → `@plannotator/core/open-in-apps`
- `ui/components/Settings.tsx:3` Origin → `@plannotator/core/agents`
- `ui/components/Settings.tsx:4` DiffLineBgIntensity → `@plannotator/core/config-types`
- `ui/components/DocBadges.tsx:16` hostnameOrFallback → `@plannotator/core/project`
- `ui/components/AISettingsTab.tsx:12` Origin → `@plannotator/core/agents`
- `ui/components/MenuVersionSection.tsx:4` Origin → `@plannotator/core/agents`
- `ui/components/DiffTypeSetupDialog.tsx:3` DefaultDiffType → `@plannotator/core/config-types`
- `ui/components/PlanHeaderMenu.tsx:14` Origin → `@plannotator/core/agents`
- `ui/components/AgentsTab.tsx:16` isTerminalStatus → `@plannotator/core/agent-jobs`
- `ui/components/PlanAIAnnouncementDialog.tsx:3` Origin → `@plannotator/core/agents`
- `ui/components/PlanAIAnnouncementDialog.tsx:4` AGENT_CONFIG/getAgentAIProviderTypes/getAgentName → `@plannotator/core/agents` (all three symbols on this line; `export * from '@plannotator/core/agents'` re-exports all)
- `ui/components/blocks/HtmlBlock.tsx:2` isCodeFilePath → `@plannotator/core/code-file`
- `ui/components/sidebar/FileBrowser.tsx:13` WorkspaceFileChange/WorkspaceStatusPayload → `@plannotator/core/workspace-status-types`
- `ui/components/sidebar/FileBrowser.tsx:14` normalizeBrowserPath → `@plannotator/core/browser-paths`
- `ui/components/sidebar/ArchiveBrowser.tsx:9` ArchivedPlan → `@plannotator/core/storage-types`
- `ui/components/goal-setup/GoalSetupSurface.tsx:13-20` GoalSetup* types → `@plannotator/core/goal-setup`
- `ui/components/settings/HooksTab.tsx:2` FAVICON_SVG → `@plannotator/core/favicon`
- `ui/hooks/useAgents.ts:6` Origin → `@plannotator/core/agents`
- `ui/hooks/useAnnotationDraft.ts:18` SourceSaveCapability → `@plannotator/core/source-save`
- `ui/hooks/useArchive.ts:9` ArchivedPlan → `@plannotator/core/storage-types`
- `ui/hooks/useLinkedDoc.ts:13` SourceSaveCapability → `@plannotator/core/source-save`
- `ui/hooks/useValidatedCodePaths.ts:2` extractCandidateCodePaths → `@plannotator/core/extract-code-paths`
- `ui/hooks/useFileBrowser.ts:12` WorkspaceStatusPayload → `@plannotator/core/workspace-status-types`
- `ui/hooks/pfm/useCodeFilePopout.ts:2` parseCodePath → `@plannotator/core/code-file`
- `ui/hooks/useAIChat.ts:2` AIContext → `@plannotator/core` (bare package root → resolves via `exports['.']` → `index.ts`)

### 2b. `packages/ui/tsconfig.json` paths
Add BOTH a `@plannotator/core/*` subpath mapping AND a bare `@plannotator/core` mapping alongside the existing shared one (line 21) so tsc resolves core during the transition. **Two entries are required:** the trailing-`/*` glob does NOT match the extensionless bare specifier `@plannotator/core` (used by `useAIChat.ts:2`):
```json
"@plannotator/core": ["../core/index.ts"],
"@plannotator/core/*": ["../core/*"]
```
(Keep `"@plannotator/shared/*": ["../shared/*"]` — see 2d note; surviving test-file imports still use it.) The bare-specifier path map is authoritative for ui's tsc; `bun install` (already run in Step 1) is the belt-and-suspenders mechanism that also makes the bare specifier resolve via core's `exports['.']`. State both: **path map is authoritative for ui tsc; workspace catalog backs it.**

### 2c. `packages/ui/package.json` dep edits + re-register
- REMOVE `"@plannotator/ai": "workspace:*"`
- REMOVE `"@plannotator/shared": "workspace:*"`
- ADD `"@plannotator/core": "workspace:*"`  (workspace alias in source; resolves to exact `0.21.0` at pack time — ADR mandates EXACT pinning, enforce at pack in Step 5/final gate)

**After 2c: run `bun install`** so the dependency-graph change (ui → core) is reflected in `bun.lock` before the Step 2d typecheck.

### 2d. Verify (run at end of Step 2)
```
bun install
grep -rn '@plannotator/shared\|@plannotator/ai' packages/ui --include='*.ts' --include='*.tsx' | grep -v '\.test\.'   # MUST be empty
tsc --noEmit -p packages/ui/tsconfig.json   # green
```
> **Note (intentional, out of scope for the grep-zero gate):** exactly two ui *test* files still import `@plannotator/shared` (`annotateAgentTerminal.test.ts`, `FileBrowser.test.ts`). These are deliberately retained — the grep-zero assertion scopes to non-test files via `grep -v '\.test\.'`, and `@plannotator/shared/*` stays in the ui tsconfig `paths` to keep them resolving. A reviewer should NOT flag these.

### Commit
```
feat(ui): depend only on @plannotator/core — re-point all shared/ai imports (Phase 7 step 2)
```

---

## STEP 3 — Move `wideMode.ts` into `packages/ui/utils` (MECHANICAL / sonnet)

Goal: relocate the pure `wideMode` helper from `editor` to `ui/utils`; fix the 2 importers.

### 3a. git mv
```
git mv packages/editor/wideMode.ts packages/ui/utils/wideMode.ts
git mv packages/editor/wideMode.test.ts packages/ui/utils/wideMode.test.ts
```

### 3b. Fix importer 1 — `packages/editor/App.tsx:109`
FROM:
```ts
import { canUseAnnotateWideMode, resolveWideModeExitLayout, type WideModeLayoutSnapshot, type WideModeType } from './wideMode';
```
TO:
```ts
import { canUseAnnotateWideMode, resolveWideModeExitLayout, type WideModeLayoutSnapshot, type WideModeType } from '@plannotator/ui/utils/wideMode';
```
(This is the ONE allowed edit to `packages/editor` source — a single import-specifier change, no behavior change. `wideMode.ts` itself only imports from `@plannotator/ui/types` + `@plannotator/ui/hooks/useSidebar`, so it lands cleanly in ui.)

### 3c. Fix importer 2 — the moved test
`packages/ui/utils/wideMode.test.ts` imports `./wideMode` (relative) — UNCHANGED after the move (it's now a sibling in `ui/utils`). Verify the line still reads `from './wideMode';`.

### 3d. exports map
`@plannotator/ui/utils/wideMode` already resolves via the existing `"./utils/*": "./utils/*.ts"` glob in `packages/ui/package.json` — NO new exports entry needed. (Confirm the glob is present at line 14.)

### 3e. Verify (run at end of Step 3)
```
grep -rn 'wideMode' packages --include='*.ts' --include='*.tsx' | grep -v 'packages/ui/utils/wideMode'   # only editor/App.tsx (the new specifier) shows
tsc --noEmit -p packages/ui/tsconfig.json   # green (wideMode + its importer resolve)
bun test packages/ui/utils/wideMode.test.ts
```

### Commit
```
refactor(ui): relocate wideMode helper to @plannotator/ui/utils (Phase 7 step 3)
```

---

## STEP 4 — Settings provider `loadFromBackend` + `configurePlannotatorUI` front door (CRITICAL / opus)

Goal: complete the half-built settings provider (initial-load routes through installed backend) and add the single typed configuration front door over the 9 global setters. Both ADDITIVE — Plannotator never calls either, so byte-for-byte parity holds.

### 4a. Add `loadFromBackend()` to `ConfigStore` — `packages/ui/config/configStore.ts`
Insert this method into the `ConfigStore` class (after the constructor, before `init`):
```ts
  /**
   * Re-hydrate all settings from the currently installed StorageBackend.
   * ADDITIVE host hook — Plannotator never calls this (eager cookie default unchanged).
   * Host installs a SYNCHRONOUS StorageBackend serving prefetched settings, then calls
   * this to route the initial load through that backend. Precedence after a host call:
   * server (init) > host backend (loadFromBackend) > cookie/default (constructor).
   */
  loadFromBackend(): void {
    for (const [name, def] of Object.entries(SETTINGS)) {
      const fromBackend = def.fromCookie();
      if (fromBackend !== undefined) {
        this.values.set(name, fromBackend);
      }
    }
    this.notify();
  }
```
Contract: use `!== undefined` (NOT `??`) so a missing key keeps the constructor default; do NOT call `def.toCookie` (no re-write). Reuses the existing per-setting `fromCookie()` reader, which under a host backend reads the host's prefetched store.

### 4b. Add `resetServerSync()` to `ConfigStore` (needed by the Step 6 seam test; keeps the seam family symmetric)
Next to `setServerSync` (configStore.ts:122):
```ts
  resetServerSync(): void { this.serverSync = defaultServerSync; }
```
(`defaultServerSync` already exists at configStore.ts:36-42.)

### 4c. Create `packages/ui/configure.ts` — `configurePlannotatorUI`
New file. Imports the 9 setters from their intra-`ui` relative modules and fans out (every field optional, only provided seams applied):
```ts
import { setImageSrcResolver, type ImageSrcResolver } from './components/ImageThumbnail';
import { setDocPreviewFetcher, type DocPreviewFetcher } from './components/InlineMarkdown';
import { setStorageBackend, type StorageBackend } from './utils/storage';
import { setIdentityProvider, type IdentityProvider } from './utils/identity';
import { setFileTreeBackend, type FileTreeBackend } from './hooks/useFileBrowser';
import { setDraftTransport, type DraftTransport } from './hooks/useAnnotationDraft';
import { setExternalAnnotationTransport, type ExternalAnnotationTransport } from './hooks/useExternalAnnotations';
import { setAITransport, type AITransport } from './hooks/useAIChat';
import { configStore } from './config';

type ExternalAnnotationBase = { id: string; source?: string };
type ServerSyncFn = (payload: Record<string, unknown>) => void;

export interface PlannotatorUIConfig {
  imageSrcResolver?: ImageSrcResolver;
  storageBackend?: StorageBackend;
  docPreviewFetcher?: DocPreviewFetcher;
  fileTreeBackend?: FileTreeBackend;
  identityProvider?: IdentityProvider;
  draftTransport?: DraftTransport;
  /**
   * Base-constraint transport. If your annotation type extends the base
   * constraint ({ id: string; source?: string }) with extra fields, call
   * setExternalAnnotationTransport<YourType>() directly for full type safety —
   * this front-door field intentionally pins the base constraint for ergonomics.
   */
  externalAnnotationTransport?: ExternalAnnotationTransport<ExternalAnnotationBase>;
  aiTransport?: AITransport;
  serverSync?: ServerSyncFn;
  /** Re-hydrate settings from the installed (SYNCHRONOUS) storageBackend after install. */
  loadSettingsFromBackend?: boolean;
}

export function configurePlannotatorUI(config: PlannotatorUIConfig): void {
  if (config.imageSrcResolver) setImageSrcResolver(config.imageSrcResolver);
  if (config.storageBackend) setStorageBackend(config.storageBackend);
  if (config.docPreviewFetcher) setDocPreviewFetcher(config.docPreviewFetcher);
  if (config.fileTreeBackend) setFileTreeBackend(config.fileTreeBackend);
  if (config.identityProvider) setIdentityProvider(config.identityProvider);
  if (config.draftTransport) setDraftTransport(config.draftTransport);
  if (config.externalAnnotationTransport) setExternalAnnotationTransport(config.externalAnnotationTransport);
  if (config.aiTransport) setAITransport(config.aiTransport);
  if (config.serverSync) configStore.setServerSync(config.serverSync);
  // Re-hydrate AFTER storageBackend is installed (load-bearing order — gated last).
  if (config.loadSettingsFromBackend) configStore.loadFromBackend();
}
```
Notes: inline `ServerSyncFn` (configStore's type is module-local — do NOT widen configStore's surface). The external-annotation generic is pinned to the base constraint `{ id: string; source?: string }` (the hook's default transport is `<any>`, contract-compatible); the doc comment above the field tells consumers with extended annotation types to call `setExternalAnnotationTransport<YourType>()` directly. The render-time prop seams (vscode-diff, save-to-notes, obsidian-detect, version fetchers, editor `mode`, code-path toggle, `ScrollViewportProvider`) are intentionally NOT here — they're passed where the host renders those components.

### 4d. ui exports + files
`packages/ui/package.json`:
- exports: add `"./configure": "./configure.ts"` (alongside `./config`, `./types`).
- files: add `"configure.ts"` (sits at package root like `types.ts`).

### 4e. Verify (run at end of Step 4)
```
tsc --noEmit -p packages/ui/tsconfig.json   # green
grep -n 'loadFromBackend\|resetServerSync' packages/ui/config/configStore.ts
grep -n 'configurePlannotatorUI' packages/ui/configure.ts
```

### Commit
```
feat(ui): add loadFromBackend settings rehydration + configurePlannotatorUI front door (Phase 7 step 4)
```

---

## STEP 5 — Precompiled CSS build + madge circular-dep tooling (MECHANICAL / sonnet)

Goal: ship a required precompiled `@plannotator/ui/styles.css` (CSS-only Vite build); add `madge` + a circular-dependency script. (Core's node-free typecheck wiring already landed in Step 1i — re-verify here.)

### 5a. CSS entry — `packages/ui/styles-entry.css` (new)
```css
@import "@fontsource-variable/inter";
@import "@fontsource-variable/geist-mono";
@import "tailwindcss";

@plugin "tailwindcss-animate";

@source "./components/**/*.tsx";
@source "./hooks/**/*.ts";
@source "./utils/**/*.ts";

@import "./theme.css";
```
(`@source` globs are relative to this file at `packages/ui/`; they run ONCE at build time on source, baking the utility classes into the output — that's the whole point vs. the fragile consumer-side `@source` into `node_modules`.) Does NOT include `@plannotator/webtui/styles.css` (agent-terminal) or dockview CSS (review-editor) — those are runtime-specific, not exported UI.
> **`print.css` is covered (verified):** `packages/ui/theme.css:55` already does `@import "./print.css";`, and `styles-entry.css` imports `./theme.css`, so the precompiled bundle DOES include print styles transitively. No separate `@import "./print.css"` is needed here.

### 5b. Vite CSS-only config — `packages/ui/vite.css.config.ts` (new)
```ts
import path from 'path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: { alias: { '@plannotator/ui': path.resolve(__dirname, '.') } },
  build: {
    lib: { entry: path.resolve(__dirname, 'styles-entry.css'), formats: ['es'], fileName: () => 'styles.js' },
    outDir: '.',
    cssCodeSplit: false,
    rollupOptions: { output: { assetFileNames: 'styles.css' } },
    emptyOutDir: false,
  },
});
```

### 5c. `packages/ui/package.json` — CSS build wiring
- scripts: add `"build:css": "vite build --config vite.css.config.ts && rm -f styles.js"`
- scripts: add `"prepublishOnly": "bun run build:css"` — mirrors `apps/pi-extension/package.json`'s `prepublishOnly` pattern. This fires automatically before `bun pm pack` / `npm publish`, guaranteeing `styles.css` is fresh in the tarball even though it is NOT committed. Without it, a publish would ship a tarball missing the (listed-in-`files`) `styles.css` — a silent consumer break.
- exports: add `"./styles.css": "./styles.css"`
- files: add `"styles.css"`
- devDependencies: add `"@tailwindcss/vite": "^4.1.18"` and `"vite": "^6.2.0"` (CSS-only build needs only these two; no react plugin).
- Add a `.gitignore` line (or repo-root ignore) for `packages/ui/styles.js`. **Do NOT commit `styles.css`** — it's a generated artifact produced by `prepublishOnly` at pack/publish time (avoids stale diffs). Also add `packages/ui/styles.css` to `.gitignore`.

### 5d. Root scripts — `build:ui-css`
Root `package.json` scripts: add `"build:ui-css": "bun run --cwd packages/ui build:css"`.

### 5e. madge circular-dep tooling
- Root `package.json` devDependencies: add `"madge": "^8.0.0"` (`bun add -d madge` at repo root).
- Root `.madgerc` (new) — TS support:
  ```json
  { "extensions": ["ts", "tsx"], "fileExtensions": ["ts", "tsx"] }
  ```
- Root `package.json` scripts: add
  ```json
  "check:cycles": "madge --circular --extensions ts,tsx --ts-config packages/core/tsconfig.json packages/core && madge --circular --extensions ts,tsx --ts-config packages/ui/tsconfig.json packages/ui"
  ```
  (Scoped to the two published packages — the strict invariant. `--circular` reports cycles only, not unresolved imports; the `--ts-config` for ui carries the `@plannotator/core/*` + bare-`@plannotator/core` path maps added in Step 2b so madge resolves the aliases. The two surviving `@plannotator/shared` references in ui *.test.ts files are resolved by the retained shared path map and do not affect cycle detection.)

### 5f. Re-confirm core node-free typecheck wiring (from Step 1i)
Ensure `tsc --noEmit -p packages/core/tsconfig.json` is in the root `typecheck` script (added in 1i). Sanity: a planted `import 'node:fs'` in a core file fails `TS2307`.

### 5g. Verify (run at end of Step 5)
```
bun install   # picks up madge + vite/@tailwindcss/vite devDeps
bun run build:ui-css   # emits packages/ui/styles.css, removes styles.js
test -s packages/ui/styles.css && echo "styles.css non-empty OK"
bun run check:cycles   # exits 0 (no cycles in core/ui)
tsc --noEmit -p packages/core/tsconfig.json   # node-free green
```

### Commit
```
build(ui): precompiled styles.css CSS build + madge circular-dep check (Phase 7 step 5)
```
(Commit the configs/scripts/devDeps + `prepublishOnly`; do NOT commit the generated `styles.css`/`styles.js`.)

---

## STEP 6 — Per-seam override tests + a `configurePlannotatorUI` routing test (MECHANICAL / sonnet)

Goal: one override test per seam (`setX(fake)` → drive → assert → `resetX()`), making the `reset*()` functions live and pinning the subtle contracts; plus one test that `configurePlannotatorUI({...})` routes to each setter.

### 6a. Verify (DO NOT re-edit) the override-path contracts before writing tests
The two override-path fixes flagged in earlier interrogation passes are **ALREADY landed on this branch** (verified). Step 6a is VERIFICATION-ONLY — do NOT re-apply or "fix" working code (re-editing risks an unintended Plannotator behavior change, a LAW violation).

1. **Split-transport (already fixed):** `packages/ui/hooks/useExternalAnnotations.ts:134` captures `transportRef = useRef(externalAnnotationTransport …)`; the subscribe/poll effect reads `transportRef.current` (line 145) AND every CRUD callback reads `transportRef.current` (`.remove` line 232, `.clear` line 244, `.update` line 253). Reads and writes already use the same backend instance. **Confirm via grep**:
   ```
   grep -n 'transportRef.current' packages/ui/hooks/useExternalAnnotations.ts   # expect lines 145, 232, 244, 253
   ```
   If (and only if) these are absent, apply the capture-once pattern; otherwise proceed.
2. **Ref reset on effect re-run (already fixed):** `fallbackRef.current = false` (line 142) and `receivedSnapshotRef.current = false` (line 143) are already reset at the TOP of the effect, so an `enabled` toggle `false→true` re-attempts SSE. **Confirm via grep**:
   ```
   grep -n 'fallbackRef.current = false\|receivedSnapshotRef.current = false' packages/ui/hooks/useExternalAnnotations.ts   # expect lines 142, 143
   ```
3. **`useFileBrowser` audit (no change expected):** `useFileBrowser.ts` reads the module global `fileTreeBackend` LIVE (lines 211/316/383) rather than capturing a ref. This is a DIFFERENT but acceptable pattern (no mount-time capture, so no read/write split to fix). Confirm no change is needed; do NOT introduce a ref here.

Then proceed straight to the seam tests in 6b/6c — they pin the already-correct behavior.

### 6b. Per-seam override tests (10 files, `.seam.test.ts(x)` naming, colocated)
| Seam | Test file | Assert |
|------|-----------|--------|
| `setImageSrcResolver` / `resetImageSrcResolver` | `packages/ui/components/ImageThumbnail.seam.test.tsx` | render `<ImageThumbnail path="/foo/img.png" />` → fake resolver called with `"/foo/img.png"` |
| `setStorageBackend` / `resetStorageBackend` | `packages/ui/utils/storage.seam.test.ts` | `setItem`/`getItem` → fake backend's read/write called (not `document.cookie`) |
| `setDocPreviewFetcher` / `resetDocPreviewFetcher` | `packages/ui/components/InlineMarkdown.seam.test.tsx` | trigger doc preview → fake fetcher called with expected path |
| `setFileTreeBackend` / `resetFileTreeBackend` | `packages/ui/hooks/useFileBrowser.seam.test.tsx` | mount `useFileBrowser` → `fetchTree()` → `fake.loadTree` invoked with expected dirPath |
| `setIdentityProvider` / `resetIdentityProvider` | `packages/ui/utils/identity.seam.test.ts` | `getIdentity()` → fake provider invoked |
| `setDraftTransport` / `resetDraftTransport` | `packages/ui/hooks/useAnnotationDraft.seam.test.ts` | `fake.load()` on mount; `fake.save()` on scheduled save |
| `setExternalAnnotationTransport` / `resetExternalAnnotationTransport` | `packages/ui/hooks/useExternalAnnotations.seam.test.ts` | mount → `fake.subscribe` called; delete → `fake.remove` on SAME transport (pins the already-landed split-transport fix) |
| `setAITransport` / `resetAITransport` | `packages/ui/hooks/useAIChat.seam.test.ts` | mount `useAIChat` + send → `fake` session/query called |
| `configStore.setServerSync` / `resetServerSync` | `packages/ui/config/configStore.seam.test.ts` | `configStore.set('<server-synced key>', …)` → fake sync fn called with expected payload |
| `loadFromBackend` | `packages/ui/config/configStore.seam.test.ts` (2nd describe) | `setStorageBackend(prefetched)` → `loadFromBackend()` → `configStore.get(key)` returns prefetched value |

Pattern (template): `afterEach(() => resetXTransport())`; in the test, `setXTransport(fake)`, drive (mount hook harness via React test utils, or call the utility directly), assert recorded calls. Files auto-discovered by `bun test` — no registration.

### 6c. `configurePlannotatorUI` routing test — `packages/ui/configure.test.ts` (new)
Call `configurePlannotatorUI({ imageSrcResolver, storageBackend, docPreviewFetcher, fileTreeBackend, identityProvider, draftTransport, externalAnnotationTransport, aiTransport, serverSync, loadSettingsFromBackend: true })` with fakes/spies, then assert each underlying setter received its fake (and that `loadFromBackend` ran after `setStorageBackend`). Reset every seam in `afterEach`.

### 6d. Verify (run at end of Step 6)
```
bun test packages/ui   # all ui tests incl. new .seam.test + configure.test green
tsc --noEmit -p packages/ui/tsconfig.json
```

### Commit
```
test(ui): per-seam override tests + configure routing test (Phase 7 step 6)
```

---

## FINAL PARITY GATE (run after Step 6, before any publish/push — DO NOT push or publish)

Run from repo root. ALL must pass; investigate any failure before proceeding.

1. **Full typecheck (incl. core node-free + Pi vendor):**
   ```
   bun install   # ensure catalog is current (core registered, ui→core)
   bun run typecheck
   ```
   Expect green for core, shared, ai, server, ui, pi-extension. Confirm a planted `import 'node:fs'` in a `packages/core/*.ts` fails `TS2307` (node-free invariant), then remove it.

2. **Test suite — delta vs. main must be ADDITIONS only:**
   ```
   bun test
   ```
   Expect the Phase-0 baseline pass count PLUS the new Step-6 seam/configure tests — zero regressions, zero failures. The delta should be exactly the new `.seam.test`/`configure.test` files plus the moved `wideMode.test` file. No pre-existing test changed behavior.

3. **madge clean (no circular deps in published packages):**
   ```
   bun run check:cycles
   ```
   Exit 0.

4. **`git diff` confined to expected packages:**
   ```
   git diff --name-only main...HEAD
   ```
   Must be limited to: `packages/core/**`, `packages/shared/**`, `packages/ai/**`, `packages/ui/**`, the single `packages/editor/App.tsx` import line + the moved `wideMode` files, `apps/pi-extension/vendor.sh`, root `package.json` / `.madgerc` / `.gitignore` / `bun.lock`, and (if added) `.github/workflows/*` CI. NOTHING in `packages/server`, `packages/review-editor`, `apps/hook`, `apps/opencode-plugin`, or any other Plannotator app source.

5. **ui depends ONLY on core internally (non-test):**
   ```
   grep -rn '@plannotator/shared\|@plannotator/ai' packages/ui --include='*.ts' --include='*.tsx' | grep -v '\.test\.'
   ```
   Empty. (The two surviving `@plannotator/shared` imports in ui *.test.ts files are intentional — see Step 2d note — and are excluded by `grep -v '\.test\.'`.)

6. **Apps build green + functional/visual parity (the REAL gate):**
   ```
   bun run --cwd apps/review build && bun run build:hook && bun run build:opencode
   bun run build:pi   # Pi vendors from core now
   ```
   All builds MUST succeed. **Parity is confirmed by a human running the plan review and code review UIs in the browser** (ADR 004: human browser verification is the real gate). The shipped bundle should be **functionally identical** to the Phase-0 baseline — the carve is move + re-export only, no runtime logic change.

   **Bundle-hash guidance (NOT a hard gate):** compare shipped bundle hashes against the Phase-0 baseline as a proxy signal, but do NOT treat any hash delta as an automatic STOP. The carve changes the import-resolution graph (e.g. `@plannotator/ui` now resolves `compress` directly from `core/compress.ts` instead of through the `shared/compress.ts` shim; `editor/App.tsx` now imports `wideMode` from `@plannotator/ui/utils/wideMode`). A bundler may emit different hashes purely from changed module ordering, import-path string literals, or source-map metadata while the executed JS logic is byte-identical.
   - **Acceptable (proceed):** hash differs only in source-map metadata or import-path string literals, with no change to the JS logic bytes — confirm by diffing the de-minified/normalized bundle output.
   - **STOP and investigate:** any difference in the actual JS logic bytes, OR any visible/functional difference in the browser. That is a regression and must be root-caused before proceeding.

7. **CSS artifact builds:**
   ```
   bun run build:ui-css && test -s packages/ui/styles.css
   ```

**Publish/registry steps are OUT OF SCOPE for these 6 steps** — branch-validation (`bun pm pack` each, inspect tarball, `npm publish --dry-run`), the `release.yml` publish job, and the EXACT-pin substitution of `ui → core@0.21.0` happen only after a human confirms parity in the browser and gives explicit go (ADR 007 §5, THE LAW). Do NOT push these commits.
