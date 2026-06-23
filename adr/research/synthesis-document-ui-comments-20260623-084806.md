# Synthesis: Comments / Annotations / Drafts (Phase 5)

Date: 2026-06-23

> Synthesizes `SPIKE-document-ui-comments-system-20260623-084806.md` against the verified plan (`adr/specs/document-ui-extraction-plan-verified-20260622-184500.md`) and ADR 004. Settles the shape of Phase 5.

## The reframing

Phase 5 has been called "the big one." The research **confirms it's the most interconnected subsystem but narrows the actual work.** Three facts change the picture:

1. **The comment UI is already portable.** Panel, popover, toolbar, highlighter hook — all prop-driven, no backend wires. Nothing to extract.
2. **A second consumer already proves it.** `review-editor` reuses `useExternalAnnotations`, `useEditorAnnotations`, and `useCodeAnnotationDraft` unchanged, with `enabled` gates and shape-generics already in place. The portability pattern exists; we extend it, we don't invent it.
3. **Annotation state is host-owned already.** Each app holds its own `useState` array; there is no shared reducer to wrestle. Workspaces owns its state too.

So Phase 5 = **three transport/identity seams** + **two things that are NOT extraction work** (a renderer constraint to document, and a replies feature to defer).

## What we will do: three seams (same pattern as Phases 2–4)

Each is the proven shape: a module-level default that reproduces today's literal behavior, plus an optional `setX` override; Plannotator passes nothing and is byte-unchanged.

### Seam 1 — Draft transport
Inject a `DraftTransport` (load/save/delete) into `useAnnotationDraft` and `useCodeAnnotationDraft`, default = today's `/api/draft` fetches **verbatim**, including the `keepalive` retry and the `visibilitychange`/`pagehide` flush. **The generation protocol is the hard part and must be preserved end-to-end:** `getDraftGeneration()` still escapes the hook and the host still threads it into submit (`withDraftGeneration`), and the seam must document that a host swapping transport also has to honor generation-gated delete-on-submit (or ghost drafts return). The refs and pre-increment timing move verbatim.

### Seam 2 — External-annotation transport
Inject an `ExternalAnnotationTransport` (`subscribe(onEvent,onError)` + optimistic CRUD + `getSnapshot(since)`) into `useExternalAnnotations`, default = the SSE→polling state machine **moved verbatim** (EventSource primary, 500ms polling fallback, 304 gate, 30s heartbeat, fallback-once semantics). The reducer and optimistic mutators stay in the hook. The `enabled` gate is already host-suppliable. The server store/validators/SSE encoding in `shared/external-annotation.ts` are already shared; a Workspaces backend implements the same event contract over Durable Objects instead of SSE.

### Seam 3 — Identity
Make authorship overridable: optional `author?` (or an injected `getIdentity`) at the ~9 stamp sites and an optional `isCurrentUser?` at the 2 `(me)` display sites, **defaulting to the existing `identity.ts` functions**. Storage is already swappable (Phase 2) and `configStore.init(serverConfig)` already seeds identity from the server, so much of identity is host-controllable today; this seam closes the last gap so Workspaces' real logins (WorkOS) drive authorship instead of tater names.

## What we will NOT do in Phase 5

### Constraint A — Renderer coupling: document it, don't fight it
Highlight restoration re-anchors against the rendered DOM and depends on `transformPlainText` (emoji + smart punctuation) matching the renderer's output. **Workspaces must reuse `BlockRenderer` + `InlineMarkdown` + `inlineTransforms` as a unit.** This is an integration contract we write down, not a wire we cut. (Optional later: expose `transformPlainText` as overridable with today's default — but not required for Phase 5.)

### Constraint B — Replies/threading: defer as a new feature
Comments are flat today. Threading is something **Workspaces wants but Plannotator does not have** — so building it is *adding a feature*, which is explicitly outside "make today's behavior reusable without changing Plannotator." Phase 5 ships the flat model unchanged. Replies become a later, backward-compatible enhancement (a host layer over the shared components, or an optional `replies?` extension that Plannotator never populates), planned on its own once the seams land.

## Why this ordering and risk read
- **Identity (Seam 3) is the lowest-risk** and partly done — do it first to warm up.
- **Drafts (Seam 1) is medium** — the generation protocol is fiddly but well-understood; the guardrail is that approve/deny/feedback/exit still carry the generation and ghost drafts don't return.
- **External (Seam 2) is the riskiest** — a timing-sensitive state machine that must move verbatim (the exact trap that sank the reverted attempt). Do it last, with the SSE→polling fallback proven by an eyeball (kill the stream, confirm polling takes over).
- Everything else (panel, popover, toolbar, highlighter, exporters) is already portable — **no work, just confirm noop** like the sidebar in Phase 4.

## Open decisions for the spec/ADR
1. **Identity injection mechanism:** optional `author?` prop threaded to stamp sites vs. an injected `getIdentity`/`isCurrentUser` pair (module-level setter, like the other seams). Lean: module-level setter (`setIdentityProvider`) for consistency and to avoid threading props through 9 sites.
2. **Replies:** confirm it's deferred (recommended) vs. scoped into Phase 5. Recommend defer.
3. **Renderer constraint:** document-only (recommended) vs. also extract `transformPlainText` as overridable now. Recommend document-only.

## References
- Spike: `adr/research/SPIKE-document-ui-comments-system-20260623-084806.md`
- Verified plan (Phase 5 / step 5): `adr/specs/document-ui-extraction-plan-verified-20260622-184500.md`
- Decision: `adr/decisions/004-reuse-document-ui-as-published-building-blocks-20260622-180637.md`
