import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from '@/lib/utils';
import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/** Whether the Dialog around a DialogContent is open. */
const DialogOpenContext = createContext(true);

function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogOpenContext.Provider value={open}>{children}</DialogOpenContext.Provider>
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
  const open = useContext(DialogOpenContext);
  const popup = useRef<HTMLDivElement>(null);
  // A closed dialog stays mounted for its fade, and Base UI hands the focus back only when it
  // unmounts. Let go of the focus now, so a key pressed during the fade (Ctrl+Shift+N straight
  // after Escape) reaches the map instead of the fading form.
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (!open && active instanceof HTMLElement && popup.current?.contains(active)) active.blur();
  }, [open]);
  return (
    <DialogPrimitive.Popup
      ref={popup}
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
