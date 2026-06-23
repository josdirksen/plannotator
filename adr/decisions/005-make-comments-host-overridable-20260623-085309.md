# 005. Make Comments / Annotations / Drafts Host-Overridable (Phase 5)

Date: 2026-06-23

## Status

Accepted

## Context

ADR 004 set the plan: make `@plannotator/ui` reusable by the commercial Workspaces app by lifting each Plannotator-specific wire up to an optional override whose default is today's behavior, never changing Plannotator. Phases 0–4 did this for packaging, image/storage, the rendering stack, and the file tree.

Phase 5 is comments — the core of Workspaces (teammates and AI agents commenting on documents, live). It was assumed to be the largest, most dangerous phase. Five code-research probes (`adr/research/SPIKE-document-ui-comments-system-20260623-084806.md`, synthesized in `adr/research/synthesis-document-ui-comments-20260623-084806.md`) found a narrower reality:

- The comment **UI is already portable** — `AnnotationPanel`, `CommentPopover`, `AnnotationToolbar`, `AnnotationToolstrip`, `EditorAnnotationCard`, `useAnnotationHighlighter`, the `export*Annotations` serializers — all prop-driven, no backend wires.
- A **second consumer already proves it**: `review-editor` reuses `useExternalAnnotations`, `useEditorAnnotations`, and `useCodeAnnotationDraft` unchanged.
- Annotation **state is host-owned already** (each app's own `useState`), so there is no shared reducer to wrestle.

The real coupling is three things: the draft transport (`/api/draft`) plus a fragile 3-party "generation" protocol that prevents ghost drafts; the external-annotation transport (an SSE→polling state machine — the live-comment channel); and identity/authorship (the local "tater" nickname behind the `(me)` badge). Two further findings are not extraction work: highlight restoration is coupled to Plannotator's exact markdown renderer, and there is no reply/threading model (which Workspaces wants but Plannotator does not have).

## Decision

Make the comment system host-overridable through **three seams**, each a module-level default that reproduces today's behavior plus an optional override; Plannotator passes nothing and stays byte-for-byte unchanged. Land them lowest-risk first, as three separate verify-gated commits.

1. **Identity (first, lowest risk).** Add a module-level identity provider in `packages/ui/utils/identity.ts` (`setIdentityProvider` / `resetIdentityProvider`) defaulting to today's `getIdentity` / `isCurrentUser`. Route the ~9 author-stamp sites and 2 `(me)`-display sites through it. Workspaces supplies the logged-in user; Plannotator keeps the tater nickname. (Identity already persists via the Phase-2 swappable storage and `configStore.init(serverConfig)`; this closes the last gap.)

2. **Draft transport (second).** Inject a `DraftTransport` (load/save/remove) into `useAnnotationDraft` and `useCodeAnnotationDraft`, default = today's `/api/draft` fetches verbatim — including the `keepalive` retry and the `visibilitychange`/`pagehide` flush. The generation protocol stays end-to-end: `getDraftGeneration()` still escapes to the host and is still threaded into approve/deny/feedback/exit; the seam's contract documents that a host swapping transport must also honor generation-gated delete-on-submit and tombstoning, or ghost drafts return. The stateful refs, debounce, and pre-increment timing stay in the hook, verbatim.

3. **External-annotation transport (last, riskiest).** Inject an `ExternalAnnotationTransport` (`subscribe` + optimistic CRUD + `getSnapshot(since)`) into `useExternalAnnotations`, default = the SSE→polling state machine moved verbatim (EventSource primary, 500ms polling fallback, 304 gate, 30s heartbeat, fallback-once). The reducer, optimistic mutators, version-scoping, and `enabled` gate stay in the hook. A Workspaces backend implements the same event contract over Durable Objects instead of SSE; the shared store/validators/encoding in `packages/shared/external-annotation.ts` are unchanged.

The already-portable comment components and hooks are confirmed no-ops — no work.

**Two things are explicitly excluded from Phase 5:**

- **Renderer coupling — document, do not change.** Highlight restoration re-anchors against the rendered DOM and depends on `transformPlainText` matching the renderer. We write down an integration contract: a host must reuse `BlockRenderer` + `InlineMarkdown` + `inlineTransforms` as a unit. (Optionally expose `transformPlainText` as overridable later; not now.)

- **Replies / threading — defer as a new feature.** Comments are flat today. Threading is something Workspaces wants and Plannotator lacks; building it is adding a feature, not making existing behavior reusable. Phase 5 ships the flat model unchanged. Replies are a later, backward-compatible enhancement that Plannotator never populates, tracked in its own spec.

## Consequences

- Workspaces can power real-time, multi-person, agent-friendly commenting by implementing three transports/providers, without inheriting Plannotator's `/api/draft`, SSE routes, or tater identity.
- Plannotator is unchanged: every seam defaults to today's literal behavior; the draft generation protocol and the SSE→polling machine move verbatim (the exact failure mode of the reverted attempt is avoided by copying, not re-deriving).
- The parity bar per seam: full `bun test` stays at baseline (1620/0), typecheck and builds pass, `packages/editor/App.tsx` changes stay minimal/empty, and an eyeball confirms the surface — author/`(me)` badge, draft save+restore+no-ghost, live external annotations, and the SSE→polling fallback (kill the stream, confirm polling takes over).
- A new integration constraint is now on record: Workspaces must reuse Plannotator's markdown renderer for comment highlights to land. This narrows Workspaces' freedom on rendering but is required and cheap (it already wants the same look).
- Replies remain unbuilt; Workspaces' full collaborative-thread vision needs a follow-up once the seams land.

## References

- Spike: `adr/research/SPIKE-document-ui-comments-system-20260623-084806.md`
- Synthesis: `adr/research/synthesis-document-ui-comments-20260623-084806.md`
- Spec: `adr/specs/document-ui-comments-seam-20260623-084806.md`
- Governing decision: `adr/decisions/004-reuse-document-ui-as-published-building-blocks-20260622-180637.md`
