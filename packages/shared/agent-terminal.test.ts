import { describe, expect, test } from "bun:test";
import { supportsAnnotateAgentTerminalMode } from "./agent-terminal";

describe("supportsAnnotateAgentTerminalMode", () => {
  test("enables the terminal only for annotate file and folder modes", () => {
    expect(supportsAnnotateAgentTerminalMode("annotate")).toBe(true);
    expect(supportsAnnotateAgentTerminalMode("annotate-folder")).toBe(true);
    expect(supportsAnnotateAgentTerminalMode("annotate-last")).toBe(false);
    expect(supportsAnnotateAgentTerminalMode("archive")).toBe(false);
    expect(supportsAnnotateAgentTerminalMode(undefined)).toBe(false);
  });
});
