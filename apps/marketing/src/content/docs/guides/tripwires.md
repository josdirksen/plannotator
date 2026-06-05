---
title: "Tripwires"
description: "Mark slop-free zones in your repo so any change that touches a protected file or symbol surfaces a warning during code review."
sidebar:
  order: 17
section: "Guides"
---

Tripwires let you mark **slop-free zones** — the parts of your codebase that agents and people must not casually touch. When a diff changes one of those files or symbols, Plannotator surfaces an unmissable amber warning during code review. No gates, no modals, no blocking. Just a clear signal that says "be careful, you're in a protected area."

Some code is load-bearing in ways that aren't obvious from the diff: a hand-tuned query, a security check, a migration that already shipped, a config the whole deploy depends on. An agent will happily rewrite any of it with full confidence. Tripwires give that code a perimeter so a careless edit doesn't slip through review unnoticed.

## Configuration

Tripwires are defined in a single JSON file at the root of your repo:

```
.plannotator/tripwires.json
```

The file has one top-level key, `rules`, which is an array. Each rule names the files it protects (`globs`), optionally the symbols within them (`symbols`), and an optional `note` explaining why the zone is protected.

```json
{
  "rules": [
    {
      "id": "rule-id",
      "globs": ["src/auth/**"],
      "symbols": ["verifyToken", "hashPassword"],
      "note": "Security-critical — changes need a second reviewer."
    }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | No | Identifier for the rule. Defaults to `rule-<index>` if omitted. |
| `globs` | Yes | One or more repo-relative glob patterns. A rule with no valid globs is dropped. |
| `symbols` | No | Names that narrow the rule to lines mentioning those symbols. Omit to protect every change in the matched files. |
| `note` | No | Message shown on the warning. Defaults to `Touches a slop-free zone`. |

### Example: protect whole files

The simplest tripwire watches a set of files. Any change anywhere in them trips the wire.

```json
{
  "rules": [
    {
      "globs": ["migrations/**", "db/schema.sql"],
      "note": "Schema changes ship to production — review carefully."
    }
  ]
}
```

### Example: protect specific symbols

Add `symbols` to narrow a rule to changes that touch particular functions, constants, or types. Only changes mentioning one of those names within the matched files will trip.

```json
{
  "rules": [
    {
      "globs": ["packages/billing/**"],
      "symbols": ["chargeCard", "PRICE_TABLE", "refund"],
      "note": "Money-touching code — get sign-off before changing."
    }
  ]
}
```

## Glob syntax

Globs are matched against repo-relative paths:

- `*` matches anything within a single path segment (does not cross `/`)
- `**` matches across path segments, including none
- `?` matches a single character
- A leading `**/` also matches files at the repo root, so `**/config.ts` matches both `config.ts` and `src/config.ts`

Examples:

- `src/auth/**` — every file under `src/auth/`
- `**/*.sql` — every `.sql` file anywhere in the repo
- `packages/*/index.ts` — `index.ts` directly inside any package folder

## What trips a wire

The rule is simple: **any change that touches a tripwired file or symbol trips the wire.** That includes:

- **Adding** new lines in a protected file
- **Editing** existing lines
- **Deleting** lines
- **Renaming** a protected file (matched against either the old or new path)

If a rule has `symbols`, only changes that mention one of those names count. If it has no `symbols`, any change in the matched files trips it.

## How hits surface

Tripwires are re-evaluated every time the diff loads — on initial review, on diff-type switches, and on PR switches. When a change trips a wire, you'll see it in three places:

- **Gutter marker** — an amber warning marker on the affected line in the diff, with the rule's note. Click it to jump to the matching entry in the sidebar.
- **Sidebar list** — each hit appears as an amber-accented card with its note and the file it touched. Click a card to jump to the line, or to the file panel for file-scope hits (renames that have no single line to anchor to).
- **File tree** — protected files that were touched show an amber warning glyph next to their name, so you can spot them before opening the diff.

Because tripwires are re-evaluated on every diff and PR switch, a hit you've already seen will reappear after you switch views. This is intended — the warning reflects the current diff, not a dismissible to-do.

## Tripwires are informational only

Tripwires never block anything and they are **never included in the feedback sent back to the agent.** They are a signal for the human reviewer, not an instruction for the agent. When you click **Send Feedback**, only your own annotations are submitted — tripwire warnings are filtered out entirely, and they don't count toward the annotation total that gates submission.

## Fail-open behavior

If `.plannotator/tripwires.json` is missing, empty, or malformed, tripwires simply do nothing — review proceeds exactly as it would without the file. A single broken rule never discards its siblings; the valid rules still apply. You can't break code review by writing a bad config.

## PR mode

Tripwires evaluate during PR review as well, as long as a local checkout of the repo exists so the config file and repo root can be found. Without a local checkout there's nothing to read the config from, so no tripwires fire.
