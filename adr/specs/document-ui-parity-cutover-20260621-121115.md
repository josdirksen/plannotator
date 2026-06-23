# Spec: Document UI Parity Cutover

> ⚠️ **REVERTED — DO NOT IMPLEMENT.** Spec for the failed cutover (reverted 2026-06-22). The corrected plan is **`adr/decisions/004-reuse-document-ui-as-published-building-blocks-20260622-180637.md`**. Kept here as history only.

Date: 2026-06-21

Status: Draft

## Intent

Finish the `@plannotator/document-ui` extraction so the Plan Review / Annotate app uses the package as the real production document surface, with no parallel legacy document UI path left behind.

The target is not to move every Plannotator feature into the shared package. The target is to move the reusable document-review experience into the package, then leave Plannotator-specific environment behavior in a small host shell.

## Target State

`packages/editor/App.tsx` should stop being the document-review product. It should become a Plannotator host shell that:

- loads the session through the Plannotator adapter
- reads Plannotator settings and environment capabilities
- wires Plannotator-only routes and side effects
- provides host slots for settings, export/share, note integrations, archive, goal setup, and terminal
- renders `DocumentReviewSurface`

The normal production path should not require:

```text
VITE_DOCUMENT_SURFACE=1
```

`VITE_DOCUMENT_SURFACE` should be removed once parity is reached.

## Ownership Rule

The package owns the document review loop.

The host owns environment policy.

### Package owns

- markdown and raw HTML document review
- annotation creation, editing, deletion, selection, and persistence hooks
- global comments and image attachments
- linked document navigation
- document tree/file tree UI and badges
- message/document navigation when messages are represented as documents
- source/document editing UI
- writeback states: clean, dirty, saving, saved, conflict, missing, error
- draft restore UI and state
- feedback payload assembly
- plan/document version browsing and diff UI
- generic Ask AI panel and in-document ask affordances when a host AI API exists
- code/link preview UI when the host can load or validate targets
- generic shortcuts for document review actions
- default chrome needed for parity: toolstrip, sticky controls, sidebars, panels, empty states, banners, and action buttons

### Host owns

- server routes
- auth
- browser opening and process lifetime
- CLI/plugin/hook integration
- `ExitPlanMode` stdout decisions
- Plannotator settings persistence
- share/paste service policy
- import/export modal policy
- Obsidian, Bear, and Octarine integrations
- agent terminal runtime, PTY/WebSocket bridge, installer, and remote security policy
- goal setup business logic
- archive storage and list loading
- provider transport details for comments, versions, documents, and watches

## Required Work

### 1. Make `DocumentReviewSurface` the default app surface

Remove the feature-flagged bridge as a separate product path.

Current state:

- `packages/editor/App.tsx` computes `USE_DOCUMENT_SURFACE`.
- The package surface is only rendered when the flag is enabled.
- The old app shell remains the default render path.

Required changes:

- Replace the default editor render path with the package surface.
- Keep a thin Plannotator host shell, but do not keep both document-review implementations.
- Delete `shouldUseDocumentSurfaceBridge()` and the `VITE_DOCUMENT_SURFACE` runtime branch after parity is green.
- Move or delete old `App.tsx` document-domain state that duplicates package state.

Acceptance:

- Running the normal app with no env flag renders `DocumentReviewSurface`.
- `rg VITE_DOCUMENT_SURFACE packages apps` returns no production code hits.
- `packages/editor/App.tsx` no longer imports or directly orchestrates `Viewer`, `HtmlViewer`, `PlanDiffViewer`, `AnnotationPanel`, `usePlanDiff`, `useLinkedDoc`, or `useArchive` for the main document path.

### 2. Add provider-neutral versions and diff

Plan diff/version browser is the biggest package gap. It should move into `@plannotator/document-ui` as optional document version capability.

Add host API methods:

```ts
interface DocumentHostApi {
  listDocumentVersions?(request: ListDocumentVersionsRequest): Promise<DocumentVersionsResult>;
  loadDocumentVersion?(request: LoadDocumentVersionRequest): Promise<LoadedDocumentVersion>;
}
```

Draft types:

```ts
interface DocumentVersionRef {
  id: string;
  label: string;
  createdAt?: number;
  revision?: string;
  providerState?: unknown;
}

interface DocumentVersionsResult {
  versions: DocumentVersionRef[];
  currentVersionId?: string;
  previousVersionId?: string;
  providerState?: unknown;
}

interface LoadedDocumentVersion {
  version: DocumentVersionRef;
  document: LoadedDocument;
}
```

Package behavior:

- fetch and show versions when `session.capabilities.supportsVersions` is true
- select a base version
- compute markdown diffs in the package, using existing diff utilities
- render clean/raw diff modes
- support diff annotations
- block version/diff actions while document editing is dirty
- expose version state through render props for custom hosts

Plannotator adapter:

- map `/api/plan/versions`
- map `/api/plan/version`
- use existing `previousPlan` and `versionInfo` as initial version data when available

Workspaces adapter expectation:

- map workspace document versions API
- use workspace document ids and versions, not local history paths

Acceptance:

- Plan review with previous versions shows the same diff affordance as the old app.
- Version browser works from the package surface.
- Diff annotations are included in feedback with the current legacy wording.
- Workspaces can implement the version API without Plannotator route names.

### 3. Bring default chrome to visible parity

The current default `DocumentReviewSurface` chrome works, but it is simpler than the old shell. The package surface needs parity for the generic document review experience.

Move or recreate in package:

- annotation toolstrip
- sticky header lane behavior
- wide/focus document controls
- document max-width behavior
- raw HTML tool visibility toggle
- folder empty state
- linked document breadcrumb/back chrome
- message picker as document navigation, if message mode remains supported
- feedback panel count and delete/edit behavior
- right panel resize/collapse behavior
- left sidebar collapsed rail and tab behavior
- keyboard shortcuts for submit, print, diff exit, save, and panel/sidebar toggles
- code-file/link preview when the host can load the target
- checkbox override behavior if editable checkboxes remain part of rendered markdown review

Keep host-owned:

- user preference storage
- Plannotator-specific issue/help links
- product-specific header menu
- print side effect
- settings modal

Acceptance:

- Annotate markdown, annotate raw HTML, annotate folder, annotate last message, and plan review do not visibly regress from the old app for core review actions.
- Default package UI has no obvious missing document controls compared with the old app.
- Package surface remains usable without Plannotator-specific settings or note integrations.

### 4. Turn file/message browsing into provider-neutral document navigation

The package already has document tree state. It needs to become the real default file/message navigation path.

Required changes:

- Treat folders, files, and recent messages as `DocumentTreeNode` / `DocumentRef` data.
- Let Plannotator adapter map `/api/reference/files` and `/api/reference/files/stream` to `listDocuments` and optional watch behavior.
- Let Workspaces adapter map workspace manifest rows to the same tree.
- Preserve annotation counts and writeback status badges in the tree.
- Preserve highlighted/annotated file behavior where it is generic.
- Keep local filesystem containment and vault retry mechanics in the Plannotator adapter/host.

Acceptance:

- Annotate-folder can select markdown, text, and raw HTML files through the package surface.
- File annotation counts survive navigation.
- Writeback statuses show on tree rows.
- Message mode can navigate recent assistant messages without bespoke `App.tsx` state.

### 5. Finalize writeback and local source-save cutover

The provider-neutral writeback core is mostly done. The remaining work is to stop the old shell from applying separate source-save state.

Required changes:

- Route all active document edit/save/discard/reload-conflict behavior through package writeback state.
- Keep Plannotator source-save behavior inside `plannotator-*` adapter helpers.
- Ensure missing local files, disk conflicts, stale saved changes, and draft-restored edits behave the same as the old path.
- Remove duplicate editor/source-save state from `App.tsx` after package behavior is authoritative.

Acceptance:

- Saving source-backed markdown/text files works from the package surface.
- Dirty, saving, saved, conflict, missing, and error states match current semantics.
- Draft restore preserves dirty writeback buffers and saved-change context.
- No generic shared type requires disk hash, mtime, EOL, or filesystem path.

### 6. Move Ask AI surface behavior into the package

The package already has Ask AI context helpers and `hostApi.askAI`. It needs the UI path if parity requires the package surface to replace the old shell.

Required changes:

- Add a default AI panel when `session.capabilities.canUseAskAI` and `hostApi.askAI` are available.
- Use package-owned document context assembly.
- Support document-targeted ask from comments or selected document regions.
- Let the host provide provider/model settings and permission handling.
- Keep terminal fallback and agent-specific prompt policy host-owned.

Possible host API extension:

```ts
interface DocumentHostApi {
  askAI?(request: DocumentAskAIRequest): Promise<DocumentAskAIResponse> | AsyncIterable<DocumentAskAIEvent>;
  listAIProviders?(): Promise<DocumentAIProviderResult>;
  respondToAIPermission?(response: DocumentAIPermissionResponse): Promise<void>;
}
```

Acceptance:

- The old Ask AI panel can be replaced for document review sessions.
- Hosts without AI do not see AI UI.
- Provider/model/auth policy does not leak into core document types.

### 7. Keep agent terminal as a host slot, but finish integration points

Do not move the terminal runtime into `@plannotator/document-ui`.

Required changes:

- Keep `terminalPanel` or a refined terminal slot in `DocumentReviewSlots`.
- Let package chrome show/hide terminal entry points when the host provides a terminal slot/capability.
- Keep generic agent-delivery state in the package.
- Keep PTY, WebSocket, runtime install, remote-mode security, and shell prompt construction in Plannotator host code.

Acceptance:

- Annotate-mode terminal can be mounted beside the package document surface.
- Package can show delivered-to-agent status without knowing terminal transport details.
- Workspaces is not forced to implement a terminal.

### 8. Handle archive without making it core document review

Archive is Plannotator-specific storage, but it still needs a path after `App.tsx` is shrunk.

Required changes:

- Do not make archive mandatory in `DocumentHostApi`.
- Expose enough slot support for a host archive tab or collection browser.
- Plannotator host owns archive plan loading, selection, copy, and done behavior.
- Archive selection can load a read-only `LoadedDocument` into the package surface or render through a host-provided archive mode.

Acceptance:

- Plannotator archive mode still works after old `App.tsx` document shell is gone.
- Archive does not appear in Workspaces unless Workspaces opts into a comparable collection provider.

### 9. Keep goal setup host-owned

Goal setup is not document review. It should not become core package behavior.

Required changes:

- Render goal setup from the Plannotator host shell, not the legacy document shell.
- Keep `GoalSetupSurface` in its current package unless a later decision moves it.
- Ensure goal setup submit/exit still uses shared action-controller helpers only where useful.

Acceptance:

- Goal setup works without the old document-review render path.
- `@plannotator/document-ui` does not need goal setup-specific public types.

### 10. Keep settings, share, export, and note integrations host-owned

These are Plannotator product policies, not shared document review behavior.

Required changes:

- Package exposes current feedback payload/rendered feedback through callbacks or render state.
- Host uses that payload for export/share/import and note integrations.
- Host injects header/menu actions through slots.
- Package does not call paste service, Obsidian, Bear, or Octarine routes.

Acceptance:

- Export/share/import still work in Plannotator.
- Note-app saves still work in Plannotator.
- Workspaces can ignore these features or provide its own host actions.

### 11. Finalize annotation provider integration

Current package annotation persistence is a good base. Full parity needs live provider annotations to stop being old-app-specific.

Required changes:

- Keep `loadAnnotations` and `saveAnnotations`.
- Add optional watch/subscribe support if live updates are required:

```ts
interface DocumentHostApi {
  watchAnnotations?(request: WatchDocumentAnnotationsRequest): DocumentAnnotationSubscription;
}
```

- Package owns merging local draft annotations with provider-owned annotations.
- Host/provider owns external transport, SSE route names, VS Code editor annotation routes, and permission policy.

Acceptance:

- External/provider annotations can appear in the package surface.
- Editing or deleting provider annotations routes through the provider where appropriate.
- Hosts without live annotations still work through load/save/draft behavior.

### 12. Cut down `packages/editor/App.tsx`

After parity lands, remove old document-product orchestration.

Keep in editor host shell:

- load session
- build Plannotator host API
- read settings
- wire Plannotator host slots
- render completion overlay
- render modals owned by Plannotator
- handle plan-mode and annotate route policy

Remove from editor host shell:

- document annotation reducer
- linked-doc state machine
- plan diff state machine
- archive document rendering path
- file/message document navigation state
- markdown/html viewer rendering
- document edit/writeback UI state
- direct document feedback assembly
- duplicate draft restore logic

Acceptance:

- The old document body path is gone.
- The file is understandable as a host shell, not a product state machine.
- Any remaining Plannotator-specific code has a clear reason to stay host-owned.

## Dependency Order

1. Add missing package contracts: versions/diff, optional annotation watch, refined slots.
2. Move version/diff state and rendering into the package.
3. Bring package chrome to visible parity for toolstrip, sidebars, panels, file/message navigation, and code previews.
4. Wire Plannotator adapter to the new contracts.
5. Move Ask AI surface behavior into the package, keeping provider config host-owned.
6. Mount terminal/archive/settings/export/note integrations through host slots.
7. Flip default app path to `DocumentReviewSurface`.
8. Delete old duplicate editor document state.
9. Run parity verification and fix regressions.

## Verification

Minimum automated checks:

```text
bun test packages/document-ui
bun run typecheck
bun build packages/document-ui/DocumentReviewSurface.tsx --target browser --outdir /tmp/plannotator-document-ui-build
bun run --cwd apps/hook build
bun run --cwd apps/review build
git diff --check
```

Browser smoke checks:

- plan review approve
- plan review deny with annotations
- plan diff/version browser
- annotate markdown file
- annotate raw HTML file
- annotate folder and switch files
- annotate last message and switch messages
- linked markdown document navigation
- code-file/link preview
- image upload and image display
- source-save success
- source-save conflict
- source file missing and save/recreate behavior
- draft restore after reload
- Ask AI open/ask/permission if enabled
- agent terminal slot open/close/delivered status
- archive browse/done
- export/share/note actions

## Non-Goals

- Do not redesign Plannotator's visual language.
- Do not move server route implementations into the package.
- Do not rename current Plannotator routes as part of this cutover.
- Do not make Workspaces adapter code live in this repo.
- Do not make local source-save terms part of the provider-neutral core.
- Do not move terminal runtime or note-app policy into the package.
- Do not keep both old and new document UI paths after cutover.

## Open Decisions

1. Should archive be represented as a host-provided document collection API, or only as a Plannotator host slot?

   Recommendation: host slot for this cutover. Add a collection API later only if Workspaces has a matching need.

2. Should Ask AI provider/model settings be shown inside the shared package panel or injected by host slot?

   Recommendation: package owns the panel shell and messages; host injects provider settings/actions.

3. Should goal setup remain in `@plannotator/ui` or move to another host package?

   Recommendation: leave it where it is for this cutover. The important thing is that it no longer depends on the old document shell.

4. Should package version/diff compare be host-computed or package-computed?

   Recommendation: host loads versions; package computes markdown diff by default. Add optional host-computed diff only if Workspaces needs semantic/version-specific compare results.

## Completion Criteria

This work is complete when:

- The normal Plan Review / Annotate app renders through `@plannotator/document-ui`.
- There is no `VITE_DOCUMENT_SURFACE` cutover flag.
- The old document-review render path is removed.
- Plan review, annotate file, annotate folder, annotate last, raw HTML, linked docs, source-save, drafts, plan diff, Ask AI, terminal slot, archive, export/share, and note integrations all still work.
- Workspaces can implement the same UI by supplying a `DocumentHostApi` without inheriting Plannotator local source-save vocabulary.
