---
title: "Hook Integration"
description: "Use plannotator annotate and annotate-last as review gates from agent hooks — spec-driven workflows, turn-by-turn review, and more."
sidebar:
  order: 27
section: "Guides"
---

The `--gate`, `--json`, and `--hook` flags on `plannotator annotate` and `plannotator annotate-last` turn annotation into a structured review decision. This guide shows how to wire them into agent hooks so a human can gate the agent at specific points in a workflow.

See [Annotate → Flags](/docs/commands/annotate/#flags) for the full stdout matrix. The short version:

- `--hook` emits hook-native JSON that works directly with Claude Code and Codex hook protocols. Implies `--gate`. Recommended for hook integrations.
- `--gate` adds a three-button UX (Approve / Send Annotations / Close).
- `--json` emits every decision as a structured `{ "decision": "approved" | "annotated" | "dismissed", "feedback": "..." }` object.

## Recipe 1: PostToolUse spec gate

Spec-driven frameworks (spec-kit, kiro, openspec) generate multiple markdown artifacts per feature — spec.md, plan.md, tasks.md, and so on — each needing human review before the agent builds from it. A PostToolUse hook on Write turns plannotator into a reviewer in the loop.

### Plaintext (naive)

Add to `.claude/hooks.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "plannotator annotate \"$CLAUDE_TOOL_INPUT_file_path\" --gate",
            "timeout": 345600
          }
        ]
      }
    ]
  }
}
```

Behavior:

- **Approve** → `The user approved.` on stdout. Claude Code reports the line back and proceeds.
- **Send Annotations** → feedback markdown on stdout. Claude Code reports the feedback back.
- **Close** → empty stdout. Claude Code proceeds silently.

### Hook-native mode (`--hook`)

For direct hook integration without a wrapper script, use `--hook`. It emits the JSON protocol that Claude Code and Codex hooks expect natively:

```json
"command": "plannotator annotate \"$CLAUDE_TOOL_INPUT_file_path\" --hook"
```

Behavior:

- **Approve** → empty stdout → hook passes → agent proceeds.
- **Close** → empty stdout → hook passes → agent proceeds.
- **Send Annotations** → `{"decision":"block","reason":"<feedback>"}` → hook blocks with feedback.

`--hook` implies `--gate` (three-button UX). This is the recommended approach for both Claude Code PostToolUse hooks and Codex hooks.

### Structured (`--json`)

If you want to route on decision type explicitly — for example, only re-prompt on `annotated` and log `approved` vs `dismissed` separately — pipe through `jq` or a small shell wrapper:

```bash
#!/usr/bin/env bash
# .claude/hooks/spec-gate.sh
result=$(plannotator annotate "$CLAUDE_TOOL_INPUT_file_path" --gate --json)
decision=$(echo "$result" | jq -r '.decision')
feedback=$(echo "$result" | jq -r '.feedback // ""')

case "$decision" in
  approved|dismissed)
    # empty stdout — hook passes through, agent proceeds
    ;;
  annotated)
    # emit feedback on stdout so the hook blocks with it as the reason
    echo "$feedback"
    ;;
esac
```

Exit code stays `0` for all three branches; signaling happens via stdout (empty = pass, non-empty = block). This mirrors the `--gate`-without-`--json` mode exactly — JSON just gives you a parsed decision for logging or conditional routing without changing the block contract.

## Recipe 2: Stop-hook turn gate

Wire `annotate-last` to Claude Code's Stop hook to pause every agent turn for human review.

### Plaintext

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "plannotator annotate-last --gate",
            "timeout": 345600
          }
        ]
      }
    ]
  }
}
```

Behavior:

- **Approve** → `The user approved.` on stdout. Turn ends; Claude Code reports the marker.
- **Send Annotations** → feedback on stdout → Claude Code re-prompts with the feedback.
- **Close** → empty stdout → turn ends.

Use `--hook` instead of `--gate` if you want hook-native JSON. Approve and Close emit empty stdout, Send Annotations emits `{"decision":"block","reason":"..."}` which prevents the stop and re-prompts with feedback.

### Structured

Same pattern as the PostToolUse recipe — pipe `--gate --json` through a shell wrapper if you want distinct handling per decision.

## OpenCode and Pi

The same `--gate` flag works in OpenCode's `/plannotator-annotate` and Pi's `/plannotator-annotate` slash commands:

```
/plannotator-annotate spec.md --gate
```

On those harnesses there is no stdout channel back to the agent — the plugin writes back via `session.prompt` (OpenCode) or `sendUserMessage` (Pi). Approve and Close both result in no session injection; Send Annotations injects the feedback. `--json` and `--hook` are accepted silently on these harnesses so recipes stay portable.

Third-party Pi or OpenCode plugins that want explicit decision routing can read `approved` directly from the server's decision object:

- OpenCode plugin: `server.waitForDecision()` returns `{ feedback, annotations, exit?, approved? }`.
- Pi: `openMarkdownAnnotation()` and `openLastMessageAnnotation()` return `{ feedback, exit?, approved? }`.

## Notes

- Exit code is always `0`. Gate decisions are signaled via stdout, not exit code.
- Folder annotation with `--gate` applies one decision to the whole session (not per-file). The user navigates the file browser inside the UI, annotates across files, and submits once.
- The `--gate` UX is fully opt-in. Users running `/plannotator-annotate README.md` interactively without the flag still see the 2-button experience.
