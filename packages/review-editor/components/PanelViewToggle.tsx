import React from 'react';

/**
 * Sections ⇄ Tree switcher for the left review panel. Rendered in the SAME
 * header position in both views so the control never moves under the user.
 */
export const PanelViewToggle: React.FC<{
  view: 'sections' | 'tree';
  onSelect: (view: 'sections' | 'tree') => void;
}> = ({ view, onSelect }) => (
  <div className="flex items-center bg-muted/50 rounded p-0.5" role="group" aria-label="Panel view">
    <button
      onClick={() => onSelect('sections')}
      className={`p-1 rounded-sm transition-colors ${
        view === 'sections' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
      title="Sections view (Committed / Changes / Untracked)"
      aria-pressed={view === 'sections'}
    >
      {/* stacked rows glyph */}
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16M4 10h16M4 15h16M4 20h10" />
      </svg>
    </button>
    <button
      onClick={() => onSelect('tree')}
      className={`p-1 rounded-sm transition-colors ${
        view === 'tree' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
      title="Tree view"
      aria-pressed={view === 'tree'}
    >
      {/* folder tree glyph */}
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h6M6 6v12h6m-6-6h6m3-3h6M15 15h6" />
      </svg>
    </button>
  </div>
);
