# Legacy Design State — Complete UI & Styling Anatomy

> Snapshot of the current (pre–UI 2.0) design system across the shared UI package, the plan-review
> and code-review apps, and the frontend shell. Baseline reference for the `ui2point0` work.
> Branch: `ui2point0` (off `feat/single-server-runtime` @ 2cb76299).

---

## 0. TL;DR — the stack at a glance

| Layer | Choice |
|---|---|
| Framework | **React 19.2** + TypeScript |
| Styling | **Tailwind CSS v4.1.18** (Vite plugin, **no `tailwind.config.*`** — config is inline CSS via `@theme`/`@source`) |
| Class utils | `cn()` = **clsx + tailwind-merge**; variants via **class-variance-authority (cva)** |
| Primitives | **Radix UI** wrapped shadcn-style in `apps/frontend/src/components/ui/` |
| Theme | CSS-variable token system, **~50 themes**, dark-default + `.light` class; OKLch-based |
| Icons | **Hand-rolled inline SVG** components (plus `lucide-react` available as a dep) |
| State | **Zustand v5 + Immer** (vanilla singleton stores) |
| Routing | **TanStack Router v1** (frontend shell) |
| Layout | Code review uses **dockview-react** (IDE panels); plan review uses custom resizable panels |
| Markdown | custom block parser → renderers; **marked + DOMPurify**, **highlight.js**, **mermaid** + **@viz-js/viz** |
| Animation | CSS keyframes + global 150ms transitions + **motion** (Framer) v12 + **tailwindcss-animate** |
| Fonts | Inter Variable (sans), Geist Mono Variable (mono), Instrument Sans Variable — all via `@fontsource-variable/*` |
| Build | **Vite** + `vite-plugin-singlefile` → one HTML file embedded in the daemon binary |

**Source-of-truth files:** `packages/ui/theme.css` (tokens + global CSS), `apps/frontend/src/styles.css` (Tailwind entry + `@theme`/`@source`), `apps/frontend/src/lib/utils.ts` (`cn()`).

---

## 1. CSS / Tailwind foundation

- **Tailwind v4.1.18** via `@tailwindcss/vite` (no PostCSS, no JS config file). Configuration is **inline in CSS**.
- Entry: `apps/frontend/src/styles.css` (~288 lines) — imports fonts, `@plannotator/ui/theme.css`, `@import "tailwindcss"`, `@plugin "tailwindcss-animate"`.
- **Content scanning** via `@source` globs in `styles.css`:
  ```css
  @source "../src/**/*.{ts,tsx}";
  @source "../../../packages/plannotator-code-review/**/*.{ts,tsx}";
  @source "../../../packages/plannotator-plan-review/**/*.{ts,tsx}";
  @source "../../../packages/ui/components/**/*.{ts,tsx}";
  @source "../../../packages/ui/hooks/**/*.{ts,tsx}";
  ```
  ⚠️ **New `.tsx` dirs outside these globs get no CSS generated** — add a matching `@source` (already called out in CLAUDE.md).
- **Typography scale** customized in `@theme` (text-sm…5xl with explicit line-heights).
- Dark mode is a **custom variant**: `@custom-variant dark (&:not(.light *))` — i.e. dark is the default, `.light` on `<html>` flips it.

### Per-app CSS entry files
- `packages/ui/theme.css` — token bridge + global base (shared by everything).
- `packages/ui/print.css` — print stylesheet (`.plannotator-print`).
- `packages/plannotator-code-review/index.css` — dockview theming, review comments, conventional-comment labels, file tree, suggestions, code-tour animations, PR-switch loaders.
- `packages/plannotator-plan-review/index.css` — hljs light overrides, annotation highlights, plan-diff line styles.

---

## 2. Theme system (tokens)

- **~50 theme files** in `packages/ui/themes/*.css` (plannotator [default], dracula, github, nord, tokyo-night, rose-pine, gruvbox, caffeine, terminal, …).
- Each theme defines `.theme-{name}` (dark) and `.theme-{name}.light` (light overrides). Mostly **OKLch** color space (some RGB).
- **~24 semantic tokens** (CSS custom properties): `--background/-foreground`, `--card(-foreground)`, `--popover(-foreground)`, `--primary(-foreground)`, `--secondary`, `--muted(-foreground)`, `--accent(-foreground)`, `--destructive`, `--success`, `--warning`, `--border`, `--input`, `--ring`, `--font-sans`, `--font-mono`, `--radius` (0.625rem), plus theme-specific `--code-bg`, `--focus-highlight`.
- **Tailwind bridge** via `@theme inline` (in `theme.css` + `styles.css`): maps `--color-background: var(--background)` etc., plus radius scale (`--radius-sm/md/lg/xl`), **sidebar tokens** (`--color-sidebar*`), and **surface layers** (`--surface-0/1/2`, derived via `color-mix`).
- Derived extras in `@layer base`: `--card-ring`, `--card-shadow` (different opacity in light/dark), sidebar token aliases.
- Theme is applied **pre-hydration** by a script in `index.html` (flash prevention); persisted via cookies `plannotator-color-theme` / `plannotator-theme`. Managed by `ThemeProvider` (`packages/ui/components/ThemeProvider.tsx`).

---

## 3. Fonts

- Loaded locally via `@fontsource-variable/*` (no CDN), imported in `styles.css`:
  - **Inter Variable** (`@fontsource-variable/inter` ^5.2.8) — sans / body / UI.
  - **Geist Mono Variable** (`@fontsource-variable/geist-mono` **pinned 5.2.7**) — code/mono. *(Pin matters: 5.2.8 re-cut metrics broke the landing ASCII banner — see earlier fix.)*
  - **Instrument Sans Variable** (`@fontsource-variable/instrument-sans` ^5.2.8) — secondary.
- Stacks: sans = `"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif`; mono = `"Geist Mono Variable", "SF Mono", ui-monospace, monospace`.
- Global `body { font-feature-settings: "ss01","ss02","cv01"; }`. Individual themes can override `--font-sans`/`--font-mono`.

---

## 4. Animations & transitions

- **Global transition** on `*`: `color, background-color, border-color, box-shadow` @ 150ms `cubic-bezier(0.4,0,0.2,1)`. Suppressed on hidden keep-alive surfaces and before `html.transitions-ready`.
- Full `prefers-reduced-motion` support.
- **CSS keyframes** spread across `theme.css` (`file-flash`, `ai-cursor-blink`, `ai-menu-in`, `goal-pill-in`), `styles.css` (`fade-in`, `slide-in-right`, `toolbar-enter`, `approve-pulse`), and code-review `index.css` (large set for the **code tour**, plus `shimmer-slide`/`block-chase` loaders).
- **JS animation:** `motion` (Framer Motion) **v12.38.0** — used in `BorderTrail.tsx`, `TextShimmer.tsx`, and the tour components (`motion/react`).
- **`tailwindcss-animate` v1.0.7** for `animate-in/out` utilities.

---

## 5. Dependencies (UI-relevant, by purpose)

**Core:** react / react-dom **^19.2.3**, typescript.
**Styling/variants:** tailwindcss **4.1.18**, @tailwindcss/vite, tailwindcss-animate 1.0.7, class-variance-authority 0.7.1, clsx 2.1.1, tailwind-merge 3.6.0.
**Primitives (Radix):** dialog, popover, tooltip, tabs, dropdown-menu, context-menu, collapsible, checkbox, label, separator, slot (versions ^1.x–^2.x across `apps/frontend` + `packages/*`).
**Layout:** dockview-react **5.2.0** (code review IDE panels), vaul 1.1.2 (drawer), overlayscrollbars(-react) 2.11 / 0.5.6.
**State/routing:** zustand 5.0.13, immer 10.2.0, @tanstack/react-router 1.141, @tanstack/react-table 8.21.
**Markdown/diagrams:** marked 17, dompurify 3.3, highlight.js 11.11, mermaid 11.12, @viz-js/viz 3.25.
**Diff:** @pierre/diffs 1.1.x, diff 8.0.x.
**Annotation/draw:** @plannotator/web-highlighter 0.8.1, perfect-freehand 1.2.2.
**Icons/toasts:** lucide-react 1.14 (available; most icons are hand-rolled), sonner 2.0.7.
**AI SDKs:** @anthropic-ai/claude-agent-sdk, @openai/codex-sdk, @opencode-ai/sdk.

---

## 6. Primitives layer (shadcn-style)

- Location: `apps/frontend/src/components/ui/` — Radix wrappers: `button.tsx`, `dialog.tsx`, `input.tsx`, `separator.tsx`, `tabs.tsx`, `tooltip.tsx`, `sheet.tsx`, and a large `sidebar.tsx` (~500 lines, context-based layout system).
- `cn()` at `apps/frontend/src/lib/utils.ts`: `twMerge(clsx(inputs))`.
- Variants via **cva** — e.g. `button.tsx` has 6 variants (default/destructive/outline/secondary/ghost/link) × sizes (xxs/xs/sm/default/lg/icon), `Slot` for `asChild`, tokens-driven classes (`bg-primary`, `focus-visible:ring-ring/50`, etc.).
- **Note:** the shared `packages/ui/components/*` library predates this primitives layer and largely uses **hardcoded Tailwind utility strings** rather than the cva primitives — two coexisting styling conventions.

---

## 7. Shared component library (`packages/ui/components/`, 100+ files)

- **Viewer/rendering:** `Viewer.tsx` (doc + annotation engine), `BlockRenderer.tsx` (block dispatcher), `blocks/` (`CodeBlock`, `TableBlock`+`TableToolbar`+`TablePopout`, `AlertBlock`, `Callout`, `HtmlBlock`, `proseBody`), `InlineMarkdown.tsx`.
- **Annotation system:** `AnnotationPanel`, `AnnotationSidebar`, `AnnotationToolbar`, `AnnotationToolstrip`, `CommentPopover`, `InlineAnnotation`, `FloatingQuickLabelPicker`, `EditorAnnotationCard`.
- **Plan diff:** `plan-diff/` (`PlanDiffViewer`, `PlanDiffModeSwitcher`, `PlanDiffBadge`, `PlanCleanDiffView`, `PlanRawDiffView`, `VSCodeIcon`).
- **Sidebar:** `sidebar/` (`SidebarContainer`, `SidebarTabs`, `FileBrowser`, `VersionBrowser`, `CountBadge`).
- **Settings:** `settings/` (General/PlanGeneral/PlanDisplay/Files/Labels/Hooks/Saving tabs + shared controls).
- **Diagrams:** `MermaidBlock.tsx`, `GraphvizBlock.tsx` (zoom/pan).
- **Image/draw:** `ImageAnnotator/` (Canvas + Toolbar + perfect-freehand), `ImageThumbnail`, `AttachmentsButton`.
- **Modals/overlays:** `ConfirmDialog`, `ExportModal`, `ImportModal`, `DiffTypeSetupDialog`, `CompletionOverlay`, `CompletionBanner`, `PopoutDialog`, `Popover`, `Tooltip`.
- **Misc:** `Toolbar`/`ToolbarButtons`, `ResizeHandle`, `OverlayScrollArea`, `StickyHeaderLane`, `TableOfContents`, `SearchableSelect`, `ActionMenu`, `ModeToggle`, `KeyboardShortcuts`, `UpdateBanner`, `DocBadges`, `ListMarker`, effects (`BorderTrail`, `TextShimmer`), and Tater mascot sprites.

---

## 8. Icons

- **Hand-rolled inline-SVG React components** (no icon-library dependency for the brand set), each accepting `className` for size and using `currentColor` (or hardcoded brand colors):
  - `icons/themeIcons.tsx` (`SunIcon`/`MoonIcon`/`SystemIcon`), `SparklesIcon` (animatable, AI), `ProviderIcons.tsx` (`ClaudeIcon`/`CodexIcon`/`PiIcon`/`OpenCodeIcon` + `PROVIDER_META` map), `GitHubIcon`, `GitLabIcon`, `RepoIcon`, `PullRequestIcon`, `ReviewAgentsIcon`, `plan-diff/VSCodeIcon`.
- `lucide-react` (1.14) is installed and available, but the brand/UI glyphs above are custom. Inline icons in flex rows get `flex-shrink-0`.

---

## 9. Markdown rendering pipeline

- Parser: `packages/ui/utils/parser.ts` → `parseMarkdownToBlocks()` → flat `Block[]` (heading, blockquote/GitHub-alert, list-item w/ checkboxes, code w/ fenced language, table, hr, html, directive `:::kind`, paragraph).
- `BlockRenderer.tsx` dispatches each type to a renderer (token-styled with `text-foreground/90`, `border-l-2 border-primary/50` blockquotes, etc.).
- **Inline:** `InlineMarkdown.tsx` — 20+ patterns: bold/italic/strikethrough, inline code (or `CodeFileLink` if it resolves to a repo path), bare-URL autolink, `<autolinks>`, `~~del~~`, hex-color **swatches**, `#issue` refs, `@mentions`, `[[wiki-links]]`, images (zoomable), links (routed to linked-doc/code-file/anchor/external), emoji shortcodes, smart punctuation. Code-file links have a **validation gate** (found/ambiguous/missing) with hover preview popovers.
- **HTML blocks:** `marked.parse()` → `DOMPurify.sanitize()` (allowlisted tags/attrs) → `ref.innerHTML` (so `<details open>` DOM state persists), then relative-ref rewrite.
- **Syntax highlighting:** highlight.js, **`github-dark.css`** theme, per-block `highlightElement` (fallback `highlightAuto`), ext→lang map.
- **Diagrams:** mermaid (dark theme config) + @viz-js/viz, both with zoom/pan via viewBox.

---

## 10. Plan-diff visual system

- **Clean view** (`PlanCleanDiffView`): word-level `<ins>/<del>` with `color-mix` success/destructive backgrounds (`.plan-diff-word-added/removed`, `box-decoration-break: clone`); block states `added/removed/modified/unchanged` with hover/annotate rings (`ring-1 ring-primary/30`, `ring-2 ring-accent`).
- **Raw view** (`PlanRawDiffView`): monospace git-style, +/- gutter, line-number column, `.plan-diff-line-added/removed` row backgrounds.
- **Badge** (`PlanDiffBadge`): `+N / -M` in `success/70` + `destructive/70`, active state `bg-primary/15`.

---

## 11. Frontend shell (apps/frontend)

- **Routing:** TanStack Router (`app/router.tsx`, `routeTree.gen.ts` auto-generated). Routes: `__root.tsx` (wraps `Layout`), `index.tsx` (→ `LandingPage`), `s.$sessionId.tsx` (validates id, loads `getSessionBootstrap`, activates session).
- **Shell:** `main.tsx` → `ThemeProvider` + `RouterProvider`. `app/Layout.tsx` provides `SidebarProvider` + `TooltipProvider`, renders `AppSidebar` + `SidebarPeek` + a `<main>` that holds the landing `Outlet` **and one absolutely-positioned `SessionSurface` per visited session** (inactive ones use `content-visibility: hidden` + `contain-intrinsic-size` — a "keep-alive tabs" perf pattern). Cmd/Ctrl+, toggles settings.
- **Session embedding:** `components/sessions/SessionSurface.tsx` mounts `ReviewAppEmbedded` or `PlanAppEmbedded` by `session.mode`, wrapped in `SessionProvider`; imports both apps' CSS.
- **Landing/dashboard:** `components/landing/LandingPage.tsx` (~737 lines) — **three-pane translateX carousel**: (0) project selector + `ConjoinedSessionsHistory`, (1) `git-dashboard/GitDashboard`, (2) `FullSessionsHistoryView`. ASCII banner; `ProjectTable`/`ProjectNode` (PRs tab via `buildStacks`, Worktrees tab); `ActiveSessionRow`/`HistoryRow`.
- **Sidebar:** `components/sidebar/AppSidebar.tsx` (project→worktree→session tree, depth indent via `row-style.ts`, Radix collapsible), `SidebarPeek.tsx` (hover-reveal when collapsed), `components/ui/sidebar.tsx` (244px desktop / 260px mobile / 3rem icon, breakpoint 1024px, localStorage `sidebar_state`).
- **Daemon integration:** `daemon/api/client.ts` (`DaemonApiClient`, Bearer auth), `daemon/events/*` (WebSocket hub → `event-store`, auto-reconnect/polling), `use-daemon-events.ts` (wired in Layout).

---

## 12. UI state (Zustand)

- **Vanilla singleton stores + Immer** (`enableMapSet()` for Set/Map):
  - `stores/app-store.ts` — `activeSessionId`, `visitedSessions`, `expandedProjects: Set`, `collapsedWorktrees: Set`, dialog flags; `activateSession/deactivateSession`.
  - `stores/project-store.ts` — projects list, add/remove.
  - `stores/history-store.ts` — history entries, lazy fetch.
  - `stores/git-dashboard-store.ts` — aggregated PRs (dedup + sort).
  - `daemon/events/event-store.ts` — daemon connection state + live sessions (this one uses `create()`, not vanilla).
- **Code-review store** (`packages/plannotator-code-review/store/`): slices `annotations` (hot path) + `diff-options` + `files`, Immer middleware, selectors; provided via `ReviewStoreProvider`. Plus a `ReviewStateContext` to feed static dockview panels (which can't take React props).
- **Config store** (`packages/ui/config/configStore.ts`): settings persisted to localStorage — **the one store NOT on Immer** (recently moved to a Zustand vanilla store).

---

## 13. The two embedded apps

- **Plan review** — `packages/plannotator-plan-review/App.tsx` (~103 KB monolith). Tree: `ThemeProvider`→`OverlayScrollArea`→ `SidebarContainer/SidebarTabs` (TOC/Versions/Files) + `Viewer` (blocks + annotation toolbar/popover) + right `AnnotationPanel`/`DocumentAIChatPanel`. Features: responsive label mode (ResizeObserver), linked-doc navigation, wide mode, plan diff, export/import, goal-setup surface.
- **Code review** — `packages/plannotator-code-review/App.tsx` (2600+ lines). **dockview** center with panels: `ReviewDiffPanel`, `ReviewAllFilesDiffPanel`, `ReviewPRSummary/Comments/Checks`, `ReviewAgentJobDetail`, `ReviewCodeNav`. Left `FileTree` (React.memo'd nodes), right `ReviewSidebar` (Annotations/AI). Hooks: `useCodeNav`, `useAIChat`, `useReviewSearch`, `usePRSession`, `usePRStack`, `useGitAdd`. Code-tour subsystem with heavy motion.

---

## 14. Build

- `apps/frontend/vite.config.ts`: plugins = TanStack Router, React, `@tailwindcss/vite`, **`vite-plugin-singlefile`**. Build target esnext, `assetsInlineLimit`/`chunkSizeWarningLimit` 100MB, `cssCodeSplit: false`, `inlineDynamicImports: true` → **one self-contained HTML** verified by `scripts/verify-single-file-build.ts` and embedded/served by the daemon binary.
- Dev: port 3002, proxies `/daemon/*` and `/s/:id/api` to the discovered daemon (`~/.plannotator/daemon.json`, Bearer auth). `bun run dev:frontend`.
- Path aliases: `@` → src; `@plannotator/{code-review,plan-review,ui,shared}` → packages (with `/styles` subpaths to each app's `index.css`).

---

## 15. Characterization & notes for UI 2.0

**Strengths to preserve**
- Single token system (`theme.css`) with ~50 themes and clean Tailwind-v4 bridge — theming is centralized and powerful.
- Radix + cva primitives in `apps/frontend/src/components/ui/` are the modern, accessible baseline.
- Strong markdown/diff/diagram rendering already in place.

**Tensions / debt the 2.0 work will hit**
- **Two styling conventions coexist:** the new `ui/` cva primitives vs. the older `packages/ui/components/*` with hardcoded Tailwind strings. No shared Button/Input/etc. across the shared library.
- **Two monolith `App.tsx` files** (plan ~103KB, review 2600+ lines) concentrate most layout/state — also the contested ground for the deferred keyboard-registry + performance work.
- **Icons are hand-rolled** and scattered as individual components; `lucide-react` is present but underused — no unified icon set/sizing convention.
- **CSS is spread** across `theme.css`, `styles.css`, two app `index.css` files, and `print.css`; animations especially are duplicated across them.
- **`@source` coupling:** any new component directory needs a matching `@source` glob or its classes silently no-op.
- **dockview** (code review) vs **custom resizable panels** (plan review) — two different layout engines.
- Surface/elevation is partly ad-hoc (`--surface-0/1/2`, `--card-shadow`, `bg-muted/30|50` opacities used inconsistently).

**Open question for 2.0 scope:** unify the primitive layer + icon set + elevation/surface tokens across both apps and the shared library, vs. a targeted reskin on top of the existing structure.

---

*Generated from a parallel read-only exploration of `packages/ui`, `packages/plannotator-plan-review`, `packages/plannotator-code-review`, and `apps/frontend` on branch `ui2point0`.*
