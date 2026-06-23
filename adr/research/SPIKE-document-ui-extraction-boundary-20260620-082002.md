# Spike: Document UI Extraction Boundary

> ℹ️ **Research still useful; the direction it informed was reverted.** This accurately describes how the current document UI works, but the extraction approach it fed into (ADRs 002/003) was reverted on 2026-06-22. Read **`adr/decisions/004-reuse-document-ui-as-published-building-blocks-20260622-180637.md`** before acting on any recommendation here.

Date: 2026-06-20

## Question

Build a concrete understanding of how the Plan Review app now powers annotate-mode document review, and identify the boundary for extracting that document experience into a shared UI package.

The historical center of gravity was Plan Mode: Claude Code intercepted `ExitPlanMode`, opened Plannotator, and waited for approve or deny. The current primary document workflow is broader:

- run annotate on a markdown, text, HTML, URL, or folder target
- run last-message annotation
- optionally review-gate an artifact with approve or feedback
- sometimes keep an agent terminal running inside the annotate session

## Scope

This spike only reads the current branch code. It does not change product code.

Primary files inspected:

- `packages/editor/App.tsx`
- `packages/editor/components/AppHeader.tsx`
- `packages/editor/components/AnnotateAgentTerminalPanel.tsx`
- `packages/editor/agentTerminalIntegration.ts`
- `packages/editor/directEdits.ts`
- `packages/editor/editableDocuments.ts`
- `packages/editor/sourceDocumentClient.ts`
- `packages/editor/sourceDocumentReconciliation.ts`
- `packages/editor/savedFileChangeValidation.ts`
- `packages/ui/components/Viewer.tsx`
- `packages/ui/components/BlockRenderer.tsx`
- `packages/ui/components/InlineMarkdown.tsx`
- `packages/ui/components/MarkdownEditor.tsx`
- `packages/ui/components/html-viewer/HtmlViewer.tsx`
- `packages/ui/components/html-viewer/useHtmlAnnotation.ts`
- `packages/ui/components/AnnotationPanel.tsx`
- `packages/ui/components/sidebar/FileBrowser.tsx`
- `packages/ui/components/sidebar/SidebarContainer.tsx`
- `packages/ui/hooks/useAnnotationDraft.ts`
- `packages/ui/hooks/useAnnotationHighlighter.ts`
- `packages/ui/hooks/useFileBrowser.ts`
- `packages/ui/hooks/useLinkedDoc.ts`
- `packages/ui/hooks/usePlanDiff.ts`
- `packages/ui/hooks/useArchive.ts`
- `packages/ui/hooks/useAIChat.ts`
- `packages/ui/hooks/useExternalAnnotations.ts`
- `packages/ui/hooks/useValidatedCodePaths.ts`
- `packages/ui/utils/parser.ts`
- `packages/ui/types.ts`
- `packages/server/annotate.ts`
- `packages/server/index.ts`
- `packages/server/reference-handlers.ts`
- `packages/server/reference-watch.ts`
- `packages/server/agent-terminal.ts`
- `apps/hook/server/index.ts`
- `apps/opencode-plugin/index.ts`
- `apps/pi-extension/index.ts`
- `apps/pi-extension/server/serverAnnotate.ts`
- `apps/pi-extension/server/reference.ts`
- `apps/pi-extension/server/file-browser-watch.ts`

## Short Answer

There is not a separate "Annotate app" today. Annotate mode is the Plan Review app running in a different server-provided mode.

The Bun annotate server deliberately serves document content through `/api/plan` so the existing plan editor bundle can render it. `packages/editor/App.tsx` is the real composition root for plan review, annotate, annotate-last, annotate-folder, archive, goal setup, linked docs, direct edits, AI, drafts, external annotations, file browser, raw HTML, and agent terminal.

The reusable pieces are already partly in `@plannotator/ui`, but that package is not a clean document UI package. Many components and hooks inside it fetch hard-coded `/api/*` routes. The actual document-product state machine is split between `@plannotator/ui` and `@plannotator/editor`, with the largest orchestration still in `App.tsx`.

A good extraction should not start by moving `App.tsx` wholesale. The safer boundary is a document-review surface with an explicit host API adapter and optional capabilities.

## Current Runtime Shape

### Entry points

Claude Code, Droid, OpenCode, and Pi all route manual document review into annotate mode.

Claude Code and Droid run the CLI-style commands:

- `plannotator annotate <file-or-url-or-folder>`
- `plannotator annotate-last` / `plannotator last`

OpenCode intercepts `plannotator-annotate`, `plannotator-last`, and `plannotator-review` before the agent sees the command. This is important: OpenCode clears command prompt output so a large file path is not auto-attached to the agent context before Plannotator opens.

Pi implements native command handlers, but converges on the same server/UI contract.

The CLI annotate command does input detection before starting the server:

- `https://...`: fetch with Jina Reader by default, or fetch plus Turndown with `--no-jina`
- folder: open annotate-folder mode and show the file browser
- `.html` / `.htm`: render raw HTML by default, or convert to markdown with `--markdown`
- `.md`, `.mdx`, `.txt`: read file text directly

Annotate-last resolves recent assistant messages from each agent's transcript or session store. It can pass a picker list of recent messages to the frontend.

### Servers

There are two server implementations with matching API surfaces:

- Bun server in `packages/server/*`, used by Claude Code, Droid, and OpenCode paths.
- Pi server in `apps/pi-extension/server/*`, using Node HTTP primitives and generated shared files.

The annotate Bun server is `startAnnotateServer(options)` in `packages/server/annotate.ts`. The Pi mirror is `apps/pi-extension/server/serverAnnotate.ts`.

The annotate server intentionally reuses `/api/plan`:

```text
GET /api/plan -> {
  plan,
  origin,
  mode,
  filePath,
  sourceInfo,
  sourceConverted,
  sourceSave,
  gate,
  renderAs,
  rawHtml?,
  convertHtml,
  sharingEnabled,
  shareBaseUrl,
  pasteApiUrl,
  repoInfo,
  projectRoot,
  isWSL,
  serverConfig,
  agentTerminal?,
  recentMessages?
}
```

That endpoint is the switch that turns the plan editor bundle into annotate mode.

Other annotate-mode endpoints used by the document UI:

- `GET /api/doc`: open linked docs, folder files, and code-file previews.
- `POST /api/doc/exists`: validate code-file links discovered in markdown.
- `GET /api/reference/files`: build the folder file browser tree.
- `GET /api/reference/files/stream`: SSE watch for folder tree, git status, and open source file changes.
- `POST /api/source/save`: atomically save source-backed markdown, mdx, or text files.
- `GET /api/share-html`: lazily prepare portable raw HTML for sharing.
- `GET /api/html-assets/<token>/<path>`: serve relative HTML support assets.
- `GET/POST/DELETE /api/draft`: persist annotations, attachments, and direct edits.
- `POST /api/feedback`: return annotated feedback to the invoking session.
- `POST /api/approve`: approve a review-gated annotate session.
- `POST /api/exit`: close without feedback.
- `GET/POST /api/ai/*`: Ask AI sessions.
- `GET/POST/PATCH/DELETE /api/external-annotations*`: live annotations from external tools.
- `WebSocket /api/agent-terminal/pty/<token>`: optional annotate-mode agent terminal.

The server also owns the security boundary for document access. `getAnnotateReferenceRootPaths()` scopes file access to the folder target, current working directory, the source file directory, and realpath equivalents. `/api/doc` and `/api/doc/exists` resolve within those roots.

### Source-save capability

Source save is negotiated by the server and carried to the UI as `sourceSave`.

Enabled only for local `.md`, `.mdx`, or `.txt` documents. Disabled for:

- message mode
- folder root before a file is selected
- raw HTML rendering
- converted HTML/URL content
- non-local URLs
- unsupported extensions
- missing or unreadable files

The capability includes:

- scope: `single-file` or `folder-file`
- path, basename, language
- content hash, mtime, size, and EOL style

The UI uses these fields as optimistic concurrency metadata when calling `/api/source/save`.

## Current UI Shape

### Composition root

`packages/editor/App.tsx` is 4,685 lines and owns the product state machine.

It initializes from `/api/plan`, then branches across:

- normal plan review
- annotate single file
- annotate last message
- annotate folder
- raw HTML annotate
- archive
- goal setup
- shared sessions

Core state clusters in `App.tsx`:

- document content: `markdown`, `renderAs`, `rawHtml`, `shareHtml`, `sourceInfo`, `sourceConverted`, `sourceFilePath`, `imageBaseDir`, `projectRoot`
- parsed document: `displayedMarkdown`, `frontmatter`, `blocks`
- annotations: document annotations, code annotations, external annotations, editor annotations, linked-doc annotation cache, global image attachments
- editor state: markdown edit mode, direct-edit stats, dirty flags, editable document records
- mode flags: `annotateMode`, `gate`, `annotateSource`, archive mode, goal setup, message picker
- layout: left sidebar, right annotation panel, wide mode, resizable panes, agent terminal pane
- server/session capabilities: origin, sharing URLs, repo info, AI providers, agent terminal capability

The key render switch is:

- `renderAs === "html"`: render `HtmlViewer`
- `isEditingMarkdown`: render `MarkdownEditor`
- otherwise: render `Viewer`

This means markdown, editable markdown, and raw HTML are different render surfaces inside the same app shell.

### Markdown parser and block model

`parseMarkdownToBlocks(markdown)` in `packages/ui/utils/parser.ts` creates `Block[]`.

The parser is intentionally simple and stable for annotation anchoring. It handles:

- headings with deterministic ids
- paragraphs
- blockquotes and GitHub alert callouts
- list items and task checkboxes
- fenced code blocks
- tables
- horizontal rules
- raw HTML blocks
- directive containers
- inline enhancements through render components

`Block.startLine` is part of the feedback contract. `exportAnnotations()` uses it to generate human-readable feedback with line labels.

This creates a strong coupling:

```text
markdown -> parseMarkdownToBlocks -> Block ids and startLine
         -> Viewer highlights and annotation blockId
         -> exportAnnotations feedback
```

Any extracted package must preserve this chain or own a replacement end to end.

### Viewer

`packages/ui/components/Viewer.tsx` is 970 lines. It is not just a presentational renderer.

It owns:

- `useAnnotationHighlighter`
- web-highlighter lifecycle
- code-block annotation path
- sticky headers and scroll behavior
- code path validation through `useValidatedCodePaths`
- heading anchors and hash navigation
- global comments and image attachments
- quick labels
- table and code popouts
- doc badges
- Ask AI hooks at comment and document level

`Viewer` delegates block rendering to `BlockRenderer`, `CodeBlock`, `TableBlock`, `MermaidBlock`, `GraphvizBlock`, and related components.

`InlineMarkdown` is another important coupling point. It linkifies code-file references and wiki/doc links, fetches `/api/doc` for hover previews, and relies on `CodePathValidationContext`.

### Raw HTML viewer

`HtmlViewer` renders raw HTML in an iframe through `srcdoc`. The server rewrites relative assets to `/api/html-assets/...`.

Annotation inside raw HTML uses `useHtmlAnnotation` and an injected bridge script. It communicates selection, comments, deletions, and quick labels with `postMessage`.

HTML annotations do not use markdown blocks the same way markdown annotations do. They carry text and bridge mark ids, with `blockId` effectively empty. This is a separate annotation path hidden behind the same `ViewerHandle` contract:

- `removeHighlight`
- `clearAllHighlights`
- `applySharedAnnotations`

### Markdown editing and direct edits

`MarkdownEditor` in `@plannotator/ui` is a thin Plannotator-themed wrapper around `@plannotator/markdown-editor`.

The editing state is not in that component. It lives in `App.tsx` plus `packages/editor/editableDocuments.ts`.

For normal plan review, editing produces a Direct Edits feedback section. For source-backed annotate files, editing can save back to disk through `/api/source/save`.

After edits, `App.tsx` calls `applyEditedDocument(next)`:

- reparse markdown
- remap annotations by original selected text
- clear positional metadata when a block changes
- update markdown
- bump `editGeneration`
- repaint highlights

This annotation remapping is a critical behavior. It is easy to lose if editing is extracted separately from rendering and export.

### Source-backed folder files

`useEditableDocuments()` tracks one record per source-backed document:

- session-open text and hash
- disk baseline
- current text
- dirty/saving/saved/conflict/error/missing status
- saved change context for feedback
- conflict snapshots when disk changed

The source document reconciliation loop watches directories containing open source docs through `/api/reference/files/stream`. On SSE events, it refetches snapshots through `/api/doc` and reconciles:

- clean file changed on disk: update UI to disk
- dirty file changed on disk: mark conflict
- file disappeared: mark missing
- stale async snapshot: ignore by sequence/hash guard

The file browser uses `useFileBrowser()` plus `FileBrowser.tsx`. It displays:

- markdown/text/html file tree
- workspace status from git metadata
- annotation counts by file
- edit status markers from `editableDocuments`

Folder mode selection opens files through linked-doc machinery, but source-backed folder files can become editable and saveable.

### Linked docs

`useLinkedDoc()` is central to the document experience.

It handles same-surface navigation to another markdown or HTML document:

- snapshot current root or linked document
- cache annotations and attachments per filepath
- clear and restore highlights
- switch `markdown`, `renderAs`, `rawHtml`, and `shareHtml`
- restore cached doc state on back
- keep annotation counts for file browser/sidebar

Linked docs can be raw HTML or markdown. This means `renderAs` is not only a session-level mode; it is active-document scoped.

### Drafts

`useAnnotationDraft()` persists:

- full `Annotation[]`
- code annotations
- global attachments
- direct edited markdown
- dirty source-backed edited documents
- already-saved source-backed file changes
- draft generation number

The hook is intentionally best-effort and uses debounced `/api/draft` writes with `keepalive` flushes on page hide. Draft generation prevents a late save from resurrecting a draft after submit.

Draft restore in `App.tsx` is complex because it has to validate saved file changes against disk, restore dirty source documents, maybe reopen a single restored file, remap annotations, and repaint highlights.

### Feedback and approval

Plan mode:

- Approve posts `/api/approve`.
- Deny posts `/api/deny`.
- Feedback may include annotations, editor annotations, linked-doc annotations, code-file annotations, direct edits, saved file changes, and note-app settings.

Annotate mode:

- Feedback normally posts `/api/feedback`.
- Gate approval posts `/api/approve`.
- Close posts `/api/exit`.
- If the agent terminal is ready, feedback is sent directly to the terminal instead of `/api/feedback`.

`getCurrentFeedbackPayload()` is the important document feedback seam in `App.tsx`. It composes exported annotations plus direct-edit and saved-file-change sections, then wraps them for the target agent/file/message context.

### Agent terminal

Agent terminal is annotate-only for `annotate` and `annotate-folder`, not `annotate-last`.

Server side:

- Bun uses `createBunAgentTerminalBridge()`.
- Pi mirrors it with `createNodeAgentTerminalBridge()`.
- The server advertises `agentTerminal` capability in `/api/plan`.
- A tokenized WebSocket path is generated under `/api/agent-terminal/pty/<token>`.
- Remote sessions disable terminal by default unless `PLANNOTATOR_AGENT_TERMINAL_REMOTE=1`.
- The Bun bridge starts a Node sidecar for WebTUI and proxies browser WebSocket traffic to the sidecar.

UI side:

- `AnnotateAgentTerminalPanel` uses `@plannotator/webtui/browser` and `@plannotator/webtui/react`.
- It stores the preferred agent id and terminal display settings locally.
- It exposes `sendMessage()` and `stop()` through an imperative ref.
- `App.tsx` tracks whether the terminal is running, open, ready, and whether the current feedback payload was already delivered.

When terminal delivery succeeds, the browser does not close the annotate session. It marks the feedback as delivered and keeps the terminal workflow live.

### AI

Ask AI is a server-backed capability exposed by `/api/ai/capabilities` and used through `useAIChat()`.

When the annotate agent terminal is ready, `App.tsx` hides normal AI chat streaming and routes Ask AI prompts to the terminal instead.

This is another package boundary concern: AI can be a document-surface capability, but the provider registry and terminal fallback are host/session concerns.

## Package Boundary Today

`@plannotator/ui` already contains a lot of reusable document primitives:

- parser and feedback export utilities
- `Viewer`
- `HtmlViewer`
- `MarkdownEditor`
- annotation toolbar/panel pieces
- file browser UI and hook
- linked-doc hook
- draft hook
- sidebar shell
- AI chat hook and UI
- external annotation hooks
- plan diff and archive pieces

`@plannotator/editor` contains the app shell and several document-domain state modules:

- `App.tsx`
- source edit state and reconciliation
- direct-edit feedback sections
- source document client
- source document path helpers
- agent terminal panel and integration
- app header
- shortcuts surface

This split is historical, not architectural. `@plannotator/ui` is broad and route-aware. `@plannotator/editor` is a product shell that imports almost every document primitive and wires them into server APIs.

Line counts that indicate the current extraction pressure:

- `packages/editor/App.tsx`: 4,685
- `packages/ui/components/Viewer.tsx`: 970
- `packages/editor/components/AnnotateAgentTerminalPanel.tsx`: 746
- `packages/ui/components/AnnotationPanel.tsx`: 731
- `packages/editor/editableDocuments.ts`: 666
- `packages/ui/hooks/useLinkedDoc.ts`: 494
- `packages/ui/hooks/useFileBrowser.ts`: 358
- `packages/server/annotate.ts`: 661
- `apps/pi-extension/server/serverAnnotate.ts`: 561

## Extraction Risks

### 1. Direct `/api/*` fetches inside reusable UI

Many `@plannotator/ui` hooks and components call API routes directly:

- `useAnnotationDraft`: `/api/draft`
- `useFileBrowser`: `/api/reference/files`, `/api/reference/files/stream`, `/api/reference/obsidian/files`
- `useLinkedDoc`: default `/api/doc`
- `usePlanDiff`: `/api/plan/version`, `/api/plan/versions`
- `useAIChat`: `/api/ai/*`
- `useExternalAnnotations`: `/api/external-annotations*`
- `useEditorAnnotations`: `/api/editor-annotations`, `/api/editor-annotation`
- `useValidatedCodePaths`: `/api/doc/exists`
- `InlineMarkdown`: `/api/doc`
- `OpenInAppButton`: `/api/open-in/apps`, `/api/open-in`
- `ExportModal`: `/api/save-notes`

That is acceptable for an app-local UI package, but not for a reusable document package unless the package declares those routes as its required host API.

### 2. `App.tsx` mixes mode policy with document mechanics

Examples:

- Plan approve/deny and annotate feedback live beside editor remapping.
- Archive/goal setup branches live beside folder annotation.
- AI provider defaults live beside source-file conflict handling.
- Agent terminal delivery status affects whether feedback buttons are enabled.
- Sidebar auto-open rules depend on archive, goal, folder, HTML, and TOC state.

Moving this all at once would preserve complexity under a new package name.

### 3. Parser, highlight anchors, and feedback export are one contract

The markdown renderer cannot be extracted independently from:

- `Block` ids
- `Block.startLine`
- annotation `blockId`
- text-search restoration
- direct-edit remapping
- feedback export

These should move or remain together.

### 4. Source-save behavior is part of the document product

Source save is not a small add-on. It includes optimistic concurrency, file watch reconciliation, conflict UX, missing-file UX, draft restore, saved file change feedback, and file browser edit badges.

If source save stays outside an extracted package, the package still needs extension points for all those statuses and actions.

### 5. Raw HTML is a parallel rendering and annotation stack

The raw HTML path uses iframe bridge annotations, rewritten asset URLs, and share HTML preparation. It is not just another markdown block type.

### 6. Dual server parity remains required

Endpoint changes must be made in both:

- `packages/server/*`
- `apps/pi-extension/server/*`

A frontend extraction can reduce UI duplication, but it does not remove this server parity requirement.

## Candidate Package Boundary

The practical package is not "all of `App.tsx`." It is a document review surface.

Working name:

```text
@plannotator/document-ui
```

Primary exported component:

```text
DocumentReviewSurface
```

It should own:

- markdown/raw-HTML render switch
- annotation lifecycle
- annotation panel integration
- linked document navigation
- file browser document picking
- markdown edit mode
- source-save document state
- draft persistence integration
- feedback payload assembly

It should not own directly:

- Claude/OpenCode/Pi command interception
- server startup
- browser opening
- note-app integration persistence policy
- plan version history
- archive browsing
- goal setup
- agent-specific transcript lookup
- exact terminal sidecar implementation

Those should remain host/app concerns passed as data, capabilities, callbacks, or optional slots.

## Suggested Host API Adapter

Instead of hard-coded route fetches in the surface, define a `DocumentHostApi` adapter.

Shape at a high level:

```ts
interface DocumentHostApi {
  loadSession(): Promise<DocumentSession>;
  loadDocument(request: LoadDocumentRequest): Promise<LoadedDocument>;
  validateCodePaths(request: ValidateCodePathsRequest): Promise<CodePathValidationResult>;
  listFiles(request: ListFilesRequest): Promise<FileTreeResult>;
  watchFiles?(request: WatchFilesRequest): EventSourceLike;
  saveSource?(request: SourceSaveRequest): Promise<SourceSaveResponse>;
  loadDraft(): Promise<DraftResult>;
  saveDraft(draft: DraftPayload): Promise<void>;
  deleteDraft(generation: number): Promise<void>;
  submitFeedback(payload: SubmitFeedbackPayload): Promise<void>;
  approve?(): Promise<void>;
  exit?(): Promise<void>;
  uploadImage?(file: File): Promise<ImageAttachment>;
  loadShareHtml?(path?: string): Promise<string>;
}
```

The current Bun/Pi HTTP routes can be one implementation of that adapter:

```text
createPlannotatorHttpDocumentApi()
```

This avoids baking `/api/plan` into every reusable hook. It also makes local storybook/unit tests easier because the surface can run against an in-memory adapter.

## Suggested Extraction Sequence

### Step 1. Define contracts without moving UI

Create shared document session types around the current `/api/plan` annotate shape and `/api/doc` loaded-document shape.

Do not rename server routes yet. Keep route compatibility.

Useful contracts:

- `DocumentSession`
- `DocumentMode`
- `LoadedDocument`
- `DocumentSourceInfo`
- `DocumentFeedbackPayload`
- `DocumentHostApi`
- `DocumentCapabilities`

This gives the code a vocabulary before package movement.

### Step 2. Extract API client wrappers

Move route fetches behind a client object used by `App.tsx`.

Good first candidates:

- `/api/doc`
- `/api/doc/exists`
- `/api/reference/files`
- `/api/reference/files/stream`
- `/api/source/save`
- `/api/draft`
- `/api/share-html`

The goal is not abstraction for its own sake. The goal is to make the eventual package boundary explicit and testable.

### Step 3. Move source document state out of `@plannotator/editor`

The source-edit modules are already cohesive:

- `editableDocuments.ts`
- `sourceDocumentClient.ts`
- `sourceDocumentReconciliation.ts`
- `savedFileChangeValidation.ts`
- `sourceDocumentPaths.ts`
- `directEdits.ts`
- `draftRestoreSelection.ts`

These are document-domain modules. They are stronger candidates for `@plannotator/document-ui` than plan-specific code.

### Step 4. Extract document surface around existing components

Create a component that accepts:

- initial document session
- host API adapter
- current origin/config info
- optional capability slots: AI, terminal, notes/export, sharing, archive, plan diff
- callbacks for submit/approve/exit

At this step, `packages/editor/App.tsx` becomes a host shell that still handles plan-specific behavior, but delegates document mechanics.

### Step 5. Split plan-only features from annotate-first features

Plan-only or mostly plan-only:

- `/api/approve` and `/api/deny` behavior for `ExitPlanMode`
- plan save settings
- plan version history
- plan diff browser
- archive sidebar
- permission mode setup

Annotate/document-first:

- render markdown/raw HTML
- annotations and feedback
- linked docs
- folder browser
- source save
- direct edits
- drafts
- external annotations
- image attachments

The extracted package should make plan-only features optional instead of requiring them in every document session.

## Recommended Initial Decision

Extract a document-review package, not a plan-review package.

The package should treat plan review as one host mode that supplies a document and approve/deny callbacks. Annotate should be the reference use case for the package because it exercises the full document surface: arbitrary files, folders, raw HTML, linked docs, source save, drafts, and optional terminal delivery.

Do not make `@plannotator/ui` the final boundary by default. It is currently a mixed component library plus route-aware app helpers. Either:

- create `@plannotator/document-ui` and move document-domain pieces there, or
- carve a `/document` export surface inside `@plannotator/ui` with a documented host API contract.

The separate package is cleaner if the goal is reuse across applications.

## Verification Map

Existing tests that cover likely extraction-sensitive behavior:

- `packages/ui/utils/parser.test.ts`
- `packages/ui/components/InlineMarkdown.test.ts`
- `packages/ui/markdownEditorFidelity.test.tsx`
- `packages/ui/annotationDraftPersistence.test.tsx`
- `packages/ui/hooks/useFileBrowser.test.tsx`
- `packages/ui/components/sidebar/FileBrowser.test.ts`
- `packages/editor/directEdits.test.ts`
- `packages/editor/editableDocuments.test.ts`
- `packages/editor/editableDocumentsHook.test.tsx`
- `packages/editor/sourceDocumentClient.test.ts`
- `packages/editor/sourceDocumentReconciliation.test.ts`
- `packages/editor/savedFileChangeValidation.test.ts`
- `packages/editor/agentTerminalIntegration.test.ts`
- `packages/server/annotate.test.ts`
- `packages/server/annotate-doc-url.test.ts`
- `packages/server/annotate-html-assets.test.ts`
- `packages/server/reference-handlers.test.ts`
- `packages/server/reference-watch.test.ts`
- `packages/server/agent-terminal.test.ts`
- `apps/pi-extension/server.test.ts`
- `apps/pi-extension/server/agent-terminal.test.ts`
- `apps/pi-extension/server/file-browser-watch.test.ts`

Tests to add before or during extraction:

- a contract test for the Bun and Pi annotate `/api/plan` shapes
- a contract test for `/api/doc` loaded markdown, raw HTML, converted HTML, code-file preview, and source-save metadata
- a component test for the document surface with an in-memory host API adapter
- an integration test that edits a folder file, saves it, restores draft state, and sends feedback with saved file change context
- an integration test that switches linked docs between markdown and raw HTML and preserves per-document annotations

## Open Questions

1. Should the extracted package include the right annotation panel, or only the document renderer plus hooks?

Recommendation: include it. The panel is part of the annotation product, and feedback export depends on the same state.

2. Should the agent terminal live in the document package?

Recommendation: keep terminal transport and sidecar out. Include only an optional "agent delivery" capability or slot. The current panel can move later if the package is intended to ship the full annotate workspace.

3. Should plan diff and archive move with the package?

Recommendation: no for the first extraction. They depend on plan history endpoints and plan-specific mental models. Leave them as host-provided optional sidebar tabs.

4. Should route names change away from `/api/plan` for annotate?

Recommendation: not during extraction. The route name is historical but functional. Put a typed client over it first, then rename only if there is a separate compatibility plan for Bun and Pi.

5. Should raw HTML and markdown be separate surfaces?

Recommendation: keep one document surface with two render engines. Users experience them as one annotate workflow, and linked docs can switch between them.

## Bottom Line

The current architecture works because the annotate server impersonates the plan server enough for `packages/editor/App.tsx` to boot the same React app in annotate mode.

The extraction should preserve the successful part of that design: one document review experience across plan, file, folder, HTML, URL, and last-message workflows.

The extraction should remove the fragile part: document behavior is currently spread across a massive app shell and route-aware shared UI hooks. The next architectural boundary should be a document surface plus a typed host API adapter.
