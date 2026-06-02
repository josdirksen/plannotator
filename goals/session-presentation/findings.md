# Session Presentation — silent CLI URL + browser-focus detection

Captured 2026-06-01. Two related gaps in how a freshly-created daemon session is
presented to the user. Neither is a bug in the binary — both are intentional
behaviors from the daemon refactor that don't match user expectation.

Context discovered while diagnosing "I ran `plannotator review` in my fullscreen
terminal, the CLI said nothing, and no browser tab opened — but the session
*did* get created (3 live sessions on the default daemon, port 59554)."

---

## Finding 1 — Silent CLI: session-creating commands print no URL locally

> Silent in your terminal today (these should print the URL):
>   - plannotator review
>   - plannotator annotate <file>
>   - plannotator annotate-last / last
>   - plannotator setup-goal
>   - plannotator copilot-plan / copilot-last
>
> All of these funnel through one function (runDaemonSessionRequest). Today it
> only prints a URL in remote mode — locally it says nothing. Fixing that one
> spot fixes all of them at once. The URL goes to stderr so it doesn't corrupt
> the feedback text that the slash command captures from stdout.

### Where it lives (dug context — do not lose)

- **The chokepoint:** `runDaemonSessionRequest()` in `apps/hook/server/index.ts:623`.
  Every interactive session command routes through it.
- **Why it's silent locally:** at `apps/hook/server/index.ts:655-659`, it only
  writes a human notice when `created.session.remoteShare` exists OR
  `daemon.state.isRemote`. In plain local mode neither is true → nothing is
  printed. It just blocks on `daemon.waitForResult()` (line 664) until the user
  finishes in the browser.
- **Why stderr, not stdout:** the command branches print the *result* (feedback
  text) to **stdout** via `console.log` — e.g. review at
  `apps/hook/server/index.ts:843` (`console.log(result.prompt ?? result.feedback ?? "")`).
  The Claude Code slash command captures that stdout via the `!` bang in
  `apps/hook/commands/plannotator-review.md`. A URL on stdout would corrupt the
  captured feedback. The existing remote notice already uses
  `process.stderr.write` (line 656/658) — follow that precedent.

### Command branches that create sessions (top-level dispatch in index.ts)

| Command | Branch line | Creates session via |
| --- | --- | --- |
| `plannotator review` | 825 | runDaemonSessionRequest |
| `plannotator annotate <file>` | 847 | runDaemonSessionRequest |
| `plannotator annotate-last` / `last` | 874 | runDaemonSessionRequest |
| `plannotator setup-goal` | 1016 | runDaemonSessionRequest |
| `plannotator copilot-plan` | 1065 | runDaemonSessionRequest |
| `plannotator copilot-last` | 1122 | runDaemonSessionRequest |
| `improve-context` (hook) | 1170 | runDaemonSessionRequest |

**Already fine — do NOT add a URL print to these:**
- **Plugin hosts** (`plugin plan|review|annotate|annotate-last`) go through
  `runDaemonBackedPluginRequest` → `runDaemonSessionRequest(req, { pluginError: true })`
  (index.ts:693-694) and already hand the URL to the host as JSON via
  `emitPluginSessionReady` (index.ts:660-662). OpenCode/Pi/etc. get it.
- **The plan hook** (Claude Code PermissionRequest) and **`improve-context`** are
  automated hooks: stdout is reserved protocol JSON and no human is watching the
  terminal. They should stay quiet. So the URL print must be gated to the genuine
  interactive commands, NOT applied blindly to every `runDaemonSessionRequest`
  caller. The `pluginError` flag distinguishes plugin callers; the hook callers
  need their own gate (e.g. an `announceUrl`/interactive opt-in flag).

### Fix shape (not yet implemented)

In `runDaemonSessionRequest`, after `created` is obtained and for the local,
interactive, non-plugin path, `process.stderr.write` a one-liner like:
`Review session ready → http://localhost:<port>/s/<id>`. One change covers all
six human commands. Gate it so hooks (`improve-context`, plan hook) stay silent.

---

## Finding 2 — Browser "is anyone watching?" detection is focus-blind

The daemon decides whether to open a NEW browser tab or stream the session into
an EXISTING tab based on whether a frontend reports itself "visible." That
visibility signal is `!document.hidden`, which is true whenever the tab is the
selected tab in a non-minimized window — **even if the browser is on another
macOS Space / behind the terminal / not the focused app.** So in a fullscreen
terminal, the browser (on its own Space) still says "I'm visible," the daemon
assumes the user is watching, and it drops the session into that off-screen tab
instead of opening a new one. User sees nothing.

> Short version: the browser hands JavaScript a built-in check —
> document.hasFocus(). It's true only when that browser window is the one your
> Mac is focused on. Fullscreen terminal focused → the browser page's
> hasFocus() is false. That's the signal we're missing.
>
> How it works in practice:
>
> Right now the page reports "am I visible?" as just !document.hidden (is this
> the active tab, not minimized). I add the focus check on top:
>
>   // before
>   client.sendClientState(!document.hidden, ...)
>
>   // after
>   client.sendClientState(!document.hidden && document.hasFocus(), ...)
>
> Then I wire it to fire the moment you switch apps, by listening to the
> window's focus and blur events (today it only listens to tab
> visibilitychange):
>
>   window.addEventListener("focus", handleChange);  // you clicked into the browser
>   window.addEventListener("blur",  handleChange);  // you clicked away to the terminal
>
> So the live flow becomes:
> - You're in your fullscreen terminal → browser fired blur a while ago → page
>   already told the daemon "not focused" → daemon sees nobody's watching →
>   opens a new tab.
> - You're looking at the browser → focus fired → page says "watching" → daemon
>   streams the session into that tab, no new window.
>
> It's a real, well-supported API built exactly for "is this window the one in
> front?" — not a hack.
>
> The one honest caveat, same as before: once this is on, if you're reading the
> browser and then click back to your terminal, the next review opens a new tab
> — because as far as the machine's concerned, you walked away from the browser.

### Where it lives (dug context — do not lose)

**Server side (the open-vs-stream decision):**
- `packages/server/daemon/runtime.ts:100` — `presentSession()`. The gate:
  ```js
  if (!config.legacyTabMode && frontendState.connected && frontendState.anyVisible) {
    // publish session-notify over WS → stream into existing tab
    return "notified";
  }
  // else openBrowser(url) → "opened"
  ```
- `packages/server/daemon/event-hub.ts:108-119` — `getFrontendState()`. `anyVisible`
  is true if ANY authenticated connection has `conn.tabVisible === true`.
- `packages/server/daemon/event-hub.ts:168-175` — the `client-state` WS message
  sets `connection.tabVisible = message.visible` (and `activeSessionId`).
- `tabVisible` defaults to `true` on connection open (event-hub.ts:143).

**Frontend side (the source of `visible`):**
- `apps/frontend/src/daemon/events/event-stream.ts:88-89` — `sendClientState()`
  calls `client.sendClientState(!document.hidden, currentActiveSessionId)`.
  **This is the line to change** to `!document.hidden && document.hasFocus()`.
- `apps/frontend/src/daemon/events/event-stream.ts:92-101` — `handleVisibilityChange`
  + the single `document.addEventListener("visibilitychange", ...)`. Need to ALSO
  add `window` `focus`/`blur` listeners and remove them in `stop()` (line 139-141).
- `apps/frontend/src/daemon/events/hub-client.ts:236-238` — `sendClientState(visible, activeSessionId)`
  emits `{ type: "client-state", visible, activeSessionId }`.

**Coupled behavior to re-check when changing the signal:**
- `event-stream.ts:95` and `event-stream.ts:110` — the `onSessionNotify` /
  `pendingNotifications` buffering ALSO gates on `!document.hidden` (a hidden tab
  buffers the notify toast until it becomes visible again). If "watching" now
  means focus too, these `!document.hidden` checks should likely move to the same
  combined `isWatching()` predicate so the toast logic stays consistent — i.e.
  factor out `const isWatching = () => !document.hidden && document.hasFocus()`
  and use it in all three spots.

### Alternative considered
`legacyTabMode: true` in `~/.plannotator/config.json` — always opens a new tab,
no smarts. Blunt fallback; keep as the escape hatch but the focus fix is the
real answer.

### Honest tradeoffs / open edge cases (for the recon dive)
- Click browser → click back to terminal → next session opens a new tab (you
  "walked away"). Arguably correct, but a behavior shift.
- Second monitor: browser focused on monitor 2 while you work on monitor 1 — the
  browser IS the focused window, so `hasFocus()` is true → streams into it (no
  new tab). Is that what we want? Probably fine.
- DevTools focused: in some browsers `document.hasFocus()` returns false when
  devtools has focus even though the page window is frontmost. Minor.
- Multiple tabs/connections: `anyVisible` is an OR across all connections. If you
  have two Plannotator tabs and one is focused, it still streams. Fine.
- Reliability: `document.hasFocus()` is a long-standing, well-supported API. Not
  a hack. Confirm no SSR/initial-load race where it's transiently false.

---

---

## Recon conclusions (2026-06-01)

### Blast radius is tightly contained — verified
- **Server:** `tabVisible` → `anyVisible` is read in exactly ONE place,
  `packages/server/daemon/runtime.ts:103` (`presentSession`). `getFrontendState`
  has exactly one caller (same line). So changing what `visible` *means* affects
  **only** the open-a-new-tab-vs-stream-into-existing decision. It does NOT touch
  WS event delivery, session routing, or anything else. (`allActiveSessionIds`,
  the other field, isn't even read by the caller.)
- **Frontend:** only THREE readers of `document.hidden`, all in
  `event-stream.ts` (lines 89, 95, 110). All three should be replaced by one
  shared predicate `const isWatching = () => !document.hidden && document.hasFocus()`.
- **VS Code extension:** does not use `client-state` / `hasFocus` / this WS path
  at all — separate code path, zero impact.

### Architecture facts that make the fix safe
- One daemon WS connection per browser tab, app-global via
  `useDaemonEvents` in `apps/frontend/src/app/Layout.tsx:41`. It persists across
  routes (dashboard ↔ `/s/:id`), so the focus signal is reported no matter which
  surface the tab is showing.
- `hub-client.sendClientState` (`hub-client.ts:236`) silently no-ops if the
  socket isn't OPEN. Focus/blur events fired mid-(re)connect are dropped, but the
  stream re-sends client-state on every WS `open` (`event-stream.ts:121-124`), so
  state self-heals on reconnect. Fine.
- Happy path is unchanged: when you ARE looking at the browser, `hasFocus()` is
  true and `document.hidden` is false → still streams into the tab. The new
  behavior only triggers when the browser is NOT the focused window.
- Why `hasFocus()` and not rely on `document.hidden` for Spaces: whether a
  browser reports `document.hidden=true` for a window on a non-active macOS Space
  is browser/OS-dependent and was empirically FALSE in the repro. `hasFocus()` is
  the deterministic "is this the frontmost window" signal.

### The one real product decision (burst tab-spam)
With the focus fix, every session launched from a fullscreen terminal opens a new
tab. Run 3 reviews back-to-back from the terminal → 3 tabs. That is the inverse
of the earlier "all 3 streamed into one tab" behavior. It matches the explicit
ask ("rather open a new tab than nothing"), but bursts could feel noisy. No clean
"focus-and-raise the existing background tab" option exists — browsers can't
reliably raise a tab on another Space from JS, and per-session URLs open new tabs
anyway. Decision to confirm with user, not silently pick.

### Recommended sequencing / value
1. **Finding 1 (print session URL to stderr) is the higher-value, zero-risk
   fix.** It's a safety net for ALL "session went somewhere I'm not looking"
   cases (second monitor, Spaces, focus edge cases) — you always get a clickable
   URL in the terminal. Ship this regardless.
2. **Finding 2 (focus detection) is the "do what I meant" nicety** with the one
   named tradeoff. Small, contained, safe to implement — but the burst-tab
   behavior is a judgment call worth a thumbs-up before building.

### Implementation sketch (when greenlit)
**Finding 1** — in `runDaemonSessionRequest` (`apps/hook/server/index.ts:623`),
after `created`, for the local non-remote non-plugin interactive path,
`process.stderr.write` a `<Mode> session ready → <url>` line. Gate so hooks
(`improve-context`, plan PermissionRequest) stay silent — add an opt-in flag set
by the genuine interactive command branches, or reuse the existing `pluginError`
distinction plus a new `announceUrl` flag.

**Finding 2** — in `event-stream.ts`:
```js
const isWatching = () => !document.hidden && document.hasFocus();
const sendClientState = () => client.sendClientState(isWatching(), currentActiveSessionId);
const handleChange = () => {
  if (stopped) return;
  sendClientState();
  if (isWatching() && pendingNotifications.length && options.onSessionNotify) {
    for (const n of pendingNotifications.splice(0)) options.onSessionNotify(n);
  }
};
document.addEventListener("visibilitychange", handleChange);
window.addEventListener("focus", handleChange);
window.addEventListener("blur", handleChange);
// line 110 guard also becomes isWatching()
// stop(): removeEventListener for all three
```

## Status — IMPLEMENTED & VERIFIED (2026-06-01)

Both fixes shipped on `feat/ui2-code-review`. Built clean (`build:hook` +
`--compile`), binary replaced at `~/.local/bin/plannotator`.

### Finding 1 — session URL print (done)
- `packages/shared/daemon-protocol.ts` — added `browserAction?: "opened" | "notified"`
  to `DaemonCreateSessionResponse` (server already sent it at runtime).
- `apps/hook/server/index.ts` — `runDaemonSessionRequest` options gained
  `announceUrl?: boolean`; when set (and local, non-remote), prints to **stderr**:
  `Plannotator <mode> session ready — <opened in your browser | sent to your open
  Plannotator window>:\n  <url>`. Gated ON via `{ announceUrl: true }` at the 6
  interactive call sites (review, annotate, annotate-last, setup-goal,
  copilot-plan, copilot-last). Codex/gemini/claude plan **hooks** (the two
  `action:"plan"` callers) and the plugin path stay silent.
- **Verified:** `plannotator review --git` prints the URL line to stderr,
  stdout stays empty (slash-command capture uncorrupted).

### Finding 2 — focus-aware "is anyone watching" (done)
- `apps/frontend/src/daemon/events/event-stream.ts` — added
  `isWatching = () => !document.hidden && document.hasFocus()`, replaced all three
  `document.hidden` reads with it, renamed `handleVisibilityChange` →
  `handleWatchChange`, added `window` `focus`/`blur` listeners (+ removal in
  `stop()`). Now a fullscreen terminal (browser unfocused / on another Space)
  reports not-watching → daemon opens a new tab.
- **Verify in browser** (user): launch a review from a fullscreen terminal with a
  Plannotator tab already open elsewhere → a new tab should open instead of the
  session silently streaming into the off-screen tab.

### Known tradeoff (accepted)
Reading the browser then clicking back to the terminal makes the next session
open a new tab. Burst of N terminal-launched reviews → N tabs. Escape hatch:
`legacyTabMode` unchanged.

---

## Research — why focus detection CANNOT fix fullscreen-Spaces (2026-06-01)

User repro that broke the focus fix: terminal fullscreen on its own Space, browser
fullscreen on its own Space. Launch from terminal while the active browser tab is
**Plannotator** → session silently streams into the off-screen tab (no new tab).
Launch while the browser is on **x.com** → works (new tab, browser comes forward).

Web research conclusion: **there is no portable, reliable web API for "is my
window on the active Space / in front" on macOS.** Specifically:

- **Page Visibility API is designed to flip `hidden` only on tab-switch and
  window-minimize** — "the page is the foreground tab of a non-minimized window."
  It is NOT specified to detect a window covered by another window or moved to a
  background Space/desktop. (MDN; web.dev pagevisibility-intro.)
- **The only mechanism meant to catch "on another desktop" is Chrome's Mac Window
  Occlusion** (chromium.org/developers/design-documents/mac-occlusion — an NSWindow
  checks if it is "not covered by other windows, or on another desktop"). But it is
  **Chrome-only, has latency, and has open bugs** — e.g. Chromium issue 342919175
  "document.visibilityState is always 'visible' on macOS …", and a Chrome 128 / M1
  report of `visibilitychange` not firing.
- **Firefox does NOT reflect occlusion** (`visibilityState` stays visible when
  overlaid — Mozilla bug 1712854). Safari likewise does not.
- **window focus/blur on Space-switch is unreliable** across browsers (Apple dev
  forums; general reports). The recommended "combine visibilitychange + focus/blur"
  advice (bobbyhadz, designcise) improves the overlapping-window case but does not
  solve cross-Space fullscreen.

Net: the `!document.hidden && document.hasFocus()` fix is a genuine improvement for
**overlapping windows on the same Space** (where blur is reliable), but it cannot
beat **fullscreen apps on separate Spaces** — the browser keeps reporting the tab
as visible+focused. Confirmed by elimination from the repro (the tab was connected
and reporting watching, else the daemon would have opened).

Hard constraint compounding it: **a background web page cannot raise its own
window/Space** (browser security). Only the OS `open <url>` brings the browser
forward — which is exactly why scenario A (no Plannotator tab claiming focus →
daemon calls `open`) surfaces the browser and scenario B (notify path) does not.

### Resolution (chosen)
Because reliable auto-detection is impossible cross-browser, the open-vs-stream
choice must be a **user preference**, not a heuristic. For the cross-Space
fullscreen workflow the correct setting is **`legacyTabMode: true`** — it bypasses
the `anyVisible` check entirely (`runtime.ts:103`) and always `openBrowser(url)`,
so every CLI launch brings the browser forward with a tab (same mechanism that
makes scenario A work). Set in `~/.plannotator/config.json`; `loadConfig()` reads
fresh per session so it is live immediately, no daemon restart.

Side effect (acceptable / arguably better for this workflow): sessions use the
full-screen auto-closing `CompletionOverlay` instead of the inline
`CompletionBanner`. Revert by removing `legacyTabMode` from config.

### Follow-up option (not yet done)
Consider flipping the product default so CLI-initiated sessions **open** unless the
user opts INTO dashboard-streaming — because the streaming default depends on a
signal the web platform can't reliably provide, and produces the "nothing
happened" confusion. Streaming only makes sense for users who keep the daemon
dashboard visible on a second monitor; that should be the opt-in, not the default.

### Sources
- MDN Page Visibility API — developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- web.dev — web.dev/articles/pagevisibility-intro
- Chromium Mac Window Occlusion design — chromium.org/developers/design-documents/mac-occlusion/
- Chromium issue 342919175 (visibilityState always 'visible' on macOS)
- Chrome community: visibilitychange not firing, Chrome 128 / M1
- Mozilla bug 1712854 (Firefox doesn't reflect occlusion)
- bobbyhadz / designcise (combine visibilitychange + focus/blur)

---

## FINAL DESIGN — daemon surfaces the browser (IMPLEMENTED 2026-06-01)

The web page can't raise its own window, and its visibility self-report is
unreliable across macOS Spaces. But the **daemon** can bring the browser forward
(`open`/`open -a`/`open -b` switch the OS to the app's Space — proven by the
working "browser on x.com" case). So we stop depending on the flaky "is it
visible?" signal and decide on the **reliable** one: "is a frontend connected?"

### The rule (in `presentSession`, `packages/server/daemon/runtime.ts`)
- `legacyTabMode` on → always open a new tab (unchanged; also drags in the
  full-screen `CompletionOverlay` — intentionally untouched here).
- **Local + a frontend is connected** → reuse that tab:
  1. `activateBrowser()` brings the browser's Space to the front.
  2. publish `session-notify`; the connected tab navigates itself to `/s/<id>`
     (`apps/frontend/.../use-daemon-events.ts:26`).
  3. If activation fails (e.g. unknown default browser) → fall through and open
     the session URL in a fresh tab. **Never "do nothing."**
- **Local + no frontend connected** → open the session URL (new tab + forward).
- **Remote** → unchanged: notify only when `anyVisible`, else open (prints the
  forwarded URL). We can't control a remote user's browser.
- **Always:** the CLI prints the session URL to stderr (Finding 1) as the backstop.

### Why this fixes the "no" case (browser already on the daemon URL, separate Space)
The connected tab already navigates to the new session on notify — it just sits
on a background Space unseen. The daemon now also **activates** the browser, so
the OS switches to that Space and the user lands on the session in the SAME tab.
No tab spam, never hanging.

### Browser activation (`activateBrowser()` in `packages/server/browser.ts`)
macOS only (Spaces concept). Brings the browser forward WITHOUT a URL:
- `PLANNOTATOR_BROWSER` = app name / `.app` → `open -a <app>`.
- `PLANNOTATOR_BROWSER` = raw executable path → returns false (no clean
  activate-only form) → caller opens the URL.
- Default browser → resolve the https handler bundle id from LaunchServices
  (`plutil -convert json` on `com.apple.launchservices.secure.plist`, cached) →
  `open -b <bundleId>`. Verified on this machine: `https → com.google.chrome`.
- Non-macOS → returns false (caller opens the URL; Spaces problem is macOS-only).

### Decoupled from legacyTabMode
This keeps the new inline `CompletionBanner`. The legacy full-screen overlay is
NOT involved. (legacyTabMode's full reach — daemon decision + completion-UI gates
in BOTH `plannotator-code-review/App.tsx` and `plannotator-plan-review/App.tsx`
(banner vs `CompletionOverlay`) + Settings→General toggle + getServerConfig
plumbing — is why it must stay separate.)

### Files changed
- `packages/server/browser.ts` — `activateBrowser()` + cached
  `getDefaultBrowserBundleId()`.
- `packages/server/daemon/runtime.ts` — `presentSession()` rewritten to the rule
  above; imports `activateBrowser`.

### Status: built, server typecheck clean, default daemon restarted. Needs the
user's eyeball on the real cross-Space repro (scenario B) — can't verify browser
activation from here without stealing focus.

### Open follow-up (not built)
A "quiet mode" opt-in for users who DON'T want focus stolen on every launch
(e.g. agent firing many reviews while they work) — backstopped by the URL print.
Default stays "surface."

---

## FIX 2 — the "active tab is something else" case (cnn.com) — 2026-06-01

First cut dropped the `anyVisible` check and activated+notified whenever a
frontend was *connected*. That broke this case:

- Browser has a Plannotator tab open, but the **active tab is cnn.com**; user in
  the terminal launches a command → daemon activates the browser (shows cnn.com),
  and the Plannotator tab navigated to the session **in the background, unseen**.

Root cause: I conflated two different questions.
- **"Is a Plannotator tab the FOREGROUND tab in its window?"** — `document.hidden`
  is reliable for this (it's the active-tab signal). → decides reuse vs new tab.
- **"Is the user's window in front (across Spaces)?"** — unreliable from JS; this
  is what `activateBrowser()` fixes from the daemon side.

These are independent. The correct logic uses BOTH:
- `connected && anyVisible` (a Plannotator tab IS the foreground tab) → reuse it:
  `activateBrowser()` (local) to bring its Space forward + `session-notify` (it
  navigates). The foreground tab is Plannotator, so the user lands on it.
- else (no tab, or the active tab is cnn.com) → `openBrowser(sessionUrl)`: a fresh
  **focused** tab. Navigating a *background* Plannotator tab would leave it unseen
  behind cnn.com, so we don't — a focused new tab is the only reliable surface
  without per-browser tab-activation scripting (AppleScript + TCC permission;
  deliberately avoided).

Also reverted the earlier `event-stream.ts` change: client-state now reports pure
`!document.hidden` again (foreground-tab signal), NOT `&& document.hasFocus()`.
Folding in hasFocus would falsely mark a foreground Plannotator tab as
not-visible when its window is on a background Space — costing a needless new tab
in case (b), which we just confirmed should *reuse* the tab. The focus/blur
listeners were removed too.

### Verified case matrix (local)
| State | anyVisible | Action | Result |
| --- | --- | --- | --- |
| No Plannotator tab | false | open URL | new focused tab ✓ |
| Plannotator IS active tab, bg Space (case b) | true | activate + notify | reused tab, brought forward ✓ |
| Plannotator is bg tab, cnn.com active (case c) | false | open URL | new focused session tab ✓ |
| Remote + visible | true | notify (no activate) | unchanged ✓ |
| Remote + not visible | false | open (prints URL) | unchanged ✓ |

Files: `packages/server/daemon/runtime.ts` (presentSession combines both signals),
`apps/frontend/src/daemon/events/event-stream.ts` (reverted to `!document.hidden`).
Built, both typechecks clean, default daemon restarted.

---

## FINAL (shipped) — always open a focused tab. SUPERSEDES the activate-browser design above.

Diagnostics on the real repro killed the reuse-and-activate approach. Ground truth
from `presentation-debug.log` (separate fullscreen Spaces, user on x.com, a
Plannotator window open elsewhere):

```
connected:true, anyVisible:true, connections:[ ... {tabVisible:true, activeSessionId:null} ]
→ branch "notified" + open -b com.google.chrome  → user still saw x.com
```

**Why reuse is unsalvageable:** `document.hidden` only means "I'm the active tab in
MY window." Every window has an active tab, and x.com is not a Plannotator page so
the daemon never sees it. A Plannotator window on its own Space therefore ALWAYS
reports `tabVisible:true`, regardless of which window/Space the user is actually
looking at. So `anyVisible` ≠ "the user is looking at Plannotator," and activating
the app (`open -b`) raises whichever Chrome window was last in front — often the
wrong one (x.com). No web signal distinguishes these cases.

**Shipped behavior:** for LOCAL sessions the daemon **always opens the session URL
in a focused tab** (`presentSession` → `openBrowser`). `open <url>` focuses the
session in the window the user is currently in — the same mechanism that already
worked when no Plannotator tab existed. Tab-per-session is the accepted cost.
Remote keeps the stream-into-visible-tab path. Confirmed acceptable by the user
("it just launches a new tab every time? I'm fine to simplify that way").

**Reverted / removed (dead-end reuse machinery):**
- `packages/server/browser.ts` — removed `activateBrowser()` + `getDefaultBrowserBundleId()`.
- `packages/server/daemon/runtime.ts` — `presentSession()` is now just "remote+visible
  → notify, else open"; removed activate call + all diagnostics/imports.
- `packages/server/daemon/event-hub.ts` — removed `debugConnections()`.
- `apps/frontend/.../event-stream.ts` — already reverted to pure `!document.hidden`.
- Deleted `~/.plannotator/presentation-debug.log`.

**Still in place (the keepers):** the CLI prints the session URL on every
interactive launch (Finding 1) — the real backstop. legacyTabMode untouched.

**Net diff that ships from this whole thread:** Finding 1 (URL print) + Opus 4.8
models + this one-line-of-intent presentSession ("always open locally"). Everything
about focus/visibility/activation detection was explored and discarded as
unworkable on macOS Spaces.

### Future opt-in (not built)
"Quiet/dashboard mode": for users who keep the daemon dashboard visible and DON'T
want a new tab per session — stream into the dashboard instead. Needs a real
setting; default stays "open a tab."
