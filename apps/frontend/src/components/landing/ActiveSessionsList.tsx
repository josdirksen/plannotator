import { useMemo } from "react";
import { useDaemonEventStore } from "../../daemon/events/event-store";
import { compareSessionsByRecency } from "../../shared/session-sort";
import { ActiveSessionRow } from "./ActiveSessionRow";

/**
 * Landing-page list of sessions: just the list. Active sessions sit on top, most
 * recently ended after. Unfiltered — the History page owns the Active/All toggle
 * and the project filter. The "History →" link lives on the section heading in
 * LandingPage (outside this box), so the box stays a plain list.
 */
export function ActiveSessionsList() {
  const sessions = useDaemonEventStore((s) => s.sessions);
  const sorted = useMemo(() => [...sessions].sort(compareSessionsByRecency), [sessions]);

  return (
    <div className="max-h-[300px] overflow-y-auto rounded-lg border border-border px-1 py-1">
      {sorted.length > 0 ? (
        sorted.map((session) => <ActiveSessionRow key={session.id} session={session} />)
      ) : (
        <div className="py-6 text-center text-sm text-muted-foreground">No active sessions</div>
      )}
    </div>
  );
}
