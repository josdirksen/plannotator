# Prototype Design State — The Authoritative UI 2.0 Target

> Complete anatomy of the DiffKit **goal-prototype** (`/Users/ramos/oss/diffkit/apps/goal-prototype/`)
> plus its design-system packages (`@diffkit/ui`, `@diffkit/icons`). This prototype is the
> **authoritative target** for the UI 2.0 rewrite — not merely a reference. It was heavily refined
> and represents the critical outcome we want production to reach.
>
> Source handoffs: `HANDOFF.md`, `DASHBOARD-HANDOFF.md` in the prototype root.
> Companion doc: `legacy-design-state.md` (current production) and `transfer-map.md` (the diff + plan).

---

## 0. TL;DR — the target stack at a glance

| Layer | Prototype choice |
|---|---|
| Framework | **React 19.2** + TypeScript (strict, `react-jsx`) |
| Styling | **Tailwind v4.1.18** (`@tailwindcss/vite`, no JS config), inline `@theme`/`@source` in `globals.css` |
| Design system | **`@diffkit/ui`** workspace package — shadcn **"new-york"** style, **28 primitives**, all cva-driven |
| Class utils | `cn()` = `twMerge(clsx(...))` |
| Primitives | Radix UI (v1–v2) wrapped shadcn-style + **cmdk** (command palette) + **vaul** (mobile drawer) |
| Theme | **OKLch** tokens, **light-default (`:root`) + `.dark` class**, single diffkit theme (light+dark), **surface-0/1/2** elevation layers |
| Icons | **`@diffkit/icons`** (hugeicons-react wrapper + 6 custom SVG + brand logos) **and `lucide-react` used directly** throughout the app |
| State | **Plain React `useState` + `localStorage`** (the prototype has **no Zustand** — state is throwaway) |
| Routing | **None** — state-based view switching (`activeSessionId`, `activePR`) |
| Layout — code review | **Simple custom tab bar** (Dockview explicitly abandoned) |
| Layout — plan review | Custom resizable sidebar with **drag-to-close (60% snap)** + hover gutter + `[data-sidebar-panel]` CSS |
| Session nav | **shadcn offcanvas `Sidebar`** (`defaultOpen={false}`) + **Cmd+B/K/1–9** + cmdk command palette |
| Syntax highlighting | **Shiki 4.0.2** (fine-grained 27-lang bundle, dual-theme `diffkit-light`/`diffkit-dark`, cached) |
| Diff rendering | **`@pierre/diffs`** (`PatchDiff`, unified/split, word-alt, line selection) with custom Shiki diff themes |
| Markdown | `@m2d/react-markdown` + `remark-gfm` + `remark-github-blockquote-alert` + `rehype-raw` + Shiki (in `@diffkit/ui`); the plan editor itself uses a **simpler hand-rolled inline parser** |
| Fonts | **Inter Variable** (sans) + **Geist Mono Variable** (mono) via `@fontsource-variable/*` |
| Build | Plain **Vite** dev (`@tailwindcss/vite` + `@vitejs/plugin-react`), pre-hydration theme script in `index.html` |
| Design ethos | **Emil Kowalski principles** — no layout shift, tabular-nums, 44px touch targets, hover guards, no `transition: all`, reduced-motion, no card-in-card |

**Source-of-truth files:**
- `packages/ui/src/styles/globals.css` — tokens, `@theme` bridge, plugins, scrollbars, Shiki vars, alerts
- `packages/ui/components.json` — shadcn config (new-york, neutral, lucide)
- `packages/ui/src/lib/utils.ts` — `cn()`
- `packages/ui/src/lib/shiki-bundle.ts` / `shiki-themes.ts` / `diffs-themes.ts` — highlighting
- `apps/goal-prototype/src/main.tsx` — the shell (session model + offcanvas sidebar + command palette + view switching)
- `apps/goal-prototype/src/styles.css` — `grid-pattern`, `[data-sidebar-panel]`, drag-disable, `--card-shadow`, reduced-motion

---

## 1. CSS / Tailwind foundation

- **Tailwind v4.1.18** via `@tailwindcss/vite`, no PostCSS, no JS config. All config inline in `globals.css`.
- Plugins: **`tailwindcss-animate`** + **`@tailwindcss/typography`** (`@plugin`).
- `@source` globs: `../../../apps/**/*.{ts,tsx}` and `../**/*.{ts,tsx}` (broad — whole monorepo apps layer + the UI package).
- **Custom dark variant:** `@custom-variant dark (&:is(.dark *))` — i.e. **light is default (`:root`)**, `.dark` on a parent flips it. *(This is the OPPOSITE of production, which is dark-default + `.light`.)*
- **Typography scale** customized in `@theme` (text-sm…5xl with explicit line-heights, e.g. `--text-sm: 0.875rem / 1.45`, `--text-2xl: 1.375rem / 1.3`).
- **Base layer:** `body { font-size: 13px; font-weight: 450; }`, `code/.font-mono { letter-spacing: -0.02em; font-weight: 450; }`, `* { border-border outline-ring/50 }`.
- **Custom scrollbars:** thin thumb-only (`scrollbar-color: var(--border) transparent`), 6px WebKit, dark-mode hover uses `--surface-2`; `.overflow-stable` utility for layout-shift-free auto-hide.

### CSS entry layering (prototype)
- `packages/ui/src/styles/globals.css` — the design-system foundation (tokens, primitives base, Shiki, alerts, scrollbars).
- `apps/goal-prototype/src/styles.css` — app-level extras (grid-pattern, sidebar-panel transition, command-palette animations, code-token vars, print).

---

## 2. Theme system (tokens)

- **OKLch color space** throughout (`oklch(L C H)`).
- **Light-default:** `:root { … }` defines light tokens; **`.dark { … }`** overrides for dark. Class-based, applied pre-hydration by an inline `index.html` script reading `localStorage.theme`.
- **Single theme** (diffkit light + dark) — *not* a 50-theme system.

**Semantic tokens** (`--background/-foreground`, `--card(-foreground)`, `--popover(-foreground)`, `--primary(-foreground)`, `--secondary(-foreground)`, `--muted(-foreground)`, `--accent(-foreground)`, `--destructive(-foreground)`, `--border`, `--input`, `--ring`).

**Elevation — the surface layer system (key addition over stock shadcn):**
- Light: `--surface-0: oklch(0.967 …)`, `--surface-1: oklch(0.945 …)`, `--surface-2: oklch(0.925 …)`.
- Dark: `--surface-0: oklch(0.21 …)`, `--surface-1: oklch(0.245 …)`, `--surface-2: oklch(0.28 …)`.
- Convention: `bg-card` = content background, `bg-muted` = page background, `bg-surface-1` = elevated card/row, `bg-surface-2` = hover-on-surface-1. Fractional opacities (`/20 /30 /50`) used liberally for sub-surfaces.

**Other token groups:**
- `--chart-1` … `--chart-5` (data viz, 5 OKLch hues).
- `--brand` (green `oklch(0.68 0.2 150)`) + `--brand-dev` (yellow) — logo fills.
- `--container` (literal hex override).
- **Sidebar tokens:** `--sidebar`, `--sidebar-foreground/primary/accent/border/ring` (10 vars).
- **Markdown alert colors** (`--alert-color` per kind: note/tip/important/warning/caution) in OKLch, light + dark.
- **Radius:** `--radius: 0.625rem`; bridged to `--radius-sm/md/lg/xl` via `calc()`.
- **Shiki vars:** `--shiki-light` / `--shiki-dark` (token color switch); diff bg auto-switches light→`--background`, dark→`--surface-1`.

**`@theme inline` bridge** maps every token to Tailwind's `--color-*` namespace (`--color-background`, `--color-surface-0/1/2`, `--color-sidebar*`, `--color-chart-*`, `--color-brand*`, radius scale).

### App-level token extras (`apps/goal-prototype/src/styles.css`)
```css
:root {
  --card-ring: rgba(0,0,0,0.06);
  --card-shadow: 0 0 0 1px var(--card-ring), 0 1px 3px 0 rgba(0,0,0,0.04), 0 2px 8px -2px rgba(0,0,0,0.06);
  /* --code-keyword/string/number/boolean/comment/property/type/punctuation in oklch */
}
.dark { --card-ring: rgba(255,255,255,0.08); --card-shadow: …(darker); /* dark code tokens */ }
```
`--card-shadow` is the workhorse elevation for every content card across all surfaces (`shadow-[var(--card-shadow)]`).

---

## 3. Fonts

- **Inter Variable** (`@fontsource-variable/inter` ^5.2.8) — sans/body/UI.
- **Geist Mono Variable** (`@fontsource-variable/geist-mono` 5.2.7) — code/mono.
- *(No Instrument Sans — production has a third face the prototype doesn't.)*
- Stacks: sans = `"Inter Variable", "Inter", "Avenir Next", ui-sans-serif, system-ui`; mono = `"Geist Mono Variable", "SF Mono", ui-monospace, "Cascadia Code"`.

---

## 4. Animations & transitions

- **Reduced motion:** global `@media (prefers-reduced-motion: reduce)` zeroes animation/transition durations + `scroll-behavior: auto`.
- **Sidebar panel:** `[data-sidebar-panel] { transition: width 200ms cubic-bezier(0.16,1,0.3,1); }`, disabled mid-drag via `body[style*="user-select"] [data-sidebar-panel] { transition: none; }`.
- **Command palette:** `cmd-fade-in` (120ms) backdrop + `cmd-slide-in` (200ms, translateY+scale) dialog.
- **Keyframes** in `styles.css`: `fade-in`, `slide-in-right`, `toolbar-enter`, `finding-enter`, `approve-pulse` (expanding ring).
- `tailwindcss-animate` for `animate-in/out` utilities (dialogs, selects, tooltips).
- **No Framer/motion dependency** in the prototype (production uses `motion` v12 for tour/effects).

---

## 5. Dependencies (target inventory)

**`@diffkit/ui` package:**
- Core: react/react-dom ^19.2, typescript 5.7, tailwindcss 4.1.18.
- Variants/utils: `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.3.0, `tailwindcss-animate` 1.0.7.
- Radix (14 packages, v1.1–v2.2): alert-dialog, avatar, checkbox, collapsible, context-menu, dialog, dropdown-menu, label, popover, progress, select, separator, slot, switch, tabs, toggle, tooltip.
- Command/overlay: `cmdk` 1.0.0, `vaul` 1.1.2 (mobile drawer), `sonner` 2.0.1 (toasts).
- Markdown: `@m2d/react-markdown` 1.0.0, `remark-gfm` 4.0.1, `remark-github-blockquote-alert` 2.1.0, `rehype-raw` 7.0.0.
- Highlighting: `shiki` 4.0.2, `@shikijs/langs` 4.0.2, `@shikijs/rehype` 4.0.2.
- Typography: `@tailwindcss/typography` 0.5.19.
- Forms/widgets: `react-hook-form` 7.54, `react-day-picker` 8.10, `react-resizable-panels` 3.0.3, `next-themes` 0.4.4.
- Fonts: `@fontsource-variable/inter` 5.2.8, `@fontsource-variable/geist-mono` 5.2.7.

**Prototype app adds:** `@diffkit/file-tree` (ABANDONED — do not port), `@diffkit/icons`, `@mdxeditor/editor` (abandoned facts-notebook), `@pierre/diffs` 1.1.12, `lucide-react` 0.511.

---

## 6. Primitive layer — `@diffkit/ui` (28 components, the target shared library)

Location: `packages/ui/src/components/`. shadcn **new-york** style, baseColor **neutral**, CSS-vars mode, icon library **lucide**. Every component cva-driven where it has variants.

| Component | Notable shape / variants |
|---|---|
| **button** | variants: default/destructive/outline/secondary/ghost/link × sizes **xxs/xs/sm/default/lg/icon**. Built-in **`iconLeft`/`iconRight`** slots, auto SVG sizing, 3px `ring-ring/50`, `asChild` via Slot, base `text-[13px] font-medium rounded-md` |
| **card** | composition (Card/Header/Title/Description/Content/Footer), `rounded-xl border bg-card py-6 gap-6` |
| **badge** | default/secondary/destructive/outline, `rounded-md px-3 py-1 text-xs`, `[&>svg]:size-3`, `asChild` |
| **state-pill** (custom) | `tone`: open(green)/closed(red)/merged(purple)/muted/secondary — `rounded-full px-2 py-0.5 text-xs`, semantic PR/issue state |
| **sidebar** | compound (11 sub-components), context-based, `--sidebar-width: 244px / icon 3rem`, Cmd+B, localStorage persist, mobile→Sheet, variants sidebar/floating/inset, collapsible offcanvas/icon/none |
| **command** | cmdk wrapper — Command/Dialog/Input/List/Empty/Group/Item/Shortcut/Separator; `CommandDialog` top-[20%] max-w-2xl, kbd shortcut rendering |
| **markdown** | `@m2d/react-markdown` + remark-gfm + github-alerts + rehype-raw, **Shiki dual-theme** code, 32 component overrides, CopyButton overlay, GitHub alerts, asset-URL resolver context |
| **markdown-editor** | full comment editor: write/preview tabs, syntax overlay, **@mention autocomplete**, toolbar (⌘B/I/E/K/H/⇧./⇧8/⇧7/tasks), media drop, caret tracking, imperative `insertAtCaret`/`replaceUploadPlaceholder` |
| **dialog** | **responsive** — Radix Dialog desktop / vaul Drawer mobile (<768px), `bg-black/55 backdrop-blur-[2px]`, rounded-2xl |
| **tabs** | TabsList `bg-surface-1 p-px`, trigger active `bg-surface-0 shadow-sm`, nested radius via calc |
| **tooltip** | `bg-surface-2 text-[11px] rounded-md`, animate-in fade/slide |
| **callout** | variants default/info/warning/success/destructive, `rounded-lg px-4 py-2.5` + CalloutContent/Action |
| **logo** (custom) | parametrized SVG squircle (k=0.66) + 3×3 contribution grid, `fill-brand`/`fill-brand-dev` |
| **avatar** | Radix wrapper, `size-8 rounded-full`, AvatarImage/Fallback (`bg-muted`) |
| **breadcrumb** | nav/List/Item/Link/Page/Separator(ChevronRight)/Ellipsis — `text-sm gap-1.5` |
| **input / textarea** | `h-9 rounded-md`, focus `ring-[3px] ring-ring/50`, aria-invalid destructive; textarea `field-sizing-content` |
| **select / dropdown-menu / popover / context-menu** | standard Radix shadcn wrappers (Check indicators, animate zoom) |
| **sheet / drawer / resizable** | Radix Dialog-as-sheet / vaul / react-resizable-panels |
| **spinner / skeleton / progress / switch / checkbox / toggle / label / separator / table / alert / alert-dialog / calendar / sonner / form** | standard shadcn, minimal customization |

`cn()` (`lib/utils.ts`): `twMerge(clsx(inputs))`.

**What the prototype primitive layer has that production lacks:** a *single coherent* shared primitive set (production splits a partial `apps/frontend/.../ui/` shadcn layer from the older hardcoded-string `packages/ui/components/*`), plus `state-pill`, `command` (palette), `breadcrumb`, `avatar`, `callout`, `markdown-editor`, `logo`, surface-layer-aware `tabs`/`tooltip`, and button `iconLeft/iconRight` + `xxs/xs` sizes.

---

## 7. Icons

- **`@diffkit/icons`** (`packages/icons/`): wraps **hugeicons-react** (aliased, 70+ re-exported glyphs) + **6 custom SVG** (ActionsIcon, ArchiveDownIcon, FullScreenIcon, PenIcon, SeparatorHorizontalIcon, StarIcon) + **brand logos** (GitHubLogo, GitHubWordmarkLogo, XLogo, from svgl.app). API: `{ size?, strokeWidth? }` + full SVG props, `currentColor`, self-determining aria.
- **BUT** the prototype app itself imports **`lucide-react` directly** for almost everything (session icons Target/ListChecks/Code2/ScrollText/Home; UI Check/X/ChevronDown/Plus; code-review Bot/Crosshair/MapPin/Layers/FileCode/Locate; etc.). `@diffkit/icons` is barely used in the app surfaces.
- **Net target convention:** lucide-react as the working icon set (consistent sizing via `size={N}`), with a small custom/brand set for things lucide lacks.

---

## 8. Markdown & syntax highlighting

- **Highlighting is Shiki, not highlight.js.** `shiki-bundle.ts`: fine-grained 27-lang bundle (js/ts/jsx/tsx/json/html/css/bash/python/go/rust/ruby/java/c/cpp/swift/kotlin/php/csharp/yaml/toml/dockerfile/vue/svelte/sql/graphql/markdown/diff), JS regex engine, dual-theme (`diffkit-light`/`diffkit-dark`), HTML cache keyed `lang:code`, shell/alias map.
- **Themes** (`shiki-themes.ts`): hand-tuned token palettes — light keywords `#c41562`, strings `#107d32`, functions `#7d00cc`; dark keywords `#ff4d8d`, strings `#00ca50`, functions `#c472fb`.
- **`@diffkit/ui/markdown.tsx`** is the rich renderer (remark-gfm + github-blockquote-alert + rehype-raw, 32 overrides, alerts, asset resolver). **However the plan editor prototype does NOT use it** — it has its own line-by-line `parseBlocks()` + a regex `Inline()` renderer (bold/italic/code/links only) and calls `createMarkdownHighlighter()` for code blocks. So the prototype demonstrates *two* markdown paths; the production-grade one is `@diffkit/ui/markdown.tsx`.
- **Diff themes** (`diffs-themes.ts`): `quickhubLight`/`quickhubDark` Shiki themes for `@pierre/diffs`, mapping tokens to VS Code color model + ANSI + git decoration colors.

---

## 9. App shell — session model, view switching, navigation

**No router.** `apps/goal-prototype/src/main.tsx` switches views from two state vars:
```ts
type SessionType = "interview" | "facts" | "plan" | "review";
interface Session { id; type; title; needsAttention; completed; }
// view = activePR ? "pr-detail" : activeSession ? session.type : "dashboard"
```
- `SESSION_TYPE_META` maps each type → lucide icon + group label (Goal Setup / Facts Review / Plan Reviews / Code Reviews).
- Dashboard is the default (no session selected). Clicking a PR row sets `activePR` → PRDetail. Selecting a session sets `activeSessionId` → that surface.

**Offcanvas session sidebar** (shadcn `Sidebar collapsible="offcanvas"`, `SidebarProvider defaultOpen={false}`, `--sidebar-width: 16rem`):
- Header (logo "P" + session count), grouped session menu (by type, completed = strikethrough + green check, needsAttention = primary dot), footer theme toggle.
- **Why offcanvas (handoff rationale):** browsers shipped vertical tabs (2026) → a persistent left rail creates a "double sidebar." Fully hidden by default, slides in as overlay.

**Keyboard shell:** **Cmd+B** toggle sidebar, **Cmd+K** command palette (cmdk-style modal: search + sections Sessions/Appearance/View/Plan Headings, arrow-nav, kbd hints), **Cmd+1–9** positional session jump. `SidebarTrigger` is always the first element in each view's topbar.

**Internal sidebars are independent:** the plan editor's TOC/versions/archive sidebar and the code-review file tree are *within-session* tools with their own state — the offcanvas session sidebar overlays on top of everything and is unrelated.

---

## 10. Surface — Plan editor (`PlanEditor.tsx`, ~1425 lines)

- **Layout:** `flex h-full flex-col bg-muted` → topbar nav → content card (`rounded-xl bg-card shadow-[var(--card-shadow)]`) holding left sidebar | `<main>` | right annotation panel.
- **Topbar:** SidebarTrigger + "Plan Review" + (Feedback btn, Approve btn green-state-machine, panel toggle, **Grid3x3** grid toggle).
- **Block parser:** custom inline `parseBlocks()` (heading/code/blockquote/list-item/table/hr/paragraph) — NOT production `parser.ts`. Code blocks rendered via Shiki `codeToHtml({ themes: {light:"diffkit-light",dark:"diffkit-dark"} })` with regex fallback.
- **Annotation:** selection toolbar (Comment=blue MessageSquare, Delete=red Trash2) positioned over selection; annotation modes markup/comment/redline/label; pinpoint (Crosshair) block mode; right `AnnotationPanel` (cards with quote + comment, inline edit, copy-all footer). Persisted to localStorage.
- **Sidebar UX (port this exactly):** tabs TOC(List)/Versions(Clock)/Archive(Archive); resizable via gutter with `before:-inset-1.5` hover zone; **drag-to-close** — if drag width `< SIDEBAR_MIN * 0.6` (108px) snaps shut mid-drag; `[data-sidebar-panel]` drives the CSS transition; hover-reveal collapse chevron (`PanelLeftClose`) centered on gutter; thin `w-1` hover zone + `PanelLeftOpen` when closed. `SIDEBAR_MIN 180 / MAX 400 / DEFAULT 240`.
- **Grid view toggle (port this — 3 things change together):** `<main>` gets `grid-pattern bg-muted`; `<article>` becomes `rounded-xl border border-border/50 bg-card p-5 shadow-xl md:p-8 lg:p-10`; outer wrapper drops `p-2`→`p-0` and `bg-card shadow-…`→`bg-transparent`. localStorage `plannotator-grid-view`. **Gotcha:** original class `bg-grid` was silently dropped by `tailwind-merge` (conflicts with `bg-muted`) → renamed `grid-pattern`.
- **View modes:** default 860px / wide 1040px / focus 720px (max-width on content). **Ghost header:** sticky toolstrip clone that fades in when the real toolstrip scrolls away (IntersectionObserver sentinel).
- **Body constraints:** `max-w-3xl`, `tabular-nums`, `before:-inset-2` 44px touch targets.

---

## 11. Surface — Code review (`code-review/`, 12 files)

**The headline architectural decision: a simple state tab bar replaces Dockview.**

- **Root** (`index.tsx`): `flex h-full` → topbar → 3-panel (file tree aside | center [TabBar + content] | annotation sidebar aside), both asides mouse-resizable. Keyboard: Cmd+Enter submit, Cmd+B tree, Cmd+. sidebar, Cmd+\ focus, `[`/`]`/`j`/`k` file nav, `v` viewed, `a` all-files, `g` go-to-symbol, `1–9` tab, `?` help.
- **Tab model** (`tab-bar.tsx`): `Tab { id, type: "file"|"agent"|"tour"|"code-nav", label, file?, pinned? }`. Tabs open/switch/close; bar hides when ≤1 tab; per-type lucide icon (FileCode/Layers/Bot/MapPin/Crosshair); active = `bg-card` + top accent bar; annotation dot; +N/−M stats on active; close button unless pinned.
- **Diff** (`diff-viewer.tsx`): `@pierre/diffs` `PatchDiff` (unified/split, `lineDiffType:"word-alt"`, `enableLineSelection`, `onLineSelectionEnd`→pending annotation). Theme synced into Pierre's shadow DOM via `unsafeCSS` + MutationObserver on `html.dark`. Header has prev/next, copy-path, viewed toggle, options popover (style/wrap/indicators/line-diff/whitespace/tab-size).
- **File tree** (`file-tree.tsx`, uses abandoned fork — **port the UI patterns, not the fork**): **DiffTypePicker** (7 types: uncommitted/staged/unstaged/last-commit/merge-base/branch/all, each with label+desc), **BaseBranchPicker** (Local/Remote groups, "detected"/"default" badges), **viewed-state circles** (green check vs hollow, replacing file icons), **colored +N/−M** decorations.
- **Annotation sidebar** (`annotation-sidebar.tsx`): 4 tabs — **Notes** (annotations grouped by file, `L{n}` line refs, label badges), **AI** (chat: user/Sparkles avatars, typing dots, autosize textarea), **Agents** (job list + launch panel: provider picker, model/effort/reasoning segmented pickers, Run; status icon map), **PR** (mock PR comments with replies/resolve).
- **annotation-toolbar.tsx:** fixed bottom toolbar — CC label buttons, comment textarea, suggestion code block, image attach, ⌘Enter submit.
- **agent-panel.tsx:** full job view — header (status bg/icon), findings (issue/suggestion/info colored cards), summary box (confidence %), copy/kill, collapsible logs.
- **code-nav-panel.tsx:** symbol def/ref/type results grouped by file, kind badges (def green/ref blue/type purple), filter all/definition/reference.
- **tour-dialog.tsx:** guided stops — progress bar, greeting (stop 0), current stop + file:line, checklist, prev/mark-visited/next.
- **all-files-view.tsx:** sticky jump pills + IntersectionObserver scroll tracking + per-file accordion with inline `PatchDiff`.

**Data model** (`types.ts`): `ReviewFile {additions,deletions,path}`, `Annotation {id,filePath,lineStart,lineEnd,side,text,label?,createdAt}`, `TreeNode`, and **`CC_LABELS`** (conventional-comment set: praise/nit/suggestion/issue/question/thought, each with semantic color classes).

---

## 12. Surfaces — Goal interview + Facts review

- **GoalHeader** (text-only, no card — Emil "no card-in-card"): one `h1 text-lg font-semibold`, optional mono `tabular-nums` progress, one `text-[13px] text-muted-foreground` objective line.
- **Interview** (`App.tsx`): vertical collapsible question list; answer modes text/single/multi/multi-custom/custom; status dots (hollow/green-check/yellow-x); recommendation box with "Use"; skip-with-note; Tab/Shift+Tab advance, number-keys toggle options, Esc collapse; localStorage state.
- **Facts** (`FactsReview.tsx`): card list, per-fact accept/edit/comment/auto-verify(FlaskConical)/remove; hover-revealed actions with `@media(hover:hover)` guard; `before:-inset-2` 44px targets; inline textarea edit; auto-verify badge; accept-all.
- **Handoff note:** production's `GoalSetupSurface` (Interview + Facts) is **already more complete** than the prototype (Ctrl+U/K/J, CommentPopover, help dialog). These surfaces are **reference-only** — production wins; just reskin to the new tokens/primitives.

---

## 13. Surfaces — Dashboard + PR Detail (net-new)

These have **no production equivalent** (production has a `GitDashboard` in its landing carousel, but not these GitHub-grade pages). They define the dashboard look.

- **Dashboard** (`Dashboard.tsx`): `xl:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)]` — sticky metric sidebar (SmallMetricCard `rounded-lg px-3 py-2 hover:bg-surface-1`) + grouped PR list (Review requested / Open / Recently merged) with sticky `-top-px` headers. PR row = full-width button `rounded-xl px-3.5 py-2.5 hover:bg-surface-1` with status icon (green/purple/gray/red), title, `repo #n · @author · time`, review badge, `font-mono text-[10px]` +/− stats, comment count. `PullRequest` interface + 8-item `DEMO_PRS`.
- **PR Detail** (`PRDetail.tsx`): `xl:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]` — main (breadcrumb→header→body→activity) + sticky `top-10` sidebar. Header: PR icon, title, `@author wants to merge` + branch pills (`rounded-md bg-surface-1 font-mono text-xs`), stats bar (`bg-surface-1`, commits/files/+−, **5-square ratio viz** `h-2 w-2 rounded-sm` green/red, Review button). Body: minimal split-on-`\n\n` renderer (`##`/`###`/`-`/p). Activity: comment thread (avatar initials, reaction pills) + input. Sidebar: Labels (color pills), Reviewers (avatar+login+status), Participants (overlapping `-space-x-1.5` ring-2 stack), Details (key-value `tabular-nums`).

**Reusable pattern catalog (the dashboard design tokens):** metric cards, PR rows, sticky section headers, count badges (`rounded-full bg-surface-1 px-1.5 py-px text-[10px] tabular-nums`), status pills, label pills, avatar circles (h-6/h-7/h-8), reaction pills, branch pills, diff-ratio squares. Colors: green=open/approved, red=closed/changes, purple=merged, yellow=pending, surface-1/2 + muted-foreground. Single `xl` breakpoint throughout.

---

## 14. State & build (target shape)

- **State:** the prototype uses **plain `useState` + `localStorage`** only — there is **no Zustand**. This is throwaway prototype state; the production Zustand architecture (vanilla singleton stores + Immer, code-review slices) is the keeper. The prototype informs *what state exists per surface*, not *how to store it*.
- **Build:** plain Vite dev (`@tailwindcss/vite` + React plugin, `esbuild.tsconfigRaw:{}`), path alias `#/*`→`src`, pre-hydration theme script in `index.html` (`localStorage.theme` → `.dark` class), `color-scheme`/`theme-color` metas. Production's single-file embedded-in-daemon build is a separate concern the rewrite must preserve.

---

## 15. Design principles (Emil Kowalski — apply everywhere)

- **No layout shift:** `tabular-nums` on all counters; no font-weight change on hover.
- **Touch targets:** 44px via `before:-inset-2` pseudo-elements on action buttons.
- **Hover guards:** `@media(hover:hover)` on hover-revealed controls so touch users always see them.
- **No `transition: all`:** every transition names exact properties.
- **Reduced motion:** global `prefers-reduced-motion` zeroes durations.
- **No card-in-card:** GoalHeader is text-only; content card never nests a bordered container.
- **Body cap:** `max-w-3xl` (672px) on reading content.

---

## 16. What the prototype is — and is NOT

**It IS** the authoritative target for: the **token system** (OKLch + surface layers + card-shadow), the **shadcn `@diffkit/ui` primitive set**, **Shiki** highlighting, the **offcanvas session shell + command palette**, the **code-review tab model** (Dockview replacement), the **plan-editor sidebar drag-to-close + grid view**, the **dashboard/PR-detail surfaces**, and the **Emil design principles**.

**It is NOT** feature-complete. It deliberately omits / simplifies (production must keep these): the **50-theme** system, the **rich markdown** pipeline (mermaid, graphviz, wiki-links, code-file validation gate, hex swatches), **web-highlighter** + image annotator + external-annotations SSE, the **daemon/WebSocket** runtime + session persistence, the **project→worktree→session** resolution model, **plan-diff** word-level engine, the formal **keyboard-shortcut registry**, **AI session streaming**, and **git-add** staging. The abandoned bits — `@diffkit/file-tree` fork, `@mdxeditor` facts notebook, the Pierre Trees CSS hacks — are explicitly **do-not-port**.

The transfer is therefore: **keep production's feature-complete engine, adopt the prototype's design system and UX shape.** See `transfer-map.md`.

---

*Synthesized from a 5-agent parallel read-only exploration of `/Users/ramos/oss/diffkit` (`packages/ui`, `packages/icons`, `apps/goal-prototype`) plus `HANDOFF.md` / `DASHBOARD-HANDOFF.md`, 2026-05-30.*
