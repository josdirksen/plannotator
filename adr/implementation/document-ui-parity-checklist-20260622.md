# Document UI — Parity Checklist ("did it break?")

Date: 2026-06-22 · Baseline commit: `30cfcebb`

> The safety net for the document-ui extraction (see ADR 004 + the verified plan `adr/specs/document-ui-extraction-plan-verified-20260622-184500.md`). **THE LAW: Plannotator's experience cannot change.** Run this checklist after *every* extraction step. If anything below differs from baseline, the step changed behavior — stop and fix before continuing. Passing automated checks are necessary but NOT sufficient; the manual click-through is the part that actually catches regressions (last time, tests were green while the app was broken).

## How to use this
1. Before starting work, capture the **baseline** (Part A) once. Save the outputs.
2. After each extraction step: re-run Part A and compare, then walk Part B for the surfaces the step could touch (when in doubt, walk all of it).
3. Green automated + identical manual = the step preserved parity. Proceed.

---

## Part A — Automated baseline (fast, run every step)

Run from repo root. Record PASS/FAIL + the bundle fingerprint.

```bash
bun run typecheck          # must pass
bun test                   # record pass count; must not drop vs baseline
bun run build:hook         # must succeed
bun run build:review       # must succeed
bun run build:opencode     # must succeed
# fingerprint the shipped artifacts — compare hash before/after a step:
find apps/hook/dist apps/opencode-plugin -name '*.html' -type f -exec shasum {} \; | sort
```

- [ ] `typecheck` passes
- [ ] `bun test` pass count ≥ baseline (note the number)
- [ ] all three builds succeed
- [ ] **bundle fingerprint recorded** (for a pure code-move step with defaults intact, the hashes should be byte-identical; if they change, understand exactly why)

> Baseline capture (do once, fill in): typecheck ____ · test count ____ · build ____ · hashes saved to `scratchpad/parity-baseline.txt`

---

## Part B — Manual click-through (the real test)

Launch the relevant surface and confirm each item looks and behaves **identically to baseline**. Tip: keep a baseline build/screenshots of each screen to diff against.

### Plan Review (`ExitPlanMode` flow, or `bun run dev:hook`)
- [ ] Plan renders: headings, code blocks, tables, callouts, alerts, task lists, images, links
- [ ] Theme correct on first paint (no flash/FOUC), theme switch works
- [ ] Select text → annotation toolbar appears → add comment / deletion / global comment
- [ ] Comment shows the right author, `(me)` badge on your own
- [ ] Sidebar: Table of Contents, Version Browser, Archive tabs all open and work
- [ ] Plan diff: `+N/-M` badge → toggle diff → rendered + raw modes → annotate a diff block
- [ ] Approve, and Deny-with-feedback both deliver correctly
- [ ] Export / Share (copy link + short URL) / Import round-trips
- [ ] Settings opens; AI providers, theme, identity all present
- [ ] Keyboard shortcuts: `Mod+Enter` submit, `Mod+P` print, sidebar toggles, wide mode

### Annotate file (`plannotator annotate <file.md>`)
- [ ] File renders with full markdown/PFM support
- [ ] Edit the doc → Save → source file on disk updates; saved-change banner correct
- [ ] Draft autosave/restore survives a reload
- [ ] Code-file links open the code popout; code annotations create + submit
- [ ] Send annotations delivers feedback

### Annotate folder (`plannotator annotate <dir>/`)
- [ ] File tree renders with badges + writeback status
- [ ] Expand/collapse folders; open files; **live updates** when a file changes on disk
- [ ] Per-file annotations stay associated; multi-file feedback assembles correctly

### Annotate last message / raw HTML
- [ ] Annotate-last: recent message(s) show; switching messages restores their annotations; feedback carries the message id/scope
- [ ] Raw HTML: renders, annotate, share produces portable HTML with assets

### Archive / Goal setup
- [ ] Archive view lists saved decisions with approved/denied badges; read-only render
- [ ] Goal setup surface submits and closes

### External / editor annotations (if applicable)
- [ ] External annotations posted to the API appear live (and update/delete reflect)
- [ ] VS Code editor annotations appear and are included in feedback (VS Code mode)

### Cross-cutting visual
- [ ] All themes render (spot-check a few); print mode CSS intact
- [ ] Wide/focus mode hides/restores panels correctly
- [ ] Panel resize + sidebar collapse behave the same
- [ ] Images load everywhere (markdown body, inline, HTML blocks, comment attachments, re-edit previews)

---

## What "fail" looks like (high-risk regressions to watch — from the audit)
- Theme/layout/identity **forgets settings** → the cookie-storage default got swapped instead of injected.
- **Some images load, some don't** → a `getImageSrc` call site was missed.
- **`(me)` badge or comment author missing** → identity default became empty instead of the live function.
- **Open `<details>` collapse on re-render** → a non-stable callback was threaded into a memoized block.
- **Sticky headers / scroll-to-anchor / TOC scroll broken** → ScrollViewport provider not mounted.
- **Plan-diff blocks render unstyled** → CSS that lives in the app shell wasn't accounted for.
- **Live updates stop / ghost drafts reappear** → an SSE or draft-generation protocol was re-derived instead of moved verbatim.
