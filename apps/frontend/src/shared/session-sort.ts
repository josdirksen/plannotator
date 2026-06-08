import type { SessionSummary } from "../daemon/contracts";

/** Non-terminal statuses — these sort above ended sessions. */
const LIVE_STATUSES = new Set(["active", "idle", "awaiting-resubmission"]);

/**
 * Sort order for session lists: live sessions first, then by most recent
 * activity (`updatedAt` desc). So active sessions sit on top and the most
 * recently ended follow.
 */
export function compareSessionsByRecency(a: SessionSummary, b: SessionSummary): number {
  const aLive = LIVE_STATUSES.has(a.status);
  const bLive = LIVE_STATUSES.has(b.status);
  if (aLive !== bLive) return aLive ? -1 : 1;
  if (a.updatedAt === b.updatedAt) return 0;
  return a.updatedAt < b.updatedAt ? 1 : -1;
}
