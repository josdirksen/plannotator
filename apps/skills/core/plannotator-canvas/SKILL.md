---
name: plannotator-canvas
description: Publish live HTML previews (mockups, prototypes, reports, explainers) to Plannotator's browser canvas so the user can see and interact with them, and stream their feedback back to iterate. Use when building HTML artifacts the user should review visually, or when the user mentions the canvas.
disable-model-invocation: true
---

# Plannotator Canvas

A long-running browser canvas where you publish small HTML pages as live, interactive frames. The user arranges them spatially, opens them fullscreen, comments (including on selected text inside your HTML), and sends feedback back to you while you keep working. Each project directory has its own board.

## Publish a frame

Write your HTML to a file, then:

```bash
plannotator canvas add page.html --title "Login v2"
```

- Prints `{"frameId":"...","projectKey":"...","url":"..."}` — **save the frameId** so you can update the frame later.
- The first add auto-starts the canvas server and opens the user's browser; later adds appear live, no reopen needed.
- **Don't try to predict frame size.** Frames auto-grow to their rendered content height — pages land at natural size, side by side. Only pass `--size WxH` for fixed-viewport pages (e.g. a `100vh` dashboard or app shell); it pins the frame and disables auto-fit.
- Optional flags: `--session <id>` (provenance), `--group <hint>` (cluster related pages on the board).
- `--single-doc`: if this is the *only* document you intend to publish (you won't add more), pass this so the browser opens it full-screen instead of as a small card. The browser only honors it when the board truly has just this one frame.
- Self-contained HTML works best (inline CSS/JS). JavaScript runs; the frame is sandboxed.

## Listen for feedback (recommended)

Run this **in the background** and monitor its output while you continue working:

```bash
plannotator canvas watch --json
```

Each line is one feedback event:

```json
{"event":"frame.feedback","frameId":"...","title":"Login v2","revision":3,
 "comments":[{"body":"Make the CTA primary","selection":{"originalText":"Sign in with email"}}],
 "feedbackMarkdown":"# Frame Feedback: Login v2 (rev 3)\n..."}
```

`feedbackMarkdown` is ready to act on directly. A `selection.originalText` field means the comment anchors to that exact text in your HTML. The stream stays open and reconnects on its own — leave it running and check its output after making changes or when idle.

The watcher delivers three event types:
- `frame.feedback` — revise the document, then `canvas update`.
- `comment.reply_request` — the user wants a **reply**, not a revision. Reply in the comment's thread (see below). No document change is expected.
- `frame.closed` — the user dismissed a preview; informational, no action needed.

## Reply to a comment thread

When you get a `comment.reply_request` (it includes `commentId` and the conversation so far), reply with:

```bash
plannotator canvas reply <commentId> --as "Claude" "Use teal — it matches the brand accent."
```

`--as` is the name shown next to your reply (declare whoever you are). The reply appears live in the user's thread; if they follow up, you'll get another `comment.reply_request` with the updated thread.

If you can't run background processes, poll instead:

```bash
plannotator canvas feedback --since <last-dispatchedAt-ISO>
```

## Iterate

Revise the HTML file and push a new revision (the frame keeps its place on the board):

```bash
plannotator canvas update <frameId> page.html
```

Repeat: update → watch for the next feedback event → address every comment in it.

## Other commands

```bash
plannotator canvas              # open this project's board in the browser
plannotator canvas open         # reopen the board and print its URL (--no-open to just print the link)
plannotator canvas list         # frames on this project's board (--json available)
```

The canvas server is a long-running singleton — it stays up across sessions on a fixed port (default `19434`, override with `PLANNOTATOR_CANVAS_PORT`). If the user closes the tab, `plannotator canvas open` brings them back to the live board (it prints the URL to stdout); you never need to know or guess the port.

Do not ask the user to copy shell commands into chat. Run the commands yourself.
