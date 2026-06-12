/**
 * Confirmation dialog built on the shared shadcn Dialog primitive, so canvas
 * confirms (feedback dispatch) match the rest of the app instead of a
 * hand-rolled overlay or window.confirm.
 */

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@plannotator/ui/components/ui/dialog";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  /** Optional preview of exactly what will be sent. */
  body?: React.ReactNode;
  confirmLabel?: string;
  /** Label shown on the confirm button while `busy`. Defaults to "Sending…". */
  busyLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  body,
  confirmLabel = "Send",
  busyLabel = "Sending…",
  cancelLabel = "Cancel",
  busy = false,
  error = null,
  onConfirm,
  onOpenChange,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" hideClose>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex flex-col gap-3 px-5 py-4">
          {body && (
            <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg bg-muted/40 p-3 text-[12.5px] leading-snug">
              {body}
            </div>
          )}
          {error && <div className="text-[12px] text-destructive">{error}</div>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => onOpenChange(false)}
              className="cursor-pointer rounded-md px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? busyLabel : confirmLabel}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
