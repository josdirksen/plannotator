declare global {
  interface Window {
    __PLANNOTATOR_API_BASE__?: string;
  }
}

let globalFetchBase: string | undefined;

export function setGlobalFetchBase(base: string | undefined): void {
  globalFetchBase = base;
}

function normalizeBase(base: string | undefined): string {
  if (!base) return "/api";
  const trimmed = base.trim();
  if (!trimmed) return "/api";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function normalizePath(path: string): string {
  if (!path) return "";
  const prefixed = path.startsWith("/") ? path : `/${path}`;
  return prefixed.length > 1 && prefixed.endsWith("/") ? prefixed.slice(0, -1) : prefixed;
}

export function getApiBase(): string {
  if (typeof window === "undefined") return "/api";
  const sessionBase = window.__PLANNOTATOR_API_BASE__;
  if (sessionBase) return normalizeBase(sessionBase);
  if (globalFetchBase) return normalizeBase(globalFetchBase);
  return "/api";
}

export function apiPath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/api") return getApiBase();
  if (normalized.startsWith("/api/")) {
    return `${getApiBase()}${normalized.slice("/api".length)}`;
  }
  return `${getApiBase()}${normalized}`;
}

export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(apiPath(input), init);
}

/**
 * Whether a real daemon/session API base is resolvable. False in the portal /
 * standalone plan editor, where no session base (`window.__PLANNOTATOR_API_BASE__`)
 * and no global base have been set — there `getApiBase()` falls back to the bare
 * `/api` default that would 404. Callers use this to skip doomed server requests.
 */
export function hasResolvableApiBase(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.__PLANNOTATOR_API_BASE__ || globalFetchBase);
}

export function getApiOriginAndBase(): string {
  if (typeof window === "undefined") return "/api";
  return `${window.location.origin}${getApiBase()}`;
}
