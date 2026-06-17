import { describe, expect, test } from "bun:test";
import { AGENT_TERMINAL_WS_PATH } from "@plannotator/shared/agent-terminal";
import { createBunAgentTerminalBridge } from "./agent-terminal";

describe("bun agent terminal bridge", () => {
  test("reports a disabled capability when annotate terminal support is off", async () => {
    const bridge = await createBunAgentTerminalBridge({
      enabled: false,
      cwd: "/tmp/plannotator-agent-cwd",
    });

    expect(bridge.capability).toEqual({
      enabled: false,
      reason: "not-annotate-mode",
    });
    bridge.dispose();
  });

  test("loads WebTUI and reports browser-safe capability metadata", async () => {
    const bridge = await createBunAgentTerminalBridge({
      enabled: true,
      cwd: "/tmp/plannotator-agent-cwd",
    });

    try {
      expect(bridge.capability).toMatchObject({
        enabled: true,
        cwd: "/tmp/plannotator-agent-cwd",
        wsPath: AGENT_TERMINAL_WS_PATH,
      });
      if (!bridge.capability.enabled) {
        throw new Error("Expected enabled agent terminal capability");
      }
      expect(bridge.capability.agents.length).toBeGreaterThan(0);
      expect(bridge.capability.agents[0]).toHaveProperty("id");
      expect(bridge.capability.agents[0]).toHaveProperty("name");
      expect(bridge.capability.agents[0]).toHaveProperty("available");
    } finally {
      bridge.dispose();
    }
  });
});
