export const AGENT_TERMINAL_WS_PATH = "/api/agent-terminal/pty";

export type AgentTerminalDisabledReason =
  | "not-annotate-mode"
  | "webtui-unavailable"
  | "pty-unavailable"
  | "unsupported-runtime";

export type AgentTerminalAgent = {
  id: string;
  name: string;
  available: boolean;
};

export type AgentTerminalCapability =
  | {
      enabled: true;
      cwd: string;
      wsPath: string;
      agents: AgentTerminalAgent[];
    }
  | {
      enabled: false;
      reason: AgentTerminalDisabledReason;
      message?: string;
    };

export type AnnotateAgentTerminalMode =
  | "annotate"
  | "annotate-last"
  | "annotate-folder"
  | string
  | undefined;

export function supportsAnnotateAgentTerminalMode(
  mode: AnnotateAgentTerminalMode,
): boolean {
  return mode === "annotate" || mode === "annotate-folder";
}
