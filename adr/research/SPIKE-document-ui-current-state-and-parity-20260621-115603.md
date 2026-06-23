# Spike: Document UI Current State and Parity

> ℹ️ **Context still useful; the direction it informed was reverted.** This honestly reported the failed cutover was only ~55–65% at parity. The cutover was reverted on 2026-06-22. Read **`adr/decisions/004-reuse-document-ui-as-published-building-blocks-20260622-180637.md`** before acting.

Date: 2026-06-21

## Question

What exactly is the state of the `@plannotator/document-ui` extraction now, how close is it to parity with the current Plan Review / Annotate app, and what should be finalized inside the shared package versus left to Plannotator or other hosts?

## Scope

This spike reads the current branch code. It does not change product code.

Primary files inspected:

- `packages/document-ui/package.json`
- `packages/document-ui/index.ts`
- `packages/document-ui/types.ts`
- `packages/document-ui/DocumentReviewSurface.tsx`
- `packages/document-ui/plannotatorHttpApi.ts`
- `packages/document-ui/memoryDocumentHostApi.ts`
- `packages/document-ui/documentReviewChrome.ts`
- `packages/editor/App.tsx`
- `packages/editor/PlannotatorDocumentSurfaceBridge.tsx`
- `packages/editor/documentSurfaceBridge.ts`
- `adr/implementation/document-ui-extraction-intent-20260620-085249.md`

Verification run:

- `bun test packages/document-ui`
- Result: 329 passing tests across 31 files.

## Executive Read

The extraction is real and substantial. It is accurate to say that much of Plannotator's document-review domain behavior has been moved into a new `@plannotator/document-ui` package.

It is not accurate to say the app has been cut over to the package yet.

The current production app still defaults to `packages/editor/App.tsx`. The new surface is mounted only when `VITE_DOCUMENT_SURFACE` is `1` or `true`, through `PlannotatorDocumentSurfaceBridge`. The old editor shell is still the main render path.

My current read:

- Package capability: roughly 70-80 percent of the hard reusable document-domain logic is extracted.
- Current-app parity: roughly 55-65 percent, depending on whether plan diff, archive, goal setup, Ask AI panel, and terminal are considered part of the required reusable surface.
- Cutover/no-legacy readiness: roughly 40-50 percent. The shared package is green, but the app still depends on a large legacy shell for important visible workflows.

The branch is past "prototype contract" and into "candidate package," but it still needs a deliberate parity/cutover pass before deleting the old UI.

## What Exists Now

### Package Footprint

`packages/document-ui` is a real package with explicit exports, not a single component dump. It exports the surface, provider-neutral types, memory provider, Plannotator HTTP adapter, feedback assembly, edit/writeback helpers, annotation persistence, draft state, linked state, tree state, chrome decisions, panel/sidebar state, Ask AI context, delivery helpers, and Plannotator compatibility helpers.

The package is currently about 28.6k lines including tests. The main app shell is still about 4.8k lines:

- `packages/document-ui/DocumentReviewSurface.tsx`: 1,437 lines.
- `packages/document-ui/*.ts/*.tsx`: 28,643 total lines including tests.
- `packages/editor/App.tsx`: 4,773 lines.

### Provider-Neutral Contract

The core types are now provider-neutral:

- `DocumentRef` is provider/document identity, not local file identity (`packages/document-ui/types.ts:77`).
- `DocumentWritebackStatus` is `clean | dirty | saving | saved | conflict | missing | error` (`packages/document-ui/types.ts:90`).
- `LoadedDocument` carries content, render mode, image base, and optional writeback capability (`packages/document-ui/types.ts:129`).
- `DocumentReviewSession` carries mode, root document/ref, root tree ref, capabilities, and UI labels (`packages/document-ui/types.ts:177`).
- `SubmitDocumentFeedbackPayload` contains annotations, linked annotations, code annotations, attachments, direct edits, saved changes, and message scope (`packages/document-ui/types.ts:378`).
- `DocumentHostApi` abstracts load, linked-doc resolution, tree listing, document watching, save, drafts, annotation persistence, uploads, image URLs, feedback, approve, exit, Ask AI, and agent delivery (`packages/document-ui/types.ts:437`).

This is the right conceptual center. Workspaces can implement the same contract with workspace document ids, manifests, versions, `If-Match`, and its annotation APIs. Plannotator implements it with `/api/plan`, `/api/doc`, `/api/source/save`, `/api/draft`, `/api/upload`, and `/api/image`.

### Default Surface

`DocumentReviewSurface` is no longer just a render prop wrapper. It now owns substantial product behavior:

- Resolves the initial document from session/root/ref (`packages/document-ui/DocumentReviewSurface.tsx:144`).
- Seeds and tracks writeback state (`packages/document-ui/DocumentReviewSurface.tsx:171`).
- Owns root annotation state (`packages/document-ui/DocumentReviewSurface.tsx:195`).
- Owns linked-document state (`packages/document-ui/DocumentReviewSurface.tsx:216`).
- Owns optional annotation persistence (`packages/document-ui/DocumentReviewSurface.tsx:223`).
- Owns document tree state (`packages/document-ui/DocumentReviewSurface.tsx:242`).
- Owns edit/writeback controller state (`packages/document-ui/DocumentReviewSurface.tsx:250`).
- Owns provider watch reconciliation (`packages/document-ui/DocumentReviewSurface.tsx:259`).
- Owns draft save/restore state (`packages/document-ui/DocumentReviewSurface.tsx:269`).
- Builds feedback payloads with linked annotations, direct edits, and saved changes (`packages/document-ui/DocumentReviewSurface.tsx:384`).
- Calls host feedback, approve, and exit APIs (`packages/document-ui/DocumentReviewSurface.tsx:419`).
- Renders a default chrome with header, writeback badges, annotation-persistence badges, edit/save/discard/conflict buttons, submit/approve/close buttons, document navigator, feedback panel, draft banners, and error banners (`packages/document-ui/DocumentReviewSurface.tsx:551`, `packages/document-ui/DocumentReviewSurface.tsx:613`, `packages/document-ui/DocumentReviewSurface.tsx:693`).
- Renders markdown and raw HTML through the existing Plannotator renderer modules while routing image upload/image display and linked-doc opens through the provider API (`packages/document-ui/DocumentReviewSurface.tsx:1240`, `packages/document-ui/DocumentReviewSurface.tsx:1292`).

This means the package already owns a meaningful document review loop.

### Plannotator Adapter

The Plannotator adapter is also substantial:

- `createPlannotatorHttpDocumentApi()` maps current server routes into `DocumentHostApi`.
- `createPlannotatorHostSessionState()` normalizes `/api/plan` responses into document-session and host-session state (`packages/document-ui/plannotatorHttpApi.ts:408`).
- `createPlannotatorEditorLoadPlan()` derives the legacy editor load plan from normalized session state (`packages/document-ui/plannotatorHttpApi.ts:497`).
- Capabilities are mapped from local server data, including raw HTML, folder browsing, source-save writeback, share, Ask AI, agent terminal availability, and version support (`packages/document-ui/plannotatorHttpApi.ts:877`).

This is good layering: local source-save details remain in Plannotator adapter exports, not in the provider-neutral `DocumentHostApi`.

### Opt-In Bridge

The bridge exists and is thin:

- `packages/editor/documentSurfaceBridge.ts` decides the flag and renders feedback text through shared feedback assembly (`packages/editor/documentSurfaceBridge.ts:18`, `packages/editor/documentSurfaceBridge.ts:22`).
- `packages/editor/PlannotatorDocumentSurfaceBridge.tsx` creates the Plannotator HTTP API and mounts `<DocumentReviewSurface session={session} hostApi={hostApi} />` (`packages/editor/PlannotatorDocumentSurfaceBridge.tsx:44`, `packages/editor/PlannotatorDocumentSurfaceBridge.tsx:55`).
- `packages/editor/App.tsx` only uses the bridge behind `USE_DOCUMENT_SURFACE` (`packages/editor/App.tsx:130`, `packages/editor/App.tsx:3905`).

This is the clearest evidence that the package is not yet the default app path.

## What Still Lives In The Old App

The old editor shell still owns major parity features and side effects:

- Plan diff/version behavior: `usePlanDiff`, base-version selection, diff activation, and `PlanDiffViewer` render path remain in `App.tsx` (`packages/editor/App.tsx:817`, `packages/editor/App.tsx:4267`).
- Legacy linked-doc hook and Plannotator editable-source side effects remain in `App.tsx` (`packages/editor/App.tsx:888`, `packages/editor/App.tsx:938`).
- Archive browser state and archive selection remain in `App.tsx` (`packages/editor/App.tsx:968`, `packages/editor/App.tsx:4166`).
- External/editor annotation route integration remains in `App.tsx` (`packages/editor/App.tsx:1346`).
- Sticky header lane, annotation toolstrip, wide/focus inline controls, HTML tools toggle, checkbox overrides, code-file popout, message picker chrome, and Plannotator-specific viewer props remain in `App.tsx` (`packages/editor/App.tsx:4213`, `packages/editor/App.tsx:4235`, `packages/editor/App.tsx:4298`, `packages/editor/App.tsx:4411`).
- Goal setup is rendered from the old shell (`packages/editor/App.tsx:4255`).
- Agent terminal panel and resize shell remain in the old shell (`packages/editor/App.tsx:4078`).
- Ask AI panel and provider settings remain in the old shell (`packages/editor/App.tsx:4509`).
- Export/share/import modals and note integrations remain in the old shell (`packages/editor/App.tsx:4577`).
- The old `AppHeader` still controls Plannotator-specific top-level actions, settings, archive actions, callback actions, note-app actions, and AI/sidebar toggles (`packages/editor/App.tsx:3929`).

Some of these should remain host-owned. Others are parity gaps if the package is meant to become the default document-review capability.

## Parity Matrix

| Area | Current State | Parity Read |
| --- | --- | --- |
| Provider-neutral document/session contract | In package | Strong |
| Markdown render and annotate | In package through existing `@plannotator/ui` renderer | Mostly there |
| Raw HTML render and annotate | In package through `HtmlViewer`; bridge-script tests exist | Mostly there |
| Image attachments and image display | Provider-owned in package | Strong |
| Linked document navigation | Package has provider-neutral state; old app still owns Plannotator filesystem side effects | Partial |
| Document tree/file browser | Package has tree state/default navigator; old app still owns richer file-browser tab and watchers | Partial |
| Writeback state | Provider-neutral core and Plannotator adapter exist | Strong |
| Local source-save compatibility | In package under Plannotator-specific exports | Strong for Plannotator, acceptable as adapter-specific |
| Draft restore | Provider-neutral core exists; old app still owns some display and side effects | Mostly there |
| Annotation persistence | Provider-neutral load/save contract exists | Mostly there |
| Feedback text/payload assembly | Shared package owns most assembly | Strong |
| Submit/approve/exit lifecycle | Package has default lifecycle; host still owns route policy in legacy path | Mostly there |
| External/editor annotations | Feedback text supports them; route/SSE integration remains old-app owned | Partial |
| Ask AI | Context helpers and host API type exist; full panel/session UI remains old-app owned | Partial |
| Plan versions/diff | Capability flag exists, but no generic host API and default surface does not render version browser/diff | Gap |
| Archive browser | Adapter carries archive metadata; default package surface does not provide archive browser parity | Gap or host-owned, depending decision |
| Goal setup | Old-app owned | Host-owned or package slot, not core document review |
| Agent terminal | Old-app owned; package has a slot and delivery helpers | Correctly host-owned runtime, partial UI slot |
| Sticky toolstrips/wide/focus polish | Decisions extracted, but package default chrome is simpler | Partial |
| Settings/share/import/export/note apps | Old-app owned | Correctly host-owned |
| Plugin/server routes/auth/browser open | Host/server owned | Correctly outside package |

## What Should Be Finalized Inside The Package

The package should own the reusable document-review loop end to end:

1. `DocumentReviewSurface` as the default production surface for plan review, annotate file, annotate folder, annotate message, and workspace document review.
2. Provider-neutral document identity, loading, linked-doc navigation, tree navigation, annotation state, annotation persistence, draft restore, image upload/display, edit/writeback, conflict/missing/saving/saved chrome, feedback payload assembly, and submit/approve/exit actions.
3. A real default chrome that reaches parity with the current visible document experience: annotation toolstrip, sticky controls where applicable, feedback panel behavior, document navigation, file/tree badges, writeback badges, draft banners, and polished markdown/raw-HTML render behavior.
4. Optional document version/diff capability. This is the biggest missing reusable feature. The package already has `supportsVersions`, but it needs provider-neutral methods such as `listDocumentVersions`, `loadDocumentVersion`, and maybe `compareDocumentVersions`. Plannotator would adapt `/api/plan/versions` and `/api/plan/version`; Workspaces would adapt its versions API. The package should own the diff toggle/viewer because Workspaces explicitly needs the same review experience with a different provider.
5. Optional Ask AI surface behavior when `hostApi.askAI` exists. The package should own document target/context assembly and the in-document ask affordance. The host should still own provider/model config, auth, permission policy, and transport.
6. Optional annotation-provider watch/poll capability if Workspaces needs live comment updates. The current `loadAnnotations`/`saveAnnotations` contract is a good base, but route/SSE details should stay adapter-owned.
7. Plannotator local adapter as a first-class adapter, not as core vocabulary. Keep source-save, disk hash, mtime, missing local files, `/api/source/save`, and current draft compatibility in `plannotator-*` exports.
8. A memory/provider test harness that proves Workspaces-like behavior without local filesystem assumptions.
9. Contract tests for parity behavior. The package tests are green now, but cutover needs tests that assert the default surface can handle markdown, raw HTML, folder tree navigation, linked docs, writeback conflict/missing, drafts, version diff, and feedback assembly without the old `App.tsx` state machine.

## What Should Stay Out Of The Package

The package should not own host environment policy:

1. Server route implementation, auth, process lifetime, browser launching, remote/local port behavior, and plugin command/hook handling.
2. Plan-mode `ExitPlanMode` hook behavior and stdout decision shape.
3. Plannotator note integrations: Obsidian, Bear, Octarine.
4. Share/paste service policy, short URL generation, import/export modal policy, and hosted share URLs.
5. Agent terminal runtime, PTY/WebSocket bridge, terminal installation, and terminal provider policy. The package should keep slots/state helpers, not own the terminal runtime.
6. Workspaces server calls and auth. Workspaces should provide an adapter implementing `DocumentHostApi`.
7. Local filesystem source-save internals as generic concepts. Those belong in the Plannotator adapter namespace.
8. The code-review/diff app in `packages/review-editor`; that is a different product surface.
9. Product settings UI and Plannotator-specific header menu policy.
10. External annotation transport details. The package can define optional annotation persistence/watch contracts, but SSE route names and provider mutation routes belong in adapters.

## Cutover Work To Delete The Old UI

If the branch goal is "the app uses the package and old/legacy code goes away," the remaining work is not another broad extraction pass. It is a focused parity and cutover pass:

1. Make a crisp scope decision for plan diff, archive, goal setup, Ask AI, and terminal.
   - My recommendation: move version/diff into the package as optional document capability.
   - Keep archive as either a Plannotator host tab/slot or an optional adapter-provided document collection, not mandatory core.
   - Keep goal setup host-owned or slot-based unless Workspaces needs it.
   - Keep terminal runtime host-owned; use slots and delivery state.
   - Move Ask AI UI only up to the provider-neutral level; host owns provider config and permissions.
2. Bring `DocumentReviewSurface` default chrome to parity for annotate/file/folder/message and plan review.
3. Add the missing generic version/diff API and render path in the package.
4. Wire Plannotator production path to the bridge without `VITE_DOCUMENT_SURFACE`.
5. Delete or collapse duplicate `App.tsx` document-domain state once the package owns it.
6. Leave `App.tsx` as a Plannotator host shell: load session, read settings, configure adapters/slots, handle route/policy side effects, render package surface.
7. Add a cutover test matrix:
   - `bun test packages/document-ui`
   - `bun run typecheck`
   - `VITE_DOCUMENT_SURFACE=1 bun run --cwd apps/hook build`
   - `bun run --cwd apps/hook build`
   - targeted browser smoke for annotate markdown, annotate raw HTML, annotate folder, plan review, linked docs, source-save conflict/missing, and plan diff.

## Bottom Line

We have extracted much of the Plannotator document UI and domain behavior into its own package. That is a proper thing to say.

We have not yet made the package the app. The old shell is still the default path and still owns visible parity-critical workflows.

The clean path is to finish the package around the actual document-review loop, especially version/diff and default chrome parity, then flip the production app to the package and remove the duplicate editor state. Keeping the old shell around indefinitely would defeat the point of this branch; deleting it now would cut out real behavior users still rely on.
