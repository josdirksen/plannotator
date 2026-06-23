# Spec: Document UI Feature Completeness Review Fixes

> ⚠️ **FAILED ATTEMPT — USE AS A CHECKLIST ONLY, NOT A BUILD PLAN.** This catalogs the parity gaps in the reverted `@plannotator/document-ui` cutover (reverted 2026-06-22). It is a useful *inventory of behaviors the UI must preserve*, but do NOT implement it as written — it patches a reimplementation that was thrown away. Corrected plan: **`adr/decisions/004-reuse-document-ui-as-published-building-blocks-20260622-180637.md`**.

Date: 2026-06-22

Status: In Progress

## Intent

Close the verified post-review parity gaps in the `@plannotator/document-ui` cutover so the package surface is feature-complete for Plannotator's Plan Review and Annotate app.

The branch already performs a real architecture cutover: `packages/editor/App.tsx` mounts the new host, and `@plannotator/document-ui` owns much of the document-review state. The remaining work is not to restart the extraction. The remaining work is to wire the production surface to the behavior that was extracted, or to port the few still-missing UI entry points.

Feature-complete means the normal Plan Review and Annotate production path can ship without the old App shell and without knowingly dropping user-facing behavior from the pre-cutover app.

## Current Read

The review findings are mostly valid. The package has many of the right helpers and tests, but the mounted production path does not yet call or expose several of them.

Confirmed high-impact gaps:

- Header actions are hidden in Plan Review because the whole `slots` object is gated on agent terminal availability.
- Submit, approve, and close call host APIs directly instead of routing through the extracted safety decisions.
- Annotate-last message data is created by the adapter but not rendered or sent back as an active message scope.
- External annotations and VS Code editor annotations still have server endpoints and shared hooks, but the document surface does not subscribe to them.
- Plan diff uses a new read-only renderer instead of the existing interactive diff viewer with block annotations and VS Code diff support.

Confirmed secondary gaps:

- Saved source-change validation exists but is not called before submit/approve.
- Shortcut registries exist but are not registered in the new surface.
- Code-file popout and code-file annotation entry points are not wired from `Viewer`.
- Raw HTML share does not call `/api/share-html` to build portable HTML with inlined relative assets.
- Wide/focus mode helpers exist but are unreachable.
- The new sidebar is versions plus file tree, without old TOC/archive/vault/reference parity.
- Settings are partially stubbed after the menu is restored.
- Print, checkbox task toggles, product announcements, and dead old header cleanup remain smaller follow-ups.

## Definition Of Done

The document UI cutover is feature-complete when:

- Plan Review has Settings, Export, Share, Import, print, note integrations, and any host header actions visible without requiring agent terminal support.
- Approve, Send Feedback, Close, gate-mode approve, and submit shortcuts all run the same safety checks as the old app.
- Unsaved writeback edits, feedback-loss cases, stale saved source changes, missing files, and no-op saved changes are handled before delivery.
- Annotate file, annotate folder, annotate raw HTML, and annotate-last all preserve their feedback target and navigation behavior.
- External annotations and editor annotations appear in the UI and are included in exported/submitted feedback.
- Plan diff/version review supports interactive diff annotations and the VS Code diff affordance.
- The expected keyboard shortcuts work from the production surface.
- Code-file links can open the code-file popout and create code-file annotations where supported.
- Portable sharing of raw HTML sessions preserves relative assets.
- Existing package and editor tests pass, and targeted regression tests cover the formerly missing wiring.

## P0 Required Fixes

### 1. Always Mount Header Actions

Problem:

`PlannotatorDocumentSurfaceBridge` returns `undefined` slots when `terminalAvailable` or `agentTerminal` is false. This hides `PlanHeaderMenu`, Settings, Export, Import, Share, print, and note actions in normal Plan Review. Agent terminal is only available for annotate file/folder sessions, so the primary Plan Review flow loses its menu.

Required behavior:

- `headerActions` must always be provided for supported Plannotator sessions.
- Only `terminalPanel` and terminal-specific header buttons should be gated by terminal availability.
- Plan Review and Annotate should both receive the common Plannotator host actions.

Implementation shape:

- Split `hostHeaderActions` from terminal slots in `PlannotatorDocumentSurfaceBridge`.
- Return a slots object unconditionally, with `terminalPanel` set to `null` when unavailable.
- Keep terminal delivery logic unchanged.

Acceptance:

- Plan Review shows the options menu with Settings, Export, Share, Import, and print.
- Annotate sessions still show terminal controls only when terminal capability is available.
- Add a render test that plan-review mode includes `data-document-review-header-actions` and the menu trigger when terminal is unavailable.

### 2. Wire Action Safety Decisions

Problem:

The package contains decision helpers for feedback loss, unsaved writeback edits, gate-mode primary action, print shortcut behavior, and submit shortcut behavior. The production buttons call `state.submitFeedback()`, `state.approve()`, and `state.exit()` directly.

Required behavior:

- Before Send Feedback, Approve, or Close, the surface must evaluate extracted chrome/action decisions.
- Unsaved writeback edits must warn before close, approve, or send feedback.
- Approve must warn when feedback would be lost.
- Close must warn when feedback would be lost.
- Gate-mode annotate should approve when there is no feedback and send feedback when feedback exists.
- Submit shortcut behavior must use the same action decision as the primary button.

Implementation shape:

- Add a small action coordinator inside `DocumentReviewSurface` or as a package hook.
- Render a package-owned confirmation dialog using copy from `documentReviewChrome.ts`.
- Keep host APIs simple: hosts should receive the final approved submit/approve/exit call, not own these generic decisions.
- Use existing `buildUnsavedDocumentEditContinuationDecision`, `decideDocumentReviewFeedbackAction`, `decideDocumentReviewApproveAction`, `decideDocumentReviewExitAction`, `decideDocumentReviewPrimarySubmitAction`, and `buildUnsavedDocumentEditWarningCopy`.

Acceptance:

- Tests prove dirty writeback documents block direct submit/approve/close until confirmed.
- Tests prove approve warns when feedback would be lost.
- Tests prove close warns when feedback would be lost.
- Tests prove gate-mode empty annotate primary action calls approve.
- Manual Plan Review: add annotation, click Approve, see feedback-loss warning where old app warned.

### 3. Reconnect Annotate-Last Message Workflow

Problem:

`createPlannotatorEditorLoadPlan()` builds `messages.recentMessages` and `messages.selectedMessageId`, and the Plannotator delivery layer can submit `selectedMessageId` and `feedbackScope`. The new production host does not pass or render `loadPlan.messages`, and `createFeedbackPayload()` only includes `messageScope` when it is manually injected.

Required behavior:

- Annotate-last must show the recent message set or an equivalent message navigation UI.
- The selected message must be visible and changeable.
- Annotations must stay associated with their selected message.
- Feedback must include `selectedMessageId`.
- If multiple messages are annotated, feedback must include `feedbackScope: "messages"` or the provider-neutral equivalent expected by the adapter.

Implementation shape:

- Prefer modeling messages as provider-neutral documents, if that can be done without distorting the contract.
- Otherwise add a narrow message session controller owned by `DocumentReviewSurface` or the Plannotator bridge.
- Cache annotations per message using existing linked-document/message state helpers where possible.
- Pass the resolved `messageScope` into `createFeedbackPayload()`.

Acceptance:

- Annotate-last opens with the selected recent message.
- Switching messages restores that message's annotations.
- Annotating one message sends that message id.
- Annotating multiple messages sends multi-message scope.
- Existing message feedback formatting remains unchanged.

### 4. Reconnect External And Editor Annotations

Problem:

`useExternalAnnotations` and `useEditorAnnotations` still exist in `@plannotator/ui`, and server endpoints still exist. The document surface does not subscribe to them, does not show them in the panel, and does not include editor annotations in feedback.

Required behavior:

- External annotations posted to `/api/external-annotations` appear in Plan Review and Annotate where applicable.
- VS Code editor annotations appear when running inside VS Code.
- External annotation updates and deletes are reflected in the UI.
- Editor annotations can be deleted from the UI.
- Feedback/export includes editor annotations and external annotations in the same wording as before.

Implementation shape:

- Add optional host/provider annotation channels to `DocumentHostApi`, or provide Plannotator host hooks through surface slots if route names must remain host-owned.
- Keep route names and SSE transport Plannotator-owned.
- Merge external annotations into surface annotation state without duplicating persisted local annotations.
- Pass editor annotations into feedback text assembly.
- Reuse existing `AnnotationPanel`/`EditorAnnotationCard` behavior where possible.

Candidate host API:

```ts
interface DocumentHostApi {
  watchExternalAnnotations?<T extends { id: string }>(
    request: WatchExternalAnnotationsRequest,
  ): ExternalAnnotationSubscription<T>;
  deleteExternalAnnotation?(request: DeleteExternalAnnotationRequest): Promise<void>;
  updateExternalAnnotation?(request: UpdateExternalAnnotationRequest): Promise<void>;
  loadEditorAnnotations?(request: LoadEditorAnnotationsRequest): Promise<EditorAnnotationResult>;
  deleteEditorAnnotation?(request: DeleteEditorAnnotationRequest): Promise<void>;
}
```

Acceptance:

- Posting a plan-review annotation through `/api/external-annotations` shows it without reload.
- Deleting an external annotation removes it.
- VS Code editor annotations appear inside the document review feedback panel.
- Submitted feedback includes editor annotations.

### 5. Restore Interactive Plan Diff Parity

Problem:

The new `DocumentVersionDiffViewer` renders read-only diff blocks. The old `PlanDiffViewer` supports clean/raw modes, block-level diff annotation, selected diff annotations, and `/api/plan/vscode-diff`.

Required behavior:

- Version diff supports diff annotations with `diffContext`.
- Diff annotations appear in the feedback panel and exported/submitted feedback.
- The VS Code diff button works for Plannotator plan versions.
- Provider-neutral hosts can choose whether an external diff action is available.

Implementation shape:

- Prefer reusing `@plannotator/ui/components/plan-diff/PlanDiffViewer` in the package renderer module.
- If direct reuse is too coupled, port the interaction model into `DocumentVersionDiffViewer`.
- Replace direct `fetch("/api/plan/vscode-diff")` with an optional host API action.

Candidate host API:

```ts
interface DocumentHostApi {
  openDocumentVersionDiff?(request: OpenDocumentVersionDiffRequest): Promise<OpenDocumentVersionDiffResult>;
}
```

Acceptance:

- Plan Review with prior versions shows interactive diff blocks.
- Hovering/clicking changed diff blocks can create comments/deletions/quick labels.
- Diff annotations include `[In diff content]` in submitted feedback.
- VS Code diff opens through the Plannotator host when a base version exists.
- Workspaces can omit the external diff action without breaking diff review.

### 6. Validate Saved Source Changes Before Delivery

Problem:

Saved source-change validation exists, but submit/approve does not call it. Old behavior protected against stale disk state, missing files, and no-op saved edits before feedback delivery.

Required behavior:

- Before submit or approve, saved changes must be validated when the provider supports probing.
- Stale, missing, and no-op saved changes must be dropped or warned according to existing decisions.
- Unverified changes must be preserved when validation cannot prove they are stale.

Implementation shape:

- Keep generic validation in `@plannotator/document-ui`.
- Keep local source-save probe logic in the Plannotator host/adapter.
- Route Plannotator `validateSavedFileChanges()` into the surface action coordinator before delivery.

Acceptance:

- Tests cover valid, stale, missing, no-op, and unavailable saved-change probes.
- Submit payload only includes valid/unverified saved changes.
- UI reports dropped saved changes clearly enough for the user to understand what happened.

## P1 Feature Completeness Fixes

### 7. Register Keyboard Shortcuts

Required behavior:

- `Mod+Enter` submits the primary action.
- `Mod+P` opens print while preserving print-mode CSS behavior.
- `Escape` exits plan diff when diff is active.
- Input-method double-tap shortcuts work where supported.
- Shortcuts respect dialogs, text input focus, editing state, and submitted/exiting states.

Implementation shape:

- Register the existing `planReviewSurface` and `annotateSurface` shortcut scopes in the new surface/host.
- Use extracted `decideDocumentReviewSubmitShortcut` and `decideDocumentReviewPrintShortcut`.
- Wire `usePrintMode()` in the mounted app.

Acceptance:

- Shortcut tests cover disabled states and text input focus.
- Manual smoke confirms `Mod+Enter` and `Mod+P`.

### 8. Restore Code-File Popout And Code Annotations

Required behavior:

- Markdown/PFM code-file links can open the code-file popout.
- Code-file annotations can be created and submitted.
- Code path validation continues to run through the host.

Implementation shape:

- Pass `onOpenCodeFile` into `Viewer`.
- Mount `CodeFilePopout` from `@plannotator/ui`.
- Use existing `useCodeFilePopout()` and host API code-file loading.
- Keep local filesystem route details in Plannotator host/adapter.

Acceptance:

- Clicking a code-file link opens the popout.
- Creating a code annotation adds it to the panel.
- Submitted feedback includes code-file annotations.

### 9. Restore Portable Raw HTML Sharing

Required behavior:

- Raw HTML annotation sessions shared through Export/Share use portable HTML with relative assets inlined.
- The display HTML used by the review iframe should not be assumed to be the share HTML.

Implementation shape:

- Add `prepareShareHtml?` to the host API, or keep it as a Plannotator header action helper.
- Plannotator implementation calls `/api/share-html`.
- Cache prepared share HTML per active HTML document where sensible.

Acceptance:

- Sharing an HTML file with relative images/styles produces a share that renders correctly outside the local server.
- Markdown sharing remains unchanged.

### 10. Restore Wide/Focus And Chrome Polish Needed For Parity

Required behavior:

- Wide/focus mode is reachable when `allowWideMode` is enabled and unavailable in archive/diff states.
- Left and right panels behave consistently with wide/focus transitions.
- Sticky controls, panel collapse, resize behavior, and visible document max-width are close enough to old Plan Review/Annotate behavior for normal use.

Implementation shape:

- Wire `documentWideMode.ts`, `documentReviewLeftSidebar.ts`, and `documentReviewRightPanel.ts` into `DocumentReviewSurface`.
- Keep user preference persistence host-owned or option-driven.
- Avoid making Plannotator-only settings required by core document UI.

Acceptance:

- Wide/focus controls exist when enabled.
- Entering wide/focus hides panels and can restore previous layout.
- Diff/archive states do not leave the layout stuck.

### 11. Sidebar And Reference Parity

Required behavior:

- The left sidebar should cover the core old navigation workflows: TOC, versions, file tree, and in-session archive/reference access if those remain expected in Plan Review.
- Folder annotate should show the file tree with badges and writeback status.
- `openSidebarTab` from the load plan must be honored.

Implementation shape:

- Keep generic sidebar mechanics in the package.
- Keep Obsidian vault discovery and archive storage Plannotator-host owned.
- Use slots for Plannotator-only archive/vault/reference tabs if they are not generic.

Acceptance:

- Folder annotate opens the files tab by default.
- Archive mode or archive tab behavior matches the decided scope.
- TOC is available for long markdown documents if parity requires it.

### 12. Finish Settings/Header Integration

Required behavior:

- Settings opened from the restored header should have real AI provider data.
- App version should come from package/app metadata, not `0.0.1`.
- Agent instruction copy should be enabled if that feature remains supported.
- Tater/grid/user display settings should either work or be explicitly declared out of scope.

Implementation shape:

- Plannotator host owns these values and passes them to the header slot.
- The package only exposes slot props and surface state needed by host actions.

Acceptance:

- Settings AI tab shows available providers.
- Header About/version is correct.
- Agent instructions copy works or is intentionally removed with tests/docs updated.

## P2 Cleanup And Explicit Non-Goals

These items should not block the feature-complete cutover unless the user/product bar says otherwise:

- Product announcement dialogs for Plan AI and Look & Feel. These are product-owned notices, not core document review behavior.
- Moving Plannotator adapter subpath exports out of `@plannotator/document-ui`. This is boundary cleanup, not a Plannotator parity blocker.
- Deleting dead `AppHeader.tsx` and other old shell remnants once no imports remain.
- Re-adding `VITE_DIFF_DEMO` fallback behavior. This is dev/demo-only.
- Full old visual chrome parity for every ornamental detail. Preserve workflow capability first, then polish.

## Callback Scope Decision

Shared/hash session callback support exists in `PlannotatorSharedSessionHost`. Normal API-mode callback query support was not found in the new production host path.

Decision needed:

- If `?cb=&ct=` was only a shared-session workflow, no P0 work is needed.
- If API-mode sessions still need callback approval/feedback, add callback config parsing to `PlannotatorDocumentSurfaceHost` and route submit/approve through the same callback utility.

Acceptance if in scope:

- API-mode callback URLs preserve feedback and approval behavior.
- Shared-session callback behavior remains unchanged.

## Package Boundary Requirements

The package should own generic document review behavior:

- annotation lifecycle
- feedback assembly
- writeback state and writeback warnings
- draft restore
- document tree/navigation
- version diff and diff annotations
- shortcuts and generic chrome decisions
- generic code-file preview hooks if a host can load targets

The host should own environment behavior:

- Plannotator route names
- note apps
- share/paste policy
- app version and settings data
- agent terminal runtime
- local source-save probing
- VS Code diff route
- external annotation transport route names
- archive/vault storage mechanics

The Workspaces integration should be able to implement `DocumentHostApi` without importing Plannotator local source-save concepts. Any new host API should use provider-neutral names such as writeback, versions, annotations, external diff, and prepared share HTML.

## Test Plan

Unit and integration tests:

- `bun test packages/document-ui`
- `bun test packages/editor`
- `bun run typecheck`
- `bun run --cwd apps/hook build`
- `git diff --check`

New or updated tests should cover:

- Header actions visible without terminal.
- Submit/approve/close safety warnings.
- Gate-mode primary action decision.
- Annotate-last selected and multi-message feedback scope.
- External annotation subscription/update/delete merge behavior.
- Editor annotation feedback inclusion.
- Diff annotation creation and feedback inclusion.
- Optional external version diff host action.
- Saved-change validation before delivery.
- Shortcut registration and blocking states.
- Code-file popout open path and code annotation feedback.
- Raw HTML share HTML preparation.

Manual smoke tests:

- Plan Review from `ExitPlanMode`: menu, approve, deny/send feedback, diff, settings, export/share/import.
- Annotate markdown file: annotations, source save, saved-change validation, close warnings.
- Annotate folder: file tree, badges, open files, writeback statuses.
- Annotate raw HTML with relative assets: render, annotate, share.
- Annotate-last: select messages and submit one-message and multi-message feedback.
- VS Code mode if available: editor annotations and VS Code diff.
- External annotation API: post, update, delete while UI is open.

## Implementation Order

1. Fix header slots so Plan Review has the menu again.
2. Wire the action coordinator and confirmation dialogs.
3. Add saved-change validation into the same action path.
4. Reconnect annotate-last message state and `messageScope`.
5. Reconnect external/editor annotations.
6. Restore interactive plan diff and VS Code diff host action.
7. Register shortcuts and print mode.
8. Restore code-file popout/code annotations.
9. Restore portable raw HTML sharing.
10. Wire wide/focus/sidebar parity and settings polish.
11. Remove dead old shell leftovers after the feature-complete path is verified.

## Scope Decisions

- Recent messages stay as provider-neutral message review state for this PR, not as regular `DocumentRef` entries. The surface owns message navigation/cache behavior and the Plannotator adapter maps it into annotate-last delivery.
- Standalone archive host is enough for this PR. In-session archive/vault/reference sidebar tabs remain P1/product-scope work.
- API-mode callback support is not required for this cutover. The old header only rendered callback actions for non-API shared sessions, and shared/hash callback support remains preserved.
- Restore workflow parity, not pixel-perfect old chrome.
- External/editor annotations are generic optional `DocumentHostApi` watch/delete capabilities, with Plannotator route names kept inside the Plannotator HTTP adapter.

## Implementation Status: 2026-06-22

Completed in the current worktree:

- Header actions are mounted in Plan Review without requiring annotate terminal support.
- Send Feedback, Approve, Close, and primary submit paths now route through package-owned action safety checks and confirmation dialogs.
- Saved source-file changes are validated before submit/approve, with stale, missing, and no-op changes filtered before delivery.
- Annotate-last message state is surfaced through a message navigator, cached per message, and submitted with `messageScope` and `messageAnnotations`.
- External annotations and VS Code editor annotations are exposed through a provider-neutral annotation watch/delete host API, rendered in the surface, and included in feedback assembly.
- Plan version diffs use the interactive plan diff viewer again, restoring block annotations and the Plannotator VS Code diff affordance.
- Basic production shortcuts and print behavior are restored for `Mod+Enter`, `Mod+P`, and diff `Escape`.
- Input-method switching is package-owned again: the surface owns mutable `drag`/`pinpoint` state and registers the existing Alt hold / Alt Alt input-method hook.
- Code-file links can open the code-file popout and create code-file annotations through the package surface.
- Raw HTML export/share preparation calls the Plannotator `/api/share-html` route before falling back to display HTML.
- Wide/focus controls are exposed by the package surface when `allowWideMode` is enabled, Plannotator enables them in the production bridge, and active wide/focus mode hides side panels until exit.
- Header settings now receive real AI provider capability data, the app version value, and enabled agent-instruction copy behavior.
- The unused old-shell `packages/editor/components/AppHeader.tsx` file and stale read-only diff renderer helpers were removed.
- Callback compatibility was audited: the old header only rendered bot callback actions for non-API shared sessions, and shared/hash callback sessions remain handled by `PlannotatorSharedSessionHost`.

Verified:

- `bun test packages/document-ui` -> 357 pass, 0 fail.
- `bun test packages/editor` -> 64 pass, 7 skip, 0 fail.
- `bun run typecheck` -> pass.
- `bun run --cwd apps/hook build` -> pass.
- `git diff --check` -> pass.
- Vite dev server smoke: `bun run --cwd apps/hook dev --host 127.0.0.1` served `http://127.0.0.1:3000/`, `/api/plan`, and `/api/plan/versions` successfully.
- Playwright Chromium smoke against the Vite-rendered production app path passed for:
  - Plan Review header menu, Settings menu item, interactive diff view, wide-mode toggle, external annotation display, editor annotation display, print shortcut, and approve delivery.
  - Plan Review share-link copy, global-comment creation, and deny/send-feedback delivery through `/api/deny`.
  - Annotate markdown source-save edit/save via `/api/source/save`.
  - Annotate folder document-tree expansion and `/api/doc` navigation.
  - Annotate raw HTML share/export preparation via `/api/share-html`.
  - Annotate-last multi-message navigator rendering.
- Playwright Chromium SSE smoke passed for browser consumption of `/api/external-annotations/stream` snapshot events.

Additional focused checks after wide/focus, input-method, raw HTML share, code-file URL, and cleanup wiring:

- `bun test packages/document-ui/DocumentReviewSurface.test.tsx packages/document-ui/DocumentReviewSurface.interaction.test.tsx packages/editor/PlannotatorDocumentSurfaceBridge.test.tsx` -> 36 pass, 0 fail.
- Interaction coverage now dispatches `Mod+Enter`, `Mod+P`, `Alt`, and wide-mode clicks against a mounted DOM surface.
- Bridge coverage now verifies `/api/share-html` is called for raw HTML export/share and falls back safely when portable HTML is unavailable.
- Code-file coverage now verifies the popout `/api/doc` URL boundary uses the target path and active document base.
- `bun run typecheck` -> pass.

Still open or requiring manual confirmation:

- Old sidebar/reference parity is intentionally not a P0 blocker for this PR under the current scope decision: standalone archive host is enough, while in-session archive/vault/reference tabs remain P1/product-scope work.
- Host-only integrations still need manual confirmation in their native environments: the VS Code extension/editor-annotation producer and real external-annotation producers. The browser-rendered consumer paths are covered by the Playwright smoke above.
