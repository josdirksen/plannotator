# Transfer Map — Production (legacy) → Prototype (target)

> The authoritative diff between **where production is** (`legacy-design-state.md`) and **where the
> prototype says we must land** (`prototype-design-state.md`), plus the migration strategy.
>
> **Framing:** the prototype is the *design + UX* target, not a feature target. Production is the
> *feature-complete engine*. The transfer = **keep production's engine, adopt the prototype's
> design system, primitives, shell UX, and surfaces.** Anything the prototype simplifies or omits
> that production already does richly (markdown, themes, daemon runtime, project resolution) is a
> capability we **preserve**, reskinned — not a regression we accept.

---

## 0. The shape of the diff

Three buckets:

1. **Adopt wholesale** (prototype is strictly better / net-new): the `@diffkit/ui` primitive set, surface-layer tokens + `--card-shadow`, Shiki, the offcanvas shell + command palette, the code-review tab model, the plan-editor sidebar/grid UX, the dashboard + PR-detail surfaces.
2. **Reconcile** (both have a strong but *different* model — needs a decision): dark-mode polarity, the 50-theme system, the session navigation model (project→worktree tree vs type-grouped offcanvas), the markdown pipeline, syntax highlighting swap, the code-review layout engine.
3. **Preserve & reskin** (production wins on capability; prototype only restyles): goal-setup surfaces, rich markdown features, daemon/WebSocket runtime, project resolution, plan-diff engine, keyboard registry, AI streaming, git-add, the single-file build.

---

## 1. Token & theme system

| Aspect | Production (legacy) | Prototype (target) | Action |
|---|---|---|---|
| Color space | OKLch (mostly) | OKLch | ✅ aligned |
| **Dark-mode polarity** | **Dark-default**, `.light` flips; `@custom-variant dark (&:not(.light *))` | **Light-default `:root`**, `.dark` class; `@custom-variant dark (&:is(.dark *))` | ⚠️ **RECONCILE** — opposite conventions. Every one of production's ~50 theme files is written dark-first. Flipping polarity is invasive. **Decision needed** (see §8). |
| Themes | **~50** (`packages/ui/themes/*.css`), dark + `.light` each | **1** (diffkit light+dark) | ⚠️ **RECONCILE** — keep multi-theme but re-tokenize, or collapse to diffkit-only? |
| Elevation | ad-hoc `--surface-0/1/2` (via color-mix) + `--card-shadow` + `bg-muted/30\|50` used inconsistently | **first-class `--surface-0/1/2`** + `--card-shadow`/`--card-ring`, consistent `bg-surface-1`/`/30`/`/50` + hover `surface-2` | ✅ **ADOPT** the prototype's disciplined surface convention; bake into every theme |
| Radius | `--radius 0.625` + sm/md/lg/xl | same | ✅ aligned |
| Tokens prod lacks | — | `--chart-1..5`, `--brand`/`--brand-dev`, `--alert-color` per kind, full sidebar token set | ✅ **ADD** to the token contract |
| Fonts | Inter + Geist Mono (pinned 5.2.7) + **Instrument Sans** | Inter + Geist Mono | keep production's set; Instrument Sans is extra, harmless |

**Net:** the token *contract* the rewrite targets = production's OKLch base **+ prototype's surface layers, card-shadow, chart/brand/alert tokens**. The two unresolved questions are **polarity** and **theme count**.

---

## 2. Primitive layer — the biggest structural win

| | Production | Prototype | Action |
|---|---|---|---|
| Shared primitives | **split brain**: partial shadcn in `apps/frontend/src/components/ui/` (~7: button/dialog/input/tabs/tooltip/sheet/sidebar) **+** older `packages/ui/components/*` (100+ files) using **hardcoded Tailwind strings**, no shared Button/Input | **one** `@diffkit/ui` package, **28 cva primitives**, new-york style | ✅ **ADOPT** `@diffkit/ui` as *the* shared primitive library; migrate `packages/ui/components/*` onto it |
| Button | basic cva (6 variants × xxs/xs/sm/default/lg/icon) | same + **`iconLeft`/`iconRight` slots** | adopt prototype's |
| Net-new primitives | — | **state-pill, command (palette), breadcrumb, avatar, callout, markdown-editor, logo** | ✅ bring across |
| Tabs/Tooltip | token-styled | **surface-layer aware** (`bg-surface-1 p-px`, active `bg-surface-0 shadow-sm`) | adopt |
| Dialog | Radix only | **responsive** Radix↔vaul-drawer | adopt (vaul already a prod dep) |

**This resolves the #1 tension in `legacy-design-state.md`** ("two styling conventions coexist"). The migration: stand up `@diffkit/ui` (or its equivalent inside `packages/ui`), then sweep `packages/ui/components/*` to consume primitives instead of raw utility strings.

---

## 3. Icons

| Production | Prototype | Action |
|---|---|---|
| Hand-rolled inline SVG brand set (`themeIcons`, `ProviderIcons`, `GitHubIcon`, …); `lucide-react` installed but **barely used**; no unified sizing | **`lucide-react` used directly everywhere** (`size={N}`) + small `@diffkit/icons` (hugeicons wrapper + 6 custom + brand logos) | ✅ **STANDARDIZE on lucide** as the working set with consistent `size`; keep a small custom set only for brand/provider glyphs lucide lacks (Claude/Codex/Pi/OpenCode, GitHub/GitLab). Resolves the "scattered hand-rolled icons" tension. |

---

## 4. Syntax highlighting & markdown

| | Production | Prototype | Action |
|---|---|---|---|
| Code highlight | **highlight.js** + `github-dark.css`, per-block `highlightElement` | **Shiki 4.0.2**, 27-lang bundle, dual-theme `diffkit-light/dark`, cached | ⚠️ **RECONCILE → adopt Shiki.** Premium, theme-token-aware, but heavier bundle + async. Touches every code block + the diff theming. |
| Diff theming | `@pierre/diffs` already in prod deps | Shiki `quickhubLight/Dark` injected into Pierre shadow DOM via `unsafeCSS` + MutationObserver | adopt the Pierre theme-sync approach |
| Markdown richness | **custom `parser.ts` → BlockRenderer + `InlineMarkdown` (20+ patterns)**: code-file links w/ validation gate, wiki-links, hex swatches, `#issue`/`@mention`, mermaid, graphviz, image zoom, external-annotation SSE | `@diffkit/ui/markdown.tsx` (remark-gfm + github-alerts + rehype-raw + Shiki, 32 overrides) **OR** the plan editor's own simpler inline parser | ⚠️ **PRESERVE production's richer pipeline** — the prototype markdown is *simpler*, do not regress mermaid/graphviz/wiki-links/code-file gate. Reskin production's renderers with Shiki + diffkit tokens; optionally use `@diffkit/ui/markdown` as the base and **port production's extra inline patterns onto it**. |
| Comment editor | — (annotation inputs are plain textareas) | **`markdown-editor.tsx`**: write/preview, @mention autocomplete, toolbar, media drop | ✅ net-new capability — adopt for annotation/PR-comment inputs |

**Markdown is the one place production > prototype in capability.** Treat the prototype as the *visual* target and production's parser as the *feature floor*.

---

## 5. Layout engines

| Surface | Production | Prototype | Action |
|---|---|---|---|
| **Code review** | **dockview-react** (IDE panels) | **simple state tab bar** (Dockview *explicitly abandoned*) | ⚠️ **RECONCILE → replace Dockview with the tab model.** Large change: `packages/plannotator-code-review/dock/` + `ReviewStateContext` (the context that feeds static dockview panels) go away; panels become tab content. Removes a whole dependency + the "panels can't take React props" workaround. |
| **Plan review sidebar** | custom resizable panels | **drag-to-close (60% snap) + hover gutter + `[data-sidebar-panel]` CSS** | ✅ **ADOPT** the prototype's gutter UX verbatim |
| **Plan grid view** | none | **grid-pattern + document-card toggle** | ✅ net-new — adopt (mind the `bg-grid`→`grid-pattern` twMerge gotcha) |

---

## 6. App shell & session navigation — the hardest reconcile

| | Production (post-#822) | Prototype | Tension |
|---|---|---|---|
| Routing | **TanStack Router** (`__root`/`index`/`s.$sessionId`), keep-alive `SessionSurface` per visited session | **no router**, state-based view switch | Production's router + keep-alive perf pattern is real infrastructure; prototype's no-router is a prototype shortcut. **Keep the router**, adopt the prototype's *visual* shell on top. |
| Session grouping | **project → worktree → session** tree (`AppSidebar`, from #822 project resolution) | **flat, grouped by session TYPE** (Plan/Code/Goal/Facts) | ⚠️ **RECONCILE.** Production's project/worktree model is richer and load-bearing (history keyed on it). The prototype's type-grouping is simpler/flatter. Likely: **keep project→worktree as the primary axis, layer type/status as secondary** — don't lose project resolution. |
| Sidebar mode | 244px desktop sidebar + `SidebarPeek` hover-reveal when collapsed | **offcanvas** (hidden by default, slides over) | ⚠️ **RECONCILE.** Prototype's offcanvas rationale (browser vertical tabs → no double sidebar) is sound. Decision: switch to offcanvas, or keep the peek-rail? |
| Command palette | none (only a KeyboardShortcuts modal) | **cmdk Cmd+K palette** (sessions + actions + headings) | ✅ net-new — adopt |
| Landing | 3-pane translateX carousel (project selector + ConjoinedSessionsHistory / GitDashboard / FullHistory) | **Dashboard** + **PR Detail** pages | reconcile: prototype's Dashboard/PRDetail are more GitHub-grade; fold production's git-dashboard data into them |

**This is where the most design discussion is needed** — the prototype flattened away the project→worktree model that #822 just built. The reconcile is "prototype UX shell, production data model."

---

## 7. Preserve & reskin (production wins, prototype only restyles)

These need **no architectural change** — just the new tokens/primitives/icons applied:

- **Goal setup** (Interview + Facts) — handoff confirms production's `GoalSetupSurface` is *more* complete than the prototype. Reference-only; reskin.
- **Plan-diff** word-level engine, **version history**, **annotation/web-highlighter**, **image annotator**, **external-annotations SSE**, **AI session streaming**, **git-add staging**, **PR switch/stack**, **code tour** (production already has a richer one) — keep, reskin.
- **Daemon / WebSocket runtime / session persistence / project resolution** — untouched by UI 2.0; the design layer sits above it.
- **Single-file embedded-in-daemon build** — keep; the prototype's plain-Vite setup is dev-only.

---

## 8. Open decisions (need your call before/within the rewrite)

> **RESOLVED 2026-05-30 — see `decisions.md`.** Locked: keep dark-first (#1), keep all ~50
> themes (#2), keep our project→worktree sidebar + no Cmd+K (#3), keep highlight.js (#4),
> keep our production-grade markdown (#6), rebuild primitives in `packages/ui` not vendored
> (#7). Code-review engine (#5) deferred. The original list is retained below for context.

1. **Dark-mode polarity** — flip production to light-default `:root` + `.dark` (match prototype, invasive across ~50 themes), or keep dark-default and adapt the prototype's tokens to it?
2. **Theme count** — keep the ~50-theme system (re-tokenized with surface layers etc.), or collapse to the single diffkit theme as the prototype implies?
3. **Session navigation** — offcanvas (prototype) vs the project→worktree tree + peek-rail (production #822). And how to merge type/status grouping with project/worktree grouping.
4. **Highlighting swap** — commit to Shiki (premium, heavier/async) vs keep highlight.js? (Prototype strongly implies Shiki.)
5. **Code-review engine** — confirm replacing Dockview with the tab model (removes `dock/` + `ReviewStateContext`).
6. **Markdown base** — extend `@diffkit/ui/markdown` with production's inline patterns, or keep production's `parser.ts` and only reskin it?
7. **Package boundary** — adopt `@diffkit/ui` as a vendored package, or rebuild its primitives inside `packages/ui`? (Plannotator's build embeds into the daemon binary — a new workspace dep is fine but must survive single-file bundling.)

---

## 9. Do-not-port (explicit from the handoff)

- **`@diffkit/file-tree`** — 22K-line Pierre Trees fork; CSS indentation overrides never worked (shadow DOM). Build a simpler tree or use Pierre as-is. **Port only the UI patterns** (DiffTypePicker, BaseBranchPicker, viewed circles, +N/−M decorations).
- **`@mdxeditor/editor` facts notebook** (`FactsNotebook.tsx`) — abandoned; card-based FactsReview is the right model.
- The Pierre Trees CSS-variable override hacks.

---

## 10. Suggested migration order (low-risk → high-risk)

1. **Token foundation** — land the surface-layer + card-shadow + chart/brand/alert token contract; resolve polarity & theme-count decisions (§8.1, §8.2). *Everything else depends on this.*
2. **Primitive library** — stand up the `@diffkit/ui` primitive set in the shared package; resolve the package-boundary decision (§8.7).
3. **Icon standardization** — lucide + small brand set, consistent sizing.
4. **Reskin the stable surfaces** — goal setup, plan viewer, annotation panels — onto new tokens/primitives (no behavior change). Validates the system end-to-end.
5. **Shell** — offcanvas + command palette + Dashboard/PR-detail, reconciled with the router + project→worktree model (§6).
6. **Plan-editor UX** — sidebar drag-to-close + grid view.
7. **Code-review engine swap** — Dockview → tab model (§5). Highest risk; do last.
8. **Highlighting swap** — highlight.js → Shiki + Pierre theme sync (can run parallel to 4–7).

Each step is independently shippable and reversible; nothing after step 1 blocks daemon/runtime work.

---

*Companion to `legacy-design-state.md` (current) and `prototype-design-state.md` (target). 2026-05-30.*
