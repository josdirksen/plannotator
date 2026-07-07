# dropdown-menu

2026-07-07, transformation engine. Radix DropdownMenu → Base UI Menu (renamed primitive). One file; typecheck clean.

## Changed

- `components/DiffTypePicker.tsx:2` — `import * as DropdownMenu from '@radix-ui/react-dropdown-menu'` → `import { Menu } from '@base-ui/react/menu'`; all parts renamed `DropdownMenu.*` → `Menu.*`.
- Trigger `asChild` → `render={<button …/>}` (spinner/chevron stay as Trigger children).
- `Content` → `Portal > Positioner > Popup`: `side`/`align`/`sideOffset` and `z-50` on Positioner; classes `min-w-[var(--radix-dropdown-menu-trigger-width)]` → `min-w-[var(--anchor-width)]`, `origin-[var(--radix-dropdown-menu-content-transform-origin)]` → `origin-[var(--transform-origin)]`, animate-in/out → `transition-opacity data-starting-style:opacity-0 data-ending-style:opacity-0`.
- Item `onSelect={() => onSelect(opt.id)}` → `onClick` (Base UI rename); `data-[highlighted]:bg-muted` unchanged (same attribute both engines). Items close the menu on click in both engines (Base `closeOnClick` defaults true).
- Leftover scan: clean.

## Left alone

- The `Tooltip` inside each item comes from `@plannotator/ui` (Radix-based, being migrated in parallel by another agent) — import and `delayDuration` prop untouched; the seam is that package's wrapper API, not a raw Radix surface. The `stopPropagation` handlers on the info icon still suppress item activation with `onClick` semantics.

## Behavior changes

- **Focus loop default flips**: Radix `loop` defaulted to false; Base UI `loopFocus` (on Root) defaults to true — ArrowDown past the last item now wraps to the first. Left at the Base UI default (idiomatic target), flagged here.
- Typeahead: both engines support it; Base matches on item text content (no `textValue` was used).

## Verify by hand

1. Open the diff-type dropdown (review header). Arrow keys walk options; past-the-end wraps (new).
2. Type the first letters of an option — typeahead highlights it.
3. Enter/click selects, menu closes, diff reloads.
4. Hover the ⓘ icon — tooltip shows without closing the menu; clicking ⓘ does not select the item.
5. Escape closes and returns focus to the trigger; menu min-width still matches the trigger width.
