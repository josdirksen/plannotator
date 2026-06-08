import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import type { EditorMode, InputMethod } from '../types';
import { TaterSpritePullup } from './sprites';
import { MousePointer2, Crosshair, Pencil, MessageSquare, Zap } from 'lucide-react';
import { RedlineIcon } from './icons/RedlineIcon';

interface AnnotationToolstripProps {
  inputMethod: InputMethod;
  onInputMethodChange: (method: InputMethod) => void;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  taterMode?: boolean;
  /**
   * Compact mode: used inside the sticky header lane. Buttons only expand for
   * the active mode (no hover expansion), gap is tightened, and the help link
   * is hidden.
   */
  compact?: boolean;
  /**
   * Icon-only mode: no button ever expands to show a label, even the active
   * one. Used in the sticky header lane on mobile so the toolstrip stays
   * narrow and leaves room for the diff badges.
   */
  iconOnly?: boolean;
  /**
   * Show the "how does this work?" help link. Default true; hidden on the
   * floating HTML toolstrip where space is tight.
   */
  showHelpLink?: boolean;
}

export const AnnotationToolstrip: React.FC<AnnotationToolstripProps> = ({
  inputMethod,
  onInputMethodChange,
  mode,
  onModeChange,
  taterMode,
  compact = false,
  iconOnly = false,
  showHelpLink = true,
}) => {
  const [showHelp, setShowHelp] = useState(false);
  const [helpTab, setHelpTab] = useState<'selection' | 'plannotator'>('selection');
  const [mounted, setMounted] = useState(false);

  // Enable transitions only after first paint
  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  return (
    <>
      <div className={`flex items-center flex-wrap ${compact ? 'gap-1' : 'gap-1.5'}`}>
        {/* Input method group */}
        <div className={`inline-flex select-none items-center gap-0.5 ${compact ? 'rounded-md bg-muted/40' : 'rounded-lg bg-muted/60'} p-0.5`}>
          <ToolstripButton
            active={inputMethod === 'drag'}
            onClick={() => onInputMethodChange('drag')}
            label="Select"
            color="primary"
            mounted={mounted}
            compact={compact}
            iconOnly={iconOnly}
            icon={
              <MousePointer2 className="w-3.5 h-3.5 shrink-0" />
            }
          />
          <ToolstripButton
            active={inputMethod === 'pinpoint'}
            onClick={() => onInputMethodChange('pinpoint')}
            label="Pinpoint"
            color="primary"
            mounted={mounted}
            compact={compact}
            iconOnly={iconOnly}
            icon={
              <Crosshair className="w-3.5 h-3.5 shrink-0" />
            }
          />
        </div>

        {/* Action mode group */}
        <div className={`inline-flex select-none items-center gap-0.5 ${compact ? 'rounded-md bg-muted/40' : 'rounded-lg bg-muted/60'} p-0.5`}>
          <ToolstripButton
            active={mode === 'selection'}
            onClick={() => onModeChange('selection')}
            label="Markup"
            color="secondary"
            mounted={mounted}
            compact={compact}
            iconOnly={iconOnly}
            icon={
              <Pencil className="w-3.5 h-3.5 shrink-0" />
            }
          />
          <ToolstripButton
            active={mode === 'comment'}
            onClick={() => onModeChange('comment')}
            label="Comment"
            color="accent"
            mounted={mounted}
            compact={compact}
            iconOnly={iconOnly}
            icon={
              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
            }
          />
          <ToolstripButton
            active={mode === 'redline'}
            onClick={() => onModeChange('redline')}
            label="Redline"
            color="destructive"
            mounted={mounted}
            compact={compact}
            iconOnly={iconOnly}
            icon={
              <RedlineIcon className="w-3.5 h-3.5 shrink-0" />
            }
          />
          <ToolstripButton
            active={mode === 'quickLabel'}
            onClick={() => onModeChange('quickLabel')}
            label="Label"
            color="warning"
            mounted={mounted}
            compact={compact}
            iconOnly={iconOnly}
            icon={
              <Zap className="w-3.5 h-3.5 shrink-0" />
            }
          />
        </div>

        {/* Help */}
        {!compact && showHelpLink && (
          <button
            onClick={() => setShowHelp(true)}
            className="ml-2 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors hidden sm:block"
          >
            how does this work?
          </button>
        )}
      </div>

      {/* Help Video Dialog */}
      {showHelp && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-card border border-border rounded-xl w-full max-w-2xl shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            {taterMode && <TaterSpritePullup />}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
                <button
                  onClick={() => setHelpTab('selection')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    helpTab === 'selection'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Selection Modes
                </button>
                <button
                  onClick={() => setHelpTab('plannotator')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    helpTab === 'plannotator'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  How Plannotator Works
                </button>
              </div>
              <button
                onClick={() => setShowHelp(false)}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="aspect-video">
              <iframe
                key={helpTab}
                width="100%"
                height="100%"
                src={helpTab === 'selection'
                  ? 'https://www.youtube.com/embed/ZNt9jtfx9TY?autoplay=1'
                  : 'https://www.youtube.com/embed/a_AT7cEN_9I?autoplay=1'
                }
                title={helpTab === 'selection' ? 'How Selection Modes Work' : 'How Plannotator Works'}
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/* ─── Color system ─── */

/* Active state mirrors the prototype's ToolstripBtn: a raised `bg-card shadow-sm`
 * surface with a per-mode active color (input-method=foreground, markup/comment
 * =blue-500, redline=red-500, label=yellow-500). */
const colorStyles = {
  primary: {
    active: 'bg-card text-foreground shadow-sm',
    hover: 'text-primary/80 bg-primary/8',
    inactive: 'text-muted-foreground hover:text-foreground',
  },
  secondary: {
    active: 'bg-card text-blue-500 shadow-sm',
    hover: 'text-secondary/80 bg-secondary/8',
    inactive: 'text-muted-foreground hover:text-foreground',
  },
  accent: {
    active: 'bg-card text-annotation-comment shadow-sm',
    hover: 'text-annotation-comment/80 bg-annotation-comment/8',
    inactive: 'text-muted-foreground hover:text-foreground',
  },
  destructive: {
    active: 'bg-card text-red-500 shadow-sm',
    hover: 'text-destructive/80 bg-destructive/8',
    inactive: 'text-muted-foreground hover:text-foreground',
  },
  warning: {
    active: 'bg-card text-yellow-500 shadow-sm',
    hover: 'text-warning/80 bg-warning/8',
    inactive: 'text-muted-foreground hover:text-foreground',
  },
} as const;

type ButtonColor = keyof typeof colorStyles;

/* ─── Constants ─── */

const ICON_SIZE = 28;       // collapsed button width (px)
const H_PAD = 10;           // horizontal padding when expanded (px) — matches px-2.5
const GAP = 6;              // gap between icon and label (px) — matches gap-1.5
const ICON_INNER = 14;      // icon element width (px)
const DURATION = 180;       // transition ms

/* ─── Button ─── */

const ToolstripButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  color: ButtonColor;
  mounted: boolean;
  compact?: boolean;
  iconOnly?: boolean;
}> = ({ active, onClick, icon, label, color, mounted, compact = false, iconOnly = false }) => {
  const [hovered, setHovered] = useState(false);
  const [labelWidth, setLabelWidth] = useState(0);
  const measureRef = useRef<HTMLSpanElement>(null);
  const styles = colorStyles[color];
  const [isTouchDevice] = useState(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0);

  // Measure label text width synchronously before first paint
  useLayoutEffect(() => {
    if (measureRef.current) {
      setLabelWidth(measureRef.current.offsetWidth);
    }
  }, [label]);

  // iconOnly: never expand (mobile sticky lane).
  // compact: only active expands (sm+ sticky lane — shows current mode).
  // default: active or hovered expands (top-of-doc full toolstrip).
  const expanded = iconOnly
    ? false
    : compact
      ? active
      : (active || hovered || isTouchDevice);
  const expandedWidth = H_PAD + ICON_INNER + GAP + labelWidth + H_PAD;
  const currentWidth = expanded ? expandedWidth : ICON_SIZE;

  const colorClass = active
    ? styles.active
    : hovered
      ? styles.hover
      : styles.inactive;

  const transition = mounted
    ? `width ${DURATION}ms cubic-bezier(0.25, 0.46, 0.45, 0.94), background-color ${DURATION}ms ease, color ${DURATION}ms ease, box-shadow ${DURATION}ms ease`
    : 'none';

  const innerTransition = mounted
    ? `padding-left ${DURATION}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`
    : 'none';

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`relative flex items-center h-7 rounded-md overflow-hidden ${colorClass}`}
      style={{ width: currentWidth, transition }}
    >
      {/* Inner flex container — fixed layout, no layout-shifting properties animated */}
      <div
        className="flex items-center whitespace-nowrap"
        style={{ paddingLeft: expanded ? H_PAD : (ICON_SIZE - ICON_INNER) / 2, gap: GAP, transition: innerTransition }}
      >
        {icon}
        <span
          className="text-xs font-medium"
          style={{
            opacity: expanded ? 1 : 0,
            transition: mounted ? `opacity ${expanded ? DURATION : DURATION * 0.6}ms ease ${expanded ? '60ms' : '0ms'}` : 'none',
          }}
        >
          {label}
        </span>
      </div>

      {/* Hidden measurement span — rendered offscreen to get label pixel width */}
      <span
        ref={measureRef}
        className="text-xs font-medium absolute pointer-events-none"
        style={{ visibility: 'hidden', position: 'absolute', left: -9999 }}
        aria-hidden
      >
        {label}
      </span>
    </button>
  );
};
