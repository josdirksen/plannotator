import React from 'react';
import type { Origin } from '@plannotator/shared/agents';
import type { Agent } from '@plannotator/ui/hooks/useAgents';
import type { UpdateInfo } from '@plannotator/ui/hooks/useUpdateCheck';
import { FeedbackButton, ApproveButton, ExitButton } from '@plannotator/ui/components/ToolbarButtons';
import { ApproveDropdown } from '@plannotator/ui/components/ApproveDropdown';
import { SettingsDialog } from '@plannotator/ui/components/settings/SettingsDialog';
import { PlanHeaderMenu } from '@plannotator/ui/components/PlanHeaderMenu';
import type { CallbackConfig } from '@plannotator/ui/utils/callback';
import { SparklesIcon } from '@plannotator/ui/components/SparklesIcon';
import { Button } from '@plannotator/ui/components/ui/button';
import { cn } from '@plannotator/ui/lib/utils';
import { CommentIcon } from '@plannotator/ui/components/icons/CommentIcon';

interface AppHeaderProps {
  /** HTML annotate surface: show a Hide/Show annotation-tools toggle in the header,
   *  so hiding leaves the rendered HTML completely free of overlay controls. */
  htmlSurface?: boolean;
  htmlToolsHidden?: boolean;
  onToggleHtmlTools?: () => void;
  // Slot for external content (e.g., shell sidebar trigger)
  headerLeft?: React.ReactNode;
  // When true, the built-in Settings modal is not mounted (unified dialog handles it)
  skipBuiltInSettings?: boolean;
  // Mode flags (stable after mount)
  isApiMode: boolean;
  annotateMode: boolean;
  goalSetupMode: boolean;
  goalSetupCanSubmit: boolean;
  goalSetupIsSubmitting: boolean;
  goalSetupSubmitLabel: string;
  gate: boolean;
  isSharedSession: boolean;
  origin: Origin | null;

  // Dynamic state
  submitted: boolean;
  isSubmitting: boolean;
  isExiting: boolean;
  isPanelOpen: boolean;
  aiAvailable: boolean;
  isAIChatOpen: boolean;
  aiHasMessages: boolean;
  hasAnyAnnotations: boolean;
  linkedDocIsActive: boolean;
  callbackShareUrlReady: boolean;
  canShareCurrentSession: boolean;
  agentName: string;
  availableAgents: Agent[];
  showAnnotationsWarning: boolean;

  // Callback config (null when no bot callback)
  callbackConfig: CallbackConfig | null;

  // Settings props
  mobileSettingsOpen: boolean;

  // Handlers — App owns all decision logic, header just calls these
  onCallbackFeedback: () => void;
  onCallbackApprove: () => void;
  onAnnotateExit: () => void;
  onGoalSetupExit: () => void;
  onGoalSetupSubmit: () => void;
  onAnnotateFeedback: () => void;
  onAnnotateApprove: () => void;
  onFeedback: () => void;
  onApprove: () => void;
  onAnnotationPanelToggle: () => void;
  onAIChatToggle: () => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onOpenExport: () => void;
  onCopyAgentInstructions: () => void;
  onDownloadAnnotations: () => void;
  onPrint: () => void;
  onCopyShareLink: () => void;
  onOpenImport: () => void;

  // PlanHeaderMenu config
  appVersion: string;
  updateInfo?: UpdateInfo | null;
  isWSL?: boolean;
  agentInstructionsEnabled: boolean;
}

export const AppHeader = React.memo<AppHeaderProps>(({
  headerLeft,
  htmlSurface,
  htmlToolsHidden,
  onToggleHtmlTools,
  skipBuiltInSettings,
  isApiMode,
  annotateMode,
  goalSetupMode,
  goalSetupCanSubmit,
  goalSetupIsSubmitting,
  goalSetupSubmitLabel,
  gate,
  isSharedSession,
  origin,
  submitted,
  isSubmitting,
  isExiting,
  isPanelOpen,
  aiAvailable,
  isAIChatOpen,
  aiHasMessages,
  hasAnyAnnotations,
  linkedDocIsActive,
  callbackShareUrlReady,
  canShareCurrentSession,
  agentName,
  availableAgents,
  showAnnotationsWarning,
  callbackConfig,
  mobileSettingsOpen,
  onCallbackFeedback,
  onCallbackApprove,
  onAnnotateExit,
  onGoalSetupExit,
  onGoalSetupSubmit,
  onAnnotateFeedback,
  onAnnotateApprove,
  onFeedback,
  onApprove,
  onAnnotationPanelToggle,
  onAIChatToggle,
  onOpenSettings,
  onCloseSettings,
  onOpenExport,
  onCopyAgentInstructions,
  onDownloadAnnotations,
  onPrint,
  onCopyShareLink,
  onOpenImport,
  appVersion,
  updateInfo,
  isWSL,
  agentInstructionsEnabled,
}) => {
  return (
    <header data-app-header="true" className="h-12 flex items-center justify-between px-2 md:px-4 border-b border-border/50 bg-card/50 backdrop-blur-xl sticky top-0 z-[50]">
      <div className="flex items-center gap-2">
        {headerLeft}
        <AppHeaderLogo />
        {htmlSurface && onToggleHtmlTools && (
          <button
            type="button"
            onClick={onToggleHtmlTools}
            className="ml-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-1.5 py-1 rounded cursor-pointer"
            title={htmlToolsHidden ? 'Show annotation tools' : 'Hide annotation tools'}
          >
            {htmlToolsHidden ? 'Show tools' : 'Hide tools'}
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 md:gap-2">
        {/* Bot callback buttons — only shown when ?cb=&ct= params are present */}
        {callbackConfig && !isApiMode && isSharedSession && (
          <>
            <div className="w-px h-5 bg-border/50 mx-1 hidden md:block" />
            <FeedbackButton
              onClick={onCallbackFeedback}
              disabled={isSubmitting || !callbackShareUrlReady}
              isLoading={isSubmitting}
              title="Send feedback to bot"
            />
            <ApproveButton
              onClick={onCallbackApprove}
              disabled={isSubmitting || !callbackShareUrlReady}
              isLoading={isSubmitting}
              title="Approve design and notify bot"
            />
          </>
        )}

        {isApiMode && !submitted && !linkedDocIsActive && goalSetupMode && (
          <>
            <ExitButton
              onClick={onGoalSetupExit}
              disabled={isExiting || goalSetupIsSubmitting}
              isLoading={isExiting}
              title="Close goal setup without submitting"
            />
            <ApproveButton
              onClick={onGoalSetupSubmit}
              disabled={!goalSetupCanSubmit || goalSetupIsSubmitting || isExiting}
              isLoading={goalSetupIsSubmitting}
              label={goalSetupSubmitLabel}
              loadingLabel="Submitting..."
              mobileLabel="Submit"
              title={goalSetupSubmitLabel}
            />
            <div className="w-px h-5 bg-border/50 mx-1 hidden md:block" />
          </>
        )}

        {isApiMode && !submitted && (!linkedDocIsActive || annotateMode) && !goalSetupMode && (
          <>
            {annotateMode ? (
              <>
                <ExitButton
                  onClick={onAnnotateExit}
                  disabled={isSubmitting || isExiting}
                  isLoading={isExiting}
                />
                {hasAnyAnnotations && (
                  <FeedbackButton
                    onClick={onAnnotateFeedback}
                    disabled={isSubmitting || isExiting}
                    isLoading={isSubmitting}
                    label="Send Annotations"
                    title="Send Annotations"
                  />
                )}
              </>
            ) : (
              <FeedbackButton
                onClick={onFeedback}
                disabled={isSubmitting}
                isLoading={isSubmitting}
                label="Send Feedback"
                title="Send Feedback"
              />
            )}

            {(!annotateMode || gate) && (
              origin === 'opencode' && !annotateMode && availableAgents.length > 0 ? (
                <ApproveDropdown
                  onApprove={onApprove}
                  agents={availableAgents}
                  disabled={isSubmitting}
                  isLoading={isSubmitting}
                />
              ) : (
                <div className="relative group/approve">
                  <ApproveButton
                    onClick={onApprove}
                    disabled={isSubmitting || (annotateMode && isExiting)}
                    isLoading={isSubmitting}
                    dimmed={!annotateMode && (origin === 'claude-code' || origin === 'gemini-cli') && showAnnotationsWarning}
                    title={annotateMode ? 'Approve — no changes requested' : undefined}
                  />
                  {!annotateMode && (origin === 'claude-code' || origin === 'gemini-cli') && showAnnotationsWarning && (
                    <div className="absolute top-full right-0 mt-2 px-3 py-2 bg-popover border border-border rounded-lg shadow-xl text-xs text-foreground w-56 text-center opacity-0 invisible group-hover/approve:opacity-100 group-hover/approve:visible transition-all pointer-events-none z-50">
                      <div className="absolute bottom-full right-4 border-4 border-transparent border-b-border" />
                      <div className="absolute bottom-full right-4 mt-px border-4 border-transparent border-b-popover" />
                      {agentName} doesn't support feedback on approval. Your annotations won't be seen.
                    </div>
                  )}
                </div>
              )
            )}

            <div className="w-px h-5 bg-border/50 mx-1 hidden md:block" />
          </>
        )}

        {/* Annotations panel toggle */}
        {!goalSetupMode && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onAnnotationPanelToggle}
            title={isPanelOpen ? 'Hide annotations' : 'Show annotations'}
            className={cn('p-1.5', isPanelOpen ? 'bg-primary/15 text-primary hover:bg-primary/15 hover:text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
          >
            <CommentIcon className="size-4" />
          </Button>
        )}
        {!goalSetupMode && aiAvailable && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onAIChatToggle}
            title={isAIChatOpen ? 'Hide AI chat' : 'Show AI chat'}
            aria-label={isAIChatOpen ? 'Hide AI chat' : 'Show AI chat'}
            className={cn('relative p-1.5', isAIChatOpen ? 'bg-primary/15 text-primary hover:bg-primary/15 hover:text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
          >
            <SparklesIcon className="w-4 h-4" />
            {aiHasMessages && !isAIChatOpen && (
              <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-primary" />
            )}
          </Button>
        )}

        {/* Standalone settings dialog (portal / non-embedded plan editor).
            When embedded in the frontend shell, externalOpenSettings is set so
            skipBuiltInSettings is true and the gear routes to the shell's
            daemon-backed dialog instead — this one is not mounted. */}
        {!skipBuiltInSettings && (
          <SettingsDialog
            open={mobileSettingsOpen}
            onOpenChange={(next) => (next ? onOpenSettings() : onCloseSettings())}
            sessionContext={null}
            daemonAvailable={false}
          />
        )}

        <PlanHeaderMenu
          appVersion={appVersion}
          updateInfo={updateInfo}
          origin={origin}
          isWSL={isWSL}
          onOpenSettings={onOpenSettings}
          onOpenExport={onOpenExport}
          onCopyAgentInstructions={onCopyAgentInstructions}
          onDownloadAnnotations={onDownloadAnnotations}
          onPrint={onPrint}
          onCopyShareLink={onCopyShareLink}
          onOpenImport={onOpenImport}
          sharingEnabled={canShareCurrentSession}
          isApiMode={isApiMode}
          agentInstructionsEnabled={agentInstructionsEnabled}
        />
      </div>
    </header>
  );
});

const AppHeaderLogo = () => (
  <div className="flex items-center gap-2 md:gap-3">
    <a
      href="https://plannotator.ai"
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 md:gap-2 hover:opacity-80 transition-opacity"
    >
      <span className="text-sm font-semibold tracking-tight">Plannotator</span>
    </a>
  </div>
);
