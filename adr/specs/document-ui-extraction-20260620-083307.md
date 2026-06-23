# Spec: Shared Document UI Package

> ⚠️ **REVERTED — DO NOT IMPLEMENT.** Spec for the failed `@plannotator/document-ui` extraction (reverted 2026-06-22). The corrected plan is **`adr/decisions/004-reuse-document-ui-as-published-building-blocks-20260622-180637.md`**. Kept here as history only.

Date: 2026-06-20

Status: Draft

## Intent

Extract Plannotator's document review experience into one shared UI package that can be used by Plannotator and a sister Workspaces repo.

The package should not be a thin markdown renderer. It should own the reusable document review loop:

- render markdown and raw HTML documents
- annotate text and blocks
- show comments and attachments
- navigate linked documents
- browse document/file trees
- edit documents
- show dirty/saving/saved/conflict/missing/error states
- restore drafts
- assemble feedback and saved-change context

The host app should own routing, auth, server calls, environment capabilities, and provider-specific persistence.

## Package

Create one package:

```text
@plannotator/document-ui
```

Do not split into renderer/tree/comments/editor packages yet. The first stable boundary is the full document review surface.

Primary export:

```tsx
<DocumentReviewSurface hostApi={api} session={session} />
```

The package may later expose lower-level hooks and components, but those are secondary. The product-level export is the surface.

## Design Principle

The core contract must be provider-neutral.

Do not name the shared contract around Plannotator's local source-save implementation. Local source-save is one provider. The reusable concept is document writeback state:

```ts
type DocumentWritebackStatus =
  | "clean"
  | "dirty"
  | "saving"
  | "saved"
  | "conflict"
  | "missing"
  | "error";
```

Plannotator local implements writeback with:

- `/api/source/save`
- disk hashes
- mtime
- EOL metadata
- missing local files
- source-save draft restore

Workspaces implements writeback with:

- `/v1/workspaces/{workspace}/documents/{document}`
- `If-Match`
- document versions
- missing document rows
- workspace restore semantics

The package should own the common UI and state behavior. Providers own the persistence details.

## Goals

1. Make Plannotator's document experience the upstream UI for both repos.

2. Keep one shared package, not many narrowly split packages.

3. Move document-domain behavior out of `packages/editor/App.tsx`.

4. Preserve current Plannotator behavior for:

- plan review
- annotate file
- annotate folder
- annotate last message
- raw HTML annotation
- linked docs
- source-backed file editing
- drafts
- feedback submission

5. Let Workspaces provide a different backend with the same document UI:

- workspace manifest based document tree
- document ids instead of filesystem paths
- workspace versions instead of disk hashes
- workspace annotations and replies API
- workspace auth and routes

6. Keep current Plannotator server routes stable during extraction.

7. Make the document surface testable with an in-memory host API.

## Non-Goals

Do not redesign the user interface as part of this extraction.

Do not rename `/api/plan` during the extraction.

Do not solve Bun/Pi server duplication as part of the frontend package boundary.

Do not move CLI/plugin command interception into the package.

Do not move server startup or browser opening into the package.

Do not move the agent terminal runtime, WebTUI sidecar, or runtime installer into the package.

Do not make plan diff, archive, goal setup, or permission mode setup first-class parts of the first document package boundary.

Do not require a filesystem path for every document.

## Package Responsibilities

`@plannotator/document-ui` owns:

- `DocumentReviewSurface`
- document render mode switch: markdown, raw HTML, editing
- markdown parsing and block model
- markdown block rendering
- raw HTML iframe annotation bridge
- annotation lifecycle
- highlight restoration
- comments and annotation panel
- image attachments
- linked document navigation
- document tree/file tree rendering and status badges
- edit toggle and edit session state
- provider-neutral writeback state
- conflict/missing/error UI patterns
- draft save and restore state
- feedback payload assembly
- saved-change section assembly
- code path validation UI
- inline link handling
- optional Ask AI integration points
- optional agent-delivery integration points

The host app owns:

- app routing
- server endpoints
- auth
- current user/session identity
- provider implementation
- browser opening
- plugin/CLI integration
- local filesystem access
- workspace API access
- plan-mode hook stdout behavior
- plan history
- plan diff
- archive
- goal setup
- note-app settings and persistence policy
- terminal runtime and sidecar

## Terminology

### Host App

The application that embeds `DocumentReviewSurface`.

Examples:

- Plannotator plan/annotate app
- Workspaces web app

### Provider

The host-side implementation of document loading, saving, tree listing, draft persistence, annotations, versions, and feedback submission.

Examples:

- Plannotator local provider
- Workspaces provider
- in-memory test provider

### DocumentRef

Provider-neutral identity for a document.

A document may have a filesystem path, but the package must not require one.

### Writeback

Provider-neutral document edit persistence.

Local Plannotator's current `sourceSave` is one writeback implementation. Workspaces document save is another.

### Feedback

The review output assembled from annotations, global comments, image attachments, direct edits, saved changes, linked-document comments, and provider-specific metadata.

## Core Types

This is a draft interface shape. Exact names can change during implementation, but the concepts should remain.

```ts
export type DocumentProviderId = string;

export interface DocumentRef {
  id: string;
  providerId?: DocumentProviderId;
  label: string;
  title?: string;
  path?: string;
  parentId?: string;
  kind?: "document" | "folder" | "message" | "url" | "html" | string;
  metadata?: Record<string, unknown>;
}

export type DocumentRenderMode = "markdown" | "html";

export interface LoadedDocument {
  ref: DocumentRef;
  content: string;
  renderMode: DocumentRenderMode;
  rawHtml?: string;
  shareHtml?: string;
  sourceInfo?: string;
  converted?: boolean;
  baseForRelativeLinks?: DocumentRef | string;
  imageBase?: string;
  writeback?: DocumentWritebackCapability;
}

export type DocumentWritebackStatus =
  | "clean"
  | "dirty"
  | "saving"
  | "saved"
  | "conflict"
  | "missing"
  | "error";

export interface DocumentWritebackCapability {
  writable: boolean;
  status: DocumentWritebackStatus;
  revision?: string;
  language?: "markdown" | "mdx" | "text" | string;
  reason?: string;
  message?: string;
  providerState?: unknown;
}

export interface DocumentWritebackState {
  ref: DocumentRef;
  status: DocumentWritebackStatus;
  dirty: boolean;
  revision?: string;
  sessionOpenContent?: string;
  savedContent?: string;
  currentContent?: string;
  conflict?: DocumentConflict;
  error?: string;
  providerState?: unknown;
}

export interface DocumentConflict {
  latestContent: string;
  latestRevision?: string;
  message?: string;
  providerState?: unknown;
}

export interface SaveDocumentRequest {
  ref: DocumentRef;
  content: string;
  baseRevision?: string;
  providerState?: unknown;
  overwriteConflict?: boolean;
}

export type SaveDocumentResult =
  | {
      ok: true;
      ref?: DocumentRef;
      revision?: string;
      providerState?: unknown;
    }
  | {
      ok: false;
      code: "conflict";
      message: string;
      latestContent: string;
      latestRevision?: string;
      providerState?: unknown;
    }
  | {
      ok: false;
      code: "missing" | "not-writable" | "validation" | "network" | "unknown";
      message: string;
      providerState?: unknown;
    };
```

## Session Types

```ts
export type DocumentSessionMode =
  | "plan-review"
  | "annotate"
  | "annotate-folder"
  | "annotate-message"
  | "workspace-review"
  | string;

export interface DocumentReviewSession {
  id: string;
  mode: DocumentSessionMode;
  origin?: string;
  rootDocument?: LoadedDocument;
  initialDocumentRef?: DocumentRef;
  rootTreeRef?: DocumentRef;
  capabilities: DocumentCapabilities;
  ui?: DocumentSessionUi;
  providerState?: unknown;
}

export interface DocumentCapabilities {
  canAnnotate: boolean;
  canEdit: boolean;
  canWriteback: boolean;
  canApprove?: boolean;
  canExit?: boolean;
  canShare?: boolean;
  canUploadImages?: boolean;
  canOpenLinkedDocuments?: boolean;
  canBrowseDocuments?: boolean;
  canUseAskAI?: boolean;
  canDeliverToAgent?: boolean;
  supportsRawHtml?: boolean;
  supportsVersions?: boolean;
}

export interface DocumentSessionUi {
  title?: string;
  subtitle?: string;
  primaryActionLabel?: string;
  approveLabel?: string;
  exitLabel?: string;
}
```

## Host API

The surface talks to a provider through `DocumentHostApi`.

```ts
export interface DocumentHostApi {
  loadSession?(): Promise<DocumentReviewSession>;

  loadDocument(request: LoadDocumentRequest): Promise<LoadedDocument>;

  resolveLinkedDocument?(request: ResolveLinkedDocumentRequest): Promise<DocumentRef | null>;

  validateCodePaths?(
    request: ValidateCodePathsRequest,
  ): Promise<CodePathValidationResult>;

  listDocuments?(
    request: ListDocumentsRequest,
  ): Promise<DocumentTreeResult>;

  watchDocuments?(
    request: WatchDocumentsRequest,
  ): DocumentWatchSubscription;

  saveDocument?(
    request: SaveDocumentRequest,
  ): Promise<SaveDocumentResult>;

  loadDraft?(
    request: LoadDraftRequest,
  ): Promise<DocumentDraftResult>;

  saveDraft?(
    request: SaveDraftRequest,
  ): Promise<void>;

  deleteDraft?(
    request: DeleteDraftRequest,
  ): Promise<void>;

  uploadImage?(
    file: File,
  ): Promise<ImageAttachment>;

  submitFeedback?(
    payload: SubmitDocumentFeedbackPayload,
  ): Promise<SubmitFeedbackResult>;

  approve?(
    payload: ApproveDocumentPayload,
  ): Promise<void>;

  exit?(
    payload: ExitDocumentPayload,
  ): Promise<void>;

  askAI?(
    request: DocumentAskAIRequest,
  ): Promise<DocumentAskAIResponse> | AsyncIterable<DocumentAskAIEvent>;

  deliverToAgent?(
    payload: DocumentAgentDeliveryPayload,
  ): Promise<DocumentAgentDeliveryResult>;
}
```

### LoadDocumentRequest

```ts
export interface LoadDocumentRequest {
  ref: DocumentRef;
  baseRef?: DocumentRef;
  preferredRenderMode?: DocumentRenderMode;
}
```

### Tree Types

```ts
export interface DocumentTreeNode {
  ref: DocumentRef;
  kind: "folder" | "document";
  children?: DocumentTreeNode[];
  annotationCount?: number;
  writebackStatus?: DocumentWritebackStatus;
  disabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface DocumentTreeResult {
  root: DocumentTreeNode;
  workspaceStatus?: unknown;
}
```

### Watch Types

```ts
export interface DocumentWatchSubscription {
  close(): void;
  onEvent(callback: (event: DocumentWatchEvent) => void): () => void;
}

export type DocumentWatchEvent =
  | { type: "ready"; ref?: DocumentRef }
  | { type: "changed"; ref?: DocumentRef; reason?: string }
  | { type: "deleted"; ref: DocumentRef }
  | { type: "error"; message: string };
```

The Plannotator local adapter can implement this over `EventSource('/api/reference/files/stream')`.

The Workspaces adapter can implement it over its own workspace document event system, polling, or no-op watches.

## DocumentReviewSurface Props

```ts
export interface DocumentReviewSurfaceProps {
  session: DocumentReviewSession;
  hostApi: DocumentHostApi;
  initialDocument?: LoadedDocument;
  initialAnnotations?: Annotation[];
  initialCodeAnnotations?: CodeAnnotation[];
  initialGlobalAttachments?: ImageAttachment[];
  className?: string;
  slots?: DocumentReviewSlots;
  options?: DocumentReviewOptions;
  onSubmitted?: (result: SubmitFeedbackResult) => void;
  onApproved?: () => void;
  onExited?: () => void;
  onError?: (error: DocumentReviewError) => void;
}

export interface DocumentReviewSlots {
  leftSidebarExtraTabs?: React.ReactNode;
  rightPanelExtraTabs?: React.ReactNode;
  terminalPanel?: React.ReactNode;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
}

export interface DocumentReviewOptions {
  defaultEditorMode?: "selection" | "comment" | "redline" | "quickLabel";
  defaultInputMethod?: "drag" | "pinpoint";
  allowRawHtml?: boolean;
  allowWideMode?: boolean;
  allowImageAttachments?: boolean;
  persistUiPreferences?: boolean;
  disableDrafts?: boolean;
  hideDocumentNavigator?: boolean;
  hideAnnotationPanel?: boolean;
}
```

## State Ownership

The package owns frontend state for:

- active document
- linked document stack
- per-document annotation cache
- selected annotation
- global comments and attachments
- parsed blocks
- markdown edit session
- writeback status map
- dirty document set
- conflict/missing/error display
- draft payload
- saved-change records
- file/document tree badges
- feedback payload assembly

The provider owns durable state for:

- document content
- revisions or hashes
- versions
- saved annotations, if the host persists them
- draft storage backend
- auth and permissions
- server-side conflict detection
- route shape

## Writeback State Machine

The package should implement the common frontend state machine.

### clean

The current editor buffer matches the loaded baseline.

Allowed actions:

- edit
- annotate
- navigate away
- submit feedback

### dirty

The user changed editable content but has not saved it.

Allowed actions:

- save
- discard
- continue editing
- submit only if the product policy allows unsaved direct edits

Plannotator local should continue to include direct edits in feedback where appropriate.

Workspaces may choose to require save before submit or include unsaved edits as proposed changes.

This policy should be configurable by the session or provider.

### saving

A writeback request is in flight.

Allowed actions:

- show saving state
- prevent duplicate save
- avoid applying stale watch snapshots

### saved

The user saved a change during this review session.

Allowed actions:

- show saved state
- include saved-change context in feedback where the session requests it
- treat current saved content as the new baseline

### conflict

The provider rejected save because the remote/local document changed.

Required provider data:

- latest content
- latest revision or provider-specific conflict state

Allowed actions:

- reload latest
- overwrite, when policy allows and the edit buffer is available
- keep editing
- discard

The package should not show overwrite if the provider or current state cannot perform it.

### missing

The document no longer exists or cannot be resolved.

Allowed actions:

- show missing row/state
- preserve annotations and draft context when possible
- allow discard/close
- allow restore/recreate only if provider advertises support

### error

An operation failed without a recoverable conflict or missing state.

Allowed actions:

- retry if operation is retryable
- discard local edits
- submit only if policy allows

## Provider Policies

Some behavior must be provider/session configurable:

```ts
export interface DocumentWritebackPolicy {
  submitWithUnsavedEdits:
    | "allow-as-direct-edits"
    | "block"
    | "ask";
  submitWithUnverifiedSavedChanges:
    | "allow"
    | "block"
    | "ask";
  conflictOverwrite:
    | "allowed"
    | "disallowed"
    | "provider";
  missingDocumentRestore:
    | "none"
    | "recreate"
    | "provider";
}
```

Plannotator local likely uses:

- `submitWithUnsavedEdits: "allow-as-direct-edits"` for plan edits
- stricter behavior for source-backed saved-change verification
- `conflictOverwrite: "allowed"` only when live editor buffer is available
- `missingDocumentRestore: "none"` for first extraction

Workspaces likely uses:

- `submitWithUnsavedEdits: "block"` or `"ask"` depending on product choice
- `submitWithUnverifiedSavedChanges: "block"` if version checks fail
- `conflictOverwrite: "provider"`
- `missingDocumentRestore: "provider"` if workspace restore exists

## Drafts

The package owns draft shape and restore behavior, but the host owns persistence.

Drafts should store provider-neutral data:

```ts
export interface DocumentReviewDraft {
  annotations: Annotation[];
  codeAnnotations?: CodeAnnotation[];
  globalAttachments: ImageAttachment[];
  editedDocuments?: DraftEditedDocument[];
  savedChanges?: DraftSavedDocumentChange[];
  activeDocumentRef?: DocumentRef;
  selectedAnnotationId?: string;
  generation: number;
  timestamp: number;
}

export interface DraftEditedDocument {
  ref: DocumentRef;
  baseRevision?: string;
  baseContent: string;
  currentContent: string;
  providerState?: unknown;
}

export interface DraftSavedDocumentChange {
  ref: DocumentRef;
  beforeContent: string;
  afterContent: string;
  beforeRevision?: string;
  afterRevision?: string;
  providerState?: unknown;
}
```

Plannotator local can map existing draft fields to this shape.

Workspaces can persist drafts in its own storage and map workspace revisions into `baseRevision` / `afterRevision`.

Draft generation remains important. It prevents late saves from resurrecting cleared drafts after submit.

## Feedback Assembly

The package should assemble a provider-neutral feedback payload:

```ts
export interface SubmitDocumentFeedbackPayload {
  sessionId: string;
  mode: DocumentSessionMode;
  activeDocument?: DocumentRef;
  annotations: Annotation[];
  linkedDocumentAnnotations?: LinkedDocumentAnnotationEntry[];
  codeAnnotations?: CodeAnnotation[];
  globalAttachments?: ImageAttachment[];
  directEdits?: DirectEditEntry[];
  savedChanges?: SavedDocumentChangeEntry[];
  messageScope?: unknown;
  providerState?: unknown;
}
```

The package can also expose a renderer for human-readable markdown feedback, but the host decides what to do with the payload.

Plannotator local host behavior:

- convert payload into current agent feedback text
- call `/api/feedback`, `/api/approve`, or `/api/deny`
- optionally route feedback to the agent terminal

Workspaces host behavior:

- save comments/replies through annotation APIs
- save review state through workspace APIs
- submit or share feedback according to workspace product rules

## Linked Documents

Linked document navigation must use `DocumentRef`, not filesystem path as the only identity.

The package should handle:

- opening linked docs
- preserving root document state
- caching annotations per document
- switching between markdown and raw HTML render modes
- returning to the prior document
- showing annotation counts in the tree

The provider handles:

- resolving link text/path/id to `DocumentRef`
- loading document content
- enforcing access and auth
- choosing whether relative links are path-based, manifest-based, or id-based

## Document Tree

The package should render a tree of `DocumentTreeNode`.

Tree rows should support:

- folders
- documents
- active document indicator
- annotation count
- writeback status badge
- workspace/git/provider status metadata
- missing/deleted rows
- disabled rows

The package should not assume git status. It can accept provider metadata and render known generic status patterns. Plannotator local can map git workspace status into this metadata.

## Raw HTML

Raw HTML support remains part of the package.

The package owns:

- iframe rendering
- annotation bridge integration
- shared viewer handle behavior
- raw HTML annotation state

The provider owns:

- asset rewriting
- raw HTML sanitization/permission policy if needed
- portable/share HTML generation

## Ask AI

Ask AI should be an optional capability.

The package owns:

- where Ask AI affordances appear
- how selected document context is gathered
- how annotation context is included

The host owns:

- provider selection
- auth
- session creation
- streaming implementation
- terminal fallback

## Agent Delivery

Agent delivery is optional and host-owned.

The package can accept:

```ts
export interface DocumentAgentDeliveryCapability {
  available: boolean;
  deliveredKey?: string;
  send(payload: DocumentAgentDeliveryPayload): Promise<DocumentAgentDeliveryResult>;
}
```

The package can use this to:

- show delivered/current feedback state
- avoid duplicate sends
- route Ask AI prompts to an agent when configured

The package must not own:

- WebTUI runtime
- sidecar process
- WebSocket URL creation
- remote-mode security
- runtime installation

## Plannotator Local Adapter

Add a browser-side adapter around current routes:

```ts
createPlannotatorHttpDocumentApi(options?: {
  baseUrl?: string;
}): DocumentHostApi
```

Initial route mapping:

- `loadSession` -> `GET /api/plan`
- `loadDocument` -> `GET /api/doc`
- `validateCodePaths` -> `POST /api/doc/exists`
- `listDocuments` -> `GET /api/reference/files`
- `watchDocuments` -> `GET /api/reference/files/stream`
- `saveDocument` -> `POST /api/source/save`
- `loadDraft` -> `GET /api/draft`
- `saveDraft` -> `POST /api/draft`
- `deleteDraft` -> `DELETE /api/draft`
- `uploadImage` -> `POST /api/upload`
- `submitFeedback` -> `POST /api/feedback`
- `approve` -> `POST /api/approve`
- `exit` -> `POST /api/exit`

The adapter should map local `sourceSave` into provider-neutral writeback fields.

The core package should not leak `sourceSave` into its public contract except through local adapter internals.

## Workspaces Adapter

The sister repo should be able to implement:

```ts
createWorkspaceDocumentApi(options: {
  workspaceId: string;
  auth: WorkspaceAuth;
  baseUrl: string;
}): DocumentHostApi
```

Expected mapping:

- load tree from workspace manifest
- resolve linked docs from manifest/document ids
- load documents by document id
- save with `If-Match` or version id
- map versions/ETags to `revision`
- map deleted/unavailable docs to `missing`
- load comments/replies from annotations API
- persist drafts through workspace draft storage
- load versions through versions API

This adapter does not need to live in the Plannotator repo if the package contract is stable.

## Migration Plan

### Phase 1. Contracts

Create `packages/document-ui`.

Add:

- core types
- `DocumentHostApi`
- provider-neutral writeback types
- draft types
- feedback payload types

No product behavior changes.

### Phase 2. Local HTTP Adapter

Implement `createPlannotatorHttpDocumentApi()` over current routes.

Use it from `packages/editor/App.tsx` where possible without moving major UI yet.

Goal: route calls begin moving behind the adapter.

### Phase 3. Move Document Domain Modules

Move or re-export:

- editable document state
- source document client/reconciliation, renamed toward writeback where public
- saved file change validation, generalized to saved document change validation
- direct edits
- draft restore selection
- path helpers only where local-specific

Rename public concepts from source-save to writeback. Keep local source-save names inside the local adapter.

### Phase 4. Extract Surface Shell

Create `DocumentReviewSurface` around existing:

- `Viewer`
- `HtmlViewer`
- `MarkdownEditor`
- annotation panel
- linked doc hook
- file browser hook
- draft hook
- writeback state

`packages/editor/App.tsx` still owns mode decisions and passes session/capabilities.

### Phase 5. Move Feedback Assembly

Move provider-neutral feedback assembly into document-ui.

Keep Plannotator-specific final text wrapping in the Plannotator host.

### Phase 6. Host Cleanup

Shrink `packages/editor/App.tsx` into:

- load session
- create Plannotator host API
- configure plan/annotate actions
- render `DocumentReviewSurface`
- render plan-only sidecars such as plan diff/archive when needed

### Phase 7. Workspaces Integration

Workspaces implements its adapter and embeds the surface.

Any missing extension points should be added to the contract, not patched through Plannotator-local assumptions.

## Testing

Add contract tests:

- Plannotator Bun `/api/plan` maps to `DocumentReviewSession`
- Pi `/api/plan` maps to the same `DocumentReviewSession`
- `/api/doc` markdown maps to `LoadedDocument`
- `/api/doc` raw HTML maps to `LoadedDocument`
- `/api/doc` converted HTML maps to non-writable document
- `/api/doc` source-save maps to writeback capability
- `/api/source/save` conflict maps to provider-neutral conflict

Add package tests:

- in-memory provider loads a document
- annotate and restore highlights
- edit document and transition clean -> dirty -> saving -> saved
- conflict result transitions to conflict and shows conflict controls
- missing document transition keeps row and draft context
- linked document navigation preserves annotation cache
- raw HTML document can create annotations through the common surface handle
- draft restore rehydrates edited documents and saved changes
- feedback payload includes annotations, linked doc comments, direct edits, and saved changes

Keep existing tests active:

- parser tests
- markdown editor fidelity tests
- annotation draft persistence tests
- file browser tests
- editable document tests
- source reconciliation tests
- server annotate/reference tests
- Pi server parity tests

## Acceptance Criteria

The spec is satisfied when:

- `@plannotator/document-ui` exists as one package.
- It exports provider-neutral contracts.
- It exports `DocumentReviewSurface`.
- Plannotator uses the surface for plan review and annotate flows.
- Plannotator local behavior is preserved.
- Local source-save is represented as writeback in the package contract.
- The package public API does not require filesystem paths.
- The package public API does not expose `/api/source/save`.
- The package public API does not expose local disk hash semantics as required fields.
- Workspaces can implement a provider using document ids, manifests, `If-Match`, and versions.
- The document surface can run in tests with an in-memory provider.
- Plan diff/archive/goal setup remain host-owned.
- Agent terminal runtime remains host-owned.

## Open Questions

1. Should `@plannotator/document-ui` depend on `@plannotator/ui`, or should document components move out of `@plannotator/ui`?

Working recommendation: start with `@plannotator/document-ui` depending on `@plannotator/ui` for primitives and gradually move document-specific components into the new package. Avoid a giant one-shot move.

2. Should the Plannotator local HTTP adapter live in `@plannotator/document-ui` or `@plannotator/editor`?

Working recommendation: put the browser-side adapter in `@plannotator/document-ui` if it only uses fetch and public routes. Keep server-only code out.

3. Should feedback assembly produce markdown text or structured data?

Working recommendation: produce structured data first and expose a markdown formatter. Plannotator can keep its agent-specific markdown wrapper.

4. Should unsaved edits be allowed in Workspaces feedback?

Working recommendation: make this a provider policy. Do not bake Plannotator's direct-edit behavior into all providers.

5. Should comments/replies persistence be part of the host API now?

Working recommendation: include extension points now, but do not require persistent comments for the first Plannotator extraction. Workspaces can implement persistence through the adapter.

## Decision Draft

Adopt one provider-neutral shared document UI package.

The core abstraction is not local source-save. The core abstraction is document writeback state plus a host API.

Plannotator local source-save becomes the first provider implementation. Workspaces becomes a second provider implementation. Plan review becomes one host mode that supplies a document, capabilities, and approve/deny behavior to the shared document surface.
