# Production Plan Header — Functionality Inventory

> Complete catalog of the production plan-review header's behavior, written **before** any
> reskin so nothing is lost. The reskin is a styling-layer swap only — **every item below must
> survive byte-for-byte in behavior.** Source files cited inline.
>
> Decision (2026-05-30): we **keep the "Options" dropdown** (`PlanHeaderMenu`) — it holds
> critical functionality the prototype lacks. We do **not** add the prototype's grid-view button.

---

## 0. Header shell — `packages/plannotator-plan-review/components/AppHeader.tsx`

- `<header>` — `h-12`, sticky `top-0 z-50`, `bg-card/50 backdrop-blur-xl`, `border-b border-border/50`. `React.memo`'d.
- **Left:** `headerLeft` slot (the shell's sidebar trigger is injected here) + **Logo** (`AppHeaderLogo`: "Plannotator" wordmark → https://plannotator.ai).
- **Right:** the action/toggle/menu cluster, gap `1`/`md:2`, with `w-px h-5 bg-border/50` dividers between groups (hidden on mobile).
- **Responsive rule throughout:** mobile = icon-only; `md+` = text labels. Must preserve.

---

## 1. App modes — the conditional button sets

The right cluster renders a **different button set per mode**. All conditions must be preserved exactly.

| Mode | Condition | Buttons shown |
|---|---|---|
| **Bot callback** | `callbackConfig && !isApiMode && isSharedSession` | divider · **Feedback** (→ bot) · **Approve** (notify bot) |
| **Goal setup** | `isApiMode && !submitted && !linkedDocIsActive && goalSetupMode` | **Exit** (close goal setup) · **Approve** (submit; label = `goalSetupSubmitLabel`, loading "Submitting…", mobile "Submit"; disabled unless `goalSetupCanSubmit`) · divider |
| **Annotate** | `isApiMode && !submitted && annotateMode` (within the shared branch) | **Exit** · (if `hasAnyAnnotations`) **Feedback** "Send Annotations" · (if `gate`) **Approve** "no changes requested" |
| **Normal plan review** | `isApiMode && !submitted && !annotateMode && !goalSetupMode` | **Feedback** "Send Feedback" · **Approve** (ApproveDropdown if OpenCode+agents, else ApproveButton + hover-warning) · divider |
| **After submit** | `submitted === true` | action buttons hidden (toggles + menu remain) |

Always-present (unless `goalSetupMode`): the **annotation panel toggle**, **AI chat toggle** (if `aiAvailable`), and the **Options menu**.

---

## 2. Action buttons — `packages/ui/components/ToolbarButtons.tsx`

Shared leaf components; AppHeader calls them ~8 ways. Preserve every prop + state.

- **`FeedbackButton`** — accent-tinted (`bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25`).
  Props: `onClick`, `disabled`, `isLoading`, `label` (default "Send Feedback"), `shortLabel`, `loadingLabel`, `shortLoadingLabel`, `title`, `muted`.
  States: normal / disabled / muted. Responsive labels: icon (mobile) → `shortLabel` (md) → `label` (lg). Loading swaps to loading label.
- **`ApproveButton`** — success/green (`bg-success text-success-foreground hover:opacity-90`).
  Props: `onClick`, `disabled`, `isLoading`, `label` ("Approve"), `loadingLabel`, `mobileLabel` ("OK"), `mobileLoadingLabel`, `title`, `dimmed`, `muted`.
  **`dimmed` state** = `bg-success/50 …/70` (used with the hover-warning below). Mobile shows `mobileLabel`/"OK".
- **`ExitButton`** — muted (`bg-muted text-muted-foreground hover:bg-muted/80`). "Close" / mobile "✕"; loading "Closing…"/"…".

### 2a. Approve hover-warning — `AppHeader.tsx:227-242` (KEEP)
For `origin === 'claude-code' || 'gemini-cli'` with `showAnnotationsWarning`, the Approve button is wrapped in `group/approve`; on hover a popover appears (`group-hover/approve:opacity-100`, with caret) reading *"{agentName} doesn't support feedback on approval. Your annotations won't be seen."* The button is also `dimmed`. Preserve the wrapper + popover + dimming.

---

## 3. Approve split-dropdown (OpenCode) — `packages/ui/components/ApproveDropdown.tsx`

Shown only when `origin === 'opencode' && !annotateMode && availableAgents.length > 0`. Replaces the plain Approve button.

- **Split button:** left = Approve (shows `Approve → {agentLabel}` when an agent switch is set; `(?)` if the saved agent isn't in the list), right = caret toggling the dropdown. Mobile = single "OK" button.
- **Dropdown:** "Switch to agent" section listing `agents` (checkmark on selected) + optional custom entry + "No switch".
- **Persistence:** `getAgentSwitchSettings` / `saveAgentSwitchSettings` (`utils/agentSwitch`) — `switchTo` ∈ agent id / `'custom'` / `'disabled'`, localStorage. Click-outside + Escape close.

---

## 4. Toggles (always present unless goal-setup)

- **Annotation panel toggle** (`AppHeader.tsx:251-265`) — raw button + inline "comment/panel" SVG. Active = `bg-primary/15 text-primary`; inactive = muted hover. Title toggles Show/Hide annotations.
- **AI chat toggle** (`:266-282`) — only if `aiAvailable`. `SparklesIcon`. Active = `bg-primary/15 text-primary`. **Unread dot** (`bg-primary`, top-right) when `aiHasMessages && !isAIChatOpen`.

---

## 5. Options menu — `packages/ui/components/PlanHeaderMenu.tsx` (the dense one — KEEP ALL)

Trigger: "Options" button (☰ / ✕ when open), `bg-muted` when open. **Update dot** on the trigger when `updateInfo.updateAvailable && !dismissed` (dismissed on open). Built on `ActionMenu`.

Menu contents, in order:
1. **Theme switcher** — segmented `light / dark / system` (icons Sun/Moon/System), via `useTheme()` (`setTheme`).
2. **Settings** → `onOpenSettings` (opens the Settings modal — see §6).
3. **Export** → `onOpenExport` (ExportModal).
4. **Agent Instructions** (if `agentInstructionsEnabled`) → `onCopyAgentInstructions` — "Copy agent instructions for external annotations".
5. **Download Annotations** → `onDownloadAnnotations`.
6. **Print / Save as PDF** → `onPrint` ("Choose 'Save as PDF' in the print dialog").
7. **Copy Share Link** (if `sharingEnabled`) → `onCopyShareLink`.
8. **Import Review** (if `sharingEnabled`) → `onOpenImport`.
9. **Version section** (`MenuVersionSection`) — `appVersion`, update-available state, `origin`, `isWSL`.

---

## 6. Settings modal — `packages/ui/components/Settings.tsx` + `settings/*Tab.tsx`

Opened from the Options menu. **11 tabs** (`SettingsTab` union): `general · theme · git · display · saving · labels · shortcuts · ai · files · comments · hooks`. Key contents:

- **general** (`GeneralTab`) — identity (Tater name), Tater mode, UI preferences.
- **theme** — color theme picker (~50 themes via `themeRegistry`), light/dark, **mono font** picker (Fira Code, JetBrains Mono, Hack, IBM Plex Mono, … "Theme Default").
- **git** — git user name.
- **display** (`PlanDisplayTab` / `PlanGeneralTab`) — plan rendering/display options; diff display (split/unified, scroll/wrap, indicator bars/classic/none, word-alt/word/char, line-bg intensity subtle/normal/strong) for review surfaces.
- **saving** (`SavingTab`) — plan-save enabled + custom path.
- **labels** (`LabelsTab`) — conventional-comment labels (suggestion[blocking], nit, question[blocking], …).
- **shortcuts** — keyboard shortcut reference.
- **ai** — AI providers + models (`aiProviders`).
- **files** (`FilesTab`) — file-linking options.
- **comments** — conventional comments config.
- **hooks** (`HooksTab`) — Plannotator Flavored Markdown reminder; Improvement Hook.

> The Settings modal is **shared** infrastructure; some tabs serve code review. The header's job is only to *open* it (`onOpenSettings`). Reskinning the header must not alter Settings.

---

## 7. What the reskin will change (band-1 styling only)

| Element | Reskin action | Preserve |
|---|---|---|
| Action buttons (Feedback/Approve/Exit) | → `Button` primitive (`accent`/`success`/ghost variants) | all props, states, responsive labels, loading |
| Approve hover-warning | restyle popover with tokens | the `group/approve` reveal + dimming |
| ApproveDropdown / PlanHeaderMenu | → `DropdownMenu` primitive (look only) | agent-switch persistence, **every menu item + gating**, theme switcher, version section, update dot |
| Toggles (panel / AI) | → ghost `Button` + lucide icons | active state, unread dot, `aiAvailable` gating, `SparklesIcon` branding |
| Logo | token alignment | the wordmark + link |

**Not added:** the prototype's grid-view button. **Not changed:** the Settings modal, any handler, any conditional/mode logic in `AppHeader`.

---

*Companion to `decisions.md`, `prototype-design-state.md`, `legacy-design-state.md`, `transfer-map.md`. 2026-05-30.*
