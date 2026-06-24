import { describe, expect, test } from "bun:test";
import {
  OPENCODE_MARKER_OPEN,
  OPENCODE_MARKER_CLOSE,
  buildOpencodeCommand,
  reduceOpencodeStreamEvents,
  parseOpencodeStreamOutput,
  formatOpencodeLogEvent,
  transformOpencodeFindings,
  validateOpencodeReviewOutput,
  parseOpencodeModelsOutput,
  type OpencodeFinding,
  type OpencodeReviewOutput,
} from "./opencode-review";

// ---------------------------------------------------------------------------
// Helpers — build NDJSON the way `opencode run --format json` does:
// every record is { type, timestamp, sessionID, ...data }.
// ---------------------------------------------------------------------------

function ndjson(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}
/** A finalized text part event (the only events carrying assistant text). */
function textEvent(text: string): string {
  return ndjson({ type: "text", timestamp: 1, sessionID: "s1", part: { type: "text", text, time: { start: 1, end: 2 } } });
}
function toolEvent(tool: string, status: string): string {
  return ndjson({ type: "tool_use", timestamp: 1, sessionID: "s1", part: { type: "tool", tool, state: { status } } });
}
function markerBlock(obj: unknown): string {
  return `${OPENCODE_MARKER_OPEN}\n${JSON.stringify(obj)}\n${OPENCODE_MARKER_CLOSE}`;
}

const cleanReview: OpencodeReviewOutput = {
  findings: [],
  summary: { correctness: "Correct", explanation: "ok", confidence: 1 },
};

// ---------------------------------------------------------------------------

describe("buildOpencodeCommand", () => {
  test("uses `opencode run --format json --agent plan`, prompt as trailing arg", () => {
    const { command } = buildOpencodeCommand("review this", "opencode/glm-5.1", "/repo");
    expect(command[0]).toBe("opencode");
    expect(command[1]).toBe("run");
    expect(command).toContain("--format");
    expect(command[command.indexOf("--format") + 1]).toBe("json");
    expect(command).toContain("--agent");
    expect(command[command.indexOf("--agent") + 1]).toBe("plan");
    expect(command[command.indexOf("--dir") + 1]).toBe("/repo");
    expect(command[command.indexOf("--model") + 1]).toBe("opencode/glm-5.1");
    // never the dangerous flag
    expect(command).not.toContain("--dangerously-skip-permissions");
    // prompt is the trailing positional message
    expect(command[command.length - 1]).toBe("review this");
  });

  test("omits --model when model is empty/undefined", () => {
    expect(buildOpencodeCommand("p", "", "/repo").command).not.toContain("--model");
    expect(buildOpencodeCommand("p", undefined, "/repo").command).not.toContain("--model");
  });

  test("omits --dir when no cwd is provided", () => {
    expect(buildOpencodeCommand("p").command).not.toContain("--dir");
  });
});

describe("parseOpencodeModelsOutput", () => {
  test("parses provider/model lines, dedupes, skips junk", () => {
    const out = ["opencode/big-pickle", "opencode-go/glm-5.1", "opencode/big-pickle", "", "Some header line", "a/b/c"].join("\n");
    expect(parseOpencodeModelsOutput(out)).toEqual([
      { id: "opencode/big-pickle", label: "opencode/big-pickle" },
      { id: "opencode-go/glm-5.1", label: "opencode-go/glm-5.1" },
    ]);
  });

  test("returns [] for empty / no provider lines", () => {
    expect(parseOpencodeModelsOutput("")).toEqual([]);
    expect(parseOpencodeModelsOutput("No models configured")).toEqual([]);
  });
});

describe("reduceOpencodeStreamEvents", () => {
  test("concatenates text-part text, ignores tool/step events", () => {
    const stdout =
      textEvent("Looking at ") +
      toolEvent("read", "completed") +
      textEvent("the diff.") +
      ndjson({ type: "step_finish", sessionID: "s1", part: { type: "step-finish" } });
    expect(reduceOpencodeStreamEvents(stdout).canonicalText).toBe("Looking at the diff.");
  });

  test("skips malformed lines, survives chunk-joined buffer", () => {
    const stdout = textEvent("a") + "this is not json\n" + textEvent("b");
    expect(reduceOpencodeStreamEvents(stdout).canonicalText).toBe("ab");
  });

  test("empty stdout → empty canonical text", () => {
    expect(reduceOpencodeStreamEvents("").canonicalText).toBe("");
  });
});

describe("parseOpencodeStreamOutput", () => {
  test("last marker block wins across multiple text parts", () => {
    const stale = { findings: [{ file: "a.ts", line: 1, severity: "nit", description: "old", reasoning: "" }], summary: { correctness: "Issues Found", explanation: "x", confidence: 0.5 } };
    const stdout =
      textEvent("Draft:\n" + markerBlock(stale) + "\n") +
      textEvent("Final:\n" + markerBlock(cleanReview));
    const out = parseOpencodeStreamOutput(stdout);
    expect(out?.findings.length).toBe(0);
    expect(out?.summary.correctness).toBe("Correct");
  });

  test("marker split across text parts still parses", () => {
    const full = markerBlock(cleanReview);
    const half = Math.floor(full.length / 2);
    const stdout = textEvent(full.slice(0, half)) + textEvent(full.slice(half));
    expect(parseOpencodeStreamOutput(stdout)?.summary.correctness).toBe("Correct");
  });

  test("missing marker → null", () => {
    expect(parseOpencodeStreamOutput(textEvent("no marker here"))).toBeNull();
  });
  test("unclosed marker → null", () => {
    expect(parseOpencodeStreamOutput(textEvent(`${OPENCODE_MARKER_OPEN}\n{"findings":[]`))).toBeNull();
  });
  test("malformed JSON → null", () => {
    expect(parseOpencodeStreamOutput(textEvent(`${OPENCODE_MARKER_OPEN}\n{ bad json }\n${OPENCODE_MARKER_CLOSE}`))).toBeNull();
  });
  test("schema-invalid → null", () => {
    expect(parseOpencodeStreamOutput(textEvent(markerBlock({ findings: [{ file: "a", line: "x", severity: "important", description: "d" }], summary: { correctness: "x", explanation: "y", confidence: 1 } })))).toBeNull();
  });
  test("empty stdout → null", () => {
    expect(parseOpencodeStreamOutput("")).toBeNull();
  });
  test("valid empty findings + summary → accepted", () => {
    const out = parseOpencodeStreamOutput(textEvent(markerBlock(cleanReview)));
    expect(out).not.toBeNull();
    expect(out?.findings).toEqual([]);
  });
});

describe("validateOpencodeReviewOutput", () => {
  test("defaults end_line→line and reasoning→''", () => {
    const out = validateOpencodeReviewOutput({
      findings: [{ file: "a.ts", line: 4, severity: "nit", description: "d" }],
      summary: { correctness: "Correct", explanation: "e", confidence: 0.9 },
    });
    expect(out?.findings[0].end_line).toBe(4);
    expect(out?.findings[0].reasoning).toBe("");
  });
  test("rejects bad severity / missing summary fields", () => {
    expect(validateOpencodeReviewOutput({ findings: [{ file: "a", line: 1, severity: "blocker", description: "d" }], summary: { correctness: "x", explanation: "y", confidence: 1 } })).toBeNull();
    expect(validateOpencodeReviewOutput({ findings: [], summary: { correctness: "x", explanation: "y" } })).toBeNull();
  });
});

describe("formatOpencodeLogEvent", () => {
  test("maps text / tool_use / error, skips step + malformed", () => {
    expect(formatOpencodeLogEvent(textEvent("hello").trim())).toBe("hello");
    expect(formatOpencodeLogEvent(toolEvent("read", "completed").trim())).toBe("[read] completed");
    expect(formatOpencodeLogEvent(ndjson({ type: "error", sessionID: "s1", error: {} }).trim())).toContain("[error]");
    expect(formatOpencodeLogEvent(ndjson({ type: "step_start", part: { type: "step-start" } }).trim())).toBeNull();
    expect(formatOpencodeLogEvent("not json")).toBeNull();
  });
});

describe("transformOpencodeFindings", () => {
  test("maps to annotation shape with author OpenCode and severity-prefixed text", () => {
    const findings: OpencodeFinding[] = [
      { file: "/repo/src/a.ts", line: 10, end_line: 12, severity: "important", description: "bug", reasoning: "why" },
    ];
    const [a] = transformOpencodeFindings(findings, "agent-x", "/repo");
    expect(a.author).toBe("OpenCode");
    expect(a.filePath).toBe("src/a.ts");
    expect(a.lineStart).toBe(10);
    expect(a.lineEnd).toBe(12);
    expect(a.side).toBe("new");
    expect(a.scope).toBe("line");
    expect(a.type).toBe("comment");
    expect(a.text).toBe("[important] bug");
    expect(a.severity).toBe("important");
  });

  test("drops findings without a file or line; defaults end_line", () => {
    const findings = [
      { file: "", line: 1, severity: "nit", description: "d", reasoning: "" },
      { file: "/repo/b.ts", line: 7, severity: "nit", description: "d", reasoning: "" },
    ] as unknown as OpencodeFinding[];
    const out = transformOpencodeFindings(findings, "src", "/repo");
    expect(out.length).toBe(1);
    expect(out[0].lineEnd).toBe(7);
  });
});
