# 003. Complete Document UI Parity Cutover

> ⚠️ **REVERTED — DO NOT IMPLEMENT.** This cutover was attempted by an AI agent and failed: it produced a ~26,500-line from-scratch reimplementation, deleted the working `App.tsx`, and broke rendering (dead sidebars, wrong experience). Reverted on 2026-06-22. **This ADR is superseded by `adr/decisions/004-reuse-document-ui-as-published-building-blocks-20260622-180637.md`** — read it before doing any document-UI work. Kept here as a post-mortem only.

Date: 2026-06-21

## Status

Accepted

## Context

ADR 002 established `@plannotator/document-ui` as the provider-neutral package for Plannotator's reusable document review experience. The branch has since implemented a substantial package: provider-neutral session/document types, `DocumentHostApi`, `DocumentReviewSurface`, writeback state, drafts, linked documents, document tree state, annotation persistence, feedback assembly, image handling, a Plannotator HTTP adapter, and an in-memory provider test harness.

The package is real and green, but the app has not yet been cut over. `packages/editor/App.tsx` still owns the default Plan Review / Annotate render path. The new package surface is only mounted through an opt-in bridge behind `VITE_DOCUMENT_SURFACE=1`.

The old shell still owns several parity-critical workflows:

- plan diff and version browser
- richer document chrome: toolstrip, sticky controls, sidebars, panels, file/message navigation, code previews, and shortcuts
- full Ask AI panel
- agent terminal shell
- archive mode
- goal setup
- settings, share/export/import, and note integrations
- Plannotator route and environment side effects

A sister Workspaces repo needs the same document review UI with a different provider. Keeping the shared package as an optional renderer while the hard behavior remains in `App.tsx` would recreate the coupling this extraction is meant to remove.

## Decision

We will finish the cutover so `@plannotator/document-ui` becomes the default production document review surface for the Plan Review / Annotate app. The feature-flagged bridge path will be removed after parity is reached.

The package owns the reusable document review loop:

- markdown and raw HTML document review
- annotation lifecycle, comments, global comments, image attachments, and annotation persistence hooks
- linked document navigation
- document tree/file tree UI, badges, and provider-neutral document/message navigation
- document editing and provider-neutral writeback states
- draft restore UI and state
- feedback payload assembly
- plan/document version browsing and diff UI
- generic Ask AI document-review surface when a host AI API exists
- code/link preview UI when the host can load or validate targets
- default chrome needed for parity: toolstrip, sticky controls, sidebars, panels, empty states, banners, shortcuts, and action buttons

The host owns environment and product policy:

- server routes, auth, browser opening, process lifetime, CLI/plugin/hook integration, and `ExitPlanMode` stdout decisions
- Plannotator settings persistence
- share/paste service policy and import/export modal policy
- Obsidian, Bear, and Octarine integrations
- agent terminal runtime, PTY/WebSocket bridge, installer, and remote security policy
- goal setup business logic
- archive storage, list loading, and archive-specific actions
- provider transport details for documents, comments, versions, and watches

Version and diff support will move into `@plannotator/document-ui` as an optional provider-neutral capability. The host will load versions; the package will provide the default version browser, base-version selection, markdown diff computation, clean/raw diff render modes, diff annotations, edit-blocking behavior, and feedback inclusion. Plannotator will adapt `/api/plan/versions` and `/api/plan/version`; Workspaces can adapt its own document versions API without inheriting Plannotator route names.

Archive and goal setup will not become core document-ui concepts for this cutover. Archive may be mounted through host slots or by loading read-only documents into the surface. Goal setup remains host-owned.

Agent terminal runtime will stay host-owned. The package may provide slots and generic delivery state, but it will not own PTY, WebSocket, runtime install, remote-mode security, or terminal prompt policy.

Ask AI will be shared only at the document-review surface level. The package may own the panel shell, document context, and in-document ask affordances. The host will own provider/model settings, auth, permission policy, and transport.

`packages/editor/App.tsx` will be reduced to a Plannotator host shell. It should load the session through the Plannotator adapter, read settings, configure host slots and side effects, render completion/modals that remain Plannotator-owned, and render `DocumentReviewSurface`. It should no longer directly orchestrate the main document viewer, HTML viewer, plan diff viewer, annotation panel, linked-doc state machine, archive document rendering path, file/message navigation state, source-save UI state, or direct document feedback assembly.

## Consequences

The branch now has a concrete completion target: there should be one production document-review path, and it should go through `@plannotator/document-ui`.

The cutover requires more work than the initial extraction because parity gaps must be closed before old code can be deleted. The biggest new package capability is provider-neutral version/diff support.

The shared package will become larger and more product-shaped. That is intentional: the reusable value is the document review loop, not just renderer components.

The Plannotator host shell remains necessary. It will still own routes, settings, share/export/note policy, archive storage, goal setup, terminal runtime, and hook/plugin behavior. Those are not shared document UI responsibilities.

Workspaces gets a clear integration point: implement `DocumentHostApi` for workspace documents, manifests, annotations, writeback, and versions. It should not need to reimplement Plannotator's document state machine or inherit local source-save vocabulary.

ADR 002 remains valid as the package boundary decision. This ADR extends it by declaring the cutover requirement and moving version/diff into the shared package as an optional capability.

The implementation is complete only when:

- the normal Plan Review / Annotate app renders through `@plannotator/document-ui`
- `VITE_DOCUMENT_SURFACE` is gone from production code
- the old document-review render path is removed
- plan review, annotate file, annotate folder, annotate last, raw HTML, linked docs, source-save, drafts, plan diff, Ask AI, terminal slot, archive, export/share, and note integrations still work
- Workspaces can supply a provider without depending on Plannotator local source-save terms
