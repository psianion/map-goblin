import { useEffect } from 'react';
import { Toaster, toast } from 'sonner';
import { useToasts } from '../session/toasts';

/**
 * The table's toasts: Sonner from the shared skin, bottom-left, clear of the dock. The
 * modules still raise theirs through `session/toasts.ts` (one slot, repeats renew it); this
 * hands each one to Sonner and clears the slot when its time is up.
 */
export function TableToaster() {
  useEffect(() => {
    let shown: { id: number; timer: ReturnType<typeof setTimeout> } | null = null;
    const show = (t: ReturnType<typeof useToasts.getState>['toast']): void => {
      if (shown && (!t || t.id !== shown.id)) {
        clearTimeout(shown.timer);
        toast.dismiss(`table-${shown.id}`);
        shown = null;
      }
      if (!t) return;
      const tid = t.id;
      const id = `table-${tid}`;
      const action = t.action;
      toast(t.message, {
        id,
        duration: t.durationMs,
        ...(action
          ? {
              action: {
                label: action.label,
                onClick: () => {
                  action.onAction();
                  useToasts.getState().dismiss(tid);
                },
              },
            }
          : {}),
      });
      if (shown) clearTimeout(shown.timer);
      shown = { id: tid, timer: setTimeout(() => useToasts.getState().dismiss(tid), t.durationMs) };
    };
    show(useToasts.getState().toast);
    const unsub = useToasts.subscribe((s, prev) => {
      if (s.toast !== prev.toast) show(s.toast);
    });
    return () => {
      unsub();
      if (shown) clearTimeout(shown.timer);
    };
  }, []);

  return (
    <Toaster
      position="bottom-left"
      visibleToasts={3}
      offset={{ left: 64, bottom: 72 }}
      gap={4}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex min-h-9 w-full items-center gap-2.5 rounded-float bg-ink px-3 py-2 font-sans text-xs whitespace-pre-line text-on-ink shadow-e',
          title: 'min-w-0',
          icon: 'flex size-3.5 shrink-0 items-center [&>svg]:size-3.5',
          actionButton:
            'ml-auto shrink-0 cursor-pointer border-0 bg-transparent p-0 text-xs font-medium text-on-ink underline underline-offset-2',
        },
      }}
    />
  );
}
