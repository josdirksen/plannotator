/**
 * Camera math tests.
 *
 * Run: bun test packages/canvas-editor/camera.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  clampZoom,
  zoomAt,
  pan,
  worldToScreen,
  screenToWorld,
  fitBounds,
  framesBounds,
  shouldMount,
  MIN_ZOOM,
  MAX_ZOOM,
} from "./camera";
import type { CanvasFrame } from "./types";

const frame = (x: number, y: number, w = 600, h = 450): CanvasFrame => ({
  id: "f",
  title: "f",
  x,
  y,
  width: w,
  height: h,
  revision: 1,
  status: "active",
  createdAt: 0,
  updatedAt: 0,
});

describe("zoomAt", () => {
  test("keeps the world point under the cursor fixed", () => {
    const camera = { x: 100, y: 50, z: 1 };
    const cursor = { x: 400, y: 300 };
    const before = screenToWorld(camera, cursor.x, cursor.y);
    const zoomed = zoomAt(camera, cursor.x, cursor.y, 2);
    const after = screenToWorld(zoomed, cursor.x, cursor.y);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(zoomed.z).toBe(2);
  });

  test("clamps to zoom range", () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
    expect(clampZoom(50)).toBe(MAX_ZOOM);
    expect(zoomAt({ x: 0, y: 0, z: 1 }, 0, 0, 100).z).toBe(MAX_ZOOM);
  });
});

describe("transforms", () => {
  test("worldToScreen / screenToWorld round-trip", () => {
    const camera = { x: -20, y: 35, z: 0.5 };
    const screen = worldToScreen(camera, 123, -456);
    const world = screenToWorld(camera, screen.x, screen.y);
    expect(world.x).toBeCloseTo(123);
    expect(world.y).toBeCloseTo(-456);
  });

  test("pan shifts in screen space", () => {
    const moved = pan({ x: 10, y: 10, z: 2 }, 5, -5);
    expect(moved).toEqual({ x: 15, y: 5, z: 2 });
  });
});

describe("fitBounds", () => {
  test("fits and centers content", () => {
    const bounds = framesBounds([frame(0, 0), frame(1000, 800)])!;
    const camera = fitBounds(bounds, 1200, 900);
    // All corners visible
    const tl = worldToScreen(camera, bounds.minX, bounds.minY);
    const br = worldToScreen(camera, bounds.maxX, bounds.maxY);
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(tl.y).toBeGreaterThanOrEqual(0);
    expect(br.x).toBeLessThanOrEqual(1200);
    expect(br.y).toBeLessThanOrEqual(900);
    // Centered horizontally
    expect(tl.x).toBeCloseTo(1200 - br.x, 4);
  });

  test("never zooms past 100%", () => {
    const camera = fitBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 2000, 2000);
    expect(camera.z).toBe(1);
  });

  test("empty board has null bounds", () => {
    expect(framesBounds([])).toBeNull();
  });
});

describe("shouldMount (culling)", () => {
  const viewport = { w: 1200, h: 900 };

  test("mounts frames in view at legible size", () => {
    expect(shouldMount({ x: 0, y: 0, z: 1 }, frame(100, 100), viewport.w, viewport.h)).toBe(true);
  });

  test("culls far-offscreen frames", () => {
    expect(shouldMount({ x: 0, y: 0, z: 1 }, frame(10000, 10000), viewport.w, viewport.h)).toBe(
      false,
    );
  });

  test("culls frames rendered too small", () => {
    // 600px-wide frame at 2% zoom = 12px on screen
    expect(shouldMount({ x: 0, y: 0, z: 0.02 }, frame(100, 100), viewport.w, viewport.h)).toBe(
      false,
    );
  });

  test("near-viewport margin keeps neighbors warm", () => {
    // Just right of the viewport, within half-viewport margin
    expect(shouldMount({ x: 0, y: 0, z: 1 }, frame(1300, 100), viewport.w, viewport.h)).toBe(true);
  });
});
