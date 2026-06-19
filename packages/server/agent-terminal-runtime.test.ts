import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveBundledAgentTerminalSidecarPath } from "./agent-terminal-runtime";

let tmp = "";

beforeEach(() => {
  tmp = join(tmpdir(), `plannotator-agent-runtime-${randomUUID()}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("agent terminal runtime", () => {
  test("uses a bundled sidecar only when it exists next to the module", () => {
    const embeddedUrl = pathToFileURL(join(tmp, "embedded.js")).href;

    expect(resolveBundledAgentTerminalSidecarPath(embeddedUrl)).toBeNull();

    const sidecarPath = join(tmp, "agent-terminal-node-sidecar.mjs");
    writeFileSync(sidecarPath, "export {};\n");

    expect(resolveBundledAgentTerminalSidecarPath(embeddedUrl)).toBe(sidecarPath);
  });

  test("does not hand Node a Bun virtual sidecar path", () => {
    expect(resolveBundledAgentTerminalSidecarPath("file:///$bunfs/embedded.js")).toBeNull();
  });
});
