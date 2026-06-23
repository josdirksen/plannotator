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
