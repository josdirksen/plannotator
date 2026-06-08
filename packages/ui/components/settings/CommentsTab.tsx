import React, { useState } from 'react';
import { configStore, useConfigValue } from '../../config';

// Co-located copy of the monolith's private ToggleSwitch primitive (Settings.tsx).
// Kept here verbatim to preserve the exact look — do NOT swap to settings/shared.tsx's version.
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

/**
 * Stored label config — serialized to JSON in the config store.
 * `blocking` controls whether the blocking/non-blocking toggle
 * appears in the picker when this label is selected.
 */
interface CCLabelConfig {
  label: string;
  display: string;
  blocking: boolean; // true = show toggle in picker, false = no decoration
}

const DEFAULT_CC_LABELS: CCLabelConfig[] = [
  { label: 'suggestion', display: 'suggestion', blocking: true },
  { label: 'nitpick',    display: 'nit',        blocking: false },
  { label: 'question',   display: 'question',   blocking: true },
  { label: 'issue',      display: 'issue',      blocking: true },
  { label: 'praise',     display: 'praise',     blocking: false },
  { label: 'thought',    display: 'thought',    blocking: false },
  { label: 'note',       display: 'note',       blocking: false },
  { label: 'todo',       display: 'todo',       blocking: true },
  { label: 'chore',      display: 'chore',      blocking: true },
];

function parseCCLabels(json: string | null): CCLabelConfig[] {
  if (!json) return DEFAULT_CC_LABELS;
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return DEFAULT_CC_LABELS;
    return parsed.map((l: Record<string, unknown>) => ({
      label: (l.label as string) || 'custom',
      display: (l.display as string) || (l.label as string) || 'custom',
      blocking: l.blocking === true || l.blocking === 'true',
    }));
  } catch {
    return DEFAULT_CC_LABELS;
  }
}

export const CommentsTab: React.FC = () => {
  const conventionalComments = useConfigValue('conventionalComments');
  const labelsJson = useConfigValue('conventionalLabels');
  const [labels, setLabels] = useState(() => parseCCLabels(labelsJson));

  const isDefault = labelsJson === null;

  const save = (next: CCLabelConfig[]) => {
    setLabels(next);
    configStore.getState().set('conventionalLabels', JSON.stringify(next));
  };

  const updateLabel = (index: number, updates: Partial<CCLabelConfig>) => {
    const next = [...labels];
    next[index] = { ...next[index], ...updates };
    save(next);
  };

  const removeLabel = (index: number) => {
    save(labels.filter((_, i) => i !== index));
  };

  const addLabel = () => {
    const existing = new Set(labels.map(l => l.label));
    let slug = 'custom';
    let n = 2;
    while (existing.has(slug)) { slug = `custom-${n++}`; }
    save([...labels, { label: slug, display: slug, blocking: false }]);
  };

  const resetToDefaults = () => {
    setLabels(DEFAULT_CC_LABELS);
    configStore.getState().set('conventionalLabels', null);
  };

  return (
    <>
      <ToggleSwitch
        checked={conventionalComments}
        onChange={(v) => configStore.getState().set('conventionalComments', v)}
        label="Conventional Comments"
        description="Add structured labels to review comments"
      />

      <div className={`space-y-4 transition-opacity ${conventionalComments ? '' : 'opacity-40 pointer-events-none'}`}>

      <div className="border-t border-border" />

      {/* How it works */}
      <div className="space-y-3">
        <div>
          <div className="text-sm font-medium">How it works</div>
          <div className="text-xs text-muted-foreground leading-relaxed mt-1">
            When enabled, a label picker appears above the comment input when annotating code.
            Labels classify your feedback intent, making it clear whether a comment is a blocking issue,
            a trivial nitpick, or praise.
          </div>
        </div>

        <div className="text-xs text-muted-foreground leading-relaxed">
          Based on the{' '}
          <a
            href="https://conventionalcomments.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Conventional Comments
          </a>
          {' '}spec. Comments are exported as plain text, readable on GitHub, and parseable by tooling.
        </div>

        {/* Example output */}
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Example output</div>
          <div className="font-mono text-[11px] text-foreground/80 leading-relaxed">
            <span className="font-bold">issue</span> <span className="text-muted-foreground">(blocking)</span>: This will throw if user is null — the guard was removed in the refactor.
          </div>
        </div>
      </div>

      <div className="border-t border-border" />

      {/* Label editor */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Labels</div>
          <div className="text-xs text-muted-foreground">
            Customize labels and their default severity
          </div>
        </div>
        {!isDefault && (
          <button
            onClick={resetToDefaults}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset to defaults
          </button>
        )}
      </div>

      {/* Column headers */}
      <div className="flex items-end gap-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
        <span className="flex-1">Label</span>
        <span className="w-20 text-center">Blocking decorator</span>
        <span className="w-6" />
      </div>

      <div className="space-y-1.5">
        {labels.map((label, index) => (
          <div
            key={index}
            className="flex items-center gap-2 p-2 rounded-lg bg-muted/40"
          >
            <input
              type="text"
              value={label.display}
              onChange={(e) => {
                const display = e.target.value;
                updateLabel(index, { display, label: display });
              }}
              className="flex-1 px-2 py-1 bg-background/80 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50 min-w-0"
            />
            <div className="w-20 flex justify-center">
              <button
                role="switch"
                aria-checked={label.blocking}
                onClick={() => updateLabel(index, { blocking: !label.blocking })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  label.blocking ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
                    label.blocking ? 'translate-x-4.5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
            <button
              onClick={() => removeLabel(index)}
              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
              title="Remove label"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {labels.length < 12 && (
        <button
          onClick={addLabel}
          className="w-full py-1.5 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border rounded-lg hover:border-foreground/30 transition-colors"
        >
          + Add label
        </button>
      )}

      </div>
    </>
  );
};
