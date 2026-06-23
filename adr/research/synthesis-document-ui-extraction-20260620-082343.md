# Synthesis: Document UI Extraction

> ℹ️ **Context still useful; the direction it informed was reverted.** The extraction approach synthesized here (ADRs 002/003) was reverted on 2026-06-22. Read **`adr/decisions/004-reuse-document-ui-as-published-building-blocks-20260622-180637.md`** before acting.

Date: 2026-06-20

Status: Synthesis

## Research Reviewed

- `adr/research/SPIKE-document-ui-extraction-boundary-20260620-082002.md`
- `adr/research/SPIKE-source-edit-reliability-20260618-090850.md`
- `adr/research/SPIKE-source-edit-race-and-conflict-20260618-095558.md`
- `adr/research/SPIKE-annotate-agent-terminal-production-runtime-20260618-212101.md`
- `adr/research/synthesis-annotate-agent-terminal-production-runtime-20260618-212604.md`

## What The Research Says

Annotate is not a separate frontend today. It is the Plan Review app booted in another mode. The annotate server serves document sessions through `/api/plan`, and `packages/editor/App.tsx` decides whether the session is plan review, annotate file, annotate folder, annotate last message, raw HTML, archive, or goal setup.

The desired extraction is therefore not a renderer extraction. The reusable product is the document review experience:

- markdown and raw HTML viewing
- markdown block rendering
- annotations and comments
- annotation panel
- linked document navigation
- file browser rows and status badges
- editor toggle
- source-backed save state
- draft persistence
- feedback payload assembly

Those pieces are currently split across `@plannotator/ui` and `@plannotator/editor`. `@plannotator/ui` has many reusable primitives, but several of them call hard-coded `/api/*` routes. `@plannotator/editor` has the main app shell plus document-domain state like editable documents, source reconciliation, direct edits, and terminal integration.

So the current split is historical, not a clean package boundary.

## Recommended Direction

Create one shared document package:

```text
@plannotator/document-ui
```

Do not split into renderer, tree, comments, editor, and sidebar packages now. The seams are not stable enough. The first useful boundary is one document surface with a typed host API.

The primary export should be something like:

```text
DocumentReviewSurface
```

It should own the document product mechanics:

- render markdown or raw HTML
- manage annotation state and highlight restoration
- render the comments/annotation panel
- support linked docs
- support folder file picking
- support markdown edit mode
- manage source-save document state
- integrate draft save/restore
- assemble document feedback

The host app should keep runtime and mode policy:

- Claude/OpenCode/Droid/Pi command interception
- server startup and browser opening
- plan-mode approve/deny hook behavior
- plan history, plan diff, archive, and goal setup
- note app policy and settings persistence
- transcript lookup for annotate-last
- terminal runtime/sidecar implementation

## Main Architectural Move

Introduce a host API adapter before moving the UI.

The document surface should not directly know that the current Plannotator server uses `/api/plan`, `/api/doc`, `/api/source/save`, or `/api/draft`. It should depend on an interface such as:

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
}
```

The current Bun and Pi HTTP routes can be implemented as:

```text
createPlannotatorHttpDocumentApi()
```

This keeps the existing routes stable while giving the UI a real boundary.

## Package Contents

Move or expose these as document-domain code:

- `Viewer`
- `HtmlViewer`
- `MarkdownEditor`
- markdown parser and block types
- annotation highlighter integration
- annotation/comment panel patterns
- linked-doc hook
- file browser hook and rows
- draft hook
- editable document state
- source document client and reconciliation
- saved file change validation
- direct edits feedback builder
- code path validation and inline link handling

Keep these outside for the first extraction:

- plan diff
- archive browser
- goal setup
- permission mode setup
- server implementations
- agent terminal sidecar/runtime resolver
- CLI/plugin integrations

The annotation panel should be included. It is part of the document product, not a peripheral widget. Feedback export and annotation state depend on it.

Raw HTML should stay in the same document surface. It is a separate render engine, but users experience it as the same annotate workflow, and linked docs can switch between markdown and raw HTML.

## Source Save Is Core

The source-edit research matters for extraction.

Source save is not just "write file on Save." It includes:

- optimistic concurrency through hash and mtime metadata
- file watch reconciliation
- stale snapshot guards
- conflict recovery with current disk snapshots
- missing-file state
- draft restore
- saved file change feedback
- file browser edit badges

If the extracted package does not own this state, it will need so many extension points that the package will not actually own the document experience.

Recommendation: move the source document state modules into the document package early.

## Terminal And AI Boundary

Agent terminal is part of the annotate workspace, but the terminal runtime is not part of document UI.

The package can support an optional "agent delivery" capability:

- send feedback to a running agent
- report whether the current feedback has already been delivered
- route Ask AI prompts to an agent when provided
- render an optional slot or panel if the host supplies one

The host should keep:

- WebTUI sidecar
- tokenized WebSocket path
- remote-mode gating
- runtime install/preflight
- agent discovery

Normal Ask AI should also be capability-driven. Provider detection and server sessions are host concerns; document UI can consume an abstract ask/send interface.

## Bun/Pi Constraint

Frontend extraction does not remove server parity work.

The Bun server and Pi server both expose the document endpoints. Any route shape change still needs both implementations updated.

For the extraction, avoid route renames. Keep `/api/plan` for compatibility and put a typed adapter over it. Rename only later if there is a deliberate migration plan.

## Implementation Order

1. Define document contracts.

Create shared types for `DocumentSession`, `LoadedDocument`, `DocumentCapabilities`, `DocumentFeedbackPayload`, and `DocumentHostApi`. Model the current annotate `/api/plan` and `/api/doc` shapes without changing routes.

2. Add an HTTP adapter.

Move route calls behind `createPlannotatorHttpDocumentApi()`. Start with `/api/doc`, `/api/doc/exists`, `/api/reference/files`, `/api/reference/files/stream`, `/api/source/save`, `/api/draft`, and `/api/share-html`.

3. Move source document modules.

Move the cohesive source-edit modules out of `@plannotator/editor` and into the document package. This reduces `App.tsx` before the main surface extraction.

4. Create `DocumentReviewSurface`.

Wrap the existing viewer, HTML viewer, editor toggle, linked docs, file browser, annotation panel, drafts, and source-save state behind one component.

5. Turn `packages/editor/App.tsx` into a host shell.

The app should load session data, configure host capabilities, handle plan-specific flows, and delegate document mechanics to `DocumentReviewSurface`.

6. Add contract and surface tests.

Add Bun/Pi contract tests for `/api/plan` and `/api/doc`, plus a component test using an in-memory `DocumentHostApi`.

## What Counts As A Good First Result

The first successful extraction should make this true:

- annotate file/folder/HTML/last still work
- plan review still works through the same document surface
- source save and drafts still work
- `App.tsx` no longer owns document mechanics directly
- document UI can run in tests without a live Plannotator server
- no endpoint rename is required
- no extra package split is introduced

## Keep Out Of Scope

Do not redesign the UI.

Do not split into multiple small UI packages yet.

Do not move the terminal runtime into the document package.

Do not rename `/api/plan` during extraction.

Do not fold plan diff, archive, or goal setup into the first document package boundary.

Do not try to solve all Pi/Bun server duplication as part of the frontend package extraction.

## Open Decisions

1. Should the package be a new workspace package or a documented `/document` export inside `@plannotator/ui`?

Recommendation: new package. `@plannotator/ui` is already broad and route-aware; a new package makes the boundary visible.

2. Should source save be mandatory or optional?

Recommendation: optional capability, but first-class inside the package. Sessions without source save should degrade cleanly.

3. Should plan review be implemented as a document mode or a host wrapper?

Recommendation: host wrapper. Plan review supplies a document plus approve/deny callbacks. The document package should not know about hook stdout decisions.

4. Should the terminal panel move later?

Recommendation: maybe, but only after the document surface exists. The runtime stays host-owned either way.

## Recommendation

Proceed toward an ADR that accepts one shared document UI package with a host API adapter.

The key decision is not "move components to another folder." The key decision is to make Plannotator's document review experience the upstream surface and make plan review one consumer of that surface.

That preserves the best part of the current architecture: one rich review experience across plans, files, folders, HTML, URLs, and last messages.

It fixes the weak part: the document product is currently trapped inside a very large app shell and route-aware UI helpers.
