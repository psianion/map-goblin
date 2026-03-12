import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </DialogPrimitive.Root>
  );
}

function DialogTrigger({ children }: { children: ReactNode }) {
  return <DialogPrimitive.Trigger>{children}</DialogPrimitive.Trigger>;
}

function DialogPortal({ children }: { children: ReactNode }) {
  return <DialogPrimitive.Portal>{children}</DialogPrimitive.Portal>;
}

function DialogBackdrop({ className }: { className?: string }) {
  return (
    <DialogPrimitive.Backdrop
      className={cn(
        'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm',
        'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200',
        className,
      )}
    />
  );
}

function DialogContent({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <DialogPrimitive.Popup
      className={cn(
        'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
        'w-full max-w-md rounded-xl border border-border bg-surface-1 p-6 shadow-xl',
        'data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
        'data-[ending-style]:scale-95 data-[ending-style]:opacity-0',
        'transition-all duration-200',
        className,
      )}
    >
      {children}
    </DialogPrimitive.Popup>
  );
}

function DialogTitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <DialogPrimitive.Title
      className={cn('text-base font-semibold text-foreground', className)}
    >
      {children}
    </DialogPrimitive.Title>
  );
}

function DialogDescription({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <DialogPrimitive.Description
      className={cn('text-sm text-muted-foreground', className)}
    >
      {children}
    </DialogPrimitive.Description>
  );
}

function DialogClose({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <DialogPrimitive.Close className={cn(className)}>
      {children}
    </DialogPrimitive.Close>
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
};
