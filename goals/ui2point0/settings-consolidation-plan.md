# Settings Consolidation — Migration Plan (vetted)

> Goal: ONE global, config-store-backed settings dialog (`AppSettingsDialog`). Delete the legacy
> monolith `packages/ui/components/Settings.tsx`. Embedded apps (plan + code-review) open the global
> dialog only — no app-local settings dialogs. One source of truth per setting.
>
> Produced + adversarially reviewed by the `settings-consolidation-plan` workflow (6 agents). 2026-05-30.

---

## The reassuring news

Most of this is **already done**. The map corrected our assumptions:
- `Settings.tsx` is ~1535 lines, already partly gutted. Diff/comments/labels/width/tater are **already on the config store**.
- The embedded apps **already route to the global dialog** (`onOpenSettings` → `appStore.setSettingsOpen`). The monolith's `<Settings>` mounts in the apps are **dead when embedded** (gated by `skipBuiltInSettings`/`externalOpenSettings`).
- The monolith stays alive for only **4 import sites** + one standalone consumer:
  1. `AppSettingsDialog` imports 3 tabs from it (`GitTab`, `ReviewDisplayTab`, `CommentsTab`).
  2. `DiffOptionsPopover` imports 5 option arrays from it.
  3. code-review `App.tsx` (dead-when-embedded mount).
  4. plan `AppHeader.tsx` (dead-when-embedded mount).
  5. **The portal** (`apps/portal`, share.plannotator.ai) — renders the standalone plan `<App/>` with **no `onOpenSettings`**, so the monolith is its **only** settings UI. ← the blocker nobody mapped.

## The two things the adversarial pass caught

- **🔴 Identity re-tag regression (the plan had called it "vestigial" — it's not).** `onIdentityChange` re-authors existing annotations (remaps `old→new` author) in both apps (code-review `App.tsx:1090`, plan `App.tsx:1340`). It reaches the user **only** through the monolith. The global dialog's `GeneralTab` doesn't pass `onIdentityChange`. Deleting the monolith silently breaks identity re-tagging in an open session. **Must add a unit to preserve it** (event/store subscription).
- **🟠 code-review's `aiProviders` is NOT settings-only.** It also drives the live in-page AI chat + sidebar (`App.tsx:547,2397`). Removal must **keep** the fetch+state; remove only the `<Settings aiProviders>` prop.

---

## Units (critical path: U1 → U2/3/4 → U5 → U9 → U8 → U10)

| # | Unit | Risk |
|---|---|---|
| U1 | Extract the diff-option constant arrays → `settings/diffOptions.ts`; repoint `DiffOptionsPopover` | low |
| U2 | Extract `GitTab` → `settings/ReviewGitTab.tsx` (config-store-only) | low |
| U3 | Extract `ReviewDisplayTab` → `settings/ReviewDisplayTab.tsx` (mind SegmentedControl/Toggle styling) | low-med |
| U4 | Extract `CommentsTab` → `settings/CommentsTab.tsx` | low |
| U5 | Repoint `AppSettingsDialog` to the new tabs → **dialog is now monolith-free** | low |
| U6 | Make the global dialog **mode-aware** (default tab by active session mode) — must actually call `setActiveTab` in the open effect | low |
| **U+** | **NEW (from review): preserve identity re-tag** — global dialog reaches the active session's store to remap annotation authors on identity change | med |
| U7 | code-review: delete the dead `<Settings>` mount + import; **keep `aiProviders` fetch/state** (it drives AI chat) | med |
| U8 | plan: delete the built-in `<Settings>` + `skipBuiltInSettings`/`mobileSettingsOpen` plumbing (keep `taterMode` state). **Gated on U9.** | med-high |
| U9 | **Portal settings path** (the hard precondition) — give `apps/portal` an alternative to the monolith, or drop portal settings | high |
| U10 | **DELETE `Settings.tsx`** — gate: grep shows zero importers + portal decoupled; full typecheck + build:hook + build:portal | med |
| U11 | Migrate `uiPreferences` toc/sticky → config store (closes the TOC/sticky live-update seam from the global dialog; also repoint `App.tsx:256` + `:204`) | med |
| U12 | Make config server-sync **deterministic** — route to `/daemon/config`, not the active session's narrower `/api/config` allowlist (silent-drop bug). **Hard gate before U13.** | med |
| U13 | *(optional, deferred)* migrate trivial stray settings (autoClose/permissionMode/theme…) into the config store. **Keep `agentSwitch` + `aiProvider` specialized.** `quickLabels` has wide blast radius. | med |

## Adversarial fixes folded in (must-do)
1. Add the **identity re-tag** unit (U+). 2. U7 **keeps** the aiProviders fetch. 3. U6 must actually `setActiveTab(default)` on open + read `bootstrap.session.mode`. 4. Tighten the dialog's `aiProviders` type to include `models?`. 5. U11 also repoints `App.tsx:256` (`useSidebar(getUIPreferences().tocEnabled)`) + the `lastAppliedTocEnabledRef`. 6. U12 is a **hard gate** before any new server-keyed setting.

## Decisions — LOCKED (2026-05-30)

1. **ONE universal dialog, no separate portal dialog.** `AppSettingsDialog` becomes *the* settings UI
   everywhere (frontend, portal, standalone). → **U9 is replaced**: move the dialog to a shared home
   (`packages/ui`) and make it **degrade gracefully without a daemon** — hide the daemon-only controls
   (AI providers, Hooks, git name, legacy-tab-mode) when no session/daemon is present; everything else
   works cookie-only. The portal renders this same dialog.
2. **The config store routes itself** (U12, elevated to core): server-keyed settings sync to the daemon
   when connected, cookie-only when not — one deterministic, daemon-aware pattern. No window-global
   ambiguity. This is the mechanism that makes #1 work.
3. **FULL migration** (U13 in scope): every setting moves to the config store as the source of truth;
   delete all the stray cookie util read/write surfaces. Keep `agentSwitch` + `aiProvider` as their own
   *clean* specialized modules (they're single-source already, not legacy) behind the store where it
   helps. `quickLabels` wide blast radius handled carefully (move all `getQuickLabels()` callers).
4. **Section UX:** default to the active session's relevant tab; keep all sections visible.

Execution: **sequential, verified phases** (not a parallel swarm — units chain + share `Settings.tsx`).
Verify each: typecheck + `build:hook` + `build:portal`.

---

*Full map + plan + review: workflow `w3xbd0psd`. 2026-05-30.*
