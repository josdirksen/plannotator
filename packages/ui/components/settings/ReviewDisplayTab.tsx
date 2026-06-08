import React, { useEffect } from 'react';
import { configStore, useConfigValue } from '../../config';
import { loadDiffFont } from '../../utils/diffFonts';
import {
  DIFF_FONT_OPTIONS,
  DIFF_STYLE_OPTIONS,
  OVERFLOW_OPTIONS,
  INDICATOR_OPTIONS,
  LINE_DIFF_OPTIONS,
  LINE_BG_INTENSITY_OPTIONS,
} from './diffOptions';

// Co-located copies of the monolith's private primitives (Settings.tsx ~115-167).
// Kept here verbatim to preserve the exact review-tab look — do NOT swap to settings/shared.tsx versions.

function SegmentedControl<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 text-xs rounded-md whitespace-nowrap transition-colors ${
            value === opt.value
              ? 'bg-background text-foreground shadow-sm font-medium'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ToggleSwitch({ checked, onChange, label, description }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

export const ReviewDisplayTab: React.FC = () => {
  const diffStyle = useConfigValue('diffStyle');
  const diffOverflow = useConfigValue('diffOverflow');
  const diffIndicators = useConfigValue('diffIndicators');
  const diffLineDiffType = useConfigValue('diffLineDiffType');
  const diffShowLineNumbers = useConfigValue('diffShowLineNumbers');
  const diffShowBackground = useConfigValue('diffShowBackground');
  const diffLineBgIntensity = useConfigValue('diffLineBgIntensity');
  const diffHideWhitespace = useConfigValue('diffHideWhitespace');
  const diffFontFamily = useConfigValue('diffFontFamily');
  const diffFontSize = useConfigValue('diffFontSize');
  const diffTabSize = useConfigValue('diffTabSize');

  useEffect(() => {
    if (diffFontFamily) loadDiffFont(diffFontFamily);
  }, [diffFontFamily]);

  const fontSizeNum = diffFontSize ? parseInt(diffFontSize) : 13;

  return (
    <div className="space-y-6">
      {/* Typography */}
      <section className="space-y-3">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Typography</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Code Font</div>
            <select
              value={diffFontFamily}
              onChange={(e) => configStore.getState().set('diffFontFamily', e.target.value)}
              className="px-2 py-1 text-xs rounded-md bg-muted/50 border border-border text-foreground"
              style={diffFontFamily ? { fontFamily: `'${diffFontFamily}', monospace` } : undefined}
            >
              {DIFF_FONT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Font Size</div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => configStore.getState().set('diffFontSize', `${Math.max(8, fontSizeNum - 1)}px`)}
                disabled={fontSizeNum <= 8}
                className="h-7 w-7 rounded-md bg-muted text-foreground flex items-center justify-center text-xs font-medium disabled:opacity-30"
              >
                −
              </button>
              <span className="w-8 text-center text-xs font-mono tabular-nums">{fontSizeNum}px</span>
              <button
                type="button"
                onClick={() => configStore.getState().set('diffFontSize', `${Math.min(24, fontSizeNum + 1)}px`)}
                disabled={fontSizeNum >= 24}
                className="h-7 w-7 rounded-md bg-muted text-foreground flex items-center justify-center text-xs font-medium disabled:opacity-30"
              >
                +
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Tab Size</div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => configStore.getState().set('diffTabSize', Math.max(1, diffTabSize - 1))}
                disabled={diffTabSize <= 1}
                className="h-7 w-7 rounded-md bg-muted text-foreground flex items-center justify-center text-xs font-medium disabled:opacity-30"
              >
                −
              </button>
              <span className="w-8 text-center text-xs font-mono tabular-nums">{diffTabSize}</span>
              <button
                type="button"
                onClick={() => configStore.getState().set('diffTabSize', Math.min(8, diffTabSize + 1))}
                disabled={diffTabSize >= 8}
                className="h-7 w-7 rounded-md bg-muted text-foreground flex items-center justify-center text-xs font-medium disabled:opacity-30"
              >
                +
              </button>
            </div>
          </div>
        </div>
        <div
          className="text-xs text-muted-foreground px-2 py-1.5 rounded-md bg-muted/30 font-mono"
          style={{ fontFamily: diffFontFamily ? `'${diffFontFamily}', monospace` : undefined, fontSize: `${fontSizeNum}px` }}
        >
          const x = fn(42);
        </div>
      </section>

      <div className="border-t border-border" />

      {/* Diff Layout */}
      <section className="space-y-3">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Layout</h3>
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm font-medium shrink-0">Diff Style</div>
          <SegmentedControl options={DIFF_STYLE_OPTIONS} value={diffStyle} onChange={(v) => configStore.getState().set('diffStyle', v)} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm font-medium shrink-0">Line Overflow</div>
          <SegmentedControl options={OVERFLOW_OPTIONS} value={diffOverflow} onChange={(v) => configStore.getState().set('diffOverflow', v)} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm font-medium shrink-0">Change Indicators</div>
          <SegmentedControl options={INDICATOR_OPTIONS} value={diffIndicators} onChange={(v) => configStore.getState().set('diffIndicators', v)} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm font-medium shrink-0">Inline Diff</div>
          <SegmentedControl options={LINE_DIFF_OPTIONS} value={diffLineDiffType} onChange={(v) => configStore.getState().set('diffLineDiffType', v)} />
        </div>
      </section>

      <div className="border-t border-border" />

      {/* Toggles */}
      <section className="space-y-3">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Options</h3>
        <ToggleSwitch
          checked={diffShowLineNumbers}
          onChange={(v) => configStore.getState().set('diffShowLineNumbers', v)}
          label="Line Numbers"
        />
        <ToggleSwitch
          checked={diffHideWhitespace}
          onChange={(v) => configStore.getState().set('diffHideWhitespace', v)}
          label="Hide Whitespace"
        />
        <ToggleSwitch
          checked={diffShowBackground}
          onChange={(v) => configStore.getState().set('diffShowBackground', v)}
          label="Line Backgrounds"
        />
        {diffShowBackground && (
          <div className="flex items-center justify-between gap-4 pl-4">
            <div className="text-sm font-medium shrink-0">Intensity</div>
            <SegmentedControl options={LINE_BG_INTENSITY_OPTIONS} value={diffLineBgIntensity} onChange={(v) => configStore.getState().set('diffLineBgIntensity', v)} />
          </div>
        )}
      </section>
    </div>
  );
};
