import React from 'react';

/**
 * Sections ⇄ Tree switcher for the left review panel. Rendered in the SAME
 * header position in both views so the control never moves under the user.
 */
export const PanelViewToggle: React.FC<{
  view: 'sections' | 'tree';
  onSelect: (view: 'sections' | 'tree') => void;
}> = ({ view, onSelect }) => (
  <div className="flex items-center bg-muted/50 rounded p-0.5 flex-shrink-0" role="group" aria-label="Panel view">
    <button
      onClick={() => onSelect('sections')}
      className={`px-1.5 py-0.5 rounded-sm text-[10px] leading-none whitespace-nowrap transition-colors ${
        view === 'sections' ? 'bg-background text-foreground shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
      }`}
      title="Git status view (Committed / Changes / Untracked)"
      aria-pressed={view === 'sections'}
    >
      Git status
    </button>
    <button
      onClick={() => onSelect('tree')}
      className={`px-1.5 py-0.5 rounded-sm text-[10px] leading-none whitespace-nowrap transition-colors ${
        view === 'tree' ? 'bg-background text-foreground shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
      }`}
      title="Tree view"
      aria-pressed={view === 'tree'}
    >
      Tree
    </button>
  </div>
);
