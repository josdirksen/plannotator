# Spec: Document UI Extraction Plan — Verified

Date: 2026-06-22

> Produced by a 36-agent verification workflow (5 coupling-sweep lenses + 15 subsystem analyses + 15 adversarial parity reviews + synthesis). It **verifies and supersedes** the draft inventory `adr/research/SPIKE-document-ui-reuse-inventory-20260622-183000.md`, which was directionally correct but materially incomplete. Governed by **ADR 004**. THE LAW: move + decouple, never rewrite; Plannotator's experience cannot change. Every seam below is "lift the URL/global to an optional prop, with **today's literal as the verbatim default**."

**Repo:** `/Users/ramos/plannotator/feat-pkg-document-ui` · **Library:** `packages/ui` · **Glue:** `packages/editor/App.tsx`

## Subsystem parity verdicts

`safe` = extract via straightforward seams. `risky` = extractable, but contains timing-sensitive/stateful code that must be **moved verbatim**, not re-derived (the reverted attempt's failure mode).

| Subsystem | Verdict | Effort | WS |
|---|---|---|---|
| Theme & tokens | safe | S | core |
| Markdown parsing + block rendering | safe | S | core |
| Document Viewer + annotation highlighting | **risky** | S–M | core |
| Raw HTML viewer | safe | S | core |
| Markdown editor | safe | S | core |
| File tree / browser | **risky** | M | core |
| Sidebar shell + tabs | safe | S | core |
| Comments / annotations / drafts | **risky** | L | core |
| Versions / plan diff | safe | M | maybe |
| Settings / config | safe | M | partial |
| Sharing / export / notes | safe | S | partial |
| Ask AI / agents | **risky** | M | maybe/own |
| Images: upload / thumbnail / annotate | safe | S | core |
| The glue (App.tsx layout) | safe | S | n/a |
| Packaging @plannotator/ui | safe | M | gate |

## 1. What the draft inventory missed (verified corrections)

The draft audited only one coupling axis — literal `/api/` strings at call sites — and was blind to five others.

- **A. Viewer is NOT clean (most consequential).** `Viewer.tsx:532` calls `useValidatedCodePaths(...)` **unconditionally**, which POSTs `/api/doc/exists`. Mounting Viewer fires a Plannotator backend call. Viewer is **NEEDS_SEAM**, not one of the "clean 82."
- **B. An uncounted cookie-persistence subsystem.** `utils/storage.ts` (`document.cookie`) is the **sole** settings backend, imported by ~24 modules (theme, TOC/plan-width/sticky prefs, panel resize, editor mode, agent switch, AI provider, identity). NEEDS_SEAM (inject a `{getItem,setItem,removeItem}` adapter; it's already localStorage-shaped).
- **C. Three React contexts + one global singleton, never mentioned.**
  - `ScrollViewportContext` — consumed in `packages/ui` (Viewer, StickyHeaderLane, PinpointOverlay, TableOfContents) but its **only Provider lives in the glue** (`App.tsx:3888`). Mounted elsewhere, sticky headers / pinpoint / scroll-to-anchor / TOC scrolling silently break. NEEDS_SEAM.
  - `configStore` singleton — module-level, eager cookie reads, hardcoded `fetch('/api/config')` write-back (L118). Reached **transitively** via `identity.ts` by Viewer, AnnotationPanel, HtmlViewer, `useAnnotationHighlighter`, diff views, Settings. This is **annotation authorship** ("which comments are mine") — core to Workspaces commenting. NEEDS_SEAM (host-supplied `currentUser`/`isCurrentUser`).
  - `CodePathValidationContext` — intra-library, null-tolerant. TRANSFER_AS_IS.
- **D. SSE (EventSource) is a distinct transport** the draft collapsed into REST siblings: `useFileBrowser.ts:297`, `useExternalAnnotations.ts:44`, `useAgentJobs.ts:66`. Workspaces' backend must speak SSE or supply a `subscribe` callback.
- **E. `useFileBrowser` is NOT transfer-as-is** — hard-codes `/api/reference/files` (L116), `/api/reference/obsidian/files` (L224), and the SSE watcher (L297). Only its expansion state is pure.
- **F. Packaging is harder than "moderate."** Hard blockers: `@plannotator/ai` + `@plannotator/shared` are `workspace:*` + `private` + `0.0.1`; a **phantom `dompurify`** dep (imported, not declared); **no `peerDependencies`** (React-duplication risk); `exports` point at raw `.tsx`/`.ts` with no `main`/`module`/`types`.
- **G. Small factual fixes** (so we don't act on bad data): theme count is a clean **51:51** (the "53/52" was a grep artifact); `useTheme()` does **not** throw without a provider (seeded default); `getImageSrc` is **one** shared seam across 5 consumers, not 3 separate wires; `utils/sharing.ts` calls the **external** paste service (base URLs parameterized), not a Plannotator `/api/paste` route.

## 2. Master extraction plan (dependency-ordered)

Each step: **default === today's literal**, additive optional prop/callback, logic untouched. The guardrail is how you prove Plannotator didn't change.

### Step 0 — Packaging unblock (do first; gates external install, zero runtime effect). Effort M.
- Add `dompurify` to `packages/ui` deps at the root's exact `^3.3.3` (version mismatch could change sanitization output).
- Resolve the two `workspace:* / private` deps: publish `@plannotator/ai` + `@plannotator/shared` with real versions, **or** inline the ~11 verified browser-safe subpaths ui value-imports (all Web-API-only — Web Crypto, CompressionStream — no `node:*`).
- Add `peerDependencies` (react, react-dom, tailwindcss, tailwindcss-animate, radix set, lucide-react); keep as devDeps for in-repo typecheck.
- Fix stale `tsconfig.json:21` alias `@plannotator/shared` → nonexistent `../shared/index.ts`; align `diff` range (`^8.0.3` vs root `^8.0.4`).
- Keep the **source-only** export model (no dist build — a build could change what Plannotator ships); document required consumer bundler settings (`isolatedModules`, JSX runtime, `allowImportingTsExtensions`).
- Add a `files` allowlist incl. `assets/`, `sprite_package_*/`, themes; exclude `*.test.*` (the only upward `ui→editor` import is `shortcuts.test.ts`).
- **Guardrail:** `bun run build:hook` + `build:opencode` produce byte-identical bundles; in-repo React still resolves to one copy.

### 1. Rendering core — images. Effort S.
- *As-is:* BlockRenderer, sanitizeHtml, inlineTransforms, parser render path.
- *Seam:* the single `getImageSrc` (ImageThumbnail.tsx:6) shared by 5 consumers (ImageThumbnail, InlineMarkdown, HtmlBlock, AttachmentsButton, Viewer). Introduce a module-level/context override whose default is the current body verbatim (http passthrough + conditional `&base`). Do **not** thread a Viewer-level prop — it can't reach InlineMarkdown/HtmlBlock.
- **Guardrail:** all 5 importers emit identical `/api/image?path=…&base=…`. Keep the default resolver **module-level (stable identity)** so HtmlBlock's `React.memo` + effect deps are untouched (otherwise `<details>` collapse on re-render).

### 2. Rendering core — doc fetch + code-path validation. Effort S.
- *Seam A:* InlineMarkdown hover preview `fetch('/api/doc?…')` (L154) → optional `fetchCodeFileContents` defaulting to the literal (same `{path, base?}`, **no `convert=1`** — that's glue). `useLinkedDoc` already accepts `buildUrl`; `useCodeFilePopout` is already prop-driven.
- *Seam B:* gate Viewer's validation — add `disableCodePathValidation`/inject result; default = today (on).
- **Guardrail:** Plannotator passes nothing → hover previews + code-link rendering identical; `/api/doc/exists` still fires.

### 3. Image upload + attachments. Effort S.
- *Seam:* `AttachmentsButton` `fetch('/api/upload')` (L140) → `onUpload(file) => Promise<{path}>`. Preserve multipart field name `'file'` and `{path}` return shape. Keep `deriveImageName` export stable.
- **Guardrail:** capture-phase paste listener + `stopPropagation` unchanged (no double-attach with App.tsx's bubble-phase paste).

### 4. File tree. Effort M (highest-risk SSE move).
- *As-is:* `FileBrowser.tsx` helpers + CountBadge, expansion state.
- *Seam:* lift `useFileBrowser`'s three fetch URLs + the **entire** SSE watcher effect (L289-342: EventSource, 120ms debounce, ready-dedup, cleanup) into a default `loadTree`/`loadVaultTree`/`watchTrees` object — moved **verbatim**, URL literals the only relocatable part. `useFileBrowser()` must stay callable with zero args.
- **Guardrail:** existing `useFileBrowser.test.tsx` stays green **without modification**. If it needs rewriting, the default changed → regression.

### 5. Comments / annotations / drafts. Effort L (risky).
- *As-is:* AnnotationSidebar, EditorAnnotationCard, commentContent, anchors, annotationHelpers, useExternalAnnotationHighlights.
- *Seam A — draftTransport:* wrap the 5 `/api/draft` fetches; `save` rejects on failure (preserves keepalive-retry). Keep generation bookkeeping in the hook. **Document the 3-party protocol:** `getDraftGeneration()` escapes into App.tsx and rides `/api/approve`/`/api/deny` bodies; server tombstone-gates in `shared/draft.ts`. A host swapping transport must replicate generation-gated delete-on-submit or ghost drafts resurrect.
- *Seam B — external-annotations transport:* move the **entire** effect body (EventSource + snapshot-gated fallback + `?since`/304 polling at 500ms) verbatim into a default `subscribe()`. Keep reducer + optimistic mutators. `enabled` flag already host-suppliable.
- *Seam C — identity:* `isCurrentUser(author)` + `getIdentity()` author-stamping (3 creation sites) → optional `author?`/`isCurrentUser?` props defaulting at the App.tsx call site to existing `identity.ts` functions.
- **Guardrail:** approve/deny payloads still carry `getDraftGeneration()`; SSE→polling fallback identical; `(me)` badge renders; every annotation stamped. Note: web-highlighter restoration is **renderer-coupled** — Workspaces must reuse BlockRenderer+InlineMarkdown+inlineTransforms as a unit.

### 6. Versions / plan diff. Effort M.
- *As-is:* `planDiffEngine.ts`, Badge, ModeSwitcher, RawDiffView.
- *Seam:* inject fetchers into `usePlanDiff` (default → `/api/plan/version(s)`); optional `onOpenVscodeDiff` in `PlanDiffViewer` (default → `/api/plan/vscode-diff`). Keep error handling in the hook (asymmetric: selectBaseVersion `alert()`s, fetchVersions silent).
- *CSS gap:* block/raw-diff + `.annotation-highlight` rules live in **`packages/editor/index.css` (L119-219)**, not the package. Move into `packages/ui/theme.css` (pure move) or document as a host CSS contract.
- **Guardrail:** App.tsx calls with no opts → identical traffic + alert behavior.

### 7. Settings / config. Effort M.
- *As-is:* `config/settings.ts` (pure cookie+default+mappers).
- *Seam A:* inject only the final `fetch('/api/config')` write-back (L118) via `setServerSync(fn)`. **Keep singleton construction, eager cookie reads, 300ms debounce, deepMerge byte-identical** (a naive per-`set()` fetch changes batching/timing).
- *Seam B:* `Settings.tsx` `fetch('/api/obsidian/vaults')` (L748) → `onDetectObsidianVaults?` default = real fetch; keep `useEffect [obsidian.enabled]` + auto-select-first-vault verbatim (a `[]` no-op default kills auto-select).
- *Seam C:* storage adapter (shared with steps 9/10). Keep literal keys (`plannotator-theme`, `plannotator-toc-enabled`, `plannotator-plan-width`, …) so existing cookies still read.
- *PLANNOTATOR_ONLY:* `HooksTab.tsx`.
- **Guardrail:** Plannotator passes nothing → identical cookie keys, merged `/api/config` POST, vault auto-select.

### 8. Sharing / export / notes. Effort S.
- *As-is:* `sharing.ts`, `useSharing`, obsidian/bear/octarine wrappers, `callback.ts`.
- *Seam:* `ExportModal` `fetch('/api/save-notes')` (L150) → `onSaveToNotes` → `{success, error}`. Keep `showNotesTab = isApiMode && !!markdown` byte-for-byte.
- *PLANNOTATOR_ONLY:* `OpenInAppButton`.

### 9. Theme & tokens. Effort S (safe).
- *As-is:* `theme.css` + 51 `themes/*.css` + `print.css` as **one atomic commit**. `themeRegistry` + `ThemeProvider` together.
- *Seam:* inject `storage` into `ThemeProvider` + `uiPreferences`; optional `mode?` on `MarkdownEditor`.
- **Guardrail:** do not touch synchronous `applyThemeClasses` (L96-98) or the rAF `transitions-ready` toggle (L107-111) — reordering causes FOUC. Keep `@source` globs in lockstep if files move.

### 10. Markdown editor. Effort S (lowest-coupled).
- `MarkdownEditor.tsx` is a 41-line theme-bridge over published `@plannotator/markdown-editor@0.1.0` + `@atomic-editor/editor@0.4.3`. `editorMode.ts` is glue (App.tsx-only).
- **Guardrail:** keep `GRID_CARD_CLASSES` under a `@source`-scanned path (else grid card loses border/shadow).

### 11. PLANNOTATOR_ONLY — never imported by Workspaces (no work).
`useAutoClose` (Glimpse), `useEditorAnnotations` (`window.__PLANNOTATOR_VSCODE`), `useUpdateCheck` (hardcoded github releases), `useArchive`/`ArchiveBrowser`, `useAgents`/`useAgentJobs`, `GoalSetupSurface`, `planAgentInstructions`, `annotateAgentTerminal` (ws:// derivation), `useSharing` `/p/<id>` routing. They stay in the app shell.

### 12. Ask AI. Effort M (risky — mechanical-move-only).
- *Seam:* extract **exactly** the 5 fetch literals in `useAIChat` behind a default `transport`. **Do NOT touch** the SSE reader loop (L233-304), epoch/createRequest guards, or the supersede-abort fetch position (L153-158). Capabilities fetch + provider resolution + cookie `aiConfig` init stay in the **shell** (pulling them into the lib is the forbidden re-derivation).

## 3. Top cross-cutting parity risks

1. **Cookie-storage swapped globally.** `storage.ts` underlies ~24 modules. Inject per-host; never change the default; keep literal `plannotator-*` keys. Otherwise Plannotator loses theme/layout/identity persistence across random-port hook invocations.
2. **`getImageSrc` resolved per-component** instead of the one shared resolver → some images break with no type error. Single override over the existing default.
3. **Over-extracting glue coordinators (the reverted-approach trap).** App.tsx's panel toggles entangle wide-mode exit + agent-terminal teardown; sidebar auto-open/close is policy keyed on `tocEnabled`/`hasTocEntries`/`isPlanDiffActive`. Keep these as opaque PLANNOTATOR_ONLY glue.
4. **Identity drift.** If `author`/`isCurrentUser` default to `undefined`/`''` instead of live `getIdentity()`/`isCurrentUser`, annotations lose author + `(me)` ownership silently.
5. **CSS that ships in the app shell, not the package** (plan-diff rules, font `@import`s, Tailwind `@source`, `GRID_CARD_CLASSES`). Move files without updating `@source` in lockstep → utilities render unstyled. Silent visual breakage in Plannotator's own build.
6. **Re-render instability from non-stable injected callbacks** (HtmlBlock memo/deps) → collapses open `<details>`. Keep defaults module-level.
7. **SSE→polling fallback / draft-generation protocols** are timing-sensitive state machines — move as **copies**, not re-derivations.

## 4. Glue guidance (App.tsx) — be conservative

**Push DOWN (default = today):**
- The seam defaults (image resolver, doc fetch, upload, draft/external transports, configStore write-back, obsidian detect, save-notes) — defaults live at the App.tsx call site wrapping the current literal.
- `packages/editor/wideMode.ts` → `packages/ui/utils/wideMode.ts`: two pure functions, no relative/circular deps — byte-identical move + one import-path edit (App.tsx:109). Effort S.
- Ship a `ScrollViewportContext` provider/wrapper with the package.

**LEAVE in the glue (PLANNOTATOR_ONLY — do NOT genericize):**
- Bootstrap from `/api/plan`, approve/deny hook flow, `getDraftGeneration` submit-body wiring.
- Right-panel/wide-mode/agent-terminal coordinators + auto-open/close sidebar policy (risk #3).
- `fileBrowserDirs` derivation + `showFilesTab` + load-orchestration; tab-visibility `show*Tab` + archive lazy-fetch.
- AI capabilities fetch + provider resolution + cookie `aiConfig` init.
- Panel-resize CSS-var writes (`--rpanel-w`/`--toc-w`/`--agent-terminal-w`).

**Hard rule for the draft's "step 7" (push layout into components):** keep `show*Tab`, `width`, `onTabChange` (with its archive side effect) as **opaque props/callbacks**. `useSidebar`/`useResizablePanel`/`SidebarContainer` are already prop-driven and already reused by `review-editor/App.tsx` — Workspaces writes its **own** coordinator over the same primitives. Re-deriving the coordinator generically is the forbidden path.

## 5. Packaging blockers (verified)

| Blocker | Severity | Fix (no logic change) |
|---|---|---|
| `@plannotator/ai` + `@plannotator/shared` are `workspace:* / private / 0.0.1` | HARD | Publish both (real version) or inline the ~11 browser-safe value-imported subpaths |
| Phantom `dompurify` dep (imported, not declared) | HARD | Add to ui deps at exact `^3.3.3` |
| No `peerDependencies` block | MED | Move react/react-dom/tailwindcss(-animate)/radix/lucide to peers; keep devDeps |
| Fonts + Tailwind `@source` live in consumer `index.css` | MED | Ship a documented CSS entry; host on Tailwind v4 |
| Source-only `exports` (no `main`/`module`/`types`) | MED | Keep source model + document bundler settings; no dist build |
| `diff` version drift (`^8.0.3` vs `^8.0.4`) | LOW | Align to `^8.0.4` |
| Stale tsconfig alias → nonexistent `../shared/index.ts` | LOW | Fix when converting shared off `workspace:*` |
| Static asset imports + no `files` allowlist | LOW | Add `files` incl. assets/sprites/themes; exclude tests |

**Non-blockers (verified — do not "fix"):** all `@plannotator/shared` value imports are Web-API-only; `@plannotator/ai` is `import type` only; `@plannotator/shared/storage` (node:fs) is `import type` only (erased under `isolatedModules`). `theme.css` is pure.
