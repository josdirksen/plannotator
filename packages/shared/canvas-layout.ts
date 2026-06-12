/**
 * Canvas grid layout — pure geometry, no fs/Bun deps so it is safe to import
 * from both the server store and the browser bundle.
 *
 * New frames flow into a roughly-square grid that wraps to new rows downward
 * rather than marching off to the right forever. The column count grows with
 * the frame count up to a cap, after which the board only grows taller — i.e.
 * "prefer a grid, then keep going down if it grows beyond."
 */

export const GRID_GUTTER = 48;
/** Max columns before the grid stops widening and only grows downward. */
export const GRID_MAX_COLS = 6;
/** Fixed cell step for incremental placement (future frame sizes unknown).
 *  Generous enough that typical previews center without overlapping. */
export const GRID_CELL_W = 760;
export const GRID_CELL_H = 580;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutItem {
  id: string;
  width: number;
  height: number;
}

/**
 * Column count for `count` frames. Small boards (≤3) get one frame per column
 * — pages side by side, like sheets pinned to a wall — then square-ish growth
 * capped so larger boards wrap downward.
 */
export function gridColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 3) return count;
  return Math.min(GRID_MAX_COLS, Math.ceil(Math.sqrt(count)));
}

function overlaps(a: Rect, others: Rect[], gutter: number): boolean {
  return others.some(
    (b) =>
      a.x < b.x + b.width + gutter &&
      a.x + a.width + gutter > b.x &&
      a.y < b.y + b.height + gutter &&
      a.y + a.height + gutter > b.y,
  );
}

/**
 * Pick the position for ONE new frame: scan grid cells in row-major order and
 * place it centered in the first cell whose rect doesn't overlap an existing
 * frame. Fills gaps left by closed frames, so the board stays compact.
 */
export function nextGridSlot(
  existing: Rect[],
  size: { width: number; height: number },
  cols = gridColumns(existing.length + 1),
): { x: number; y: number } {
  const columns = Math.max(1, cols);
  // Frames larger than the standard cell get a per-call cell sized to fit —
  // a fixed 760px step would center a 900px frame at negative x and make
  // every neighboring column collide, stacking all oversized frames into
  // column 0. Normal-size frames keep the standard lattice.
  const cellW = Math.max(GRID_CELL_W, size.width + GRID_GUTTER);
  const cellH = Math.max(GRID_CELL_H, size.height + GRID_GUTTER);
  for (let row = 0; row < existing.length + 2; row++) {
    for (let col = 0; col < columns; col++) {
      const x = col * cellW + (cellW - size.width) / 2;
      const y = row * cellH + (cellH - size.height) / 2;
      if (!overlaps({ x, y, ...size }, existing, GRID_GUTTER)) {
        return { x, y };
      }
    }
  }
  // Fallback (shouldn't hit): below everything in column 0.
  const bottom = existing.length ? Math.max(...existing.map((r) => r.y + r.height)) : 0;
  return { x: (cellW - size.width) / 2, y: bottom + cellH };
}

/**
 * Reflow ALL frames into a masonry layout (used by "Tidy"). Uniform column
 * width (= widest frame); each frame, in the given order, drops into the
 * currently-shortest column. With auto-fit content heights this packs
 * variable-height frames with no row whitespace — unlike a row grid, where one
 * tall frame opens a void next to its neighbors. Tops align across columns on
 * the first row, so small boards read as pages side by side.
 * Returns id → { x, y }.
 */
export function layoutMasonry(
  items: LayoutItem[],
  cols = gridColumns(items.length),
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (items.length === 0) return result;

  const columns = Math.max(1, cols);
  const colWidth = Math.max(...items.map((i) => i.width)) + GRID_GUTTER;
  const bottoms = new Array<number>(columns).fill(0);

  for (const item of items) {
    // Shortest column; ties resolve leftmost so the first row fills in order.
    let col = 0;
    for (let c = 1; c < columns; c++) {
      if (bottoms[c] < bottoms[col]) col = c;
    }
    const x = col * colWidth + (colWidth - GRID_GUTTER - item.width) / 2;
    result.set(item.id, { x, y: bottoms[col] });
    bottoms[col] += item.height + GRID_GUTTER;
  }

  return result;
}

export interface PlacedRect extends Rect {
  id: string;
}

/**
 * Resolve overlaps after one frame grew (auto-fit height): push every frame it
 * now overlaps straight down until it clears, then cascade — a pushed frame
 * may collide with the one below it, which is pushed in turn. Only `y` ever
 * changes and only downward, so the cascade terminates. The changed frame
 * itself never moves. Returns id → new y for frames that moved.
 */
export function resolveCollisions(
  frames: PlacedRect[],
  changedId: string,
  gutter = GRID_GUTTER,
): Map<string, number> {
  const moved = new Map<string, number>();
  const rects = new Map(frames.map((f) => [f.id, { ...f }]));
  const changed = rects.get(changedId);
  if (!changed) return moved;

  // Push budget: the cascade only ever moves frames downward so it should
  // always settle, but this runs in the server's request path — a hard cap
  // turns any unforeseen geometry into a benign partial reflow, not a hang.
  let budget = frames.length * frames.length + frames.length;
  const queue: PlacedRect[] = [changed];
  while (queue.length > 0 && budget-- > 0) {
    const pusher = queue.shift()!;
    // Process top-down so a frame is pushed by its nearest blocker first.
    const others = [...rects.values()].sort((a, b) => a.y - b.y);
    for (const other of others) {
      if (other.id === pusher.id || other.id === changedId) continue;
      const intersects =
        pusher.x < other.x + other.width &&
        pusher.x + pusher.width > other.x &&
        pusher.y < other.y + other.height &&
        pusher.y + pusher.height > other.y;
      if (!intersects) continue;
      const newY = pusher.y + pusher.height + gutter;
      if (newY <= other.y) continue;
      other.y = newY;
      moved.set(other.id, newY);
      queue.push(other);
    }
  }
  return moved;
}
