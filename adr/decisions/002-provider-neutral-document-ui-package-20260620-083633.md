# 002. Extract a Provider-Neutral Document UI Package

> ⚠️ **RE-SCOPED / SUPERSEDED BY ADR 004 — DO NOT IMPLEMENT AS WRITTEN.** The provider-neutral `DocumentReviewSurface` / `DocumentHostApi` approach in this ADR was attempted, broke the app, and was reverted on 2026-06-22. The corrected plan is **`adr/decisions/004-reuse-document-ui-as-published-building-blocks-20260622-180637.md`** — read it first. Kept here as history.

Date: 2026-06-20

## Status

Accepted

## Context

Plannotator began as a plan review UI. In Plan Mode, the Claude Code hook intercepts `ExitPlanMode`, starts the server, opens the browser, and waits for approve or deny.

The product has since shifted. The main document workflow is now broader than plan review: users run annotate on markdown, text, HTML, URLs, folders, and last assistant messages. The same React app currently handles all of those modes. The annotate server serves document sessions through `/api/plan`, and `packages/editor/App.tsx` switches between plan review, annotate file, annotate folder, annotate message, raw HTML, archive, and goal setup.

A sister Workspaces repo now needs the same document review experience. It should get the same Plannotator UI patterns for rendering, annotation, comments, file trees, edit state, draft restore, and feedback assembly, but with different provider mechanics: document ids instead of filesystem paths, workspace manifests instead of local directory walks, `If-Match` or version ids instead of disk hashes, and workspace APIs instead of `/api/doc` and `/api/source/save`.

The current package split does not express this boundary. `@plannotator/ui` contains reusable primitives, but many hooks and components call hard-coded `/api/*` routes. `@plannotator/editor` contains the app shell and important document-domain behavior such as editable document state, source reconciliation, direct edits, draft restore, and agent-terminal integration. Moving only `Viewer` or renderer components would leave the hard product behavior trapped in `App.tsx` and force Workspaces to recreate it.

The key abstraction is not local source-save. Local source-save is Plannotator's current writeback provider. The reusable concept is provider-neutral document writeback state:

- clean
- dirty
- saving
- saved
- conflict
- missing
- error

Plannotator local writeback uses `/api/source/save`, disk hashes, mtime, EOL metadata, file watching, and missing local files. Workspaces writeback uses workspace document APIs, `If-Match`, versions, missing document rows, and workspace restore semantics. The UI state and user experience should be shared; persistence details should belong to the host/provider.

## Decision

We will extract one shared package:

```text
@plannotator/document-ui
```

The package will expose a product-level document review surface:

```tsx
<DocumentReviewSurface hostApi={api} session={session} />
```

The package will own the reusable document review loop:

- markdown and raw HTML rendering
- markdown parsing and block rendering
- annotation lifecycle and highlight restoration
- comments, attachments, and annotation panel behavior
- linked document navigation
- document/file tree rendering and badges
- edit mode and edit session state
- provider-neutral writeback state
- conflict, missing, and error UI patterns
- draft save and restore behavior
- feedback and saved-change payload assembly
- code path validation UI and inline link handling
- optional Ask AI and agent-delivery integration points

The package public contract must be provider-neutral. It must not require filesystem paths, `/api/source/save`, disk hashes, or local source-save terminology. Public types should use concepts such as `DocumentRef`, `LoadedDocument`, `DocumentReviewSession`, `DocumentHostApi`, `DocumentWritebackStatus`, `SaveDocumentRequest`, and `SaveDocumentResult`.

Local Plannotator source-save will become the first provider implementation behind a browser-side adapter:

```text
createPlannotatorHttpDocumentApi()
```

That adapter will map current routes and local source-save metadata into the provider-neutral contract:

- `GET /api/plan`
- `GET /api/doc`
- `POST /api/doc/exists`
- `GET /api/reference/files`
- `GET /api/reference/files/stream`
- `POST /api/source/save`
- `GET/POST/DELETE /api/draft`
- `POST /api/feedback`
- `POST /api/approve`
- `POST /api/exit`

The current routes will remain stable during extraction. We will not rename `/api/plan` as part of this work.

Workspaces will be able to implement its own `DocumentHostApi` using workspace document ids, manifests, annotation APIs, versions, and `If-Match` behavior. That adapter does not need to live in this repository.

The host app will continue to own runtime and environment policy:

- CLI/plugin command interception
- server startup and browser opening
- auth
- provider implementation
- plan-mode hook stdout behavior
- plan history
- plan diff
- archive
- goal setup
- permission mode setup
- note-app settings and persistence policy
- terminal runtime, WebTUI sidecar, remote-mode security, and installer logic

Plan review becomes one host mode that supplies a document, capabilities, and approve/deny behavior to the shared document surface. Annotate remains the reference use case because it exercises the full document experience: arbitrary files, folders, raw HTML, linked docs, writeback, drafts, and optional agent delivery.

We will extract in phases:

1. Create `packages/document-ui` with provider-neutral contracts.
2. Add `createPlannotatorHttpDocumentApi()` over current Plannotator routes.
3. Move document-domain state out of `packages/editor`, renaming public concepts from local source-save to provider-neutral writeback where appropriate.
4. Create `DocumentReviewSurface` around the existing viewer, HTML viewer, editor toggle, linked-doc behavior, file tree, annotation panel, drafts, and writeback state.
5. Move provider-neutral feedback assembly into the package while keeping Plannotator's agent-specific markdown wrapping in the host.
6. Shrink `packages/editor/App.tsx` into a host shell that loads the session, configures capabilities, handles plan/annotate policy, and renders `DocumentReviewSurface`.
7. Add contract and surface tests, including an in-memory provider and Bun/Pi route mapping tests.

## Consequences

Plannotator's document experience becomes the upstream UI for both Plannotator and Workspaces.

The first extraction target is not just `Viewer`. The implementation must move the document-domain behavior that makes the UI useful: writeback state, draft restore, linked-doc state, comments, edit state, file tree badges, and feedback assembly.

The package boundary will force Plannotator-local assumptions behind an adapter. Filesystem paths, disk hashes, mtime, EOL metadata, and `/api/source/save` remain valid implementation details for Plannotator local sessions, but they must not become required public fields.

The writeback model becomes shared and provider-neutral. This gives Workspaces the same dirty/saving/saved/conflict/missing/error UI without inheriting local filesystem semantics.

`@plannotator/ui` will likely remain a lower-level UI primitive package at first. `@plannotator/document-ui` can depend on it and gradually pull document-specific components into the new package. We will avoid a giant one-shot component move.

Plan diff, archive, goal setup, permission mode setup, and terminal runtime stay host-owned in the first boundary. They can be exposed as optional slots or capabilities where needed, but they are not core document package responsibilities.

Bun/Pi server parity remains required. A frontend package extraction does not remove the need to update both server implementations when route behavior changes. The first implementation should avoid route shape changes and use adapter mapping instead.

Tests must cover both the provider-neutral package behavior and the Plannotator local adapter behavior. At minimum, we need contract tests for Bun and Pi `/api/plan` and `/api/doc` mapping, source-save-to-writeback mapping, conflict and missing writeback results, in-memory provider surface behavior, linked-doc annotation caching, draft restore, and feedback payload assembly.

This decision increases near-term implementation work because we are extracting behavior rather than only components. It reduces long-term duplication and prevents the sister repo from reimplementing Plannotator's document state machine under a different backend.
