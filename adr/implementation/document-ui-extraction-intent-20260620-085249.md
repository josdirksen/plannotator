# Document UI Extraction Intent

> ⚠️ **REVERTED — DO NOT IMPLEMENT.** Implementation log of the failed `@plannotator/document-ui` extraction (reverted 2026-06-22). The long "implemented slice" list here is a record of the from-scratch rewrite that broke the app. Corrected plan: **`adr/decisions/004-reuse-document-ui-as-published-building-blocks-20260622-180637.md`**. History only.

Status: active

Date: 2026-06-20

## Intent

Make Plannotator's document review experience reusable by Plannotator and Workspaces without turning the shared package into either a thin renderer or a local-filesystem abstraction.

The shared package should own the product behavior users recognize as Plannotator's document review loop:

- render markdown and raw HTML
- annotate text and blocks
- manage comments, global comments, and image attachments
- navigate linked documents
- browse document trees
- edit documents
- show clean, dirty, saving, saved, conflict, missing, and error writeback states
- restore drafts
- assemble annotation feedback and saved-change context

The host should own routes, auth, server calls, plan-mode hook behavior, local disk or workspace persistence, and provider-specific policy.

## Current Read

The strongest boundary is a single `@plannotator/document-ui` package with a provider-neutral contract:

```tsx
<DocumentReviewSurface hostApi={api} session={session} />
```

The first extraction target is not `Viewer` alone. `Viewer` is important, but the hard reusable value is the document-domain state around it: loaded document identity, linked docs, editable content, writeback state, saved-change context, draft restore, document tree badges, and feedback assembly.

Local source-save is Plannotator's first provider. It should stay behind `createPlannotatorHttpDocumentApi()` and map into provider-neutral writeback concepts. Workspaces should be able to implement the same contract with workspace document ids, manifests, versions, `If-Match`, and its own annotation APIs.

## Execution Path

1. Establish provider-neutral contracts in `packages/document-ui`.
2. Add a Plannotator HTTP adapter over the current server routes.
3. Move pure document-domain state first: writeback records, draft restore shapes, saved-change tracking, and feedback edit assembly.
4. Keep existing Plannotator UI behavior working through compatibility wrappers while logic moves out of `packages/editor`.
5. Wrap the current render and annotation experience in `DocumentReviewSurface`.
6. Shrink `packages/editor/App.tsx` into a host shell that loads session data, configures capabilities, handles plan/annotate policy, and renders the shared surface.
7. Add an in-memory provider test harness so Workspaces behavior can be exercised without Plannotator-local routes.

## Guardrails

- Do not rename `/api/plan` or current Plannotator routes during the extraction.
- Do not expose `/api/source/save`, disk hashes, mtime, or filesystem paths as required shared-package concepts.
- Do not split the package into many small packages yet.
- Do not move plan diff, archive, goal setup, permission-mode setup, or terminal runtime into the first shared surface.
- Preserve Bun/Pi server parity when route behavior changes, but avoid route changes in the first extraction slice.
- Keep Plannotator-specific final message wrapping in the Plannotator host; move provider-neutral feedback assembly into the package.

## Implemented Slice

The first implementation slice is intentionally narrow but now covers the reusable document-domain contract and its first Plannotator adapter:

- create `packages/document-ui`
- define `DocumentRef`, `LoadedDocument`, `DocumentReviewSession`, `DocumentHostApi`, and writeback result types
- add `createPlannotatorHttpDocumentApi()` over current Plannotator routes
- move writeback state into provider-neutral helpers
- move direct-edit and saved-change feedback assembly into provider-neutral helpers
- move annotation/global attachment feedback assembly into provider-neutral helpers
- add document tree state with provider-neutral row identity, expansion, aggregate counts, and writeback badges
- add linked-document cache/navigation state with linked annotation feedback entries
- add provider-neutral draft state that saves/restores annotations, linked-document annotation entries, dirty writeback documents, and saved-change context through `DocumentHostApi`
- add provider-neutral edit/writeback state that drives active edit buffers, save requests, save success, conflicts, missing documents, discard, reload-conflict, unsaved documents, and saved-change entries through `DocumentHostApi.saveDocument`
- add an initial `DocumentReviewSurface` wrapper that resolves the active document, seeds writeback state, exposes render-state, lazy-loads the existing Plannotator markdown/raw-HTML renderers, routes renderer linked-document clicks through `hostApi.resolveLinkedDocument`/`hostApi.loadDocument`, and renders provider-neutral document chrome for writeback status, draft restore, edit/save/discard, conflict overwrite, conflict reload, linked-document back/error controls, document tree/file-row navigation, and annotation/right-panel presentation for current-document comments, attachments, code annotations, linked-document feedback, unsaved writeback edits, and saved-change context
- route raw-HTML iframe local document links through the same linked-document resolver as markdown links while leaving external, anchor, unsafe, and annotation-control clicks alone
- add typed React host slots (`terminalPanel`, left/right extras, header actions, footer), Plannotator-theme layout classes, and real renderer mode options (`selection`, `comment`, `redline`, `quickLabel`, `drag`, `pinpoint`) so the default surface can carry host-specific app chrome without owning host policy
- add `createMemoryDocumentHostApi()` as a Workspaces-like in-memory provider harness with document ids, manifest trees, base-revision saves, conflict/missing results, draft round trips, linked-doc resolution, and watch events
- add provider-neutral review lifecycle actions to `DocumentReviewSurface`: assemble feedback payloads with linked annotations, unsaved direct edits, and saved-change context; call `hostApi.submitFeedback`, `hostApi.approve`, and `hostApi.exit`; clear drafts after successful terminal actions; surface action errors and default action buttons without baking in Plannotator route policy
- add provider-neutral writeback watching through `useDocumentWritebackWatch`: subscribe to `hostApi.watchDocuments`, reload changed open documents through `hostApi.loadDocument`, reconcile clean updates, preserve dirty buffers as conflicts, mark deleted/missing documents, and expose watch state from the shared surface
- add optional provider-neutral annotation persistence through `hostApi.loadAnnotations`/`hostApi.saveAnnotations`, so Workspaces can back the same comment UI with its annotations API while local Plannotator can keep relying on drafts and terminal feedback
- add Plannotator host-session normalization and editor load-plan derivation in the local HTTP adapter: `/api/plan` responses are now translated once into document-session mode flags, render mode, markdown/html payloads, annotate source, sharing settings, source-file paths, root source-save writeback, recent messages, archive/goal setup metadata, version metadata, and the concrete app-shell initialization plan before `packages/editor/App.tsx` applies React side effects
- add an explicit opt-in Plannotator app bridge for `DocumentReviewSurface`: when `VITE_DOCUMENT_SURFACE=1` or `true`, `packages/editor/App.tsx` now hands the normalized session to `PlannotatorDocumentSurfaceBridge`, which mounts `<DocumentReviewSurface hostApi={api} session={session} />` using the Plannotator HTTP adapter while the default production path keeps the legacy Plannotator shell
- move Plannotator direct-edit feedback compatibility formatting into `@plannotator/document-ui/plannotator-feedback`, including legacy direct-edit wording, saved-file-change wording, edit badge stats, panel item builders, provider-neutral current direct-edit content resolution over live/stored edit buffers, direct-edit commit decisions for stored edits/panel reveal/remapping, direct-edit discard decisions for reset/remap behavior, direct-edit draft restore decisions with CRLF normalization and current-work-wins skipping, direct-edit feedback presence decisions, saved-change-vs-direct-edit panel precedence, and current direct-edit feedback-section gating while writeback buffers are pending; `packages/editor` now imports that behavior from the shared package
- move Plannotator source-save editable-document state and disk reconciliation into `@plannotator/document-ui` adapter exports (`plannotator-source-documents`, `plannotator-source-reconciliation`), preserving local disk hash/missing-file behavior as Plannotator compatibility while keeping it out of the provider-neutral core contract
- move the Plannotator source-document `/api/doc` probe/snapshot client into `@plannotator/document-ui/plannotator-source-client`, so source-save hash refresh, missing-file detection, and markdown snapshot loading sit with the local adapter instead of the editor shell
- move the Plannotator restored single-file draft selection helper into the source-document adapter helpers, so source-save draft restore display policy is shared rather than editor-local
- move reusable feedback text assembly into `@plannotator/document-ui/feedback-text`: current-document annotations, linked-document annotations, editor annotations, code-file annotations, multi-message feedback, empty-feedback sentinels, source-specific titles, converted-source caveats, and linked-document markdown block enrichment now live in the shared package while Plannotator delivery policy stays in the editor shell
- move reusable multi-message feedback entry assembly into `@plannotator/document-ui/feedback-text`: the shared package now converts message picker rows plus linked-session annotation state into parser-ready message feedback entries, including root markdown blocks, linked-document markdown blocks, global attachments, and code annotations; `packages/editor/App.tsx` keeps selecting/saving message state and deciding when message-mode feedback is active
- move provider-neutral feedback submission interpretation into `@plannotator/document-ui/feedback-submission`: the shared package now composes annotation text with direct-edit and saved-change sections, reports whether review content exists, distinguishes saved-change-only context from unsent feedback, produces feedback-loss wording, and decides whether approve-with-notes payloads should include feedback text
- move annotate feedback target selection into `@plannotator/document-ui/feedback-submission`: the shared package now chooses linked document, source file, active file, folder, or current-file fallback targets for annotate feedback while `packages/editor/App.tsx` keeps Plannotator's message/file feedback templates and terminal delivery side effects
- move provider-neutral annotation remapping and highlight-restore decisions into `@plannotator/document-ui/annotation-remap`: markdown edits, reloads, and draft restores can now re-anchor annotations by selected text against newly parsed blocks, preserve diff/global/checkbox annotations, clear stale positional metadata when block ids move, mark missing text with an empty block id, choose which annotations should be restored into document highlights, detect missing restored highlights through a host-provided lookup, and build missing-highlight warning copy; `packages/editor/App.tsx` keeps markdown state, edit generation, DOM lookup, highlight repaint, and toast side effects
- move Plannotator-specific route payload assembly into `@plannotator/document-ui/plannotator-delivery`: approve, deny, annotate feedback, note-integration payloads, plan-save payloads, message-scope fields, and draft-generation URL helpers now sit with the local adapter while the editor shell keeps deciding when to call each route
- add a Plannotator delivery client in `@plannotator/document-ui/plannotator-delivery` and wire `packages/editor/App.tsx` approve, deny, annotate-feedback, annotate-approve, and annotate-exit handlers through it; the editor shell still owns settings lookup, saved-change validation side effects, terminal fallback, and submitted-state UI
- move generic agent-delivery state into `@plannotator/document-ui/agent-delivery`: feedback hashing, delivery records, target matching, duplicate-send decisions, current-delivery derivation, delivered-status visibility, and feedback-to-send flags are now provider-neutral; Plannotator's terminal helper keeps only terminal prompt/target formatting and adapts to the shared record shape
- move saved-change validation decisions into `@plannotator/document-ui/saved-change-validation`: submit-time stale/unverified blocking and draft-restore kept/changed-or-missing/unverified interpretation are now shared, while Plannotator keeps toast, cleanup, and draft-scheduling side effects in the host shell
- move direct-edit begin/change state decisions into `@plannotator/document-ui/edit-feedback`: non-writeback edit sessions now normalize CRLF before seeding the edit baseline, resolve missing original baselines, and report dirty/diff state through shared direct-edit lifecycle decisions while `packages/editor/App.tsx` keeps React state, source-save branching, terminal feedback revision, and draft scheduling side effects
- move direct-edit commit/discard display decisions into `@plannotator/document-ui/edit-feedback`: stored edit content, edit-stat reset/input, edit-panel reveal, editor dirty/diff reset, and remap content now flow through shared direct-edit decisions before `packages/editor/App.tsx` applies refs and annotation repaint
- move direct-edit draft-restore display decisions into `@plannotator/document-ui/edit-feedback`: restored, skipped, and ignored draft edit outcomes now map to stored edit content, edit-stat input, editor diff reset, edit-panel reveal, and remap content before `packages/editor/App.tsx` applies refs, annotation repaint, toasts, and draft scheduling
- move document review action lifecycle state into `@plannotator/document-ui/action-controller`: submitting/exiting lanes, open-session outcomes, submitted completions, and failure recovery are now shared; `packages/editor/App.tsx` approve, deny, annotate feedback, annotate approve, annotate exit, goal-setup exit, and callback delivery paths now use the shared controller while preserving Plannotator route policy and terminal fallback behavior
- move reusable review chrome copy and surface visibility decisions into `@plannotator/document-ui/chrome`: recovered-draft messages, add-feedback prompts, saved-change awareness text, unsaved-edit warnings, unsaved writeback continuation decisions, feedback/approve/exit/primary-submit action-intent decisions, submit-shortcut routing/ignore decisions, print-shortcut routing/ignore decisions, version/diff edit-block decisions, document-navigation edit-block decisions, document layout width state, feedback-loss warnings, completion-overlay title/subtitle decisions, sticky-header visibility, annotation-toolstrip visibility, folder-empty state, normal-document visibility, inline document-control visibility, left-sidebar collapsed/expanded visibility, left-sidebar tab open/toggle/wide-exit decisions, initial/TOC sidebar preference decisions, empty-TOC auto-close decisions, document-area collapsed-sidebar offset, sidebar tab visibility, right-panel tab visibility, right-panel toggle/reveal decisions, AI-panel visibility, panel resize-handle visibility, header action visibility/control state, viewer remount identity, linked-document breadcrumb variants/back labels, document copy labels, open targets, and message-picker count state are now shared; `packages/editor/App.tsx` and `AppHeader` keep the existing dialog/components, Claude Code issue links, warning continuation callbacks, provider capability flags, agent checks, DOM event wiring, callbacks, print side effect, Plannotator-specific linked-document labels, and local storage/path wording
- move provider-neutral Ask AI context assembly into `@plannotator/document-ui/ai-context`: the shared package now derives plan vs document AI context, document targets, source metadata, raw HTML vs markdown content, thread keys/titles, general ask labels, folder-empty blocking, and readable target priority without depending on the AI provider package; `packages/editor/App.tsx` keeps `useAIChat`, provider/model settings, terminal fallback delivery, toasts, and prompt formatting
- move reusable left-sidebar tab/open state into `@plannotator/document-ui/left-sidebar`: the shared generic controller now owns active-tab/open state, raw open/close transitions, review open/toggle transitions, preference-decision application, empty-TOC auto-close application, and wide-mode exit effects; `packages/editor/App.tsx` keeps concrete Plannotator tab content, archive/file/message loading side effects, resize widths, and invokes the host-owned wide-mode exit side effect
- move reusable right-panel tab/open state into `@plannotator/document-ui/right-panel`: the shared controller now owns annotation/AI active-tab state, open/close transitions, toggle/reveal transitions, compact-viewport reveal policy, and wide-mode exit effects; `packages/editor/App.tsx` keeps resize widths, mobile layout, and invokes the host-owned wide-mode exit side effect
- move reusable annotation state, visibility, feedback-presence, and provider-mutation routing into `@plannotator/document-ui/review-state`: the shared package now owns the root annotation/code-annotation/selection/global-attachment reducer, semantic add/select/update/remove actions, opposite-selection clearing, React-style setter adapters for Plannotator compatibility hooks, local/provider annotation merging while preferring live provider copies over draft-restored duplicates, rendered-viewer vs diff annotation partitioning, message/document feedback presence/counts, and provider-vs-local edit/delete routing; `packages/editor/App.tsx` keeps external annotation route calls, DOM highlight repaint, checkbox visual overrides, file-popout opening, and linked-document cache side effects
- move linked-document annotation badge/count summaries into `@plannotator/document-ui/linked-state`: the shared package now derives per-document annotation counts from linked-document caches, scopes those counts with a host-owned containment predicate, and summarizes annotations outside the active document for right-panel badges; `packages/editor/App.tsx` keeps the legacy `useLinkedDoc` cache, Plannotator filesystem path containment predicate, file-browser highlighting timer, and `AnnotationPanel` prop shape
- move linked-document editable-load decisions into `@plannotator/document-ui/linked-state`: the shared package now decides when linked-document navigation suspends an active writeback edit, clears active editability for non-editable/HTML targets, opens a folder-linked markdown document as editable, and resets an already-open editor session from current-vs-baseline content; `packages/editor/App.tsx` keeps the Plannotator editable-document store mutations, source-save keys, and React state side effects
- move linked-document back edit-state decisions into `@plannotator/document-ui/linked-state`: returning from a linked document now gets a shared decision for whether to exit edit mode and reset active editor dirty/diff state while `packages/editor/App.tsx` keeps invoking linked-document back, file-browser active-file clearing, and archive selection clearing
- move linked-document editable snapshot decisions into `@plannotator/document-ui/linked-state`: before linked-document navigation and submission, the shared package now decides whether to snapshot live editor content, displayed content, or nothing while `packages/editor/App.tsx` keeps reading the editor handle and mutating the Plannotator editable-document store
- move reusable linked-message annotation cache helpers into `@plannotator/document-ui/linked-state`: the shared package now counts annotations across root documents, linked documents, attachments, and code comments; creates empty message annotation snapshots; normalizes immutable message root content when picker messages change; and builds per-message badge counts over a linked-session-like shape without depending on Plannotator `/api/doc` or local filesystem paths; `packages/editor/App.tsx` keeps the legacy `useLinkedDoc` hook, message picker state, code-popout side effects, and feedback-entry rendering
- move current-message annotation state and active message badge-count decisions into `@plannotator/document-ui/linked-state`: the shared package now builds the live selected-message snapshot from message rows, linked-document session snapshots, code annotations, and selected code comment ids, and overlays that live state onto cached per-message counts; `packages/editor/App.tsx` keeps storing the cache ref/state and invoking the legacy linked-doc restore side effects
- move message-state cache merge/count recomputation and annotate feedback message-scope decisions into `@plannotator/document-ui/linked-state`: the shared package now folds the live selected-message state into cached message states, produces refreshed per-message annotation counts, and decides selected-message vs multi-message feedback scope for submissions; `packages/editor/App.tsx` keeps cache refs/state setters and Plannotator route body construction
- move message selection decisions into `@plannotator/document-ui/linked-state`: the shared package now decides whether a message picker request should be ignored or should select a normalized target message state, using cached message state when present and empty message state otherwise; `packages/editor/App.tsx` keeps the actual selected-message state update, legacy linked-doc restore, and code annotation restoration side effects
- move active message annotation count summaries into `@plannotator/document-ui/linked-state`: the shared package now derives total message feedback count, annotated message ids, and has-annotation flags from active per-message counts; `packages/editor/App.tsx` keeps rendering those values and passing them to sidebar/submission policy
- move wide/focus layout mode decisions into `@plannotator/document-ui/wide-mode`: wide-mode availability, enter/toggle/forced-exit decisions, sidebar/panel snapshot capture, sidebar/panel snapshot restore, explicit sidebar reopen, explicit panel reopen, and no-restore exit behavior are now shared; `packages/editor/wideMode.ts` remains a compatibility wrapper for the old Plannotator option names
- move reusable edit/writeback chrome decisions into `@plannotator/document-ui/edit-chrome`: markdown edit availability/reason classification, save button labels/disabled/tone state, edit/done/cancel/discard labels, edit-exit click transitions, stale discard-confirmation reset decisions, dirty/failed writeback status predicates, save-shortcut document/host/ignore routing, conflict banner copy, and missing-document banner copy are now shared; `packages/editor/App.tsx` maps those neutral states to existing Tailwind classes, passes Plannotator's disk wording and surface-mode facts, and keeps host notes/export fallback behavior, while the default `DocumentReviewSurface` uses the same save-label helper
- move reusable writeback edit-session chrome state into `@plannotator/document-ui/edit-chrome`: active-buffer dirtiness, conflict overwrite availability, and cancel-mode derivation now come from provider-neutral writeback content/status inputs while `packages/editor/App.tsx` keeps Plannotator source-document field mapping and button rendering
- move Plannotator local source-save request and response mapping into `@plannotator/document-ui/plannotator-source-client`: the adapter now builds `/api/source/save` bodies, maps success metadata back to source-save capabilities, preserves conflict snapshots, and normalizes local write errors; `packages/editor/App.tsx` keeps applying those mapped results to its compatibility store, repainting annotations, and showing Plannotator toasts
- move Plannotator local source-save result application into `@plannotator/document-ui/plannotator-source-documents`: mapped save results now update the source-document compatibility store for saved, live-dirty-after-save, conflict, clean-updated, conflict-unavailable, and error outcomes; `packages/editor/App.tsx` keeps repaint, toast, panel, and draft-scheduling side effects
- move Plannotator source-save display classification into `@plannotator/document-ui/plannotator-source-documents`: saved, clean-updated, conflict, conflict-unavailable, error, and noop outcomes now map to active editor state, edit-stat inputs, repaint/reset text, panel reveal, draft-save intent, edited-buffer clearing, and notification intent before `packages/editor/App.tsx` applies React effects and toasts
- move Plannotator source-backed edit-session begin/change classification into `@plannotator/document-ui/plannotator-source-documents`: entering edit mode now normalizes displayed source text, seeds the source edit buffer, and reports disk-baseline diff state, while live editor changes update source state and report edit-session/disk-baseline dirtiness; `packages/editor/App.tsx` keeps React UI flags and draft scheduling
- move Plannotator source-backed edit-session begin/change display classification into `@plannotator/document-ui/plannotator-source-documents`: source edit begin/change outcomes now map to edit-session reset text and active editor dirty/diff state before `packages/editor/App.tsx` applies refs, React editing flags, terminal feedback revision, and draft scheduling
- move Plannotator source-backed edit-commit classification into `@plannotator/document-ui/plannotator-source-documents`: committing the editor buffer now updates the source-document compatibility store, normalizes editor line endings, and reports disk-baseline diff state; `packages/editor/App.tsx` keeps edit-stat rendering, panel opening, markdown repaint, and draft-scheduling side effects
- move Plannotator source-backed edit-commit display classification into `@plannotator/document-ui/plannotator-source-documents`: committed, clean, and ignored source-edit outcomes now map to edited-buffer clearing, edit-stat reset/input, edit-panel reveal, and normalized markdown remap content before the host applies the shared edit-display effect plan
- move Plannotator source-file discard and reload-conflict outcome/display classification into `@plannotator/document-ui/plannotator-source-documents`: source-backed discard now reports active/non-active, removed-file, and replacement-text outcomes, then maps them to active editor reset, repaint text, root empty-document reset, linked-document back-navigation intent, active-file cleanup intent, and draft-save intent; reload-conflict reports the reloaded snapshot and maps it to repaint/reset, clean edit state, draft-save intent, and notification intent; `packages/editor/App.tsx` keeps applying React state, highlights, linked-doc/file-browser effects, toasts, and draft scheduling
- move Plannotator missing source-file selection display classification into `@plannotator/document-ui/plannotator-source-documents`: selecting a missing source-backed file now maps to reopened markdown content, active source key, optional edit-session reset text, and active editor dirty/diff/stat input before `packages/editor/App.tsx` applies linked-document, file-browser, and React side effects
- move Plannotator source-backed draft restore display classification into `@plannotator/document-ui/plannotator-source-documents`: restored source drafts now decide single-file vs active-folder display, active-key selection, repaint text, edit-stat inputs, and panel reveal in the local adapter; `packages/editor/App.tsx` keeps applying React state, highlights, and draft-scheduling side effects
- move Plannotator source-backed draft restore edit-display classification into `@plannotator/document-ui/plannotator-source-documents`: restored source draft display outcomes now map to shared active editor dirty/diff/stat state and edit-panel reveal intent while `packages/editor/App.tsx` keeps remapping the newly restored annotation list before applying the shared edit-display effects
- move Plannotator source-document reconcile event classification into `@plannotator/document-ui/plannotator-source-reconciliation`: file-missing, clean-update, status-update, and conflict events now map to active-document repaint/reset, edit-state, edit-stat, and notification outcomes in the local adapter; `packages/editor/App.tsx` keeps the actual React state updates, highlight repaint, toasts, and draft scheduling
- move the default `DocumentReviewSurface` editor-session lifecycle into `@plannotator/document-ui/documentEditorSession`: begin/change/save/overwrite/discard/reload-conflict/draft restore now coordinate through the provider-neutral writeback and draft controllers instead of living inline in the renderer
- move reusable edit-display effect planning into `@plannotator/document-ui/edit-display`: repaint text, edit-session reset text, active editor dirty/diff/stat state, edit-panel reveal, draft-save intent, and edited-buffer clearing now normalize through one provider-neutral plan before the Plannotator shell applies DOM repaint, refs, toasts, and local linked-file cleanup
- move the default `DocumentReviewSurface` toolbar/sidebar chrome state into `@plannotator/document-ui/chrome`: edit/save/conflict visibility, pending action labels, document-tree sidebar visibility, and annotation-persistence badge visibility now come from a pure shared helper before the surface renders its default JSX
- make shared document-surface image upload provider-owned: `DocumentReviewSurface` now exposes and passes `hostApi.uploadImage` into markdown, raw-HTML, global, and per-comment attachment controls, while legacy `@plannotator/ui` callers still keep the `/api/upload` fallback and providers without upload support disable file upload rather than silently calling Plannotator-local routes
- make shared document-surface image display provider-owned: `DocumentReviewSurface` now passes a host-owned image URL resolver through markdown images, raw HTML blocks, attachment thumbnails, and re-edit previews; the Plannotator HTTP adapter maps local paths to `/api/image`, while generic providers can return workspace asset URLs without inheriting Plannotator-local routes
- self-review tightened the image contract: the Plannotator adapter now populates `LoadedDocument.imageBase` for root and linked documents, derives image bases from `documentRef.path` when needed, resets thumbnail load/error state when image URLs change, treats Windows absolute paths as absolute in the legacy image fallback, and treats `allowImageAttachments: false` as disabling attachment controls rather than only disabling file upload
- map Plannotator renderer linked-doc hrefs into neutral refs in the local HTTP adapter, preserving `/api/doc` base resolution without exposing local source-save as a shared-package requirement
- wire `packages/editor/App.tsx` through the Plannotator HTTP document adapter for initial session loading
- map legacy Plannotator `/api/draft` source-save records into neutral draft/writeback records in the local adapter
- keep Plannotator compatibility wrappers in `packages/editor` so current feedback wording and saved-file validation behavior stay stable

This gives both repositories a concrete contract to evaluate before the larger React surface move.

## Remaining Work

- Continue visual parity work where the existing editor still owns sticky toolstrips, sidebars, plan diff, archive, goal setup, Ask AI, and other app-shell policy outside `DocumentReviewSurface`.
- Shrink `packages/editor/App.tsx` into a Plannotator host shell for plan/annotate policy, route handling, settings, and legacy plan-mode behavior.
- Decide whether threaded comment/reply history and version history live in this package contract now or stay as host-provided optional capabilities until Workspaces integration exercises them.

## Current Verification

Validated after the latest document-ui extraction:

- `bun test` for the focused `packages/document-ui` suite: 101 passing tests across 17 files.
- `bun test` for the focused `packages/document-ui` suite after feedback assembly extraction: 105 passing tests across 18 files.
- `bun test` for the focused `packages/document-ui` suite after feedback submission extraction: 110 passing tests across 19 files.
- `bun test` for the focused `packages/document-ui` suite after Plannotator delivery extraction: 115 passing tests across 20 files.
- `bun test` for the focused `packages/document-ui` suite after Plannotator delivery client wiring: 117 passing tests across 20 files.
- `bun test` for the focused `packages/document-ui` suite after generic agent-delivery extraction: 120 passing tests across 21 files.
- `bun test` for the focused `packages/document-ui` suite after saved-change validation decision extraction: 123 passing tests across 21 files.
- `bun test` for the focused `packages/document-ui` suite after action-controller extraction: 128 passing tests across 22 files.
- `bun test` for the focused `packages/document-ui` suite after chrome-copy extraction: 134 passing tests across 23 files.
- `bun test` for the focused `packages/document-ui` suite after edit-chrome extraction: 138 passing tests across 24 files.
- `bun test` for the focused `packages/document-ui` suite after Plannotator source-save client extraction: 141 passing tests across 24 files.
- `bun test` for the focused `packages/document-ui` suite after Plannotator source-save result application extraction: 145 passing tests across 24 files.
- `bun test` for the focused `packages/document-ui` suite after Plannotator source-file discard/reload outcome extraction: 151 passing tests across 24 files.
- `bun test` for the focused `packages/document-ui` suite after Plannotator source-backed edit-commit extraction: 155 passing tests across 24 files.
- `bun test` for the focused `packages/document-ui` suite after Plannotator source-backed edit-session begin/change extraction: 161 passing tests across 24 files.
- `bun test` for the focused `packages/document-ui` suite after Plannotator source-document reconcile event classification extraction: 165 passing tests across 24 files.
- `bun test` for the focused `packages/document-ui` suite after annotation-remap extraction: 170 passing tests across 25 files.
- `bun test` for the focused `packages/document-ui` suite after annotation highlight-restore helper extraction: 173 passing tests across 25 files.
- `bun test` for the focused `packages/document-ui` suite after edit-availability extraction: 176 passing tests across 25 files.
- `bun test` for the focused `packages/document-ui` suite after viewport-state extraction: 179 passing tests across 25 files.
- `bun test` for the focused `packages/document-ui` suite after wide-mode extraction: 185 passing tests across 26 files.
- `bun test` for the focused `packages/document-ui` suite after right-panel state extraction: 187 passing tests across 26 files.
- `bun test` for the focused `packages/document-ui` suite after left-sidebar state extraction: 189 passing tests across 26 files.
- `bun test` for the focused `packages/document-ui` suite after sidebar-tab state extraction: 191 passing tests across 26 files.
- `bun test` for the focused `packages/document-ui` suite after unsaved writeback continuation extraction: 193 passing tests across 26 files.
- `bun test` for the focused `packages/document-ui` suite after review action-intent extraction: 197 passing tests across 26 files.
- `bun test` for the focused `packages/document-ui` suite after header action-state extraction: 200 passing tests across 26 files.
- `bun test` for the focused `packages/document-ui` suite after submit-shortcut gate extraction: 203 passing tests across 26 files.
- `bun test` for the focused `packages/document-ui` suite after save-shortcut decision extraction: 205 passing tests across 26 files.
- `bun test` for the focused `packages/document-ui` suite after right-panel toggle extraction: 207 passing tests across 26 files.
- `bun test` for the focused `packages/document-ui` suite after left-sidebar tab decision extraction: 209 passing tests across 26 files.
- `bun test` for the focused `packages/document-ui` suite after sidebar preference decision extraction: 213 passing tests across 26 files.
- `bun test` for the focused `packages/document-ui` suite after wide-mode enter/toggle decision extraction: 219 passing tests across 26 files.
- `bun test` for the focused `packages/document-ui` suite after right-panel reveal decision extraction: 221 passing tests across 26 files.
- `bun test` for the focused `packages/document-ui` suite after right-panel controller extraction: 226 passing tests across 27 files.
- `bun test` for the focused `packages/document-ui` suite after left-sidebar controller extraction: 231 passing tests across 28 files.
- `bun test` for the focused `packages/document-ui` suite after annotation visibility/count extraction: 235 passing tests across 28 files.
- `bun test` for the focused `packages/document-ui` suite after annotation mutation-routing extraction: 238 passing tests across 28 files.
- `bun test` for the focused `packages/document-ui` suite after root annotation-state hook wiring: 240 passing tests across 28 files.
- `bun test` for the focused `packages/document-ui` suite after annotation reducer-action wiring: 241 passing tests across 28 files.
- `bun test` for the focused `packages/document-ui` suite after linked-message annotation cache extraction: 243 passing tests across 28 files.
- `bun test` for the focused `packages/document-ui` suite after multi-message feedback entry extraction: 244 passing tests across 28 files.
- `bun test` for the focused `packages/document-ui` suite after current-message state/count extraction: 247 passing tests across 28 files.
- `bun test` for the focused `packages/document-ui` suite after message cache/scope extraction: 249 passing tests across 28 files.
- `bun test` for the focused `packages/document-ui` suite after message selection decision extraction: 251 passing tests across 28 files.
- `bun test` for the focused `packages/document-ui` suite after message count-summary extraction: 252 passing tests across 28 files.
- `bun test` for the focused `packages/document-ui` suite after linked-document file badge-count extraction: 255 passing tests across 28 files.
- `bun test` for the focused `packages/document-ui` suite after document chrome identity/label extraction: 257 passing tests across 28 files.
- `bun test` for the focused `packages/document-ui` suite after Ask AI context extraction: 262 passing tests across 29 files.
- `bun test` for the focused `packages/document-ui` suite after print shortcut decision extraction: 263 passing tests across 29 files.
- `bun test` for the focused `packages/document-ui` suite after version/diff edit-block extraction: 264 passing tests across 29 files.
- `bun test` for the focused `packages/document-ui` suite after document-navigation edit-block extraction: 265 passing tests across 29 files.
- `bun test` for the focused `packages/document-ui` suite after document layout width extraction: 266 passing tests across 29 files.
- `bun test` for the focused `packages/document-ui` suite after edit-exit transition extraction: 268 passing tests across 29 files.
- `bun test` for the focused `packages/document-ui` suite after current direct-edit content resolver extraction: 269 passing tests across 29 files.
- `bun test` for the focused `packages/document-ui` suite after direct-edit feedback/panel extraction: 271 passing tests across 29 files.
- `bun test` for the focused `packages/document-ui` suite after current direct-edit feedback-section gate extraction: 273 passing tests across 29 files.
- `bun test` for the focused `packages/document-ui` suite after linked-document editable-load decision extraction: 275 passing tests across 29 files.
- `bun test` for the focused `packages/document-ui` suite after direct-edit commit decision extraction: 276 passing tests across 29 files.
- `bun test` for the focused `packages/document-ui` suite after direct-edit discard decision extraction: 277 passing tests across 29 files.
- `bun test` for the focused `packages/document-ui` suite after direct-edit draft restore decision extraction: 278 passing tests across 29 files.
- `bun test` for the focused `packages/document-ui` suite after source-backed draft restore display extraction: 282 passing tests across 29 files.
- `bun test` for the focused `packages/document-ui` suite after source-save display classification extraction: 287 passing tests across 29 files.
- `bun test` for the focused `packages/document-ui` suite after source discard/reload display classification extraction: 293 passing tests across 29 files.
- `bun test` for the focused `packages/document-ui` suite after shared edit-panel presentation extraction: 295 passing tests across 29 files.
- `bun test` for the focused `packages/document-ui` suite after shared default editor-session extraction: 300 passing tests across 30 files.
- `bun test` for the focused `packages/document-ui` suite after shared edit-display effect planning extraction: 305 passing tests across 31 files.
- `bun test` for the focused `packages/document-ui` suite after source-backed edit-commit display classification extraction: 309 passing tests across 31 files.
- `bun test` for the focused `packages/document-ui` suite after direct-edit commit/discard display decision extraction: 312 passing tests across 31 files.
- `bun test` for the focused `packages/document-ui` suite after direct-edit draft-restore display decision extraction: 313 passing tests across 31 files.
- `bun test` for the focused `packages/document-ui` suite after direct-edit begin/change state decision extraction: 315 passing tests across 31 files.
- `bun test` for the focused `packages/document-ui` suite after source-backed edit-session begin/change display classification extraction: 317 passing tests across 31 files.
- `bun test` for the focused `packages/document-ui` suite after writeback edit-session chrome-state extraction: 318 passing tests across 31 files.
- `bun test` for the focused `packages/document-ui` suite after missing source-file selection display classification extraction: 321 passing tests across 31 files.
- `bun test` for the focused `packages/document-ui` suite after source-backed draft restore edit-display classification extraction: 322 passing tests across 31 files.
- `bun test` for the focused `packages/document-ui` suite after linked-document back edit-state decision extraction: 323 passing tests across 31 files.
- `bun test` for the focused `packages/document-ui` suite after linked-document editable snapshot decision extraction: 324 passing tests across 31 files.
- `bun test` for the focused `packages/document-ui` suite after annotate feedback target selection extraction: 325 passing tests across 31 files.
- `bun test` for the focused `packages/document-ui` suite after agent-delivery state derivation extraction: 326 passing tests across 31 files.
- `bun test` for the focused `packages/document-ui` suite after Plannotator editor load-plan extraction: 326 passing tests across 31 files.
- `bun test` for the focused `packages/document-ui` suite after default surface chrome-state extraction: 327 passing tests across 31 files.
- `bun test` for the focused `packages/document-ui` suite after provider-owned image upload threading: 328 passing tests across 31 files.
- `bun test packages/document-ui/DocumentReviewSurface.test.tsx packages/document-ui/plannotatorHttpApi.test.ts packages/ui/components/html-viewer/bridge-script.test.ts`: 29 passing tests.
- `bun test` for the focused `packages/document-ui` suite after provider-owned image display threading: 329 passing tests across 31 files.
- `bun test packages/document-ui/DocumentReviewSurface.test.tsx packages/document-ui/plannotatorHttpApi.test.ts packages/ui/components/html-viewer/bridge-script.test.ts` after ADR self-review fixes: 29 passing tests.
- `bun test` for the focused `packages/document-ui` suite after ADR self-review fixes: 329 passing tests across 31 files.
- `bun run typecheck` after ADR self-review fixes.
- `bun build packages/document-ui/DocumentReviewSurface.tsx --target browser --outdir /tmp/plannotator-document-ui-build` after ADR self-review fixes.
- `VITE_DOCUMENT_SURFACE=1 bun run --cwd apps/hook build` after ADR self-review fixes.
- `bun run --cwd apps/hook build` after ADR self-review fixes.
- `bun run --cwd apps/review build` after ADR self-review fixes.
- `git diff --check` after ADR self-review fixes.
- `bun run typecheck` after provider-owned image display threading.
- `bun build packages/document-ui/DocumentReviewSurface.tsx --target browser --outdir /tmp/plannotator-document-ui-build`.
- `VITE_DOCUMENT_SURFACE=1 bun run --cwd apps/hook build`.
- `bun run --cwd apps/hook build`.
- `bun run --cwd apps/review build`.
- `git diff --check`.
- `bun test packages/document-ui/DocumentReviewSurface.test.tsx packages/ui/components/html-viewer/bridge-script.test.ts`: 16 passing tests.
- `bun test packages/document-ui/documentReviewChrome.test.ts packages/document-ui/DocumentReviewSurface.test.tsx`: 55 passing tests.
- `bun test packages/editor/PlannotatorDocumentSurfaceBridge.test.tsx packages/editor/documentSurfaceBridge.test.ts`: 3 passing tests.
- `bun test packages/editor/documentSurfaceBridge.test.ts`: 2 passing tests.
- `bun test packages/editor/documentSurfaceBridge.test.ts packages/document-ui/DocumentReviewSurface.test.tsx`: 13 passing tests.
- `bun test packages/document-ui/documentAIContext.test.ts`: 5 passing tests.
- `bun test packages/document-ui/documentFeedbackText.test.ts`: 5 passing tests.
- `bun test packages/document-ui/documentFeedbackSubmission.test.ts`: 6 passing tests.
- `bun test packages/document-ui/documentAgentDelivery.test.ts`: 4 passing tests.
- `bun test packages/document-ui/plannotatorHttpApi.test.ts`: 12 passing tests.
- `bun test packages/document-ui/documentEditDisplay.test.ts`: 6 passing tests.
- `bun test packages/document-ui/documentEditorSession.test.ts`: 5 passing tests.
- `bun test packages/document-ui/DocumentReviewSurface.test.tsx`: 11 passing tests.
- `bun test packages/document-ui/editFeedback.test.ts packages/document-ui/plannotatorFeedback.test.ts`: 29 passing tests.
- `bun test packages/document-ui/plannotatorSourceDocuments.test.ts`: 60 passing tests.
- `bun test packages/document-ui/documentLinkedState.test.ts`: 20 passing tests.
- `bun test packages/document-ui/documentReviewState.test.ts`: 14 passing tests.
- `bun test packages/document-ui/documentEditChrome.test.ts`: 12 passing tests.
- `bun test packages/document-ui/documentReviewChrome.test.ts`: 43 passing tests.
- `bun test packages/document-ui/documentReviewLeftSidebar.test.ts`: 5 passing tests.
- `bun test packages/document-ui/documentReviewRightPanel.test.ts`: 5 passing tests.
- `bun test packages/document-ui/documentWideMode.test.ts packages/editor/wideMode.test.ts`: 18 passing tests.
- `bun test packages/ui/components/html-viewer/bridge-script.test.ts`: 4 passing tests.
- `bun run --cwd apps/review build`.
- `bun run --cwd apps/hook build`.
- `VITE_DOCUMENT_SURFACE=1 bun run --cwd apps/hook build`.
- `bun build packages/document-ui/DocumentReviewSurface.tsx --target browser --outdir /tmp/plannotator-document-ui-build`.
- `bun run typecheck`.
- `git diff --check`.

## Next Slice

The next highest-value extraction is the remaining app-shell coupling around the review surface: sticky toolstrip components, sidebars, plan diff/archive/goal setup, source-file discard/reload side effects, and actual editor/toolbar layout still live directly in `packages/editor/App.tsx`. Text assembly, submission interpretation, annotate feedback target selection, root annotation state, annotation visibility/counting, annotation provider-mutation routing, linked-document file badge/count summaries, linked-document editable-load decisions, linked-document back edit-state decisions, linked-document editable snapshot decisions, linked-message annotation cache/counting/current-state/scope/selection/count-summary decisions, multi-message feedback entry assembly, annotation remapping/highlight-restore decisions, Ask AI context assembly, Plannotator route payload shapes, Plannotator route calls, Plannotator host-session/editor load-plan mapping, opt-in `DocumentReviewSurface` app bridge, saved-change validation decisions, action lifecycle state, review chrome copy, document chrome identity/labels, direct-edit content resolution, direct-edit feedback/panel decisions, direct-edit begin/change state decisions, direct-edit commit/discard/draft-restore decisions, direct-edit commit/discard/draft-restore display decisions, current direct-edit feedback-section gating, unsaved writeback continuation decisions, review action-intent decisions, submit/print shortcut gate decisions, version/diff edit-block decisions, document-navigation edit-block decisions, document layout width state, header action-state decisions, viewport visibility, left-sidebar state/layout/tab visibility/tab open-toggle decisions/sidebar preference decisions, right-panel state/visibility/toggle/reveal decisions, wide/focus layout mode enter/toggle/exit decisions, edit/writeback chrome decisions, writeback edit-session chrome state, edit-exit transition decisions, save-shortcut writeback routing, markdown edit availability, shared edit-panel presentation for unsaved/saved writeback edits, shared default renderer editor-session lifecycle, shared edit-display effect planning, Plannotator local source-save request/response mapping, source-save result application/display classification, source-backed edit-session begin/change/commit classification, source-backed edit-session begin/change display classification, source-backed edit-commit display classification, source-file discard/reload outcome/display classification, missing source-file selection display classification, source-backed draft restore display/edit-display classification, source-document reconcile event classification, and generic agent-delivery state now sit in `@plannotator/document-ui`; the terminal runtime, prompt formatting, plan-mode warnings, Claude Code issue-link markup, route policy, provider capability flags, agent checks, DOM event wiring, host notes/export fallback behavior, external annotation route calls, checkbox visual overrides, and Plannotator compatibility-store/toast/panel side effects remain host-owned.

## References

- Research: `adr/research/SPIKE-document-ui-extraction-boundary-20260620-082002.md`
- Synthesis: `adr/research/synthesis-document-ui-extraction-20260620-082343.md`
- Spec: `adr/specs/document-ui-extraction-20260620-083307.md`
- Decision: `adr/decisions/002-provider-neutral-document-ui-package-20260620-083633.md`
