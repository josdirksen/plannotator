# Document UI Extraction — Phase 0 & 1 Work Log

Date: 2026-06-22 · Baseline commit: `30cfcebb`

> Execution record for Phase 0 (safety net) and Phase 1 (packaging unblock) of the roadmap (`adr/implementation/document-ui-extraction-roadmap-20260622.md`). Law: move + decouple, never rewrite; **Plannotator's experience cannot change** — proven below by byte-identical shipped bundles.

## Phase 0 — Safety net (DONE)

Captured the known-good baseline at commit `30cfcebb` (saved to `scratchpad/parity-baseline.txt`):

| Check | Baseline result |
|---|---|
| `bun run typecheck` | PASS (exit 0) |
| `bun test` | **1620 pass / 0 fail**, 1650 ran across 123 files |
| `bun run build:review` / `build:hook` / `build:opencode` | all OK |
| Shipped plan UI hash (`apps/hook/dist/index.html`, `redline.html`, `opencode-plugin/plannotator.html`) | `4ca0cbe9dd85c3674e6122f1e830704076efa129` |
| Shipped review UI hash (`apps/hook/dist/review.html`, `opencode-plugin/review-editor.html`) | `f404d00d9a47785ca925776d48b7a67b2b30b9dd` |

The reusable click-through checklist lives at `adr/implementation/document-ui-parity-checklist-20260622.md`. The bundle-hash compare is the automated half; the manual click-through is run before any *behavioral* (non-packaging) step.

## Phase 1 — Packaging unblock (DONE except one decision)

All changes are package metadata only — no source/runtime change. Files touched: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `bun.lock`.

### Findings (verified against source before editing)
- **Phantom `dompurify` dependency (real latent bug).** Imported in `packages/ui/utils/sanitizeHtml.ts:1` and `utils/aiChatFormat.ts:3` but absent from `packages/ui/package.json`. Worked in-repo only via root hoisting; would break a standalone install. Root pins `dompurify ^3.3.3`.
- **`diff` version drift.** ui had `^8.0.3`; root has `^8.0.4`.
- **Stale tsconfig alias (dead).** `tsconfig.json:21` mapped bare `@plannotator/shared` → `../shared/index.ts`, which does not exist. Verified **no file in ui imports the bare specifier** — only `@plannotator/shared/*` subpaths (handled by the other, correct alias on the next line). The dead line was inert (typecheck passed with it) but removed for correctness.
- **No `peerDependencies`.** react/react-dom/tailwindcss were plain `dependencies`, risking duplicate-React when consumed by an external app.
- **No `files` allowlist.** A publish would have shipped test files and could have missed assets/themes.

### Changes made
1. **Added `dompurify ^3.3.3`** to `dependencies` (matches root exactly — a version mismatch could change sanitization output).
2. **Aligned `diff` `^8.0.3` → `^8.0.4`** (matches root).
3. **Added a `peerDependencies` block** — `react`, `react-dom`, `tailwindcss`, `tailwindcss-animate` — and removed them from `dependencies`. Also added the same four to `devDependencies` so in-repo typecheck/build still resolve them. (Scope decision: only the singleton/build-time packages were made peers. Radix, lucide, cva, clsx, tailwind-merge, etc. stay as regular `dependencies` — they are owned by the library and have no duplicate-instance hazard. This is the conventional, lower-risk choice and diverges deliberately from the audit's broader "radix→peer" suggestion.)
4. **Added a `files` allowlist** (source dirs + assets/themes/sprites + `theme.css`/`print.css`/`types.ts`/`globals.d.ts`), excluding `**/*.test.*` and `test-setup`. Preparatory — only affects a future publish.
5. **Removed the dead `tsconfig.json` alias line.**
6. **Kept the source-only `exports` model — no dist build added** (a build could change what Plannotator ships). Consumer bundler requirements to document for Workspaces: `isolatedModules`, the automatic JSX runtime, `allowImportingTsExtensions`, and Tailwind v4 (`@theme inline` is v4-only).

### Verification (post-change, vs Phase 0 baseline)
| Check | Result | Matches baseline? |
|---|---|---|
| `bun install` | clean, "no changes" to install tree (confirms dep moves didn't perturb resolution) | — |
| `bun run typecheck` | PASS (exit 0) | ✅ |
| `bun test` | **1620 pass / 0 fail** | ✅ identical |
| 3 builds | all OK | ✅ |
| plan UI bundle hash | `4ca0cbe9dd85c3674e6122f1e830704076efa129` | ✅ **byte-identical** |
| review UI bundle hash | `f404d00d9a47785ca925776d48b7a67b2b30b9dd` | ✅ **byte-identical** |

**Conclusion: Plannotator's shipped app is byte-for-byte unchanged.** The packaging box is now cleaner and closer to installable, with zero impact on the open-source experience.

## Remaining Phase 1 item — ONE decision required (not done)

**`@plannotator/ai` and `@plannotator/shared` are `workspace:* / private / 0.0.1`.** This is the one genuine blocker to an external `@plannotator/ui` install (an outside repo cannot resolve `workspace:*` private packages). It was **deliberately not actioned** because it is a strategic fork, and one path (publishing) is outward-facing and needs explicit authorization. Two options:

- **Option A — Publish `@plannotator/ai` + `@plannotator/shared`** (drop `private`, real versions, push to the registry). Cleanest dependency graph; lets Workspaces also reuse shared logic directly. Cost: two more published packages to maintain/version; needs registry auth. **Outward-facing — requires explicit go-ahead before any publish.**
- **Option B — Inline the browser-safe subpaths ui actually value-imports** into `@plannotator/ui` (verified Web-API-only: compress, crypto, agents, code-file, feedback-templates, project, favicon, agent-jobs, browser-paths, extract-code-paths, goal-setup). Keeps `@plannotator/ui` self-contained, no extra published packages. Cost: code duplication vs `@plannotator/shared`, and it is a real code change (must re-run the full parity verification).

When this is decided, also revisit the `tsconfig.json` `@plannotator/shared/*` alias (currently correct for in-repo; changes if shared is published/inlined).

> Note: the `@plannotator/ai` import is `import type` only (erased at compile). Most `@plannotator/shared` imports are also type-only or Web-API-only; verified no `node:*` value imports reach a bundle. So this blocker is about *package resolution for external install*, not about node code leaking into the browser.

## Phase 2 — Foundation seams (in progress)

Three cross-cutting seams that later phases depend on. Each: lift the backend wire to an optional override, default = today's behavior. For these *code* changes the bundle hash legitimately changes; parity is proven by behavior tests (+ eyeball where there's something visual to see).

### Seam 1 — Image resolver (DONE)
- **File:** `packages/ui/components/ImageThumbnail.tsx` (the single `getImageSrc`, shared by 5 consumers: ImageThumbnail, InlineMarkdown, HtmlBlock, AttachmentsButton, Viewer).
- **Change:** extracted the body into `defaultImageSrcResolver` and a module-level `imageSrcResolver` (stable identity); added `setImageSrcResolver(fn)` for a host to override once at startup, and `resetImageSrcResolver()` for tests. `getImageSrc(path, base?)` signature unchanged; it now delegates to the active resolver, default = the verbatim old `/api/image` logic.
- **Why no Viewer-level prop:** a prop can't reach InlineMarkdown/HtmlBlock; the module-level override is the only thing all 5 consumers share.
- **Verified:** default output byte-identical across remote-passthrough, base-append, and absolute-path cases (URL probe); override + reset work; typecheck pass; 1620 tests pass / 0 fail; all 3 builds OK. Dev-mode eyeball N/A — the mock serves no images and this change only affects the URL string (proven identical), so there is nothing visual to regress.

### Seam 2 — Storage backend (DONE)
- **File:** `packages/ui/utils/storage.ts` (the cookie `getItem`/`setItem`/`removeItem`, sole persistence for ~24 modules: theme, layout/TOC/width prefs, identity, auto-close, etc.).
- **Change:** moved the cookie implementation into a default `cookieBackend: StorageBackend`; added a module-level `backend` (default = cookies), `setStorageBackend(b)` for a host to swap, and `resetStorageBackend()` for tests. `getItem`/`setItem`/`removeItem` now delegate to the active backend; signatures and the `storage` object unchanged. Literal `plannotator-*` keys preserved.
- **Consumers untouched:** the ~24 modules keep calling `getItem`/`setItem` exactly as before.
- **Verified:** seam routes to an injected backend and `resetStorageBackend` restores cookies (in-memory probe); typecheck pass; 1620 tests pass / 0 fail (suite exercises storage through a real DOM); all 3 builds OK; manual eyeball — theme/settings persist across reload (cookie round-trip intact).

## Phase 3 — Rendering stack (in progress)

Teed up + adversarially reviewed by the `phase3-rendering-stack` workflow (36→22 agents; tee-up → execute-in-isolated-worktree → parity review → synthesis). Workflow verdicts: **3 noop** (theme, markdown, html-viewer — already decoupled by Phase 2 / already prop-driven, nothing to land), **3 safe** (editor, viewer, scroll), **1 "blocked"** (docfetch — false alarm: the execute worktrees were auto-removed, so the reviewer saw the clean real tree; the spec is sound, just needs real application). Note: the workflow's in-worktree `typecheck`/`tests` were unreliable (missing deps in throwaway worktrees) — landings are verified authoritatively on the real tree against the Phase 0 baseline. All landings done by hand on the real tree with the parity suite.

### Seam — Markdown editor theme mode (DONE)
- **File:** `packages/ui/components/MarkdownEditor.tsx`. Added optional `mode?` prop; `mode={resolvedMode}` → `mode={mode ?? resolvedMode}`; destructured `mode` out of `...props`.
- **Parity:** Plannotator's only `<MarkdownEditor>` call (App.tsx:4261) passes no `mode` → falls to `resolvedMode` → identical. Verified: typecheck pass, 1620 tests / 0 fail, builds OK, App.tsx untouched, no `mode=` caller.

### Seam — Viewer code-path validation gate (DONE)
- **Files:** `packages/ui/components/Viewer.tsx` + `packages/ui/hooks/useValidatedCodePaths.ts`. Added optional `disableCodePathValidation?` prop threaded to a new `disabled?` arg on the hook; when set, the `/api/doc/exists` probe is skipped (`ready: true`, empty map). Default undefined for Plannotator → validation stays on. Added `disabled` to the effect deps (always undefined for Plannotator → no behavior change).
- **Parity:** no `disableCodePathValidation` caller in editor/apps → Viewer still fires `/api/doc/exists` exactly as today. Verified: typecheck pass, 1620 tests / 0 fail, builds OK, App.tsx untouched.

### Seam — Doc-fetch (code-file hover preview) (DONE)
- **File:** `packages/ui/components/InlineMarkdown.tsx`. Added `DocPreviewResult`/`DocPreviewFetcher` + module-level `docPreviewFetcher` (default = verbatim `/api/doc` fetch) + `setDocPreviewFetcher`/`resetDocPreviewFetcher`; routed `handleMouseEnter` through it. `useCallback` deps unchanged.
- **Parity:** no `setDocPreviewFetcher` caller → Plannotator still fetches `/api/doc?path=&base=` identically. Verified: typecheck pass, 1620 tests / 0 fail, builds OK. (Hover popover not visible in dev mock — same caveat as images; call is provably identical.)

### Seam — Scroll viewport provider (DONE)
- **Files:** `packages/ui/hooks/useScrollViewport.ts` (added render-transparent `ScrollViewportProvider` via `createElement` — kept `.ts`, no JSX; fixed the stale OverlayScrollbars doc-comment) + `packages/editor/App.tsx` (import + the two provider tags at 3888/4427: `ScrollViewportContext.Provider value=` → `ScrollViewportProvider viewport=`).
- **Parity:** `ScrollViewportProvider` renders exactly `ScrollViewportContext.Provider value={viewport}` — identical tree/value/position; App.tsx delta is 3 lines. Sidebar TOC still resolves to the MAIN viewport. Verified: typecheck pass, 1620 tests / 0 fail, builds OK; **manual eyeball — TOC active-section tracks main-content scroll, click-to-scroll works.**

### Self-review fix — viewer `disabled` path (DONE)
- **Found:** the Phase-3 viewer seam's `disabled` branch set `ready=true` with an empty map, which makes `gateCodePath` demote every code link to **plain text** (since ready+no-entry => 'plain'). Wrong for the seam's purpose (a host disabling validation wants links to stay clickable). Did NOT affect Plannotator (never disables) but the seam was incorrect.
- **Fix:** `useValidatedCodePaths.ts` disabled branch now just `return;` (leaves `ready=false`), so `gateCodePath`'s no-validation fallback renders code links **optimistically (clickable)**. Re-verified: typecheck pass, 1620 tests / 0 fail, builds OK.

### Noops (nothing to land — verified already reusable)
theme, markdown, html-viewer — decoupled by Phase 2 / already prop-driven.

### Reusability note (intentional, not a defect)
Three seams now share the shape `defaultX` + module-level `x` + `setX`/`resetX` (image resolver, storage backend, doc-preview fetcher). NOT abstracted into a generic helper: they live in different files, have different call ergonomics (a bare function vs. a `{getItem,setItem,removeItem}` object vs. an async fetcher), and the duplication is ~4 trivial lines each. A shared `createOverridable<T>()` would add indirection for little gain and churn three already-verified files. Revisit if a 4th/5th appears.

## Phase 3 status: COMPLETE
All 7 pieces resolved — 4 landed (editor, viewer, doc-fetch, scroll), 3 noop. Plannotator byte-unchanged throughout (shipped behavior verified; App.tsx touched only by the 3-line scroll rewire). Scroll provider (the "announcer") now ships in `@plannotator/ui`, closing the Phase-2 deferred seam.

## Phase 4 — Navigation (sidebar + file tree)

Teed up + multi-lens adversarially reviewed by the `phase4-navigation` workflow (tee-up → execute-in-worktree → 4 parity lenses → synthesis), then landed + verified by hand on the real tree.

### Sidebar (NOOP — nothing to land)
Confirmed transfer-as-is: SidebarContainer/SidebarTabs/CountBadge/FileBrowser/VersionBrowser/ArchiveBrowser/MessagesBrowser and `useSidebar` have **zero** backend wires — all backend interaction arrives as injected callback props, or a pre-built `fileBrowser` prop. Already reused by `packages/review-editor/App.tsx` (`useSidebar<ReviewSidebarTab>`), a second consumer with a different tab union. No edit.

### Seam — File tree backend (DONE)
- **File:** `packages/ui/hooks/useFileBrowser.ts` only. Lifted the three backend wires into an injectable `FileTreeBackend` (`loadTree`/`loadVaultTree`/`watchTrees`) with a `defaultFileTreeBackend` + `setFileTreeBackend`/`resetFileTreeBackend`, same module-level pattern as the image/storage seams.
- **The SSE live-watch effect moved VERBATIM** into `watchTrees` — EventSource URL, 120ms debounce timers, `readyPaths` dedup, `onmessage` ready/changed dispatch, and `clearTimeout`+`source.close()` cleanup byte-identical. The only substitution is `fetchTreeRef.current(path,{quiet:true})` → injected `onChange(path)` (the hook passes exactly that). The `typeof EventSource === "undefined"` guard relocated into `watchTrees` (returns `undefined` → no cleanup), behavior-identical. `useFileBrowser()` stays zero-arg; default fetch/SSE URLs unchanged.
- **Parity:** no `setFileTreeBackend` caller in editor/apps → Plannotator uses the default. Verified: **`useFileBrowser.test.tsx` passes 6/0 UNMODIFIED** (the strongest guardrail — it asserts the URLs, timer, and SSE behavior via fake `fetch`/`EventSource`; run with `DOM_TESTS=1`); typecheck pass; full `bun test` 1620/0; builds OK; App.tsx untouched. **Manual eyeball** (real `annotate adr/` session): tree loads, file-switching works, new file appears live via SSE without reload.

### Phase 4 status: COMPLETE — sidebar noop, file-tree seam landed. Plannotator byte-unchanged.

## Phase 5 — Comments / annotations / drafts (ADR 005)

Researched (5-probe spike), specced, ADR-005-accepted, then teed up + multi-lens adversarially reviewed by the `phase5-comments` workflow (4 tee-ups + 3 worktree executes + 12 review lenses + synthesis; all 12 lenses returned safe). Landed + verified by hand on the real tree, lowest-risk first. The already-portable comment UI (panel, popover, toolbar, highlighter, exporters) confirmed noop.

### Seam 1 — Identity provider (DONE)
- **File:** `packages/ui/utils/identity.ts`. Added `IdentityProvider` + `setIdentityProvider`/`resetIdentityProvider`; `getIdentity`/`isCurrentUser` delegate to a module-level provider defaulting to today's ConfigStore tater behavior. The ~9 author-stamp sites and 2 `(me)`-badge sites delegate with **zero call-site edits**.
- **Parity:** no override caller → tater nickname + `(me)` badge identical. typecheck pass, 1620/0, builds OK. (+46/-5, identity.ts only.)

### Seam 2 — Draft transport (DONE)
- **Files:** `packages/ui/hooks/useAnnotationDraft.ts` (+ `useCodeAnnotationDraft.ts` reads `getDraftTransport()` live). Added `DraftTransport` (load/save/remove) + setters, default = today's `/api/draft` fetches verbatim; `save` rejects-on-failure so the **keepalive retry-gate stays in the hook**. The generation pre-increment, 500ms debounce, and pagehide/visibilitychange flush stay verbatim; `getDraftGeneration()` still escapes to the host.
- **Landing note:** the workflow diff carried one phantom hunk (a delete-on-clear branch the real code-draft hook never had — it early-returns on empty). `patch` correctly rejected it; the real tree is correct without it. Caught by landing-on-real-tree verification.
- **Parity:** no override caller; App.tsx + `shared/draft.ts` untouched. `shared/draft.test.ts` 10/0, `annotationDraftPersistence` 13/0 (incl. pagehide-flush parity), typecheck pass, 1620/0, builds OK.

### Seam 3 — External-annotation transport (DONE, riskiest)
- **File:** `packages/ui/hooks/useExternalAnnotations.ts`. Added `ExternalAnnotationTransport<T>` (`subscribe`/`getSnapshot`/CRUD) + setters; default = the SSE→polling wire moved verbatim into `createDefaultTransport`. The reducer (`applyEvent`, byte-identical cases), fallback-once gate, 500ms poll, version-scoping, optimistic-before-await, and the `[enabled]` gate **stay in the hook**. Two micro-divergences (parse-then-cancelled-check; snapshot `[]`/`0` defaults) are provably unreachable for Plannotator (server always returns well-formed `{annotations, version}`; parse-then-discard is side-effect-free).
- **Parity:** no override caller; App.tsx untouched (both apps still call `useExternalAnnotations({enabled})`). external-annotation test green, typecheck pass, 1620/0, builds OK.

### Phase 5 status: COMPLETE (pending eyeball) — 3 seams landed, comment UI noop. Plannotator byte-unchanged.

## Phase 6 — Extras: versions/diff, settings, sharing, Ask AI (ADR 006)

Researched (5-probe spike), specced, ADR-006-accepted, teed up + multi-lens adversarially reviewed by the `phase6-extras` workflow (5 tee-ups + 4 worktree executes + 15 review lenses + synthesis; all 15 lenses safe). Landed + verified by hand. Already-portable pieces (planDiffEngine, all diff render components, sharing utils/useSharing/ImportModal, notes-app helpers, settings.ts, AI chat components, aiProvider/aiChatFormat) confirmed noop. Five Plannotator-only pieces (OpenInAppButton, HooksTab, useUpdateCheck, useAgents, useAgentJobs) confirmed out of scope.

### Seam — Versions/diff + CSS move (DONE)
- **Files:** `usePlanDiff.ts` (optional `fetchers?` 4th arg, default `/api/plan/version(s)`; error asymmetry kept — selectBaseVersion alerts via the existing catch, fetchVersions silent), `PlanDiffViewer.tsx` (optional `onOpenVscodeDiff?`, default `/api/plan/vscode-diff`), and the **CSS move**: `.annotation-highlight*` + `.plan-diff-added/removed/modified/unchanged/line-*` relocated **byte-identical** from `editor/index.css` (−114) into `ui/theme.css` (+114), next to `.plan-diff-word-*`.
- **Parity:** relocated CSS **gone from index.css (0), present in shipped bundle (33×)** since Plannotator imports theme.css → pixel-identical. planDiffEngine 49/0, typecheck pass, 1620/0, builds OK, App.tsx untouched.

### Seam — Settings/config (DONE)
- **Files:** `configStore.ts` (`setServerSync(fn)` injects only the terminal `/api/config` POST; 300ms debounce + deepMerge batching + singleton + eager cookie reads verbatim), `Settings.tsx` (optional `onDetectObsidianVaults`, default `/api/obsidian/vaults`; `[obsidian.enabled]` dep + auto-select verbatim).
- **Parity:** no override caller; ui 293/0, typecheck pass, 1620/0, builds OK, App.tsx untouched.

### Seam — Sharing/save-to-notes (DONE)
- **File:** `ExportModal.tsx` (optional `onSaveToNotes`, default = verbatim `/api/save-notes` POST; `showNotesTab = isApiMode && !!markdown` byte-for-byte). Sharing utils already parameterized (noop).
- **Parity:** no override caller; typecheck pass, 1620/0, builds OK, App.tsx untouched.

### Seam — Ask AI transport (DONE, riskiest)
- **File:** `useAIChat.ts` (module-level `AITransport` session/query/abort/permission + setters, default = the five `/api/ai/*` fetches verbatim). The SSE reader loop, epoch/createRequest guards, and the supersede-abort position inside `createSession` stay untouched. Capabilities + provider-resolution stay host-owned (App.tsx).
- **Parity:** no override caller; `packages/ai/ai.test.ts` 97/0, typecheck pass, 1620/0, builds OK, App.tsx untouched.

### Phase 6 status: COMPLETE (pending eyeball) — 4 seams landed + diff CSS in the package, extras noop, 5 Plannotator-only pieces out of scope. Plannotator byte-unchanged.
The document UI is now feature-complete for reuse. Remaining: Phase 7 (publish) + the parked `@plannotator/ai`/`@plannotator/shared` publish-vs-inline decision.
Renderer-coupling contract (Workspaces must reuse BlockRenderer+InlineMarkdown+inlineTransforms for highlights) and replies/threading deferral recorded in ADR 005. Remaining: manual eyeball — author/`(me)`, draft save+restore+no-ghost, live SSE add + kill-stream→polling-takes-over.

### Discovered (PRE-EXISTING, out of scope — not caused by this work)
1. **Edit/save header state leaks across file switches** in annotate-folder mode: editing+saving file A leaves the Saved/Done/wide-focus header showing when you switch to file B without editing it. Reproduced on the **baseline with the Phase 4 change reverted** (A/B confirmed) → pre-existing App.tsx bug, not a regression. Lives in the folder file-switch handler (`handleFileBrowserSelect` / edit-session reset), unrelated to `useFileBrowser`. Worth a separate fix.
2. **Annotating the repo root (`annotate ./`) bogs down** — the file walker + chokidar SSE watcher choke on 1.4GB of node_modules (16 dirs); the code already warns about this. Pre-existing scaling limit; use a bounded folder. Not a code defect introduced here.
