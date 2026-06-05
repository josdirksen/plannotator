import React from 'react';
import { createPortal } from 'react-dom';
import { SparklesIcon } from './SparklesIcon';

interface LookAndFeelAnnouncementDialogProps {
  isOpen: boolean;
  /** Current value of the singleton configStore 'gridEnabled' key. */
  gridEnabled: boolean;
  /** App owns this — it calls configStore.set('gridEnabled', value). */
  onToggleGrid: (value: boolean) => void;
  /** Marks the announcement seen and closes the dialog. */
  onDismiss: () => void;
}

export const LookAndFeelAnnouncementDialog: React.FC<LookAndFeelAnnouncementDialogProps> = ({
  isOpen,
  gridEnabled,
  onToggleGrid,
  onDismiss,
}) => {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-xl shadow-2xl">
        {/* Header */}
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-primary/15">
              <SparklesIcon className="w-5 h-5 text-primary" />
            </div>
            <h3 className="font-semibold text-base">Plannotator got a fresh look</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            A cleaner UI 2.0 with refreshed themes and a simpler plan view.
          </p>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {/* Row 1: New look & feel */}
            <div className="flex items-start gap-3 p-3 rounded-lg border border-transparent bg-muted/50">
              <SparklesIcon className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-medium">New look &amp; feel</div>
                <div className="text-xs text-muted-foreground">
                  Refreshed themes and a cleaner design. Try the new Simple and Neutral themes in Settings.
                </div>
              </div>
            </div>

            {/* Row 2: Simplified plan mode */}
            <div className="flex items-start gap-3 p-3 rounded-lg border border-transparent bg-muted/50">
              <SparklesIcon className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-medium">Simplified plan mode</div>
                <div className="text-xs text-muted-foreground">
                  Plans now render as a clean, flat card by default. The grid-paper background is opt-in.
                </div>
              </div>
            </div>
          </div>

          {/* Opt-in: always use the grid plan background */}
          <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-muted/35">
            <div className="min-w-0">
              <div className="text-sm font-medium">Always use the grid plan background</div>
              <div className="text-xs text-muted-foreground">
                On shows the plan as a floating card on grid paper. Off keeps the simplified flat card.
              </div>
            </div>
            <button
              role="switch"
              aria-checked={gridEnabled}
              aria-label="Always use the grid plan background"
              onClick={() => onToggleGrid(!gridEnabled)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${gridEnabled ? 'bg-primary' : 'bg-muted'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${gridEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex justify-between items-center gap-3">
          <p className="text-xs text-muted-foreground">
            This notice only appears once.
          </p>
          <button
            onClick={onDismiss}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
