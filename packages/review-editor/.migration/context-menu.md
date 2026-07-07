# context-menu

2026-07-07, transformation engine. Core product interaction (file-tree right-click). Typecheck/tests/build green.

## Changed

- `components/FileTreeNode.tsx:2` — `import * as ContextMenu from '@radix-ui/react-context-menu'` → `import { ContextMenu } from '@base-ui/react/context-menu'` (part names verified against `context-menu/index.parts.d.ts`: Base UI re-exports Menu's Positioner/Popup/Item under ContextMenu).
- Trigger `asChild` → `render={<button …/>}`; the file-row button keeps its `onClick` (select file) / `onDoubleClick` handlers — left-click behavior unchanged, right-click opens the menu.
- `Content` → `Portal > Positioner > Popup` (`z-50` on Positioner; no side/align props existed — context menus position at the pointer in both engines); animation classes → `transition-opacity data-starting-style:opacity-0 data-ending-style:opacity-0`.
- Items ×3 (Copy path / Copy filename / Copy full path): `onSelect` → `onClick`; `data-[highlighted]` classes unchanged (same attribute in Base UI).
- Leftover scan: clean.

## Left alone

- `FileRowBits` imports (ViewedControl, StageControl, …) — plain components, no Radix.
- `.file-tree-item` CSS — class-based, element unchanged (still a `<button>` via render).

## Behavior changes

- None identified beyond the shared family notes (collision defaults; exit fade now animates). Items close on click in both engines.

## Verify by hand

1. Right-click a file row → menu opens at the pointer.
2. "Copy path" / "Copy filename" / (with a local repo) "Copy full path" put the right strings on the clipboard and close the menu.
3. Left-click still selects the file; double-click still opens it; right-click does NOT select the file.
4. Arrow keys navigate the menu; Enter activates; Escape closes and the file tree keeps keyboard focus.
5. Right-click near the window bottom — menu flips above the pointer.
6. Open menu, left-click elsewhere — menu closes without selecting that row.
