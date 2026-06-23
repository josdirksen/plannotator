# Spike: Document UI Reuse Inventory (for Workspaces)

Date: 2026-06-22

> ⚠️ **SUPERSEDED — first draft, materially incomplete.** A 36-agent verification found this audited only one coupling axis (literal `/api/` strings) and missed five others — most importantly: **Viewer is not actually "clean"** (fires `/api/doc/exists` on mount), an **uncounted cookie-persistence layer** (`storage.ts`, ~24 modules), **3 React contexts + a global identity singleton**, **SSE/EventSource** transports, and harder-than-stated **packaging blockers**. Use the verified version instead: **`adr/specs/document-ui-extraction-plan-verified-20260622-184500.md`**. Kept here as the first-pass record.

> Companion to **ADR 004** (`adr/decisions/004-reuse-document-ui-as-published-building-blocks-20260622-180637.md`). This is the concrete lay-of-the-land for sharing Plannotator's document UI with the commercial Workspaces app: what exists, what is reusable as-is, what is wired to Plannotator's backend, and a first-cut order of work. Read 004 first for the *why* and the safety rules.

## The shape in one paragraph

The document UI is two buckets. **Bucket 1 — `packages/ui`** (~39,400 lines, 108 components + 31 hooks + ~45 utils) is the reusable library: rendering, file browser, sidebar, editor, theme. **Bucket 2 — `packages/editor/App.tsx`** (4,685 lines, ~276 stateful hooks, 13 server fetches) is the Plannotator-specific *glue* that fetches Plannotator data and assembles it into the app. **Bucket 1 is what we share. Bucket 2 stays Plannotator's; Workspaces writes its own equivalent glue.** Of the 108 components, only **26 files** call Plannotator's server directly — those are the wires to cut. The other ~82 already take their data from the outside and are reusable as-is.

## Bucket 1: `packages/ui` component library

| Folder | Count | What it is | Workspaces relevance |
| --- | --- | --- | --- |
| `components/` (top level) | 65 | Viewer, MarkdownEditor, AnnotationPanel, modals, toolbars, etc. | Core |
| `components/blocks/` | 8 | Markdown block renderers (code, table, callout, alert, HTML…) | Core (doc rendering) |
| `components/sidebar/` | 7 | SidebarContainer, SidebarTabs, FileBrowser, VersionBrowser, ArchiveBrowser, MessagesBrowser, CountBadge | Core (sidebar + file tree) |
| `components/html-viewer/` | 1 | Raw HTML viewer | Core |
| `components/plan-diff/` | 6 | Plan version diff viewer | Maybe (Workspaces has version history) |
| `components/ImageAnnotator/` | 3 | Annotate images | Maybe |
| `components/ai/` | 2 | Ask-AI chat panel | Maybe (own AI) |
| `components/ui/` | 8 | Low-level primitives (buttons, dialogs…) | Core |
| `components/core/` | 2 | Shared core | Core |
| `components/icons/` | 4 | SVG icons | Core |
| `components/settings/` | 1 | Settings tab(s) | Partial |
| `components/goal-setup/` | 1 | Plannotator goal workflow | Plannotator-only |

Plus `packages/ui/theme.css` (the theme/color tokens — pure, fully reusable), 31 hooks, ~45 utils, and `shortcuts/` (keyboard registry).

## The 26 backend-coupled files (the wires to cut)

Grouped by purpose. "WS" = does Workspaces need it.

### Document rendering — WS: YES (do first)
| File | Calls | Note |
| --- | --- | --- |
| `components/blocks/HtmlBlock.tsx` | `/api/image` | image src in markdown |
| `components/ImageThumbnail.tsx` | `/api/image` | image thumbnails |
| `components/InlineMarkdown.tsx` | `/api/doc` | inline linked-doc loads |
| `hooks/useLinkedDoc.ts` | `/api/doc` | navigate doc → doc |
| `hooks/useValidatedCodePaths.ts` | `/api/doc/exists` | validate code-file links |
| `components/AttachmentsButton.tsx` | `/api/upload` | attach images to comments |

### File tree / browser — WS: YES (core to Workspaces)
| File | Calls | Note |
| --- | --- | --- |
| `hooks/useFileBrowser.ts` | `/api/reference/files`, `/api/reference/files/stream`, `/api/reference/obsidian/*` | the file tree data source |

### Comments / annotations / drafts — WS: YES (agents + teammates commenting)
| File | Calls | Note |
| --- | --- | --- |
| `hooks/useAnnotationDraft.ts` | `/api/draft` | autosave annotation drafts |
| `hooks/useCodeAnnotationDraft.ts` | `/api/draft` | autosave code annotations |
| `hooks/useExternalAnnotations.ts` | `/api/external-annotations`, `/api/external-annotations/stream` | **agents posting comments** — directly relevant to Workspaces |

### Versions / diff — WS: MAYBE (Workspaces has version history)
| File | Calls | Note |
| --- | --- | --- |
| `hooks/usePlanDiff.ts` | `/api/plan/version`, `/api/plan/versions` | version list + fetch |
| `components/plan-diff/PlanDiffViewer.tsx` | `/api/plan/vscode-diff` | opens VS Code (Plannotator-local; WS would drop this one button) |

### Settings / config — WS: PARTIAL (Workspaces feeds its own config)
| File | Calls | Note |
| --- | --- | --- |
| `config/configStore.ts` | `/api/config`, `/api/diff`, `/api/plan` | app config bootstrap |
| `config/settings.ts` | `/api/config` | settings load/save |
| `components/Settings.tsx` | `/api/ai/capabilities`, `/api/config`, `/api/obsidian/vaults` | settings panel |
| `components/settings/HooksTab.tsx` | `/api/config`, `/api/hooks/status` | Plannotator hooks tab (WS drops) |

### Sharing / export / open-in — WS: PARTIAL (Workspaces has its own sharing)
| File | Calls | Note |
| --- | --- | --- |
| `utils/sharing.ts` | `/api/paste`, `/api/paste/` | short-URL share |
| `components/ExportModal.tsx` | `/api/save-notes` | save to Obsidian/Bear/Octarine |
| `components/OpenInAppButton.tsx` | `/api/open-in`, `/api/open-in/apps` | open in local app (local-only; WS drops) |

### Ask AI / code-review agents — WS: NO / OWN
| File | Calls | Note |
| --- | --- | --- |
| `hooks/useAIChat.ts` | `/api/ai/*` | Ask-AI streaming (WS would wire its own AI) |
| `hooks/useAgents.ts` | `/api/agents` | agent provider detection |
| `hooks/useAgentJobs.ts` | `/api/agents/*` | code-review agent jobs (review feature, not docs) |

### Archive / editor-annotations / plan-injection — WS: NO (Plannotator-only)
| File | Calls | Note |
| --- | --- | --- |
| `hooks/useArchive.ts` | `/api/archive/*`, `/api/done`, `/api/plan` | Plannotator plan archive |
| `hooks/useEditorAnnotations.ts` | `/api/editor-annotation(s)` | VS Code editor annotations |
| `components/goal-setup/GoalSetupSurface.tsx` | `/api/goal-setup/submit` | Plannotator goal workflow |
| `utils/planAgentInstructions.ts` | `/api/external-annotations`, `/api/plan` | plan-time prompt injection |

### Tally
- **~10 coupled files Workspaces clearly needs** (rendering + file tree + comments).
- **~6 partial** (settings/config/sharing — Workspaces supplies its own source through the same shape).
- **~10 Plannotator-only** (archive, goal-setup, hooks, VS Code, code-review agents, open-in) — Workspaces simply won't mount these; no work needed beyond not importing them.

## Bucket 2: the glue (`packages/editor/App.tsx`)

4,685 lines, ~276 stateful hooks, 13 fetches. This is **not shared.** It is Plannotator's assembly layer: it bootstraps from `/api/plan`, runs the approve/deny hook flow, owns sidebar/panel/wide-mode layout state, and feeds everything into the Bucket-1 components. Workspaces writes its own (smaller) equivalent that bootstraps from its Cloudflare APIs and feeds the same components.

**Caveat that matters:** some of "the experience" (which sidebar tab is open, file-tree expansion, panel resize, wide/focus mode) currently lives *inside this glue file*, not inside the reusable components. Part of the work is pushing that behavior **down into the components** (e.g. `SidebarContainer` owns its own open/close) so Workspaces' glue stays thin and doesn't have to re-derive layout logic. (Re-deriving that logic generically is exactly what the reverted attempt did wrong — push it into the real components instead.)

## Packaging state

`packages/ui/package.json` already declares `@plannotator/ui` with a fine-grained `exports` map (components, hooks, utils, config, types, theme). But it is `version: 0.0.1`, `type: module`, source-only (no build step, no publish). To be installable by an outside repo it needs: a real version, a build (or confirmed source-export consumption), peer-deps sorted (React, CodeMirror, Radix, etc.), and a publish target. Moderate, not hard.

## First-cut order of work (the safe path from ADR 004)

Each step: lift the server call out to a prop/callback, leave the component's logic intact, confirm Plannotator still looks identical, then move on. One item at a time.

1. **Rendering core** — `/api/image`, `/api/doc`, `/api/doc/exists`, `/api/upload` (HtmlBlock, ImageThumbnail, InlineMarkdown, useLinkedDoc, useValidatedCodePaths, AttachmentsButton). Makes a doc render anywhere.
2. **File tree** — `useFileBrowser`. Makes the tree take a data source.
3. **Comments/drafts** — `useAnnotationDraft`, `useCodeAnnotationDraft`, `useExternalAnnotations`. Makes comments (incl. agent-posted) provider-driven.
4. **Versions** — `usePlanDiff` (keep the VS Code button as an optional prop Workspaces omits).
5. **Config/settings shape** — let `configStore`/`settings` take their source from the host instead of `/api/config`.
6. **Packaging** — turn `@plannotator/ui` into a real publishable package.
7. **Push layout state into components** — sidebar/panel/wide-mode behavior currently in `App.tsx` moves into the sidebar/layout components so Workspaces' glue stays thin.

Steps 1–5 are independent and can be done in any order / in parallel by different people. Step 6 can start anytime. Step 7 is the largest and is best done last, informed by what Workspaces actually needs.
