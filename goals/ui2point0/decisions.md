# UI 2.0 — Locked Decisions

> Authoritative decision log for the UI 2.0 work. These resolve the "open forks" from
> `transfer-map.md` §8. Once recorded here, treat them as settled unless explicitly revisited.
>
> Guiding principle: **adopt the prototype's design system and look; keep production's
> feature-complete engine.** The prototype is a visual/UX target, not a feature target.

---

## Locked (2026-05-30)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | **Dark-mode polarity** | **Keep dark-first** (`.light` flips). No polarity flip. | Production ships ~50 dark-first themes; flipping is invasive and unnecessary. We adapt ported primitives to our polarity, not the reverse. |
| 2 | **Theme count** | **Keep all ~50 themes.** "Simple" is one addition, not a replacement. | The theme library is a strength worth preserving. New surface/elevation tokens get folded into themes additively. |
| 3 | **Session navigation / sidebar** | **Keep the production sidebar we built** (project → worktree → session, #822). Adopt the prototype's *visual styling*, not its offcanvas model. | The project→worktree→session model is load-bearing (history keying) and richer than the prototype's flat type-grouping. |
| 4 | **Command palette (Cmd+K)** | **Do NOT build.** Out of scope. | The prototype's cmdk palette is not wanted. No Cmd+K work. |
| 5 | **Syntax highlighting** | **Keep highlight.js.** No Shiki swap. | Shiki is heavier/async and touches every code block + diff theming. Not worth it now; revisit only if a concrete need appears. |
| 6 | **Markdown rendering** | **Keep production-grade rendering** (`parser.ts` + `BlockRenderer` + `InlineMarkdown`, with mermaid, graphviz, wiki-links, code-file validation, hex swatches, etc.). | The prototype's markdown is a deliberately minimal prototype. Production is far richer; the prototype is reference-only here. We restyle our renderers, never regress their capability. |
| 7 | **Primitive package boundary** | **Rebuild primitives inside `packages/ui`.** Do NOT vendor `@diffkit/ui`. | Already settled by action. Vendoring pulls heavy deps (shiki/cmdk/etc.) and a light-default polarity that clashes with ours. Our `packages/ui/components/ui/*` is the shared primitive home. |

## Deferred (no decision now)

| # | Topic | Status |
|---|-------|--------|
| 8 | **Code-review layout engine** (Dockview vs prototype's tab bar) | **Deferred.** Code-review app, out of current (plan-app) scope. Revisit when we turn to code review. |

---

## What this means for the plan reskin

We proceed in **production's conventions**: dark-first, all 50 themes intact, highlight.js, our markdown engine, our sidebar. The reskin swaps the plan app's hand-rolled inline Tailwind for the new `packages/ui` primitives + lucide icons — a **styling-layer change only**, no behavior or capability change.

---

*Companion to `legacy-design-state.md`, `prototype-design-state.md`, `transfer-map.md`. 2026-05-30.*
