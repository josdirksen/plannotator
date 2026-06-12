---
name: plannotator-canvas
description: Publish live HTML previews (mockups, prototypes, reports, explainers) to Plannotator's browser canvas so the user can see and interact with them, and stream their feedback back to iterate. Use when building HTML artifacts the user should review visually, or when the user mentions the canvas.
allowed-tools: Bash(plannotator:*)
disable-model-invocation: true
---

# Plannotator Canvas

A long-running browser canvas where you publish small HTML pages as live, interactive frames. The user arranges them spatially, opens them fullscreen, comments (including on selected text inside your HTML), and sends feedback back while you keep working. Each project directory has its own board.

## Publish a frame

Write your HTML to a file, then run with Bash:

```bash
plannotator canvas add page.html --title "Login v2"
```

- Prints `{"frameId":"...","url":"..."}` — **remember the frameId** for updates.
- The first add auto-starts the canvas server and opens the user's browser; later adds appear live.
- Don't predict frame size — frames auto-grow to their rendered content height. Pass `--size WxH` only for fixed-viewport pages (`100vh` app shells); it pins the frame and disables auto-fit.
- Optional: `--session <id>`, `--group <hint>` (clusters related pages).
- `--single-doc`: when this is the only document you'll publish, opens it full-screen (the browser guards on the board having just this one frame).
- Self-contained HTML works best (inline CSS/JS). JavaScript runs; the frame is sandboxed.

## Listen for feedback

Run the watcher with Bash using `run_in_background: true`, and check its output (BashOutput) after publishing updates or when otherwise idle:

```bash
plannotator canvas watch --json
```

Each output line is one feedback event:

```json
{"event":"frame.feedback","frameId":"...","revision":3,
 "comments":[{"body":"Make the CTA primary","selection":{"originalText":"Sign in with email"}}],
 "feedbackMarkdown":"# Frame Feedback: Login v2 (rev 3)\n..."}
```

`feedbackMarkdown` is ready to act on. A `selection.originalText` means the comment anchors to that exact text in your HTML. The stream stays open and reconnects on its own — leave it running for the session.

Three event types arrive: `frame.feedback` (revise → `canvas update`), `frame.closed` (informational), and `comment.reply_request` (the user wants a **reply**, not a revision).

## Reply to a comment thread

For a `comment.reply_request` (carries `commentId` + the thread so far), reply with Bash:

```bash
plannotator canvas reply <commentId> --as "Claude" "Use teal — it matches the brand accent."
```

`--as` names your reply. It shows live in the user's thread; a follow-up arrives as another `comment.reply_request`.

## Iterate

Revise the HTML file, then push a new revision (the frame keeps its place):

```bash
plannotator canvas update <frameId> page.html
```

Repeat: update → check the watcher output → address every comment.

## Other commands

```bash
plannotator canvas              # open this project's board in the browser
plannotator canvas list --json  # frames on this project's board
```

Do not ask the user to copy shell commands into chat. Run the commands yourself.
