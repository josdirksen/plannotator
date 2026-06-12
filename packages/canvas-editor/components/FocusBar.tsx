/**
 * Floating bar shown while a frame is in focus mode: title, prev/next
 * navigation (flip through frames like pages), comments, and exit.
 */

import React from "react";
import type { CanvasFrame } from "../types";

export interface FocusBarProps {
  frame: CanvasFrame;
  pendingComments: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onOpenComments: () => void;
  onExit: () => void;
}

export function FocusBar({
  frame,
  pendingComments,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onOpenComments,
  onExit,
}: FocusBarProps) {
  return (
    <div className="pointer-events-auto absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border/60 bg-card/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
      <button
        onClick={onPrev}
        disabled={!hasPrev}
        title="Previous frame"
        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-30"
      >
        ‹
      </button>
      <div className="max-w-[280px] truncate px-1 text-[12.5px] font-medium text-foreground">
        {frame.title}
        <span className="ml-1.5 text-[10px] text-muted-foreground">r{frame.revision}</span>
      </div>
      <button
        onClick={onNext}
        disabled={!hasNext}
        title="Next frame"
        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-30"
      >
        ›
      </button>
      <div className="mx-1 h-4 w-px bg-border/70" />
      <button
        onClick={onOpenComments}
        className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Comments"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M21 11.5a8.38 8.38 0 01-8.4 8.4 8.5 8.5 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 018.4-8.4 8.38 8.38 0 018.6 8.4z" />
        </svg>
        {pendingComments > 0 && (
          <span className="rounded-full bg-accent/20 px-1.5 text-[10px] font-semibold text-accent">
            {pendingComments}
          </span>
        )}
      </button>
      <button
        onClick={onExit}
        className="cursor-pointer rounded px-1.5 py-0.5 text-[11.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Exit focus (Esc)"
      >
        Exit
      </button>
    </div>
  );
}
