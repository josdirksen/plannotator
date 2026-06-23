# Document UI Parity Cutover Intent

> ⚠️ **REVERTED — DO NOT IMPLEMENT.** Implementation log of the failed cutover (reverted 2026-06-22). Corrected plan: **`adr/decisions/004-reuse-document-ui-as-published-building-blocks-20260622-180637.md`**. History only.

Date: 2026-06-21

## What

We are finishing the `@plannotator/document-ui` extraction by making it the production document-review surface for Plan Review and Annotate. The package already contains much of the provider-neutral document state, rendering, writeback, draft, linked-document, annotation, feedback, image, and Plannotator adapter work. The remaining intent is to close the parity gaps, remove the `VITE_DOCUMENT_SURFACE` opt-in path, and shrink `packages/editor/App.tsx` into a Plannotator host shell instead of keeping it as a second document-review implementation.

The shared package should own the reusable experience that Workspaces also needs: markdown and raw HTML review, annotations, attachments, linked documents, document trees, document/message navigation, edit/writeback states, drafts, feedback assembly, version/diff browsing, generic Ask AI surface behavior, code/link previews, and the default chrome around those workflows. Plannotator-specific policy should remain outside the package: routes, settings, share/export/note behavior, archive storage, goal setup, terminal runtime, plugin/hook behavior, and local source-save transport details.

## Why

The point of this branch is not to create an optional renderer beside the old app. The point is to make the Plannotator document review experience reusable by a sister Workspaces repo without forcing Workspaces to reimplement the hard state machine in `App.tsx`. If the package stays opt-in and the old shell remains the real product path, the extraction fails in practice: Workspaces gets components, but not the product behavior users recognize.

The provider boundary matters because Plannotator local source-save and Workspaces document writeback are different implementations of the same user-facing states. Plannotator uses `/api/source/save`, disk hashes, mtime, file watches, missing local files, and local drafts. Workspaces will use document ids, manifests, versions, `If-Match`, annotation APIs, and workspace-specific missing/conflict behavior. The UI should share clean, dirty, saving, saved, conflict, missing, error, draft restore, feedback assembly, and version diff behavior without requiring either provider to pretend it is the other.

## How

The implementation should proceed by closing package parity first, then cutting over the app. The first major missing package capability is provider-neutral version and diff support: add host API methods for listing and loading document versions, map Plannotator's `/api/plan/versions` and `/api/plan/version`, and move the version browser, diff view modes, diff annotations, and edit-blocking behavior into `@plannotator/document-ui`. This should be optional capability, so Workspaces can implement it with its own versions API and hosts without versions do not see the UI.

After version/diff, the default `DocumentReviewSurface` chrome needs to reach visible parity with the old shell for the generic document workflows: toolstrip, sticky controls, wide/focus controls, sidebars, panel resize/collapse behavior, folder empty state, file/message navigation, linked-document chrome, code/link preview, shortcuts, and raw HTML controls. File and message browsing should become provider-neutral document navigation through `DocumentRef` and `DocumentTreeNode`, while local filesystem containment, vault retry behavior, and Plannotator route details stay in the Plannotator adapter or host.

Writeback should then become authoritative inside the package. The old app should stop owning duplicate source-save UI state, edit/save/discard/reload-conflict behavior, draft restore decisions, and direct feedback assembly. Plannotator source-save remains first-class in the Plannotator adapter, but the shared contract remains writeback-oriented rather than disk-oriented.

Ask AI should move only as far as the reusable document-review surface. The package can own document context, an AI panel shell, and in-document ask affordances when `hostApi.askAI` exists. The host keeps provider/model settings, auth, permission handling, terminal fallback behavior, and provider-specific transport.

Terminal, archive, goal setup, settings, export/share/import, and note integrations should be mounted around or beside the package surface through host shell code and slots. The terminal runtime, PTY bridge, installer, remote-mode security, archive storage, goal setup semantics, and note-app policy are not shared document-ui responsibilities.

The final cutover is to remove the feature flag and delete the old document render path. At that point `packages/editor/App.tsx` should load the Plannotator session, configure the Plannotator document API and host slots, render completion/modals that remain Plannotator-owned, and mount `DocumentReviewSurface`. It should no longer directly orchestrate `Viewer`, `HtmlViewer`, `PlanDiffViewer`, `AnnotationPanel`, `usePlanDiff`, `useLinkedDoc`, `useArchive`, file/message navigation, source-save UI state, or feedback assembly for the main document path.

Completion means the normal app renders through `@plannotator/document-ui` with no `VITE_DOCUMENT_SURFACE` flag, the old document-review path is gone, existing Plannotator workflows still work, and Workspaces can implement the same UI through `DocumentHostApi` without inheriting local source-save vocabulary.

## Implemented Slice: Provider-Neutral Version/Diff

The first cutover slice moved version/diff support into the package boundary instead of leaving it only in the old editor shell.

`@plannotator/document-ui` now defines provider-neutral version types and host API methods for listing and loading document versions. `DocumentReviewSurface` owns version state through `useDocumentVersions`, computes markdown diffs through the shared diff engine, exposes version state through the render state, renders a default version navigator, and can switch the document body into a package-owned clean/classic/raw diff view.

The Plannotator HTTP adapter maps the existing `/api/plan/versions` and `/api/plan/version` routes into the provider-neutral contract. It also seeds the session with `previousPlan` and `versionInfo`, so the package can show previous-version changes without forcing an immediate extra fetch. The memory host API now supports version seeds, version listing, and version loading so Workspaces-like behavior can be tested without local Plannotator routes.

This slice deliberately does not move Plannotator's VS Code diff route into the shared package. That route is local host policy. The package now owns the reusable document diff surface; richer route-specific actions can be added later through host actions or slots.

Verification:

- `bun test packages/document-ui`: 332 passing tests.
- `bun test packages/document-ui/DocumentReviewSurface.test.tsx packages/document-ui/plannotatorHttpApi.test.ts packages/document-ui/memoryDocumentHostApi.test.ts`: 37 passing tests.
- `bun run --cwd packages/document-ui typecheck`.
- `bun build packages/document-ui/DocumentReviewSurface.tsx --target browser --outdir /tmp/plannotator-document-ui-build`.
- `git diff --check`.

Full repo `bun run typecheck` is still blocked before `packages/document-ui` by existing `packages/ui` type errors in `AnnotationToolbar.tsx` and `config/settings.ts`; the document-ui package typecheck itself passes.

## Implemented Slice: Default Surface Routing and Delivery Parity

The next cutover slice removed the runtime `VITE_DOCUMENT_SURFACE` gate from the editor app. `packages/editor/App.tsx` now routes normal Plan Review and Annotate document sessions through `PlannotatorDocumentSurfaceBridge` by default when a `DocumentReviewSession` is available. The bridge eligibility is now mode-based (`plan-review`, `annotate`, `annotate-folder`, `annotate-message`) and explicitly leaves shared sessions, archive, goal setup, and demo fallback on the host shell for now.

The package action contract now carries draft generation and approve feedback. `DocumentReviewSurface` passes those values to the host API for submit, approve, and exit actions. The Plannotator HTTP adapter maps those provider-neutral actions through the existing production delivery helpers:

- Plan Review feedback uses `/api/deny` with plan-save settings and draft generation.
- Plan Review approval uses `/api/approve` with plan-save, permission mode, agent switch, note-app settings, optional approve-with-feedback text, document text, and draft generation.
- Annotate feedback uses `/api/feedback` with annotations, code annotations, message scope, and draft generation.
- Annotate approve/exit use the existing draft-generation query parameter routes.

The editor bridge remains the owner of Plannotator host policy. It supplies plan-save settings, permission mode, agent-switch preference, note-app configuration, and note auto-save status through the adapter context instead of moving those settings into `@plannotator/document-ui`.

Shared feedback rendering now includes direct-edit and saved-file-change sections in addition to annotations, linked-document feedback, and code annotations. That keeps edit feedback intact when the package surface submits through the Plannotator adapter.

This slice also fixed the previous full-repo typecheck blockers in `packages/ui/components/AnnotationToolbar.tsx` and `packages/ui/config/settings.ts`.

Verification:

- `bun test packages/editor/documentSurfaceBridge.test.ts packages/editor/PlannotatorDocumentSurfaceBridge.test.tsx packages/document-ui/DocumentReviewSurface.test.tsx packages/document-ui/plannotatorHttpApi.test.ts`: 32 passing tests.
- `bun test packages/document-ui packages/editor/documentSurfaceBridge.test.ts packages/editor/PlannotatorDocumentSurfaceBridge.test.tsx`: 337 passing tests.
- `bun test packages/editor`: 51 passing tests, 7 skipped existing hook tests.
- `bun run typecheck`.
- `bun run --cwd apps/hook build`.
- `git diff --check`.
- `rg -n "VITE_DOCUMENT_SURFACE|USE_DOCUMENT_SURFACE" packages apps --glob '!**/dist/**' --glob '!**/node_modules/**'` returned no code matches.

Remaining cutover work: the old `packages/editor/App.tsx` document-review implementation is still present for archive, goal setup, shared sessions, and fallback/demo paths, and much of the old main-path code still exists in the file even though normal Plan Review and Annotate sessions now route through the package bridge. The final cleanup still needs host-slot parity for settings/share/export/note/archive/goal/terminal surfaces and then deletion of the duplicate old document-review orchestration.

## Implemented Slice: Host Router Before Legacy Shell

The default app no longer enters the legacy `App.tsx` hook graph before mounting the shared document surface. `packages/editor/App.tsx` now exports a thin router that renders `PlannotatorDocumentSurfaceHost` first, with the renamed legacy shell (`LegacyPlannotatorApp`) only as a fallback.

`PlannotatorDocumentSurfaceHost` owns the Plannotator host bootstrap for normal document sessions: it loads `/api/plan` through the Plannotator document adapter, initializes config, chooses package-surface eligibility from the `DocumentReviewSession`, handles first-time Claude permission setup, preserves plan-arrival note auto-save behavior, computes completion copy, and mounts `PlannotatorDocumentSurfaceBridge`. Shared URL shapes (`/p/<id>` and share-looking hash payloads) bypass package preloading so the existing legacy share loader can still restore shared documents without an API session.

The legacy shell no longer stores a `documentSurfaceSession` or contains a second `PlannotatorDocumentSurfaceBridge` early return. That means normal Plan Review and Annotate sessions reach `@plannotator/document-ui` before legacy annotation, edit, diff, sidebar, and viewer hooks mount. Archive, goal setup, shared sessions, and demo/API-failure fallback still use the legacy shell.

Verification:

- `bun test packages/editor/PlannotatorDocumentSurfaceHost.test.ts packages/editor/PlannotatorDocumentSurfaceBridge.test.tsx packages/editor/documentSurfaceBridge.test.ts`: 5 passing tests.
- `bun test packages/editor`: 53 passing tests, 7 skipped existing hook tests.
- `bun test packages/document-ui`: 334 passing tests.
- `bun run typecheck`.
- `bun run --cwd apps/hook build`.
- `git diff --check`.

Remaining cutover work: move or slot the still-host-owned archive, goal setup, shared-session, settings/share/export/note, and terminal surfaces so the legacy shell can be deleted instead of retained as fallback. The renamed `LegacyPlannotatorApp` still contains the old document-review orchestration for those fallback paths.

## Implemented Slice: Thin Editor Entrypoint

The editor entrypoint is now a real host shell instead of the giant legacy implementation. The previous `packages/editor/App.tsx` body was moved to `packages/editor/LegacyPlannotatorApp.tsx`, and `packages/editor/App.tsx` is now a small wrapper that mounts `PlannotatorDocumentSurfaceHost` with `LegacyPlannotatorApp` as fallback.

This does not delete the old implementation yet, but it makes the production entrypoint shape match ADR 003: the app entry configures a Plannotator host route and the package surface is tried first. The old document-review orchestration is isolated behind a legacy fallback module for archive, goal setup, shared URLs, and demo/API-failure cases.

Verification:

- `wc -l packages/editor/App.tsx packages/editor/LegacyPlannotatorApp.tsx packages/editor/PlannotatorDocumentSurfaceHost.tsx` showed `App.tsx` at 9 lines and the legacy fallback isolated in `LegacyPlannotatorApp.tsx`.
- `bun test packages/editor/PlannotatorDocumentSurfaceHost.test.ts packages/editor/PlannotatorDocumentSurfaceBridge.test.tsx packages/editor/documentSurfaceBridge.test.ts`: 5 passing tests.
- `bun test packages/editor`: 53 passing tests, 7 skipped existing hook tests.
- `bun test packages/document-ui`: 334 passing tests.
- `bun run typecheck`.
- `bun run --cwd apps/hook build`.
- `git diff --check`.

Remaining cutover work: delete `LegacyPlannotatorApp.tsx` by replacing its remaining fallback responsibilities with package-owned document review behavior plus small host-owned shells/slots for archive, goal setup, shared-session loading, settings/share/export/note, and terminal runtime.

## Implemented Slice: Goal Setup Host Cutover

Goal setup is now routed before the legacy shell. `PlannotatorDocumentSurfaceHost` recognizes `mode: "goal-setup"` from the Plannotator adapter, normalizes the goal setup bundle, initializes host config, and renders a new `PlannotatorGoalSetupHost` instead of falling through to `LegacyPlannotatorApp`.

This keeps the ADR boundary intact: goal setup remains host-owned environment workflow, not package-owned document review behavior. The new host shell wraps the existing `GoalSetupSurface`, supplies the top-level Submit and Close actions, posts close through the existing `/api/exit` endpoint, and uses the same completion overlay copy as the document surface.

Verification:

- `bun test packages/editor/PlannotatorGoalSetupHost.test.tsx packages/editor/PlannotatorDocumentSurfaceHost.test.ts packages/editor/PlannotatorDocumentSurfaceBridge.test.tsx packages/editor/documentSurfaceBridge.test.ts`: 6 passing tests.
- `bun test packages/editor`: 54 passing tests, 7 skipped existing hook tests.
- `bun test packages/document-ui`: 334 passing tests.
- `bun run typecheck`.
- `bun run --cwd apps/hook build`.

Remaining cutover work: delete `LegacyPlannotatorApp.tsx` by replacing its remaining fallback responsibilities with package-owned document review behavior plus small host-owned shells/slots for archive, shared-session loading, settings/share/export/note, and terminal runtime. Goal setup no longer needs the legacy shell on the normal API path.

## Implemented Slice: Archive Host Cutover

Standalone archive mode is now routed before the legacy shell. `PlannotatorDocumentSurfaceHost` recognizes archive content from the Plannotator adapter and renders a new `PlannotatorArchiveHost` instead of entering `LegacyPlannotatorApp`.

The archive shell keeps archive storage and lifecycle host-owned. It uses the existing archive API routes (`/api/archive/plans`, `/api/archive/plan`, `/api/done`), reuses `ArchiveBrowser` for the saved-plan list, reuses the existing markdown `Viewer` for rendering archived plans, and keeps the archive completion overlay behavior. The `Viewer` import is browser-lazy so non-browser host imports and unit tests do not load `web-highlighter` before `window` exists.

Verification:

- `bun test packages/editor/PlannotatorArchiveHost.test.tsx packages/editor/PlannotatorGoalSetupHost.test.tsx packages/editor/PlannotatorDocumentSurfaceHost.test.ts packages/editor/PlannotatorDocumentSurfaceBridge.test.tsx packages/editor/documentSurfaceBridge.test.ts`: 7 passing tests.
- `bun test packages/editor`: 55 passing tests, 7 skipped existing hook tests.
- `bun run typecheck`.
- `bun run --cwd apps/hook build`.

Remaining cutover work: delete `LegacyPlannotatorApp.tsx` by replacing its remaining fallback responsibilities with shared-session loading, demo/API-failure fallback, settings/share/export/note host actions, and terminal runtime slots. Goal setup and standalone archive no longer need the legacy shell on their normal API paths.

## Implemented Slice: Shared Session Host Cutover

Shared URL sessions now route before the legacy shell. `PlannotatorDocumentSurfaceHost` still bypasses `/api/plan` preloading for share-shaped URLs, but it now renders `PlannotatorSharedSessionHost` instead of falling through to `LegacyPlannotatorApp`.

The shared host keeps share/callback policy host-owned while using the package document surface. It decodes hash payloads and short `/p/<id>` paste-service links into a provider-neutral in-memory document session, seeds shared annotations and global attachments into `DocumentReviewSurface`, and disables provider persistence/drafts for the portable shared context. Shared sessions expose a host-owned `Copy Link` header action that assembles an updated share URL from the current package feedback payload. Bot callback links (`cb`/`ct`) are handled as host delivery: package submit/approve actions call back with an updated annotated share URL, but the package remains unaware of Plannotator's share URL format.

To support host-owned share/export actions without coupling them into the package, `DocumentReviewSurface` header action slots can now be render functions that receive the current feedback payload and action helpers. Existing static slot nodes continue to work.

Verification:

- `bun test packages/editor/sharedDocumentSession.test.ts packages/editor/PlannotatorSharedSessionHost.test.tsx packages/editor/PlannotatorDocumentSurfaceHost.test.ts packages/document-ui/DocumentReviewSurface.test.tsx`: 19 passing tests.
- `bun test packages/editor`: 58 passing tests, 7 skipped existing hook tests.
- `bun test packages/document-ui`: 335 passing tests.
- `bun run typecheck`.
- `bun run --cwd apps/hook build`.

Remaining cutover work: delete `LegacyPlannotatorApp.tsx` by replacing its remaining fallback responsibilities with demo/API-failure fallback, fuller settings/share/export/note host actions, and terminal runtime slots. Normal document review, annotate, goal setup, standalone archive, and shared URL sessions no longer need the legacy shell on their normal paths.

## Implemented Slice: Annotate Agent Terminal Host Slot Cutover

Annotate agent terminal delivery is now wired into the package-backed production document surface without moving the terminal runtime into `@plannotator/document-ui`.

`PlannotatorDocumentSurfaceHost` passes the Plannotator terminal capability from the loaded `/api/plan` session into `PlannotatorDocumentSurfaceBridge`. The bridge keeps the terminal runtime host-owned: it lazy-loads `AnnotateAgentTerminalPanel`, mounts it through the existing `DocumentReviewSurface` terminal slot, and exposes host header actions for opening, hiding, stopping, and sending feedback to the agent terminal.

The default package submit action now preserves the legacy annotate behavior when a terminal session is ready. The bridge renders the current package feedback payload, wraps it with the Plannotator annotate feedback template, sends it to the terminal, records the delivery key, clears the draft through `DocumentReviewSurface`, and keeps the review session open. Duplicate sends of the same feedback/body/target in the same terminal session are treated as already delivered. If terminal delivery fails, the bridge falls back to the original `/api/feedback` submit path.

The package contract gained a small provider-neutral submit result flag, `keepSessionOpen`, so host-owned delivery channels can clear drafts without forcing the completion overlay. The package still does not own PTY/WebSocket setup, runtime install, remote-mode security, agent selection, or terminal prompt policy.

Verification:

- `bun test packages/editor/PlannotatorDocumentSurfaceBridge.test.tsx packages/document-ui/DocumentReviewSurface.test.tsx`: 17 passing tests.
- `bun run --cwd packages/document-ui typecheck`.
- `bun test packages/editor`: 59 passing tests, 7 skipped existing hook tests.
- `bun run typecheck`.
- `bun test packages/document-ui`: 336 passing tests.
- `bun run --cwd apps/hook build`.
- `git diff --check`.

Remaining cutover work: delete `LegacyPlannotatorApp.tsx` by replacing its remaining fallback responsibilities with demo/API-failure fallback and fuller settings/share/export/note host actions. The annotate terminal no longer needs the legacy shell on the normal package-backed annotate file/folder paths.

## Implemented Slice: Legacy Shell Deletion And Package Fallback

The editor app no longer imports or mounts `LegacyPlannotatorApp`. `packages/editor/App.tsx` now mounts `PlannotatorDocumentSurfaceHost` directly, and the previous legacy fallback branch in `PlannotatorDocumentSurfaceHost` has been replaced by a package-backed fallback route.

The fallback route is intentionally small and host-owned. If there is no active `/api/plan` session, or if a future unsupported session mode reaches the host, `PlannotatorDocumentSurfaceFallback` renders the existing demo plan through `DocumentReviewSurface` with an in-memory provider. This keeps development/no-server behavior available without preserving a second document-review implementation.

`packages/editor/LegacyPlannotatorApp.tsx` has been deleted. Source checks now confirm there are no remaining `LegacyPlannotatorApp`, `status: 'legacy'`, `VITE_DOCUMENT_SURFACE`, `USE_DOCUMENT_SURFACE`, or `documentSurfaceSession` references in production packages/apps outside built artifacts.

Verification:

- `bun test packages/editor`: 60 passing tests, 7 skipped existing hook tests.
- `bun test packages/document-ui`: 336 passing tests.
- `bun run typecheck`.
- `bun run --cwd apps/hook build`.
- `git diff --check`.
- `test ! -e packages/editor/LegacyPlannotatorApp.tsx`.
- `rg -n "LegacyPlannotatorApp|status: 'legacy'|VITE_DOCUMENT_SURFACE|USE_DOCUMENT_SURFACE|documentSurfaceSession" packages apps --glob '!**/dist/**' --glob '!**/node_modules/**'` returned no matches.

Remaining cutover work: fuller Plannotator host actions for settings, share/export/import, and quick note saves still need to be mounted around the package surface. The duplicate legacy document-review implementation is no longer present.

## Implemented Slice: Plannotator Host Actions Around Package Surface

Normal package-backed Plan Review and Annotate sessions now have Plannotator host actions mounted through the `DocumentReviewSurface` header slot. `PlannotatorDocumentSurfaceBridge` renders the existing host-owned `PlanHeaderMenu`, `Settings`, `ExportModal`, and `ImportModal` components around the package surface.

The bridge prepares export/share/note data from the current package feedback payload rather than from legacy app state. It renders annotation output through the shared feedback assembler, uses the active document text or current edit/save payload for exported markdown, generates hash share URLs and paste-service short URLs through the existing Plannotator sharing utilities, downloads annotations, prints, and posts quick note saves to `/api/save-notes` for Obsidian, Bear, and Octarine. Settings remain Plannotator host policy and are conditionally mounted only when opened so server-rendered tests do not load browser-only settings stores.

The package boundary remains intact: `@plannotator/document-ui` still receives only generic header slots, feedback payload callbacks, and provider-neutral annotation import actions. Plannotator share URLs, paste-service policy, note-app settings, and the settings UI stay in `packages/editor`/`@plannotator/ui`.

Import review now decodes Plannotator hash links and paste-service short links in the host bridge, converts share payload annotations through the existing sharing utilities, and merges them into the package surface through the provider-neutral annotation import slot action. The host still owns Plannotator URL formats; the package owns only the annotation merge.

Verification:

- `bun test packages/editor`: 60 passing tests, 7 skipped existing hook tests.
- `bun test packages/document-ui`: 339 passing tests.
- `bun run typecheck`.
- `bun run --cwd apps/hook build`.
- `git diff --check`.

Remaining cutover work at this point: package-owned generic Ask AI surface behavior still needs the package default panel and Plannotator HTTP adapter wiring.

## Implemented Slice: Generic Ask AI And Import Parity

`DocumentReviewSurface` now renders a provider-neutral Ask AI panel when the session exposes `canUseAskAI` and the host implements `hostApi.askAI`. The package owns document/plan context assembly, the panel shell, and streamed text rendering. The host still owns AI provider/model selection, auth, permission handling, and transport.

The Plannotator HTTP adapter now implements `hostApi.askAI` over the existing `/api/ai/session` and `/api/ai/query` endpoints. It creates/reuses an AI server session per document review context, forwards context updates when the package context changes, and maps the server SSE stream into package-level `DocumentAskAIEvent` messages.

Import review parity is also complete for normal package-backed sessions. `DocumentReviewSurface` exposes a provider-neutral `importAnnotations` slot action. `PlannotatorDocumentSurfaceBridge` keeps Plannotator share URL parsing host-owned, decodes hash and short links with the existing sharing utilities, and merges imported annotations/global attachments into the package annotation state without reaching into viewer DOM or highlighter internals.

Verification:

- `bun test packages/document-ui`: 339 passing tests.
- `bun test packages/editor`: 60 passing tests, 7 skipped existing hook tests.
- `bun run typecheck`.
- `bun run --cwd apps/hook build`.
- `git diff --check`.
- `test ! -e packages/editor/LegacyPlannotatorApp.tsx`.
- `rg -n "LegacyPlannotatorApp|status: 'legacy'|VITE_DOCUMENT_SURFACE|USE_DOCUMENT_SURFACE|documentSurfaceSession|Import review is not available" packages apps --glob '!**/dist/**' --glob '!**/node_modules/**'` returned no matches.

Cutover status: the normal app entry no longer keeps a legacy document-review shell or feature-flag path. Plan Review, Annotate file/folder/message, shared sessions, archive, goal setup, fallback/demo, terminal delivery, settings/share/export/import/note actions, version/diff, writeback, drafts, annotation state, feedback assembly, and generic Ask AI now route through the package-backed document surface plus small Plannotator host shells/slots.

## Self-Review Follow-Up

The ADR self-review found and fixed two issues after the initial green run.

First, `PlannotatorDocumentSurfaceBridge` could create a copied short share link from stale prepared export state when the current document required the paste-service short-link path. The bridge now generates short links from an explicit prepared export payload, so copy-share fallback uses the current package feedback payload.

Second, the Plannotator HTTP adapter showed the generic Ask AI panel for every writable session. The old shell checked `/api/ai/capabilities` and hid AI when no provider was registered. `createPlannotatorHttpDocumentApi().loadSession()` now checks that capabilities route and maps `canUseAskAI` from actual provider availability.

The self-review also cleaned tab-indented JSX in the touched surface file.

Verification after self-review:

- `bun test packages/document-ui`: 339 passing tests.
- `bun test packages/editor`: 60 passing tests, 7 skipped existing hook tests.
- `bun run typecheck`.
- `bun run --cwd apps/hook build`.
- `git diff --check`.
