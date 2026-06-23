# Document UI Extraction — Phased Roadmap

Date: 2026-06-22 · Baseline commit: `30cfcebb`

> The order of operations for making `packages/ui` reusable by the commercial Workspaces app. Governed by **ADR 004**; the per-step detail (exact seams, files, line numbers) lives in the verified plan `adr/specs/document-ui-extraction-plan-verified-20260622-184500.md`; the safety net is `adr/implementation/document-ui-parity-checklist-20260622.md`.
>
> **THE LAW:** move + decouple, never rewrite. Plannotator's experience cannot change. Every step = lift a URL/global to an optional prop whose **default is today's literal**, logic untouched.
>
> **The rhythm, every step:** make one small change → run the parity checklist → confirm identical → commit → next. Small steps, a human eyeballing the result. No multi-day unattended runs.

## Phase ordering at a glance

| Phase | What | Risk to Plannotator | Can Workspaces start? |
|---|---|---|---|
| 0 | Safety net (parity baseline + checklist) | none (no code change) | — |
| 1 | Packaging unblock | none (invisible) | — |
| 2 | Three foundation seams (storage, image, scroll-context) | low | — |
| 3 | Rendering stack (theme, markdown, viewer, html, editor) | low | **Yes — after this** |
| 4 | Navigation (sidebar + file tree) | medium (file tree SSE) | builds on it |
| 5 | Comments / annotations / drafts | medium (move verbatim) | builds on it |
| 6 | Optional extras (versions, settings, sharing, AI) | low–medium | as needed |
| 7 | Glue cleanup + publish | low | consumes the published package |

---

## Phase 0 — Safety net (do once, before any code change)
**Goal:** be able to prove Plannotator didn't change after every step. **Risk:** none.
- [ ] Capture the automated baseline (Part A of the checklist): `typecheck`, `bun test` count, all three builds, bundle fingerprint → save to `scratchpad/parity-baseline.txt`.
- [ ] Keep a baseline build (and/or screenshots of each mode) to diff against.
- [ ] Confirm the checklist covers every mode you ship.

## Phase 1 — Packaging unblock (invisible; gates external install)
**Goal:** make `@plannotator/ui` installable by an outside repo, with zero runtime change. **Risk:** none (no pixel changes). See verified plan "Step 0."
- [ ] Add the missing `dompurify` dependency at the root's exact `^3.3.3`.
- [ ] Resolve the two internal `workspace:* / private` packages (`@plannotator/ai`, `@plannotator/shared`) — publish them, or inline the ~11 verified browser-safe subpaths the UI value-imports.
- [ ] Add a `peerDependencies` block (react, react-dom, tailwindcss, tailwindcss-animate, radix set, lucide-react); keep as devDeps for in-repo typecheck.
- [ ] Fix the stale `tsconfig.json:21` alias (points at a nonexistent file); align the `diff` version (`^8.0.3` → `^8.0.4`).
- [ ] Add a `files` allowlist (assets, sprites, themes; exclude `*.test.*`).
- [ ] Keep source-only exports (no dist build); document required consumer bundler settings.
- **Guardrail:** builds byte-identical; in-repo React still resolves to one copy.

## Phase 2 — Three foundation seams (everything else leans on these)
**Goal:** decouple the three cross-cutting pieces first so later phases are clean. **Risk:** low.
- [ ] **Storage adapter** — inject a `{getItem,setItem,removeItem}` into the cookie layer (`utils/storage.ts`); default = current cookie impl; **keep literal `plannotator-*` keys**. (Underlies ~24 modules — theme, layout prefs, identity.)
- [ ] **Image resolver** — the single `getImageSrc` shared by 5 consumers; module-level override, default = today's `/api/image` body verbatim, stable identity.
- [ ] **Scroll/layout context** — ship a `ScrollViewportContext` provider with the package (today its only provider lives in the glue at `App.tsx:3888`).
- **Guardrail:** identical cookie keys; all images emit identical URLs; sticky headers / TOC scroll / pinpoint unchanged.

## Phase 3 — Rendering stack (the first visible win)
**Goal:** a document renders with the Plannotator look outside the app. **Risk:** low (Viewer is the one "risky" item; gate its validation call). 
- [ ] Theme & tokens (`theme.css` + 51 `themes/*.css` + `print.css` as one atomic move).
- [ ] Markdown parsing + block rendering (BlockRenderer, blocks, inline transforms) — mostly transfer-as-is.
- [ ] Document Viewer — gate the unconditional `/api/doc/exists` validation (`Viewer.tsx:532`); default on.
- [ ] Doc-fetch seam for InlineMarkdown hover preview (`/api/doc`).
- [ ] Raw HTML viewer.
- [ ] Markdown editor (41-line shim over the published editor packages).
- **Milestone:** 👉 **Workspaces can start building in parallel here** — render docs while the rest proceeds.

## Phase 4 — Navigation (sidebar + file tree)
**Goal:** the file-tree experience Workspaces is built around. **Risk:** medium (file-tree live updates).
- [ ] Sidebar shell + tabs (`SidebarContainer`/`SidebarTabs`/`useSidebar`) — already prop-driven, transfer-as-is.
- [ ] File tree: lift `useFileBrowser`'s fetch URLs **and the entire SSE watcher effect verbatim** into a default object; `useFileBrowser()` stays callable with zero args.
- **Guardrail:** existing `useFileBrowser.test.tsx` stays green **without modification** (if it needs rewriting, the default changed).

## Phase 5 — Comments / annotations / drafts (the big one)
**Goal:** the core collaborative piece (teammates + agents commenting). **Risk:** medium — move the timing-sensitive parts verbatim. Last among core work because it touches the most.
- [ ] Draft transport seam (5 `/api/draft` fetches) — **document the 3-party draft-generation protocol** (escapes into approve/deny bodies; server tombstone-gates).
- [ ] External-annotations transport — move the **entire** SSE + polling-fallback effect verbatim into a default `subscribe()`.
- [ ] Identity seam — `author?`/`isCurrentUser?` props defaulting to the live `identity.ts` functions at the call site.
- **Guardrail:** approve/deny still carry the draft generation; live updates + fallback identical; `(me)` badge + author stamping intact. Note: highlight restoration is renderer-coupled — Workspaces must reuse BlockRenderer+InlineMarkdown as a unit.

## Phase 6 — Optional extras (only when Workspaces needs them)
**Risk:** low–medium. Do not build preemptively.
- [ ] Versions / plan diff (inject fetchers; optional `onOpenVscodeDiff`; resolve the diff CSS that lives in the app shell).
- [ ] Settings / config (configStore write-back seam; obsidian-detect seam; storage adapter from Phase 2).
- [ ] Sharing / export / notes (`onSaveToNotes` seam; keep notes-tab gate verbatim).
- [ ] Ask AI (extract only the 5 fetch literals behind a `transport`; **do not touch** the SSE reader loop or epoch guards; capabilities/provider-resolution stay in the shell).

## Phase 7 — Glue cleanup + publish
**Risk:** low.
- [ ] Move `packages/editor/wideMode.ts` → `packages/ui/utils/wideMode.ts` (pure move + one import-path edit).
- [ ] **Leave the coordinators in the glue** — right-panel/wide-mode/agent-terminal teardown, auto-open/close sidebar policy, tab-visibility + archive lazy-fetch, AI capabilities/provider init, panel-resize CSS-var writes. Workspaces writes its **own** thin coordinator over the same prop-driven primitives. (Re-deriving these generically is the forbidden path.)
- [ ] Publish `@plannotator/ui`; Workspaces installs and builds its own app/glue against it.

---

## Hard guardrails (never violate)
1. **Default === today's literal.** Every seam ships with the current behavior as the default; Plannotator passes nothing and is unchanged.
2. **Move verbatim, never re-derive.** Especially the SSE transports, draft-generation protocol, configStore batching, and AI reader loop — copy them; do not "simplify."
3. **Never change the storage default** — inject per host; keep `plannotator-*` keys.
4. **Keep glue coordinators opaque** — they entangle side effects; genericizing them is how the last attempt broke.
5. **Run the parity checklist after every step.** Green automated checks are not enough — eyeball the app.
6. **Never delete a working path until parity is confirmed by a human**, mode by mode.
