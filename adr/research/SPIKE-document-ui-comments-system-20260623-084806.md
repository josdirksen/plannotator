# Spike: Comments / Annotations / Drafts System (Phase 5)

Date: 2026-06-23

> Code research for Phase 5 of the `@plannotator/ui` reuse effort (governed by ADR 004; roadmap `adr/implementation/document-ui-extraction-roadmap-20260622.md`). Five parallel probes mapped the comment/annotation/draft system on the real tree. Goal: know every backend wire and every timing-sensitive invariant before speccing the seams. THE LAW: move + decouple, never rewrite; Plannotator's experience cannot change.

## Headline

**Most of the comment UI is already portable.** The comment *components* (`AnnotationPanel`, `CommentPopover`, `AnnotationToolbar`, `AnnotationToolstrip`, `EditorAnnotationCard`) and the highlighter hook (`useAnnotationHighlighter`) are prop-driven with no backend wires. `review-editor` already reuses `useExternalAnnotations`, `useEditorAnnotations`, and `useCodeAnnotationDraft` unchanged — a second consumer proving portability. So Phase 5 is **narrower than its "big one" reputation on the UI side**; the work is concentrated in **three seams** (draft transport, external-annotation transport, identity) plus **two structural constraints** (renderer coupling, no reply model).

## Annotation state lives in the host, not a shared reducer
- Plan: `packages/editor/App.tsx:255` `useState<Annotation[]>`; Review: `packages/review-editor/App.tsx:121` `useState<CodeAnnotation[]>`. There is **no shared annotation reducer** in `packages/ui` — each host owns its annotation array. So Workspaces will own its annotation state too; the shared package supplies the components/hooks that operate on it. (This is fine and matches review-editor.)

## Seam 1 — Draft transport (`/api/draft`) + the generation protocol

**Files:** `packages/ui/hooks/useAnnotationDraft.ts` (plan, full-featured), `packages/ui/hooks/useCodeAnnotationDraft.ts` (review, simpler). Server: `packages/shared/draft.ts`, `packages/server/shared-handlers.ts`, approve/deny in `packages/server/index.ts` + `annotate.ts`.

- **Wires:** `GET/POST/DELETE /api/draft`. POST body carries `{annotations, codeAnnotations, globalAttachments, editedMarkdown, editedDocuments, savedFileChanges, draftGeneration, ts}`. DELETE uses `?generation=N`. 500ms debounce (`DEBOUNCE_MS`).
- **The 3-party generation protocol (the fragile part):**
  1. Client keeps `draftGenerationRef` (starts 0), **pre-increments before each POST** (`++draftGenerationRef.current`); `getDraftGeneration()` returns the *next* gen (`ref.current + 1`) — `useAnnotationDraft.ts:383`.
  2. That value **escapes the hook** and is threaded into submit by the host: `App.tsx:1960-1963` `withDraftGeneration(path)` appends `?draftGeneration=`; used on `/api/approve` (App.tsx:2704), `/api/exit` (2715); `/api/deny` and `/api/feedback` carry it in the **body** (2626, 2683). **Per-endpoint source differs:** plan approve/deny read from body; annotate approve/exit read from **URL** (`annotate.ts:557,550`), feedback from body (573).
  3. Server **tombstone-gates** (`shared/draft.ts`): `saveDraft` rejects if `draftGeneration <= deletedGeneration` (L98) or `< storedGeneration` (L102); `deleteDraft` writes a tombstone at the deletion generation (L150); ignores stale deletes (L146). This is what prevents a late async draft-save from **resurrecting a draft after submit** (ghost drafts).
- **Timing-sensitive, must move VERBATIM:** the `keepalive: true` POST with **retry-without-keepalive on failure** gated by generation match (L357-364); the `visibilitychange`/`pagehide` **flush** that fires a final keepalive save on tab close (L389-405); the refs (`draftGenerationRef`, `timerRef`, `latestRef` non-reactive getters, `canPersistRef`, `hasMountedRef`). `canPersist = isApiMode && !isSharedSession && !submitted`.
- **Already portable:** the hooks are pure (no host imports); `shared/draft.ts` is runtime-agnostic node:fs. The wires are the only coupling.

## Seam 2 — External-annotation transport (the live-comment channel)

**Files:** `packages/ui/hooks/useExternalAnnotations.ts`, `useExternalAnnotationHighlights.ts`. Server: `packages/server/external-annotations.ts` (+ Pi mirror), `packages/shared/external-annotation.ts` (store, validators, event types).

- **This is the "teammates + agents commenting live" channel.** External tools/agents `POST /api/external-annotations`; the UI shows them live.
- **Transport state machine (move VERBATIM):** primary `EventSource('/api/external-annotations/stream')` delivers `snapshot|add|remove|clear|update` events into an internal reducer with **optimistic mutators** (delete/clear/update update local state, then call the server; SSE reconciles). On SSE error **before first snapshot**, fall back to **polling** `GET /api/external-annotations?since=<version>` every **500ms** (`POLL_INTERVAL_MS`), honoring **304 Not Modified** when `since === store.version`. 30s SSE heartbeat (`:` comment). Version is session-scoped (`versionRef` starts 0). Fallback triggers once (`!receivedSnapshotRef && !fallbackRef`) and doesn't switch back.
- **Already generic + gated:** `useExternalAnnotations<T extends {id; source?}>` is shape-generic and takes an `enabled` flag. Plan: `enabled: isApiMode && !goalSetupMode` (App.tsx:1135). **Review already reuses it** for `CodeAnnotation` with `enabled: !!origin` (App.tsx:284). `useExternalAnnotationHighlights` paints them via the Viewer handle (filters out global/diff, 100ms mount delay, fingerprint dedup).
- **Merge policy is host-owned:** App.tsx dedups local vs external by `source+type+originalText` (plan) / `source+type+filePath+lineStart+lineEnd+side` (review).
- **Seam = inject the transport** (a `subscribe()` + CRUD + `getSnapshot(since)` object) whose default reproduces the SSE→polling machine exactly. Server store/validators/SSE encoding (`shared/external-annotation.ts`) move wholesale.

## Seam 3 — Identity / authorship ("which comments are mine")

**Files:** `packages/ui/utils/identity.ts`, `generateIdentity.ts`, `config/configStore.ts`, `config/settings.ts`.

- `getIdentity()` reads `configStore.get('displayName')`; resolution **server config > cookie (`plannotator-identity`) > generated `{adj}-{noun}-tater`**. `isCurrentUser(author)` compares `author === configStore.get('displayName')` (`identity.ts:47-50`).
- **Stamp sites (9 hardcoded `getIdentity()`):** `Viewer.tsx:456,518`, `useAnnotationHighlighter.ts:273`, `html-viewer/HtmlViewer.tsx:210`, `html-viewer/useHtmlAnnotation.ts:142,258,296,333`, `plan-diff/PlanCleanDiffView.tsx:169`. **Display sites (2 `isCurrentUser()`):** `AnnotationPanel.tsx:194,204` → renders the `(me)` badge (518, 651).
- **Partly already host-controllable:** identity persists via the **swappable storage backend** (Phase 2 `setStorageBackend`) and can be seeded from server config via `configStore.init(serverConfig)`. So a host can already set the identity *value*. The remaining seam is making the **stamp/display callable** overridable: optional `author?` / `isCurrentUser?` defaulting to the existing functions, so Workspaces (real WorkOS logins) supplies the logged-in user instead of a tater name.
- `Annotation.author` / `CodeAnnotation.author` are optional fields; `sharing.ts` preserves author across share/import (already collaborative).

## Constraint A — Renderer coupling (structural, not a seam)

**Files:** `useAnnotationHighlighter.ts` (`findTextInDOM` L106-235, `applyAnnotationsInternal` L293-403), `utils/inlineTransforms.ts` (`transformPlainText` = emoji + smartypants), `BlockRenderer.tsx`, `InlineMarkdown.tsx`, `@plannotator/web-highlighter@0.8.1`.

- Highlight **restoration** re-anchors a saved annotation by searching the rendered DOM for `originalText`, with a fallback that applies `transformPlainText` (because the renderer turns `:smile:`→😄, `---`→—, straight→curly quotes). So restoration **only works if the host renders markdown to the same text** the transforms produce.
- Code blocks use **manual `<mark>` wrapping** (web-highlighter can't sit inside hljs spans); removal re-runs `hljs.highlightElement`.
- **Implication:** Workspaces must reuse `BlockRenderer` + `InlineMarkdown` + `inlineTransforms` **as a unit** for highlights to land. This is a documented integration contract, not a wire to cut. (Optional future: expose `transformPlainText` as overridable, but default stays.)

## Constraint B — No reply / threading model (a gap, not a regression)

- `Annotation` and `CodeAnnotation` are **flat**: a comment is one `text` field. No `parentCommentId`, `replies`, `threadId`. `CommentPopover` has a module-level draft cache but composes single comments.
- Workspaces wants **replies/threads** (teammates discussing on a doc). That is a **new feature**, not part of "make today's behavior reusable." Adding threading touches the type, the panel, and the popover — and must NOT change Plannotator's flat experience. **Out of scope for Phase 5's parity-preserving extraction**; flag as a Workspaces-side addition (build replies as a host-layer on top of, or a backward-compatible extension of, the shared components later).

## Already-portable inventory (no Phase-5 work needed)
`AnnotationPanel.tsx`, `AnnotationToolbar.tsx`, `AnnotationToolstrip.tsx`, `CommentPopover.tsx`, `EditorAnnotationCard.tsx`, `AnnotationSidebar.tsx`, `useAnnotationHighlighter.ts`, `useExternalAnnotationHighlights.ts`, `utils/commentContent.ts`, `utils/annotationHelpers.ts`, `utils/anchors.ts`, and the `exportAnnotations`/`exportCodeFileAnnotations`/`exportEditorAnnotations` serializers in `parser.ts` (pure, no API). `AnnotationPanel` only touches identity via the display-only `isCurrentUser` (Seam 3).

## Out of scope / host-owned (confirmed)
- `useEditorAnnotations` (`/api/editor-annotation(s)`, gated by `window.__PLANNOTATOR_VSCODE`) — VS Code IPC, host-only, not a document-UI seam.
- Feedback/submit routes (`/api/feedback`, `/api/approve`, `/api/deny`, `/api/exit`) and their payload policy — host-owned (Workspaces has its own).
- Annotation state ownership and the external-merge/dedup policy — host-owned.

## Per-seam evidence map
| Seam | Key files | Backend wires | Move-verbatim invariants |
|---|---|---|---|
| 1 Drafts | useAnnotationDraft.ts, useCodeAnnotationDraft.ts, shared/draft.ts | `GET/POST/DELETE /api/draft`; generation in approve/deny/feedback/exit | generation pre-increment + tombstone gate; keepalive retry; visibility/pagehide flush; the 5 refs |
| 2 External | useExternalAnnotations.ts, useExternalAnnotationHighlights.ts, shared/external-annotation.ts, server/external-annotations.ts | SSE `/stream`; `GET ?since=`; `POST/PATCH/DELETE` | SSE→polling fallback machine; 500ms poll; 304 gate; 30s heartbeat; optimistic mutators; version-scoping |
| 3 Identity | identity.ts, configStore.ts, settings.ts | (none directly; via configStore→storage, swappable) | resolution order server>cookie>tater; 9 stamp sites; 2 `(me)` sites |
| A Renderer | useAnnotationHighlighter.ts, inlineTransforms.ts, BlockRenderer/InlineMarkdown | none | restoration depends on exact rendered text; manual code-block `<mark>` |
| B Replies | types.ts, AnnotationPanel, CommentPopover | none | flat model today; threading is a NEW feature, keep Plannotator flat |
