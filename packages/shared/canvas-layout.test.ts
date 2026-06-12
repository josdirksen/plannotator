/**
 * Canvas grid layout tests.
 *
 * Run: bun test packages/shared/canvas-layout.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  gridColumns,
  nextGridSlot,
  layoutMasonry,
  resolveCollisions,
  GRID_GUTTER,
  GRID_MAX_COLS,
  type LayoutItem,
  type PlacedRect,
  type Rect,
} from "./canvas-layout";

describe("gridColumns", () => {
  test("small boards go side by side, then square-ish growth capped at GRID_MAX_COLS", () => {
    expect(gridColumns(1)).toBe(1);
    expect(gridColumns(2)).toBe(2);
    expect(gridColumns(3)).toBe(3); // pages side by side, one row
    expect(gridColumns(4)).toBe(2);
    expect(gridColumns(9)).toBe(3);
    expect(gridColumns(7)).toBe(3);
    expect(gridColumns(100)).toBe(GRID_MAX_COLS); // grows downward, not wider
  });
});

describe("nextGridSlot", () => {
  const SIZE = { width: 600, height: 450 };

  function place(n: number): Rect[] {
    const rects: Rect[] = [];
    for (let i = 0; i < n; i++) {
      const pos = nextGridSlot(rects, SIZE);
      rects.push({ ...pos, ...SIZE });
    }
    return rects;
  }

  test("wraps into rows instead of marching horizontally", () => {
    const rects = place(7); // 3 columns
    const cols = new Set(rects.map((r) => Math.round(r.x / 100))).size;
    const rows = new Set(rects.map((r) => Math.round(r.y / 100))).size;
    expect(cols).toBeLessThanOrEqual(3);
    expect(rows).toBeGreaterThanOrEqual(3);
  });

  test("never overlaps existing frames", () => {
    const rects = place(12);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlap =
          a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlap).toBe(false);
      }
    }
  });

  test("oversized frames still grid (no negative x, no column-0 stacking)", () => {
    const big = { width: 900, height: 600 }; // wider than GRID_CELL_W
    const rects: Rect[] = [];
    for (let i = 0; i < 4; i++) {
      const pos = nextGridSlot(rects, big);
      rects.push({ ...pos, ...big });
    }
    // Never bleeds into negative coordinates.
    expect(Math.min(...rects.map((r) => r.x))).toBeGreaterThanOrEqual(0);
    // Spreads across more than one column (2 cols for 4 frames).
    const cols = new Set(rects.map((r) => Math.round(r.x / 200))).size;
    expect(cols).toBeGreaterThanOrEqual(2);
    // And never overlaps.
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlap =
          a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlap).toBe(false);
      }
    }
  });

  test("fills a gap left by a removed frame before adding a new row", () => {
    const rects = place(4); // 2x2
    // Remove the second frame (a gap in row 0).
    const gap = rects[1];
    const remaining = rects.filter((_, i) => i !== 1);
    const slot = nextGridSlot(remaining, SIZE);
    // New frame should reclaim the gap, not extend past the existing extent.
    expect(slot.y).toBeCloseTo(gap.y, 0);
    expect(slot.x).toBeCloseTo(gap.x, 0);
  });
});

function anyOverlap(rects: Rect[]): boolean {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) {
        return true;
      }
    }
  }
  return false;
}

describe("layoutMasonry", () => {
  const items: LayoutItem[] = Array.from({ length: 6 }, (_, i) => ({
    id: `f${i}`,
    width: 600,
    height: 450,
  }));

  test("returns a position per item, no overlaps", () => {
    const map = layoutMasonry(items);
    expect(map.size).toBe(6);
    const rects = items.map((it) => ({ ...map.get(it.id)!, width: it.width, height: it.height }));
    const cols = new Set(rects.map((r) => Math.round(r.x / 100))).size;
    expect(cols).toBeLessThanOrEqual(3); // ceil(sqrt(6))=3
    expect(anyOverlap(rects)).toBe(false);
  });

  test("three pages land side by side, tops aligned", () => {
    const three: LayoutItem[] = [
      { id: "a", width: 600, height: 900 },
      { id: "b", width: 600, height: 1400 },
      { id: "c", width: 600, height: 700 },
    ];
    const map = layoutMasonry(three);
    const xs = new Set([map.get("a")!.x, map.get("b")!.x, map.get("c")!.x]);
    expect(xs.size).toBe(3); // three distinct columns
    expect(map.get("a")!.y).toBe(0);
    expect(map.get("b")!.y).toBe(0);
    expect(map.get("c")!.y).toBe(0);
  });

  test("variable heights pack without row whitespace (masonry, not row grid)", () => {
    const mixed: LayoutItem[] = [
      { id: "a", width: 400, height: 300 },
      { id: "b", width: 400, height: 700 }, // tall — column 1
      { id: "c", width: 400, height: 300 }, // shortest column is a's, not below b
      { id: "d", width: 400, height: 300 },
    ];
    const map = layoutMasonry(mixed, 2);
    const a = map.get("a")!;
    const c = map.get("c")!;
    // c stacks under a (short column), clearing only a's height + gutter —
    // a row grid would have pushed it below b's 700.
    expect(c.x).toBeCloseTo(a.x, 5);
    expect(c.y).toBe(300 + GRID_GUTTER);
    const rects = mixed.map((it) => ({ ...map.get(it.id)!, width: it.width, height: it.height }));
    expect(anyOverlap(rects)).toBe(false);
  });

  test("empty input yields empty map", () => {
    expect(layoutMasonry([]).size).toBe(0);
  });
});

describe("resolveCollisions", () => {
  test("growth pushes the frame below it down, cascading", () => {
    // Column of three frames; the first grows past the second.
    const frames: PlacedRect[] = [
      { id: "a", x: 0, y: 0, width: 600, height: 1200 }, // grew from 450
      { id: "b", x: 0, y: 500, width: 600, height: 450 },
      { id: "c", x: 0, y: 1000, width: 600, height: 450 },
    ];
    const moved = resolveCollisions(frames, "a");
    expect(moved.get("b")).toBe(1200 + GRID_GUTTER);
    // c is pushed in turn by b's new position.
    expect(moved.get("c")).toBe(1200 + GRID_GUTTER + 450 + GRID_GUTTER);
  });

  test("frames in other columns don't move", () => {
    const frames: PlacedRect[] = [
      { id: "a", x: 0, y: 0, width: 600, height: 1200 },
      { id: "side", x: 800, y: 0, width: 600, height: 450 },
      { id: "below", x: 0, y: 500, width: 600, height: 450 },
    ];
    const moved = resolveCollisions(frames, "a");
    expect(moved.has("side")).toBe(false);
    expect(moved.get("below")).toBe(1200 + GRID_GUTTER);
  });

  test("no overlap → no movement; unknown id → no movement", () => {
    const frames: PlacedRect[] = [
      { id: "a", x: 0, y: 0, width: 600, height: 450 },
      { id: "b", x: 0, y: 600, width: 600, height: 450 },
    ];
    expect(resolveCollisions(frames, "a").size).toBe(0);
    expect(resolveCollisions(frames, "nope").size).toBe(0);
  });

  test("result has no remaining overlaps", () => {
    const frames: PlacedRect[] = [
      { id: "a", x: 0, y: 0, width: 600, height: 2000 },
      { id: "b", x: 100, y: 300, width: 600, height: 450 },
      { id: "c", x: 200, y: 800, width: 600, height: 450 },
      { id: "d", x: 0, y: 1400, width: 600, height: 450 },
    ];
    const moved = resolveCollisions(frames, "a");
    const finalRects = frames.map((f) => ({ ...f, y: moved.get(f.id) ?? f.y }));
    expect(anyOverlap(finalRects)).toBe(false);
  });
});
