// src/components/shared/ConfirmDialog.tsx
// Reusable confirmation dialog for destructive/irreversible actions.
// Cancel is the focused default so a stray Enter never confirms.
import {
  Dialog,
  DialogPortal,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogContent className="max-w-sm">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="mt-2">{message}</DialogDescription>
          <div className="mt-6 flex gap-3 justify-end">
            <button
              type="button"
              autoFocus
              onClick={() => onOpenChange(false)}
              className="px-3 py-1.5 text-sm rounded bg-surface-2 text-text-muted hover:text-text-primary transition-colors"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
              className={cn(
                'px-3 py-1.5 text-sm rounded text-on-accent transition-colors',
                destructive
                  ? 'bg-danger hover:bg-danger/85'
                  : 'bg-accent-active hover:bg-accent-active/85',
              )}
            >
              {confirmLabel}
            </button>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
