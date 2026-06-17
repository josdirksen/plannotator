import { describe, expect, test } from "bun:test";
import { AGENT_TERMINAL_WS_PATH } from "../generated/agent-terminal.js";
import { startAnnotateServer } from "./serverAnnotate";

describe("pi annotate agent terminal capability", () => {
	test("annotate mode mirrors the same-port WebSocket capability", async () => {
		const server = await startAnnotateServer({
			markdown: "# Annotate",
			filePath: "doc.md",
			htmlContent: "<html></html>",
			mode: "annotate",
			agentCwd: "/tmp/plannotator-agent-cwd",
		});

		try {
			const plan = await fetch(`${server.url}/api/plan`).then((res) => res.json());
			expect(plan.agentTerminal).toMatchObject({
				enabled: true,
				cwd: "/tmp/plannotator-agent-cwd",
				wsPath: AGENT_TERMINAL_WS_PATH,
			});
			expect(plan.agentTerminal.agents.length).toBeGreaterThan(0);

			const message = await websocketRoundTrip(
				server.url.replace(/^http/, "ws") + AGENT_TERMINAL_WS_PATH,
				{ type: "spawn", requestId: "missing-agent", options: {} },
			);
			expect(JSON.parse(message)).toEqual({
				type: "error",
				requestId: "missing-agent",
				message: "Agent terminal requires a built-in WebTUI agent.",
			});
		} finally {
			server.stop();
		}
	});

	test("annotate-last keeps terminal support disabled", async () => {
		const server = await startAnnotateServer({
			markdown: "last message",
			filePath: "last-message",
			htmlContent: "<html></html>",
			mode: "annotate-last",
			agentCwd: "/tmp/plannotator-agent-cwd",
		});

		try {
			const plan = await fetch(`${server.url}/api/plan`).then((res) => res.json());
			expect(plan.agentTerminal).toEqual({
				enabled: false,
				reason: "not-annotate-mode",
			});
		} finally {
			server.stop();
		}
	});
});

function websocketRoundTrip(url: string, payload: unknown): Promise<string> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		const timer = setTimeout(() => {
			ws.close();
			reject(new Error("Timed out waiting for WebSocket response"));
		}, 5_000);

		ws.onopen = () => ws.send(JSON.stringify(payload));
		ws.onmessage = (event) => {
			clearTimeout(timer);
			ws.close();
			resolve(String(event.data));
		};
		ws.onerror = () => {
			clearTimeout(timer);
			reject(new Error("WebSocket failed"));
		};
	});
}
