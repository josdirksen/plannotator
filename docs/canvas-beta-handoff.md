# Plannotator Canvas — Beta Tester Handoff

This document is written for a coding agent (e.g. Claude Code) setting up the
Plannotator Canvas beta on a tester's machine. Execute it top to bottom. Your
human is beta testing the canvas for demos — publishing live HTML (slide
decks, reports, prototypes) to a browser canvas and iterating on feedback.

**What this is:** a long-running local browser canvas. You (the agent) publish
self-contained HTML files as live, interactive frames from the CLI; the user
pans/zooms, presents them full-screen, comments on them (including on selected
text inside your HTML), and sends feedback back to you as structured events on
stdout while you keep working.

**Status: beta.** Local use only (no SSH/devcontainer support yet). Tested on
macOS and Linux. Everything runs on the tester's machine; nothing is uploaded.

## 1. Setup (once)

Prerequisites: [Bun](https://bun.sh) ≥ 1.2, git, a modern browser.

```bash
git clone git@github.com:backnotprop/plannotator.git
cd plannotator
git checkout feat/canvas
bun install

# Build, in this order (later builds bundle earlier outputs):
bun run build:review
bun run build:canvas
bun run build:hook

# Compile the CLI binary somewhere on PATH:
bun build apps/hook/server/index.ts --compile --outfile ~/.local/bin/plannotator
plannotator canvas --help   # sanity check (add ~/.local/bin to PATH if needed)
```

Optional but recommended — install the canvas skill so future agent sessions
know this workflow without reading this doc:

```bash
mkdir -p ~/.claude/skills/plannotator-canvas
cp apps/skills/claude/plannotator-canvas/SKILL.md ~/.claude/skills/plannotator-canvas/
```

To update later: `git pull` on the branch, rerun the three builds + compile.

## 2. The core loop

Run all commands from the project directory the demo belongs to — each
directory gets its own board.

```bash
# 1. Publish. Writes HTML to a file first; --title is what the user sees.
plannotator canvas add page.html --title "Login v2"
#    → {"frameId":"frm-…","url":"http://127.0.0.1:19434/?project=…"}
#    SAVE THE frameId. First add auto-starts the server and opens the browser.

# 2. Listen for feedback IN THE BACKGROUND while you keep working:
plannotator canvas watch --json
#    Emits one NDJSON line per event. The three event types:
#      frame.feedback        → revise the HTML, then `canvas update` (step 3)
#      comment.reply_request → answer in-thread: canvas reply <commentId> --as "Claude" "…"
#      frame.closed          → informational; no action needed

# 3. Revise (frame keeps its place and size on the board):
plannotator canvas update <frameId> page.html
```

Other commands: `canvas open` (reopen the board URL — never guess the port),
`canvas list`, `canvas feedback --since <ISO>` (poll instead of watch),
`canvas stop`.

Authoring rules:

- **Self-contained HTML works best** — inline CSS/JS. JS runs; frames are
  sandboxed iframes (no cookies/storage access, can't navigate the app).
  CDN-loaded assets (fonts, images, chart libs) work.
- **Don't predict frame size.** Frames auto-grow to their rendered content
  height and land side by side. Pass `--size WxH` only for fixed-viewport
  pages — it pins the frame and disables auto-fit.
- `--group <hint>` clusters related pages; `--single-doc` (only document
  you'll publish) opens it full-screen.

## 3. Demo recipes

**Slide deck / presentation** (the tester's main interest):

1. Write one HTML file per slide, designed at a fixed 16:9 viewport
   (`width: 1280px; height: 720px`, full-bleed).
2. Publish in deck order with a fixed size so slides stay uniform:
   ```bash
   plannotator canvas add slide-01.html --title "1 · Title" --size 1280x720 --group deck
   plannotator canvas add slide-02.html --title "2 · Problem" --size 1280x720 --group deck
   # …
   ```
3. Present: double-click the first slide → it fills the screen; the floating
   bar's ‹ › buttons flip between slides like pages (creation order); Esc
   exits; `0` zooms to fit the whole deck as a storyboard wall.
4. Feedback round: the user comments on slides (frame-level, or selecting
   text inside a slide) and hits Send; your `watch` receives the comments;
   revise the slide file and `canvas update <frameId> slide-02.html` — it
   updates live, in place.

**Documents / reports / explainers:** publish without `--size` — each page
lands at its natural content height, up to three side by side. "Tidy" in the
toolbar repacks the board masonry-style; "Fit" zooms to show everything.

**Interactive prototypes:** JS state (form input, scroll, counters) survives
pan/zoom and focus mode — iframes never reload except on `canvas update`.

## 4. UI cheat sheet (for the human)

- **Pan**: drag empty canvas (or space+drag, middle mouse). **Zoom**: scroll.
  **Fit**: `0` or the Fit button. **Tidy**: repack frames into a clean grid.
- **Click** a frame to interact with its content; **double-click** for
  full-screen focus (‹ › to flip, Esc to exit).
- **Select text inside a frame** → comment popover. **Comments** button (top
  right) opens the panel; "Send" / "Send all" deliver feedback to the agent
  instantly. "send now" on a single comment asks the agent for a *reply*
  (conversation) instead of a revision.
- After sending, a dot-wave above the frame means "awaiting the agent's
  revision". It expires after ~10 minutes if the agent never responds.
- The toast warns if feedback was sent while no agent is watching — it's
  still delivered to the next `canvas watch` that connects.
- **X** on a frame dismisses it (agent is notified, no action expected);
  **Close all** clears the board.

## 5. Operations & troubleshooting

- The canvas server is a machine-wide singleton on port **19434** (override:
  `PLANNOTATOR_CANVAS_PORT`; auto-bumps up to +10 on conflict). Discovery is
  via `~/.plannotator/canvas/server.json`, so always use `canvas open` rather
  than guessing URLs.
- Boards persist under `~/.plannotator/canvas/projects/` (frames, full
  revision history, comments, feedback log) and survive server restarts.
- `plannotator canvas stop` stops the server; any `canvas add` (or `canvas
  serve` in the foreground, for debugging) starts it again.
- `PLANNOTATOR_SKIP_BROWSER_OPEN=1` suppresses browser-opening (scripting/CI).
- `PLANNOTATOR_DATA_DIR=/some/dir` sandboxes all state (useful for a
  throwaway demo environment).
- If the UI looks stale after rebuilding, rebuild in the §1 order — the hook
  build bundles the canvas UI, so `build:canvas` must run before `build:hook`
  — then recompile the binary and `canvas stop` / re-add.

## 6. Feedback to the maintainer

This is a beta: when something breaks, capture the command you ran, the
`server.json` contents, and the board's `board.json` (under
`~/.plannotator/canvas/projects/<key>/`) and send them along with what you
expected to happen.
