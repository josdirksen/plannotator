/**
 * Open-in-App launcher — Node.js equivalent of packages/server/open-in-apps.ts.
 *
 * Launches a file in a chosen desktop app (editor / file manager / terminal)
 * using node:child_process execFile with argv arrays (never shell strings) to
 * avoid command injection. The app catalog is the runtime-agnostic single
 * source of truth shared with the Bun server and the UI
 * (packages/shared/open-in-apps.ts, vendored into generated/).
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";

import {
	OPEN_IN_APPS,
	getOpenInApp,
	resolveRevealIcon,
	resolveRevealLabel,
	type OpenInApp,
	type OpenInKind,
	type OpenInPlatform,
} from "../generated/open-in-apps.js";

function currentPlatform(): OpenInPlatform {
	switch (process.platform) {
		case "win32":
			return "win";
		case "darwin":
			return "mac";
		default:
			return "linux";
	}
}

/** which()-equivalent: returns true if a binary resolves on PATH. */
function whichBin(bin: string): boolean {
	try {
		const finder = process.platform === "win32" ? "where" : "which";
		execFileSync(finder, [bin], {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		return true;
	} catch {
		return false;
	}
}

/** macOS: does an application bundle exist in any standard Applications dir? */
function macAppExists(appName: string): boolean {
	const candidates = [
		`/Applications/${appName}.app`,
		join(os.homedir(), "Applications", `${appName}.app`),
		`/System/Applications/${appName}.app`,
	];
	return candidates.some((p) => existsSync(p));
}

/** Is the given catalog app launchable on THIS host? */
function isAppAvailable(app: OpenInApp): boolean {
	// reveal + system-default are always available.
	if (app.id === "reveal" || app.id === "system-default") return true;

	const platform = currentPlatform();
	if (platform === "mac") {
		if (app.mac?.appName) {
			if (macAppExists(app.mac.appName)) return true;
		}
		// Fall back to a CLI shim if one is configured (none of the mac entries
		// declare a bin today, but stay robust if that changes).
		if (app.mac && "bin" in app.mac && (app.mac as { bin?: string }).bin) {
			return whichBin((app.mac as { bin: string }).bin);
		}
		return false;
	}
	if (platform === "win") {
		return app.win?.bin ? whichBin(app.win.bin) : false;
	}
	// linux
	return app.linux?.bin ? whichBin(app.linux.bin) : false;
}

/**
 * The catalog filtered to apps launchable on this host (always including
 * `reveal` and `system-default`), in catalog order, with `reveal`'s label and
 * icon resolved per host platform. Used by GET /api/open-in/apps.
 */
export function getAvailableOpenInApps(): Array<{
	id: string;
	label: string;
	kind: OpenInKind;
	icon: string;
}> {
	const platform = currentPlatform();
	return OPEN_IN_APPS.filter(isAppAvailable).map((app) => {
		if (app.id === "reveal") {
			return {
				id: app.id,
				label: resolveRevealLabel(platform),
				kind: app.kind,
				icon: resolveRevealIcon(platform),
			};
		}
		return { id: app.id, label: app.label, kind: app.kind, icon: app.icon };
	});
}

/** Run execFile and surface ENOENT (app not found) as a friendly error. */
function run(
	cmd: string,
	args: string[],
	notFoundLabel: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	return new Promise((resolve) => {
		const proc = execFile(cmd, args, (err) => {
			if (!err) {
				resolve({ ok: true });
				return;
			}
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "ENOENT" || /ENOENT|not found/i.test(err.message)) {
				resolve({ ok: false, error: `${notFoundLabel} was not found on this system.` });
			} else {
				resolve({ ok: false, error: err.message });
			}
		});
		// Detach: we don't care about the child's lifetime once launched.
		proc.unref?.();
	});
}

/**
 * Launch `absPath` in the app identified by `appId` (defaults / unknown ->
 * the OS default handler). Mirrors the Bun-side launch semantics exactly.
 */
export function openFileInApp(
	absPath: string,
	appId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const platform = currentPlatform();
	const app = appId ? getOpenInApp(appId) : undefined;

	// system-default, unknown, or undefined -> OS default handler on the file.
	if (!app || app.id === "system-default") {
		if (platform === "mac") return run("open", [absPath], "Default app");
		if (platform === "win") return run("cmd", ["/c", "start", "", absPath], "Default app");
		return run("xdg-open", [absPath], "Default app");
	}

	if (app.kind === "file-manager") {
		// Reveal the file in the OS file manager.
		if (platform === "mac") return run("open", ["-R", absPath], "Finder");
		if (platform === "win") return run("explorer", [`/select,${absPath}`], "Explorer");
		return run("xdg-open", [dirname(absPath)], "File manager");
	}

	if (app.kind === "terminal") {
		// Terminals open the file's parent directory.
		const dir = dirname(absPath);
		if (platform === "mac") {
			if (!app.mac?.appName)
				return Promise.resolve({ ok: false, error: `${app.label} is not available on this platform.` });
			return run("open", ["-a", app.mac.appName, dir], app.label);
		}
		if (platform === "win") {
			if (!app.win?.bin)
				return Promise.resolve({ ok: false, error: `${app.label} is not available on this platform.` });
			return run(app.win.bin, [dir], app.label);
		}
		if (!app.linux?.bin)
			return Promise.resolve({ ok: false, error: `${app.label} is not available on this platform.` });
		return run(app.linux.bin, [dir], app.label);
	}

	// editor -> open the file itself.
	if (platform === "mac") {
		if (!app.mac?.appName)
			return Promise.resolve({ ok: false, error: `${app.label} is not available on this platform.` });
		return run("open", ["-a", app.mac.appName, absPath], app.label);
	}
	if (platform === "win") {
		if (!app.win?.bin)
			return Promise.resolve({ ok: false, error: `${app.label} is not available on this platform.` });
		return run(app.win.bin, [absPath], app.label);
	}
	if (!app.linux?.bin)
		return Promise.resolve({ ok: false, error: `${app.label} is not available on this platform.` });
	return run(app.linux.bin, [absPath], app.label);
}
