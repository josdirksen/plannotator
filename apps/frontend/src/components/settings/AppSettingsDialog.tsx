import { useAppStore } from "../../stores/app-store";
import { SettingsDialog } from "@plannotator/ui/components/settings/SettingsDialog";

/**
 * AppSettingsDialog — thin frontend adapter over the shared SettingsDialog.
 *
 * Reads the app-store for open state and the active session's mode/origin, then
 * renders the shared dialog in daemon-backed mode (all tabs, server-synced).
 * All dialog composition/behavior lives in @plannotator/ui — this only wires the
 * frontend's Zustand store into the shared component's props.
 */
export function AppSettingsDialog() {
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const visitedSessions = useAppStore((s) => s.visitedSessions);

  const origin = activeSessionId
    ? ((visitedSessions[activeSessionId]?.bootstrap.session.origin as string | undefined) ?? null)
    : null;
  const mode = activeSessionId
    ? (visitedSessions[activeSessionId]?.bootstrap?.session?.mode ?? null)
    : null;
  const apiBase = activeSessionId ? `/s/${activeSessionId}/api` : null;

  return (
    <SettingsDialog
      open={open}
      onOpenChange={setOpen}
      sessionContext={{ mode, origin, apiBase }}
      daemonAvailable={true}
    />
  );
}
