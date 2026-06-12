# Plannotator Canvas — Product Spec (adapted)

Status: **approved direction, implementation in progress** (branch `feat/canvas`).

This is the Plannotator adaptation of an externally-scoped, product-agnostic spec for an
"Agent-Connected HTML Canvas." The external spec assumed a hosted, multi-user product with
webhooks and auth. Plannotator is a local, single-user, agent-in-the-loop tool — so several
of its mechanisms are deliberately replaced with Plannotator-native ones. Every divergence
is recorded here. Where this document is silent, the external spec's intent governs; where
the codebase has an established pattern, the codebase wins.

---

## 1. Product summary

A long-running, local **canvas** application where terminal coding agents (Pi, OpenCode,
Amp, Codex, Droid, Kiro, Claude Code — anything that can run bash) publish small live HTML
previews ("**frames**") for the user to see in a browser, arrange spatially, comment on,
and send feedback back to the agent — while the agent keeps working.

The loop:

1. Agent writes an HTML file, runs `plannotator canvas add page.html --title "Login v2"`.
2. The frame appears live on that **project's** board within ~1s (SSE push).
3. User pans/zooms, opens frames in focus mode, interacts with them (scroll/click/JS all
   work), leaves frame comments and **in-frame text annotations**.
4. User clicks "Send feedback." The agent — which backgrounded
   `plannotator canvas watch --json` — receives a structured NDJSON event on stdout and
   iterates with `plannotator canvas update <frameId> page.html`.

## 2. Decisions made (PO record)

| Decision | Choice | Rationale |
|---|---|---|
| Feedback transport | **Stream, not blocking, not webhooks.** `canvas watch` emits NDJSON feedback events to stdout; agents background it and read output. `canvas feedback --since` exists for pure pollers. | The canvas is long-running; the agent must keep producing frames while monitoring feedback. Terminal agents can background a CLI and tail its output; they cannot run HTTP listeners. Webhooks (`callback_url`) are dropped entirely. |
| Scoping | **One server, project-scoped boards.** Each project directory (git repo name or cwd, via existing `detectProjectName()`) gets its own board. UI shows a flat project list in a left sidebar. | Multiple agents in different working directories submit to one surface without collisions. |
| Sidebar pattern | Implement per `/Users/ramos/work/feat-single-server-runtime/SIDEBAR-HANDOFF.md` (unshipped worktree). **Read that file in full before building the shell — not earlier.** Hard constraints from the owner: flat project list, most recent first, **no file tree**, and the hover-to-pop-out mechanism implemented the same way, so the canvas dominates the viewport. | The pattern was already designed elegantly there; don't reinvent. |
| Persistence | **Project-persistent.** Boards (frames, layout, comments, feedback log, revisions) live under `~/.plannotator/canvas/` and survive server restarts. | Agents iterate across sessions; matches plan-history precedent. |
| Viewport engine | **Hand-rolled, zero new runtime deps.** No tldraw (license), no React Flow. | The mandated two-layer architecture leaves a library managing only the chrome layer; syncing two camera systems is worse than ~300 lines of owned math. Single-file HTML bundle stays lean. Plannotator already hand-rolls comparable complexity (bridge script, highlighter). |
| v1 integrations | **CLI + core skill only.** No OpenCode/Pi native command interception in v1 (the CLI already works inside both). | Smallest surface that works everywhere on day one. |
| Frame rendering | `sandbox="allow-scripts"` srcdoc iframes — the exact security model of the existing `HtmlViewer` (`packages/ui/components/html-viewer/`). No `allow-same-origin`, ever. Raw HTML unsanitized; the opaque-origin sandbox is the boundary. | Proven in-product pattern; frames must run JS to be useful previews. |
| In-frame commenting | Reuse the existing **bridge-script / useHtmlAnnotation** machinery so users can select text *inside* a frame and comment on it, exactly like `annotate --render-html`. Anchoring is `originalText`-based, as everywhere else in the product. | This is the feature that makes the canvas Plannotator rather than a Figma clone: agents receive verbatim-text-anchored feedback they already know how to act on. |
| Frame HTML editing in UI | Out of scope (per external spec §3). Iteration happens through the agent. | — |
| Multiplayer/presence | Out of scope. Single user, multiple agent producers. SSE keeps multiple open tabs consistent; last-write-wins on geometry. | Local tool. |

## 3. Architecture

### 3.1 Server (`packages/server/canvas.ts`)

A long-running Bun server, **singleton** across the machine:

- Registry file `~/.plannotator/canvas/server.json` → `{ port, pid, startedAt }`.
  Liveness = pid check + `GET /api/canvas/health`. Stale registry is overwritten.
- Port: `PLANNOTATOR_CANVAS_PORT` if set; else **19434** (plan remote = 19432,
  paste = 19433). Discovery for CLI/agents is via the registry file, not the port.
- `plannotator canvas add` auto-starts the server **detached** if not running
  (spawn self with `canvas serve`, unref), waits for health, then POSTs.
- Serves the built single-file `canvas.html` UI at `/`.

### 3.2 Storage (`packages/shared/canvas-store.ts`, node:fs only)

```
~/.plannotator/canvas/
├── server.json                          # singleton registry
└── projects/{key}/                      # key = sanitized project name + 8-char path hash
    ├── board.json                       # { project, root, frames[], comments[], seq, updatedAt }
    ├── frames/{frameId}/{rev}.html      # full revision history of frame HTML
    └── feedback.ndjson                  # append-only dispatched-feedback event log
```

Runtime-agnostic like `storage.ts`/`draft.ts` (the Pi server copies shared files at build
time; canvas is Bun-only in v1 but the store must not assume Bun).

### 3.3 Data model

```ts
interface CanvasFrame {
  id: string;                 // "frm-" + ts36 + seq36
  title: string;
  x: number; y: number; width: number; height: number;   // canvas coords
  revision: number;           // increments on HTML update; geometry moves don't bump it
  sessionId?: string;         // opaque agent-supplied provenance
  groupHint?: string;         // provenance hint (reserved; placement is grid-based)
  sourcePath?: string;        // original file path from `canvas add`
  status: "active" | "archived";
  createdAt: number; updatedAt: number;
}

interface CanvasComment {
  id: string;
  frameId: string;
  body: string;
  author?: string;            // existing identity util
  selection?: { originalText: string };  // present for in-frame text annotations (bridge)
  frameRevision: number;      // revision the comment was made against
  resolved: boolean;
  dispatchedAt?: number;      // set when included in a feedback dispatch
  createdAt: number;
}
```

### 3.4 HTTP API (canvas server)

Conventions follow the external-annotations endpoints (SSE + `?since` versioned snapshot
fallback).

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/canvas/health` | GET | Liveness `{ ok, canvas, pid }` (pid must match the registry) |
| `/api/canvas/projects` | GET | Boards, most recently updated first |
| `/api/canvas/board` | GET | Board snapshot (`?project=key`) |
| `/api/canvas/frames` | POST | Create frame `{ projectRoot, html, title?, sessionId?, suggestedSize?, groupHint? }` → `{ frameId, projectKey, url }`. Auto-placement, broadcasts. |
| `/api/canvas/frames/:id` | PATCH | `{ html? }` → new revision (the one legitimate iframe reload); `{ x,y,width,height }` → geometry (no revision bump); `{ title?, status? }` |
| `/api/canvas/frames/:id/html` | GET | Frame HTML (`?rev=n`, default latest) — UI fetches then renders via srcdoc |
| `/api/canvas/frames/:id/comments` | GET/POST | List / add comments |
| `/api/canvas/comments/:id` | PATCH/DELETE | Resolve/unresolve/edit / remove |
| `/api/canvas/frames/:id/dispatch` | POST | Bundle unresolved (or listed) comments → append `frame.feedback` event to project log, mark comments dispatched, broadcast |
| `/api/canvas/projects/:key/dispatch` | POST | Send-all-unresolved for the board |
| `/api/canvas/stream` | GET | SSE for the UI: `frame.created/updated/moved/archived`, `comment.*`, `feedback.dispatched` |
| `/api/canvas/feedback/stream?project=` | GET | SSE for `canvas watch`: replays `?since`, then live `frame.feedback` events |
| `/api/canvas/shutdown` | POST | Graceful stop (used by `canvas stop`) |

Limits: HTML ≤ 5MB per frame, comment bodies ≤ 20k chars, selection anchors ≤ 2k chars,
standard JSON error envelopes. Localhost-only bind (same as all Plannotator servers).

**Hardening (beyond the other Plannotator servers).** Because this server is long-running
on a guessable fixed port — the exact profile DNS-rebinding/drive-by attacks target,
unlike the ephemeral random-port servers — it additionally: rejects requests whose `Host`
header is not loopback (skipped in remote sessions); validates `projectKey` URL params
against the generated `name-8hex` shape (no path traversal into the data dir); pid-checks
the registry on discovery; defers to an existing healthy server instead of overwriting the
registry on a cold-start race; and cleans up SSE subscribers on `req.signal` abort.

**Threat-model note.** Frame HTML is untrusted: it runs sandboxed (opaque origin, no
cookies/storage/top-navigation) and is never served as `text/html` on the app origin. A
frame *can* choose what text the bridge reports for an in-frame selection — the popover
shows the user that text before submitting, but on multi-agent boards, anchored text in
dispatched feedback ultimately originates from the frame's author. Comment bodies are
user-typed.

**Known limitation (v1).** While keyboard focus is inside a focused frame's iframe, Esc
doesn't reach the app (sandboxed document holds the keydown); use the focus bar's Exit
button or click outside the frame first. Forwarding Esc through the shared bridge script
is a cross-surface change deferred from v1.

### 3.5 CLI (`apps/hook/server/index.ts`, `canvas` subcommand family)

```
plannotator canvas                      # ensure server, open browser to this project's board
plannotator canvas add <file.html> [--title T] [--session ID] [--size WxH] [--group G]
                                        # auto-start server; prints {"frameId","url"} JSON
plannotator canvas update <frameId> <file.html>   # new revision, position preserved
plannotator canvas watch [--json]       # NDJSON feedback stream for cwd's project (agent backgrounds this)
plannotator canvas feedback [--since TS] [--json]  # pull snapshot of feedback events
plannotator canvas list                 # frames for cwd's project
plannotator canvas stop                 # stop the server
```

`PLANNOTATOR_CWD` respected for project detection, as in annotate.

### 3.6 Feedback event (what the agent receives)

One NDJSON line per dispatch on `canvas watch` stdout:

```json
{
  "event": "frame.feedback",
  "frameId": "frm-...", "title": "Login v2", "revision": 3,
  "sessionId": "...", "dispatchedAt": "ISO-8601",
  "comments": [
    { "id": "...", "body": "Make the CTA primary-colored",
      "selection": { "originalText": "Sign in with email" },
      "author": "ramos", "createdAt": "ISO-8601" }
  ],
  "feedbackMarkdown": "# Frame Feedback: Login v2 (rev 3)\n\n## 1. Feedback on: \"Sign in with email\"\n> Make the CTA primary-colored\n..."
}
```

`feedbackMarkdown` is the human/agent-readable rendering in the established
`exportAnnotations` voice, so agents can act without parsing the structured fields.
With `--json` omitted, `watch` prints only `feedbackMarkdown` blocks separated by `---`.

### 3.7 UI (`packages/canvas-editor/` + `apps/canvas/` build host)

Mirrors the `packages/review-editor` / `apps/review` pairing: vite single-file build →
`canvas.html`, copied into the hook build. Tailwind v4 with **`@source` entries for every
new directory** (CLAUDE.md rule). Theme from `packages/ui/theme.css`; shortcuts as a new
`packages/ui/shortcuts/canvas/` scope folder + `packages/canvas-editor/shortcuts.ts`
surface (auto-feeds the marketing docs page).

**Shell**: left sidebar of projects — implemented per SIDEBAR-HANDOFF.md (see §2).

**Two-layer viewport (mandated):**

1. **Chrome layer** — single CSS-transformed container (`translate(panX,panY) scale(z)`),
   holding frame title bars, selection outlines, comment pins, marquee, and placeholder
   rects. Camera state lives in a ref; transforms applied imperatively in rAF (no React
   re-render per gesture frame).
2. **Content layer** — untransformed sibling. Each mounted frame's iframe sits in an
   absolutely positioned wrapper at `screenX = x*z + panX` etc. Iframes never move in the
   DOM ⇒ never reload.

Camera: pan via space+drag / middle-mouse / two-finger scroll; zoom via pinch +
ctrl/cmd-wheel, cursor-centered (`pan' = cursor − (cursor − pan)·(z'/z)`); range 2%–400%;
`0` zoom-to-fit, `1` zoom-100%, `+`/`−` steps; Esc per focus rules. 60fps target @ 25
frames.

Frames: drag by title bar, resize handles, click select / shift multi / marquee.
**Activation model** for iframe interaction: inactive frames carry a pointer-events
overlay (pan/zoom always wins); single click activates (outline), click-away deactivates;
all overlays force-inert during any gesture.

**Focus mode** (hard requirements): style-only change on the content-layer wrapper
(animate to `inset:0`, elevated z, dim canvas behind; ~250ms; `prefers-reduced-motion` →
instant). No unmount/remount/re-parent ⇒ zero state loss. Esc or close exits, restoring
the prior camera. Focused bar: title, comment, send-feedback, prev/next frame (by canvas
position), exit. Verified with a test page holding scroll position + form field + JS
counter.

**Culling**: mount live iframes only when near viewport AND on-screen width ≥ ~150px, with
~300ms hysteresis; placeholder (chrome + neutral pattern, v1 — no screenshots) otherwise.
Active/focused frames always mounted; small LRU (≈6) keeps recently-interacted frames
alive.

**Arrival**: auto-place new frames into a roughly-square grid that wraps to new
rows downward (≤3 frames get one column each — pages side by side — then
column count = `ceil(sqrt(n))` capped at 6, so beyond a screenful it grows
taller rather than wider — never an endless horizontal strip). Gaps left by
closed frames are reclaimed first. Shared layout math
(`packages/shared/canvas-layout.ts`) is reused by the **Tidy** action, which
reflows the whole board into a masonry layout (shortest-column packing) in one
server-side commit (`POST /api/canvas/projects/:key/arrange` →
`board.arranged` SSE). Subtle toast with "jump to frame" on arrival.

**Auto-fit height**: the injected bridge measures rendered content height (on
load + debounced ResizeObserver) and posts `resize`; the UI grows/shrinks the
frame to fit (clamped 160–2400px) via `PATCH { height, sizedBy: "auto" }`. The
server pushes newly-overlapped neighbors straight down (`resolveCollisions`,
cascading, one commit) and broadcasts `board.arranged` when neighbors moved.
`sizedBy` tracks size ownership: `auto` (default — keep fitting), `agent`
(`--size` given — fixed viewport, never fitted), `user` (manual resize —
pinned, never fitted again). Reports from a focused frame are ignored (its
iframe is viewport-width; the measurement is meaningless for board geometry).

**Comments**: pins on chrome layer (collapse to counts when zoomed out), panel for the
selected frame (resolve / dispatched states), frame-level comment affordance in chrome +
focus bar, in-frame text annotation via bridge (focus mode and activated frames).
Dispatch confirm shows exactly what will be sent; failures surfaced with retry.

### 3.8 Skill (`apps/skills/core/plannotator-canvas/`)

Teaches the agent the loop: write HTML file → `canvas add` → background
`canvas watch --json` (e.g. `run_in_background` / `&` + log monitoring) → on each
`frame.feedback` event, revise and `canvas update`. Includes the dismissal/no-feedback
semantics and a note that `add` prints the frame's deep-link URL.

## 4. Acceptance criteria (adapted)

1. `canvas add` from a cold start (no server) → frame visible live in a freshly opened
   browser within ~2s; subsequent adds appear via SSE without reload, auto-placed without
   overlap.
2. 25+ frames: smooth pan/zoom on a mid-range laptop; offscreen frames hold no iframe.
3. Scroll/fill-form/increment-counter inside a frame → focus → identical state → exit →
   state and prior camera intact.
4. Focus transitions animate; reduced-motion respected.
5. Pan/zoom works over frame content; one click activates a frame for interaction.
6. Frame JS cannot read app cookies/localStorage or navigate top (sandbox test).
7. Comment → dispatch → backgrounded `canvas watch --json` receives the documented event;
   comments flip to dispatched; failures visible and retryable.
8. `canvas update` preserves position, bumps revision, reloads that one iframe.
9. Zero new runtime dependencies beyond what the repo already ships (MIT/Apache/BSD only).
10. Two projects in different directories produce two sidebar entries, most recent first.

## 5. Out of scope (v1)

Vector tools, edges, HTML editing in UI, screenshots/thumbnails (placeholder-only),
webhooks, OpenCode/Pi native plugin commands, presence/multi-user, mobile editing
(pinch/pan should still work), remote-session share links for canvas.
