# Spec: Comments / Annotations / Drafts Seam (Phase 5)

Date: 2026-06-23 · Status: Draft (iterate before implementing)

> Implementation spec for Phase 5 of the `@plannotator/ui` reuse effort. Grounded in `SPIKE-document-ui-comments-system-20260623-084806.md` + `synthesis-document-ui-comments-20260623-084806.md`. Governed by ADR 004. THE LAW: each seam is a module-level default reproducing today's literal behavior + an optional override; Plannotator passes nothing and is byte-for-byte unchanged. Move verbatim, never rewrite — especially the SSE machine and the draft generation protocol.

## Scope

**In scope (3 seams):** draft transport, external-annotation transport, identity/authorship.
**Confirmed noop (already portable):** AnnotationPanel, CommentPopover, AnnotationToolbar, AnnotationToolstrip, EditorAnnotationCard, AnnotationSidebar, useAnnotationHighlighter, useExternalAnnotationHighlights, commentContent/annotationHelpers/anchors, the `export*Annotations` serializers.
**Out of scope:** replies/threading (new feature — defer), renderer coupling (document as a contract), `useEditorAnnotations` / VS Code IPC (host-only), feedback/submit routes and merge/dedup policy (host-owned).

## Order of work (lowest risk first)

### Step 1 — Identity / authorship seam (effort S, lowest risk; partly already done)
**Files:** `packages/ui/utils/identity.ts` and the stamp/display sites.
- Add a module-level identity provider with default = today's functions, matching the Phase 2–4 pattern:
  ```ts
  // identity.ts
  export interface IdentityProvider {
    getIdentity(): string;
    isCurrentUser(author: string | undefined): boolean;
  }
  const defaultIdentityProvider: IdentityProvider = { getIdentity, isCurrentUser }; // existing impls
  let identityProvider = defaultIdentityProvider;
  export function setIdentityProvider(p: IdentityProvider): void { identityProvider = p; }
  export function resetIdentityProvider(): void { identityProvider = defaultIdentityProvider; }
  ```
  Then route the 9 stamp sites and 2 display sites through `identityProvider.getIdentity()` / `identityProvider.isCurrentUser()`. Keep the existing `getIdentity`/`isCurrentUser` exports working (they remain the default).
- **Alternative considered:** thread an optional `author?`/`isCurrentUser?` prop through Viewer/panel. Rejected for now — 9 stamp sites across Viewer + html-viewer + diff make a module-level provider cleaner and lower-churn. (Decide in review.)
- **Parity guardrail:** no caller sets the provider → tater identity + `(me)` badge behave exactly as today. Verify: existing identity/annotation tests green; eyeball a comment shows the tater name + `(me)`.

### Step 2 — Draft transport seam (effort M)
**Files:** `packages/ui/hooks/useAnnotationDraft.ts`, `packages/ui/hooks/useCodeAnnotationDraft.ts`.
- Introduce a `DraftTransport` and module-level default reproducing today's fetches verbatim:
  ```ts
  export interface DraftTransport {
    load(): Promise<{ data: unknown | null; generation: number | null }>;
    save(body: object, opts: { keepalive?: boolean }): Promise<void>;
    remove(generation: number, opts?: { keepalive?: boolean }): Promise<void>;
  }
  ```
  Default `save` keeps the **keepalive-true POST with retry-without-keepalive on failure gated by generation match**; default `remove` does `DELETE /api/draft?generation=N`; default `load` does `GET /api/draft` + reads `draftGeneration` from the (404) body.
- **Keep inside the hook (do not move into the transport):** the `draftGenerationRef` pre-increment, the 500ms debounce, the `latestRef` non-reactive getters, `canPersistRef`/`hasMountedRef` gates, and the `visibilitychange`/`pagehide` flush effect. These are stateful/timing-sensitive — verbatim.
- **Document the 3-party protocol in the seam's doc comment:** `getDraftGeneration()` still escapes to the host; the host still threads it into submit (`withDraftGeneration` → `/api/approve`,`/api/exit` URL; `/api/deny`,`/api/feedback` body; annotate reads approve/exit from URL). A host swapping transport **must** replicate generation-gated delete-on-submit and tombstoning, or ghost drafts resurrect.
- **Parity guardrail:** no caller overrides transport → identical `/api/draft` traffic and identical generation in approve/deny/feedback/exit. Verify: existing draft tests green (esp. `packages/shared/draft.test.ts` generation invariants — server side is untouched); typecheck; full `bun test` ≥ baseline; eyeball: type a comment, reload → draft restores; submit → draft gone, doesn't reappear.

### Step 3 — External-annotation transport seam (effort M–L, riskiest; do last)
**Files:** `packages/ui/hooks/useExternalAnnotations.ts` (+ `useExternalAnnotationHighlights.ts` stays as-is).
- Introduce an `ExternalAnnotationTransport<T>` and module-level default reproducing the SSE→polling machine verbatim:
  ```ts
  export interface ExternalAnnotationTransport<T> {
    subscribe(onEvent: (e: ExternalAnnotationEvent<T>) => void, onError: () => void): () => void;
    getSnapshot(since: number): Promise<{ annotations: T[]; version: number } | null>; // null on 304
    add(items: T[]): Promise<void>;
    remove(id: string): Promise<void>;
    update(id: string, fields: Partial<T>): Promise<void>;
    clear(source?: string): Promise<void>;
  }
  ```
  Default `subscribe` = `new EventSource('/api/external-annotations/stream')` wiring; default `getSnapshot` = `GET /api/external-annotations?since=` with 304→null; CRUD = today's optimistic-then-fetch calls.
- **Keep inside the hook (verbatim):** the reducer that applies `snapshot|add|remove|clear|update`, the **fallback-once** logic (`!receivedSnapshotRef && !fallbackRef`), the **500ms** poll interval, the version-scoped `versionRef`, and the optimistic local mutation before the network call. The default transport owns the EventSource/heartbeat/304 wire; the hook owns the state machine that drives it.
- The `enabled` flag stays host-suppliable (plan: `isApiMode && !goalSetupMode`; review: `!!origin`). Server `shared/external-annotation.ts` (store, validators, event types, SSE encoding) is already shared and unchanged.
- **Parity guardrail:** no caller overrides → identical SSE connection, identical 500ms/304 polling, identical optimistic CRUD. Verify: existing external-annotation tests green; **eyeball both paths** — (a) POST to `/api/external-annotations` shows live without reload (SSE); (b) kill/black-hole the stream → confirm polling takes over and still updates. App.tsx merge/dedup untouched.

## Renderer-coupling contract (document, no code change)
Write a short integration note (in the package README or a `docs` doc) stating: a host consuming the annotation UI must render markdown through `@plannotator/ui` `BlockRenderer` + `InlineMarkdown` + `utils/inlineTransforms` (which applies `transformPlainText`), because highlight restoration re-anchors against that exact rendered text. Optional future work: expose `transformPlainText` as overridable with today's default.

## Replies/threading (explicitly deferred)
Not built in Phase 5. When scoped later, do it backward-compatibly (Plannotator keeps the flat single-comment experience; threading is additive and Plannotator never populates it). Tracked as a separate spec.

## Definition of done (Phase 5)
- Identity, draft, and external-annotation transports are host-overridable, each defaulting to today's behavior.
- Plannotator byte-unchanged: shipped bundles behave identically; full `bun test` ≥ baseline (1620/0); typecheck; builds; App.tsx changes limited to (at most) wiring the defaults at call sites if needed (ideally zero — module-level defaults mean Plannotator passes nothing).
- Eyeball confirmed: comment author/`(me)`, draft save+restore+no-ghost, live external annotations via SSE, and SSE→polling fallback.
- Renderer-coupling contract written down. Replies deferred with a note.

## Per-step parity guardrail (run after each)
`bun run typecheck` · `bun test` must stay ≥ 1620/0 (+ the touched suite green, unmodified where a guardrail test exists) · `bun run --cwd apps/review build && bun run build:hook` · `git diff packages/editor/App.tsx` minimal/empty · manual eyeball for the step's surface.

## Open questions (resolve before/within ADR)
1. Identity: module-level `setIdentityProvider` (recommended) vs. props.
2. Replies: deferred (recommended) vs. in-scope.
3. Renderer `transformPlainText`: document-only (recommended) vs. extract overridable now.
4. Whether to ship the three seams as one Phase-5 PR or three small verify-gated commits (recommended: three commits, identity → drafts → external, like Phase 3).
