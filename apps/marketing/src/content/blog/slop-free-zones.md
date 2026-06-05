---
title: "Slop-Free Zones: Tripwires for Code Agents Shouldn't Touch"
description: "Some code is too load-bearing to let an agent casually rewrite. Tripwires let you mark slop-free zones in your repo and surface an unmissable warning whenever a diff touches them."
date: 2026-06-05
author: "backnotprop"
tags: ["tripwires", "code-review", "slop-free-zones"]
---

**Plannotator is an open-source review UI for AI coding agents.** The latest release adds Tripwires — a way to mark the parts of your codebase that agents and people must not casually touch, so any change that reaches them lights up during code review.

## The problem

Coding agents are confident. That's most of the time a feature. But confidence is dangerous around load-bearing code: the hand-tuned database query, the security check at the edge of an auth flow, the migration that already shipped to production, the one config value the whole deploy hinges on. An agent will rewrite any of it without hesitation, and the diff looks just as clean as every other diff.

The risk isn't that the change is obviously wrong. It's that it's *quiet*. You're reviewing eight files of agent output, you're moving fast, and the one edit that actually matters scrolls by looking exactly like the boilerplate around it. By the time something breaks, the context is gone.

## Slop-free zones

The fix is to give that code a perimeter. A **slop-free zone** is a part of the codebase you've decided needs care — and Tripwires let you declare those zones in one file:

```json
{
  "rules": [
    {
      "globs": ["src/auth/**"],
      "symbols": ["verifyToken", "hashPassword"],
      "note": "Security-critical — changes need a second reviewer."
    },
    {
      "globs": ["migrations/**", "db/schema.sql"],
      "note": "Schema changes ship to production — review carefully."
    }
  ]
}
```

Drop that at `.plannotator/tripwires.json` in your repo root. The first rule watches the auth package, but only fires on lines that mention `verifyToken` or `hashPassword`. The second watches every migration and the schema file wholesale — no symbols, so any change at all trips it.

The semantics are deliberately simple: **any change that touches a tripwired file or symbol trips the wire** — adding, editing, deleting, or renaming. There's nothing to learn beyond globs and an optional list of names.

## No gates, no modals — just amber

The easiest version of this feature would be a blocking modal: "You're about to review changes to a protected file. Continue?" We didn't build that. Gates train you to dismiss them, and a dismissed gate protects nothing.

Tripwires are passive on purpose. When a change touches a slop-free zone, you get an unmissable amber signal in three places — an amber gutter marker on the affected line, an amber-accented card in the review sidebar carrying your note, and an amber glyph on the file in the tree. Nothing stops you. Nothing demands a click. The warning is just *there*, exactly where you're already looking, and it stays accurate because it's re-evaluated on every diff and PR switch.

And tripwires are strictly for you, the human reviewer. They are **never** included in the feedback sent back to the agent, and they don't count toward your annotation total. They're a heads-up display, not an instruction.

If the config file is missing or malformed, tripwires simply do nothing — one bad rule never discards the others, and you can't break review by writing a bad file. Fail-open, always.

## Try it

Update to the latest version:

```bash
curl -fsSL https://plannotator.ai/install.sh | bash
```

Add a `.plannotator/tripwires.json` with the files you care about most, run `/plannotator-review`, and watch the zones light up. Full details are in the [Tripwires guide](/docs/guides/tripwires/).
