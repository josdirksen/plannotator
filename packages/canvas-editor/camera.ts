/**
 * Camera math for the canvas viewport. Pure functions — no DOM.
 *
 * World→screen: `screenX = worldX * z + x` (and same for y).
 * The camera pans in screen pixels and zooms about arbitrary screen points.
 */

import type { Camera, CanvasFrame } from "./types";

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 4;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * Zoom about a screen-space point so the world point under the cursor stays
 * under the cursor: `pan' = cursor - (cursor - pan) * (z'/z)`.
 */
export function zoomAt(camera: Camera, screenX: number, screenY: number, nextZ: number): Camera {
  const z = clampZoom(nextZ);
  const ratio = z / camera.z;
  return {
    x: screenX - (screenX - camera.x) * ratio,
    y: screenY - (screenY - camera.y) * ratio,
    z,
  };
}

/** Multiplicative zoom step (wheel ticks, +/- keys). */
export function zoomBy(camera: Camera, screenX: number, screenY: number, factor: number): Camera {
  return zoomAt(camera, screenX, screenY, camera.z * factor);
}

export function pan(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx, y: camera.y + dy };
}

export function worldToScreen(camera: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * camera.z + camera.x, y: wy * camera.z + camera.y };
}

export function screenToWorld(camera: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - camera.x) / camera.z, y: (sy - camera.y) / camera.z };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function framesBounds(frames: CanvasFrame[]): Bounds | null {
  const active = frames.filter((f) => f.status === "active");
  if (active.length === 0) return null;
  return {
    minX: Math.min(...active.map((f) => f.x)),
    minY: Math.min(...active.map((f) => f.y)),
    maxX: Math.max(...active.map((f) => f.x + f.width)),
    maxY: Math.max(...active.map((f) => f.y + f.height)),
  };
}

/**
 * Camera that fits `bounds` inside a viewport with padding, centered.
 * Zoom is clamped to [MIN_ZOOM, 1] — fitting never zooms past 100%.
 */
export function fitBounds(
  bounds: Bounds,
  viewportW: number,
  viewportH: number,
  padding = 64,
): Camera {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const z = clampZoom(
    Math.min((viewportW - padding * 2) / w, (viewportH - padding * 2) / h, 1),
  );
  return {
    x: (viewportW - w * z) / 2 - bounds.minX * z,
    y: (viewportH - h * z) / 2 - bounds.minY * z,
    z,
  };
}

/** Camera centering a single frame at a comfortable zoom (for deep links). */
export function centerFrame(
  frame: Pick<CanvasFrame, "x" | "y" | "width" | "height" | "status">,
  viewportW: number,
  viewportH: number,
): Camera {
  return fitBounds(
    {
      minX: frame.x,
      minY: frame.y,
      maxX: frame.x + frame.width,
      maxY: frame.y + frame.height,
    },
    viewportW,
    viewportH,
    96,
  );
}

/** A frame's on-screen rect for a given camera. */
export function frameScreenRect(
  camera: Camera,
  frame: Pick<CanvasFrame, "x" | "y" | "width" | "height">,
): { left: number; top: number; width: number; height: number } {
  return {
    left: frame.x * camera.z + camera.x,
    top: frame.y * camera.z + camera.y,
    width: frame.width * camera.z,
    height: frame.height * camera.z,
  };
}

/**
 * Culling decision: mount a live iframe only when the frame is near the
 * viewport (one half-viewport margin) AND its on-screen width is legible.
 */
export const MIN_MOUNT_SCREEN_WIDTH = 150;

export function shouldMount(
  camera: Camera,
  frame: Pick<CanvasFrame, "x" | "y" | "width" | "height">,
  viewportW: number,
  viewportH: number,
): boolean {
  const rect = frameScreenRect(camera, frame);
  if (rect.width < MIN_MOUNT_SCREEN_WIDTH) return false;
  const marginX = viewportW / 2;
  const marginY = viewportH / 2;
  return (
    rect.left + rect.width > -marginX &&
    rect.left < viewportW + marginX &&
    rect.top + rect.height > -marginY &&
    rect.top < viewportH + marginY
  );
}
