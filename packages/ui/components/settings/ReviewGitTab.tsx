import React from 'react';
import { configStore, useConfigValue } from '../../config';
import { DEFAULT_DIFF_TYPE_OPTIONS } from './diffOptions';

export const GitTab: React.FC = () => {
  const defaultDiffType = useConfigValue('defaultDiffType');
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">Default Diff View</div>
        <div className="text-xs text-muted-foreground">Which changes to show when you open a code review</div>
      </div>
      <div className="space-y-2">
        {DEFAULT_DIFF_TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => configStore.getState().set('defaultDiffType', opt.value)}
            className={`w-full flex items-start gap-3 p-3 rounded-lg border transition-colors text-left ${
              defaultDiffType === opt.value
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-muted-foreground/30 hover:bg-muted/50'
            }`}
          >
            <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
              defaultDiffType === opt.value ? 'border-primary' : 'border-muted-foreground/40'
            }`}>
              {defaultDiffType === opt.value && (
                <div className="w-2 h-2 rounded-full bg-primary" />
              )}
            </div>
            <div>
              <div className="text-sm font-medium">{opt.label}</div>
              <div className="text-xs text-muted-foreground">{opt.description}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
