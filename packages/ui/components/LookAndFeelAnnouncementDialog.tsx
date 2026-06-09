import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { SparklesIcon } from './SparklesIcon';
import lookGridImg from '../assets/look-grid.png';
import lookFlatImg from '../assets/look-flat.png';

interface LookAndFeelAnnouncementDialogProps {
  isOpen: boolean;
  /** Current value of the singleton configStore 'gridEnabled' key. */
  gridEnabled: boolean;
  /** App owns this — it calls configStore.set('gridEnabled', value). */
  onToggleGrid: (value: boolean) => void;
  /** Marks the announcement seen and closes the dialog. */
  onDismiss: () => void;
}

const OPTIONS: {
  key: string;
  /** gridEnabled value this option selects. */
  value: boolean;
  img: string;
  title: string;
  tag: string;
  desc: string;
}[] = [
  {
    key: 'grid',
    value: true,
    img: lookGridImg,
    title: 'Grid',
    tag: 'Classic',
    desc: 'Your plan as a floating card on grid paper.',
  },
  {
    key: 'flat',
    value: false,
    img: lookFlatImg,
    title: 'Clean',
    tag: 'New',
    desc: 'A simpler, edge-to-edge flat card.',
  },
];

export const LookAndFeelAnnouncementDialog: React.FC<LookAndFeelAnnouncementDialogProps> = ({
  isOpen,
  gridEnabled,
  onToggleGrid,
  onDismiss,
}) => {
  const [hovered, setHovered] = useState<string | null>(null);
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
            Your plans still open in the classic grid view. There&apos;s also a new, simpler clean
            look — pick whichever you prefer. Hover an option to preview it.
          </p>
        </div>

        {/* Body: two image options (click to choose, hover to preview) */}
        <div className="flex gap-4 p-5 pt-7">
          {OPTIONS.map((opt) => {
            const selected = gridEnabled === opt.value;
            const isHovered = hovered === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onToggleGrid(opt.value)}
                onMouseEnter={() => setHovered(opt.key)}
                onMouseLeave={() => setHovered((h) => (h === opt.key ? null : h))}
                aria-pressed={selected}
                className={`flex-1 min-w-0 flex flex-col items-stretch gap-2 rounded-lg border p-2 text-left transition-colors ${
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/40'
                }`}
              >
                <div className="relative">
                  <img
                    src={opt.img}
                    alt={`${opt.title} plan look`}
                    className="w-full rounded-md select-none"
                    draggable={false}
                    style={{
                      border: `2px solid ${
                        selected
                          ? 'var(--primary)'
                          : 'color-mix(in srgb, var(--primary) 25%, transparent)'
                      }`,
                      transform: isHovered ? 'scale(1.55)' : 'scale(1)',
                      transformOrigin: 'center',
                      zIndex: isHovered ? 50 : 0,
                      position: 'relative',
                      boxShadow: isHovered ? '0 14px 36px rgba(0,0,0,0.4)' : 'none',
                      transition:
                        'transform 0.25s cubic-bezier(0.34,1.56,0.64,1), border-color 0.2s ease, box-shadow 0.2s ease',
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <span className="text-sm font-medium">{opt.title}</span>
                  <span
                    className={`text-[10px] leading-none px-1.5 py-0.5 rounded-full ${
                      selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {selected ? 'Selected' : opt.tag}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground px-0.5 leading-snug">{opt.desc}</p>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex justify-between items-center gap-3">
          <p className="text-xs text-muted-foreground">You can switch anytime in Settings.</p>
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
