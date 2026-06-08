import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { GeneralTab } from "./GeneralTab";
import { PlanGeneralTab } from "./PlanGeneralTab";
import { PlanDisplayTab } from "./PlanDisplayTab";
import { SavingTab } from "./SavingTab";
import { LabelsTab } from "./LabelsTab";
import { FilesTab } from "./FilesTab";
import { GitTab } from "./ReviewGitTab";
import { ReviewDisplayTab } from "./ReviewDisplayTab";
import { CommentsTab } from "./CommentsTab";
import { ThemeTab } from "../ThemeTab";
import { KeyboardShortcuts } from "../KeyboardShortcuts";
import { AISettingsTab } from "../AISettingsTab";
import { HooksTab } from "./HooksTab";
import { getAIProviderSettings, saveAIProviderSettings } from "../../utils/aiProvider";
import { configStore } from "../../config";
import type { Origin } from "@plannotator/shared/agents";

/**
 * SettingsDialog — the single, shared settings surface.
 *
 * Adapts to its environment via `daemonAvailable`:
 *   - With a daemon/session (frontend shell): full dialog, server-synced,
 *     all tabs including AI, Hooks, "use git name", and the legacy-tab toggle.
 *   - Without a daemon (portal / standalone plan editor): same dialog, cookie-only,
 *     daemon-only tabs and controls hidden.
 *
 * Decoupled from any host app store — the frontend passes session context through
 * props; the standalone plan editor passes `sessionContext={null}` and
 * `daemonAvailable={false}`.
 */

interface TabDef {
  id: string;
  label: string;
}

export interface SettingsSessionContext {
  /** Active session mode — drives the default tab. Known values:
   *  "plan" | "review" | "annotate" | "goal-setup". Widened to `string` so
   *  hosts can pass their own (broader) session-mode unions without casting. */
  mode: string | null;
  origin: string | null;
  apiBase: string | null;
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionContext: SettingsSessionContext | null;
  daemonAvailable: boolean;
}

const GENERAL_TABS: TabDef[] = [
  { id: "general", label: "General" },
  { id: "theme", label: "Theme" },
  { id: "shortcuts", label: "Shortcuts" },
];

const PLAN_TABS: TabDef[] = [
  { id: "plan-general", label: "General" },
  { id: "plan-display", label: "Display" },
  { id: "plan-saving", label: "Saving" },
  { id: "plan-labels", label: "Labels" },
  { id: "plan-hooks", label: "Hooks" },
];

const REVIEW_TABS: TabDef[] = [
  { id: "review-git", label: "Git" },
  { id: "review-display", label: "Display" },
  { id: "review-comments", label: "Comments" },
  { id: "review-ai", label: "AI" },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  sessionContext,
  daemonAvailable,
}: SettingsDialogProps) {
  const setOpen = onOpenChange;
  const [activeTab, setActiveTab] = useState("general");
  const [themePreview, setThemePreview] = useState(false);

  const activeMode = sessionContext?.mode ?? null;
  const activeOrigin = sessionContext?.origin ?? null;
  const apiBase = sessionContext?.apiBase ?? null;

  // Daemon-dependent surfaces (AI provider tab, hooks tab, git-name control,
  // legacy-tab toggle) are hidden when there is no daemon to back them.
  const PLAN_TABS_VISIBLE = daemonAvailable
    ? PLAN_TABS
    : PLAN_TABS.filter((t) => t.id !== "plan-hooks");
  const REVIEW_TABS_VISIBLE = daemonAvailable
    ? REVIEW_TABS
    : REVIEW_TABS.filter((t) => t.id !== "review-ai");

  useEffect(() => {
    if (!themePreview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setThemePreview(false);
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [themePreview, setOpen]);

  // Force re-mount of tab content when dialog opens to ensure fresh state, and
  // default the active tab to the section matching the active session's mode.
  const [mountKey, setMountKey] = useState(0);
  useEffect(() => {
    if (!open) return;
    setMountKey((k) => k + 1);
    setActiveTab(
      activeMode === "review"
        ? "review-display"
        : activeMode === "plan" || activeMode === "annotate" || activeMode === "goal-setup"
          ? "plan-general"
          : "general",
    );
  }, [open, activeMode]);

  // Fetch git user and config from daemon on open (daemon-backed only)
  const [gitUser, setGitUser] = useState<string | undefined>();
  const [legacyTabMode, setLegacyTabMode] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!daemonAvailable) {
      setGitUser(undefined);
      return;
    }
    let active = true;
    fetch("/daemon/git/user")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active) return;
        if (data?.gitUser) setGitUser(data.gitUser);
      })
      .catch(() => {});
    fetch("/daemon/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active) return;
        if (data?.config) {
          configStore.getState().init(data.config);
          setLegacyTabMode(!!data.config.legacyTabMode);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open, daemonAvailable]);

  // Daemon-routed fetch for tabs that need server calls without session context
  const daemonFetch = useCallback((input: string, init?: RequestInit) => {
    const path =
      typeof input === "string" && input.startsWith("/api/") ? `/daemon${input.slice(4)}` : input;
    return fetch(path, init);
  }, []);

  // AI provider state — fetched once when dialog opens (daemon-backed only)
  const [aiProviders, setAiProviders] = useState<
    Array<{
      id: string;
      name: string;
      capabilities: Record<string, boolean>;
      models?: Array<{ id: string; label: string; default?: boolean }>;
    }>
  >([]);
  const [aiProviderId, setAiProviderId] = useState<string | null>(
    () => getAIProviderSettings().providerId,
  );

  // Re-read AI provider on each open (could have changed via per-surface settings)
  useEffect(() => {
    if (open) setAiProviderId(getAIProviderSettings().providerId);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!daemonAvailable || !apiBase) {
      setAiProviders([]);
      return;
    }
    fetch(`${apiBase}/ai/capabilities`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.providers) setAiProviders(data.providers);
      })
      .catch(() => {});
  }, [open, daemonAvailable, apiBase]);

  const handleAiProviderChange = useCallback((providerId: string | null) => {
    setAiProviderId(providerId);
    const current = getAIProviderSettings();
    saveAIProviderSettings({ ...current, providerId });
  }, []);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-0" hideClose>
          <DialogTitle className="sr-only">Settings</DialogTitle>
          <Tabs
            key={mountKey}
            value={activeTab}
            onValueChange={setActiveTab}
            orientation="vertical"
            className="flex h-[min(600px,80vh)]"
          >
            <div className="flex w-44 shrink-0 flex-col border-r border-border">
              <div className="px-4 pb-1 pt-4">
                <span className="text-sm font-semibold">Settings</span>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>v{__APP_VERSION__}</span>
                  <span>·</span>
                  <a
                    href="https://github.com/backnotprop/plannotator/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground"
                  >
                    Send feedback
                  </a>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-2 py-2">
                <TabsList className="flex-col gap-0.5">
                  <SectionLabel>General</SectionLabel>
                  {GENERAL_TABS.map((tab) => (
                    <TabsTrigger key={tab.id} value={tab.id} className="w-full justify-start h-8">
                      {tab.label}
                    </TabsTrigger>
                  ))}

                  <SectionLabel>Plan Review</SectionLabel>
                  {PLAN_TABS_VISIBLE.map((tab) => (
                    <TabsTrigger key={tab.id} value={tab.id} className="w-full justify-start h-8">
                      {tab.label}
                    </TabsTrigger>
                  ))}

                  <SectionLabel>Code Review</SectionLabel>
                  {REVIEW_TABS_VISIBLE.map((tab) => (
                    <TabsTrigger key={tab.id} value={tab.id} className="w-full justify-start h-8">
                      {tab.label}
                    </TabsTrigger>
                  ))}

                  <TabsTrigger value="int-files" className="w-full justify-start h-8">
                    Files
                  </TabsTrigger>
                </TabsList>
              </div>
            </div>

            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-end border-b border-border px-4 py-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-5">
                {/* General */}
                <TabsContent value="general">
                  <GeneralTab
                    gitUser={daemonAvailable ? gitUser : undefined}
                    legacyTabMode={legacyTabMode}
                    onLegacyTabModeChange={
                      daemonAvailable
                        ? (enabled) => {
                            setLegacyTabMode(enabled);
                            fetch("/daemon/config", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ legacyTabMode: enabled }),
                            }).catch(() => {});
                          }
                        : undefined
                    }
                  />
                </TabsContent>
                <TabsContent value="theme">
                  <ThemeTab
                    onPreview={() => {
                      setOpen(false);
                      setThemePreview(true);
                    }}
                  />
                </TabsContent>
                <TabsContent value="shortcuts">
                  <div className="space-y-6">
                    <div>
                      <div className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Plan Review
                      </div>
                      <KeyboardShortcuts mode="plan" />
                    </div>
                    <div className="border-t border-border pt-6">
                      <div className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Code Review
                      </div>
                      <KeyboardShortcuts mode="review" />
                    </div>
                  </div>
                </TabsContent>

                {/* Plan Review */}
                <TabsContent value="plan-general">
                  <PlanGeneralTab origin={activeOrigin} />
                </TabsContent>
                <TabsContent value="plan-display">
                  <PlanDisplayTab />
                </TabsContent>
                <TabsContent value="plan-saving">
                  <SavingTab />
                </TabsContent>
                <TabsContent value="plan-labels">
                  <LabelsTab />
                </TabsContent>
                {daemonAvailable && (
                  <TabsContent value="plan-hooks">
                    <HooksTab fetchFn={daemonFetch} />
                  </TabsContent>
                )}

                {/* Code Review */}
                <TabsContent value="review-git">
                  <GitTab />
                </TabsContent>
                <TabsContent value="review-display">
                  <ReviewDisplayTab />
                </TabsContent>
                <TabsContent value="review-comments">
                  <CommentsTab />
                </TabsContent>
                {daemonAvailable && (
                  <TabsContent value="review-ai">
                    <AISettingsTab
                      providers={aiProviders}
                      selectedProviderId={aiProviderId}
                      origin={activeOrigin as Origin | null}
                      onProviderChange={handleAiProviderChange}
                    />
                  </TabsContent>
                )}

                <TabsContent value="int-files">
                  <FilesTab />
                </TabsContent>
              </div>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      {themePreview &&
        createPortal(
          <div className="fixed inset-0 z-[110] flex flex-col pointer-events-none">
            <div className="flex-1" />
            <div className="pointer-events-auto w-full bg-card border-t-2 border-primary/30 shadow-[0_-4px_20px_rgba(0,0,0,0.4)] flex flex-col max-h-[35vh] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Theme Preview
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setThemePreview(false);
                    setOpen(true);
                  }}
                  className="px-3 py-1 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                >
                  Done
                </button>
              </div>
              <div className="p-3 overflow-y-auto flex-1 min-h-0">
                <ThemeTab compact />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
