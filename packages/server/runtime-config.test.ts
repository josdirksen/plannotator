import { afterEach, describe, expect, test } from "bun:test";
import { injectRuntimeConfig } from "./runtime-config";

afterEach(() => {
  delete process.env.PLANNOTATOR_ROOM_BASE_URL;
  delete process.env.VITE_ROOM_BASE_URL;
});

describe("injectRuntimeConfig", () => {
  test("injects after the document head opener, not bundled head strings", () => {
    process.env.VITE_ROOM_BASE_URL = "http://localhost:8787";
    const html = '<html><head><script>const s="<head></head>";</script></head><body></body></html>';

    const result = injectRuntimeConfig(html);

    expect(result).toStartWith(
      '<html><head><script>window.__ROOM_BASE_URL="http://localhost:8787";</script><script>',
    );
    expect(result).toContain('const s="<head></head>";');
  });

  test("leaves html unchanged when no room base URL is configured", () => {
    const html = "<html><head></head><body></body></html>";

    expect(injectRuntimeConfig(html)).toBe(html);
  });
});
