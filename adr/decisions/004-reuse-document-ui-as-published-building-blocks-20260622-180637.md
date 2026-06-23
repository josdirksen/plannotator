# 004. Reuse the Document UI as Published Building Blocks (Reverts 003, Re-scopes 002)

Date: 2026-06-22

## Status

Accepted.

**This ADR is the single source of truth for sharing Plannotator's document UI with the commercial Workspaces app.** It **reverts ADR 003** and **re-scopes ADR 002**.

> If you are an agent or contributor about to work on "document-ui extraction," read this ADR first. Treat ADRs 002 and 003, and their specs/intents (`adr/specs/document-ui-extraction-*`, `adr/specs/document-ui-parity-cutover-*`, `adr/implementation/document-ui-*-intent-*`), as a **post-mortem of a failed attempt** — not a plan to execute. The `packages/document-ui` package they describe was deleted. Do not recreate it.

## Context

### What we actually want

The commercial app, **Workspaces**, needs to reuse Plannotator's *presentation layer*: theme, Markdown rendering, the editor, settings UI, and layout/components — including the comment/annotation *rendering*.

Workspaces is a separate, Cloudflare-based collaborative document platform. It owns its own world:

- documents stored as versioned blob history (Git-like), D1 metadata, a raw file-serving worker (`tot.page`)
- workspaces/folders, public/private/open sharing, raw file URLs
- document version history and restore
- anchored comments and replies, shared with teammates
- agents commenting on documents via API keys
- realtime collaboration through Durable Objects
- browser login via WorkOS (hosted) or Cloudflare Access (self-host)
- hosted at `workspaces.plannotator.ai`, raw content at `tot.page`

The shared thing is therefore **UI building blocks, not an application.** Workspaces renders Plannotator's components and feeds them *its own* data, comments, versions, and realtime sync. Plannotator keeps feeding the same components *its* local hook/file data. Same look; different data and backend behind it.

### What we tried before (002/003) and why it failed

The previous attempt built a ~26,500-line, 70-file `packages/document-ui` package containing a provider-neutral `DocumentReviewSurface` + `DocumentHostApi` meant to be *the whole app* for both Plannotator and Workspaces. It then deleted Plannotator's working 4,685-line `packages/editor/App.tsx` and routed the real app through the new surface. The result did not render correctly — dead sidebars, missing chrome, a different experience. The branch was reverted on 2026-06-22 (all of it was uncommitted working-tree changes; a backup patch + archive of the dead code is in the session scratchpad).

Root causes (these are what this ADR exists to prevent repeating):

1. **Abstracted for a consumer that didn't exist yet.** The provider-neutral contract was designed against an imagined Workspaces backend that couldn't be run or tested. Premature/speculative generality.
2. **The method was a rewrite, not a move.** Every behavior was re-derived as a new "provider-neutral decision function" with its own unit test. ~80 such steps = a from-scratch reimplementation by construction.
3. **The acceptance bar couldn't see the failure.** Verification was `bun test` / `typecheck` / `build` only. 357 unit tests stayed green while the actual rendered app was broken. Nobody opened it.
4. **Deleted the known-good code before parity existed.** The team's own parity SPIKE measured only ~55–65% app-visible parity, yet the working shell was deleted anyway, with a demo page as the fallback.

## Decision

1. **Plannotator's app stays as it is.** No cutover. `packages/editor/App.tsx` and the current experience are the reference to preserve, not a thing to replace. There is no "flip the production app to a new surface" step in this plan.

2. **Share by publishing `@plannotator/ui` (and, if a slimmer editor package is needed, a small editor package) as versioned npm packages.** Workspaces installs them as a dependency. There is no shared "whole-app surface," no `DocumentReviewSurface`, and no `DocumentHostApi`.

3. **Shared = presentation building blocks that take their data via props/callbacks.** In scope:
   - theme and color tokens (`packages/ui/theme.css`)
   - Markdown parser + block renderer (`parser.ts`, `BlockRenderer`, block components)
   - document viewer / editor components
   - settings UI
   - layout / chrome components (toolbars, sidebars, panels)
   - comment / annotation **rendering** components (the visual presentation of an anchored comment and its replies)

   The real, *narrow* extraction work is this: where a shared component currently calls a hard-coded `/api/*` route or reaches into Plannotator-only globals, lift that I/O up to a prop or callback so the host supplies it. Make the components backend-agnostic. **Do not rebuild their logic.**

4. **NOT shared — each app owns its own:** document and comment *data* and state, realtime sync, version storage, feedback/delivery, server routes, auth, and backend. Workspaces wires comments to Durable Objects and its D1/blob store; Plannotator wires them to its local hook/file model. The shared component renders what it is given and emits events; it does not know who stores the data.

## Hard rules (these are the safeguards we lacked)

- **Move, don't rewrite.** Relocate existing code and change import paths. If a slice produces a large amount of brand-new code, stop — that is the warning sign that you are reimplementing instead of extracting.
- **No hard-coded routes or backend assumptions in shared packages.** Data comes in via props; actions go out via callbacks.
- **Parity is the gate, and a human verifies it in the browser.** After any change, Plannotator must look and behave identically across every mode: plan review; annotate file / folder / last; raw HTML; archive; goal setup; sidebars; plan diff; keyboard shortcuts; themes; settings; editor. Passing tests are necessary but **not sufficient** — last time they were green the entire time the app was broken.
- **Never delete or replace working code until a human signs off on parity**, mode by mode. Keep the old path until the replacement is proven.
- **Small, reviewed increments.** One component family at a time, eyeballed in the running app. No day-long unattended agent runs.

## Consequences

- Plannotator is never at risk during this work; its app keeps running unchanged the whole time.
- Workspaces gets a real, versioned dependency (`@plannotator/ui`) it can build its own product around, without inheriting Plannotator's routes, hooks, or local-file assumptions.
- The boundary is honest and small: **share the look, own the data.** A comment renders the same in both apps; how it syncs and persists is each app's own concern.
- Publishing adds a release/version step for the shared package(s). That is the accepted cost of a clean separate-repo boundary (Workspaces is its own repo on Cloudflare).
- ADRs 002 and 003 and their specs/intents are kept as history. The 2026-06-22 review-fixes spec (`adr/specs/document-ui-feature-completeness-review-fixes-*`) remains useful as a **checklist of behaviors the UI must preserve** — but read it as an inventory, not a build plan.

## References

- Reverts: `adr/decisions/003-complete-document-ui-parity-cutover-20260621-122015.md`
- Re-scopes: `adr/decisions/002-provider-neutral-document-ui-package-20260620-083633.md`
- Failed-attempt parity inventory (reuse as a checklist only): `adr/specs/document-ui-feature-completeness-review-fixes-20260622-085528.md`
- Sound research on how the current system works: `adr/research/SPIKE-document-ui-extraction-boundary-20260620-082002.md`
