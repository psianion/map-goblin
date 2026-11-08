import type { ToasterProps } from 'sonner';

/**
 * Toasts in the page's own style: ink-filled, 36 tall, 12 aside, one underlined verb
 * (Undo) when the toast carries an action. They sit in the title card's band, top centre.
 */
export const SHELL_TOASTER: ToasterProps = {
  position: 'top-center',
  visibleToasts: 3,
  offset: 16,
  gap: 4,
  toastOptions: {
    unstyled: true,
    duration: 5000,
    classNames: {
      toast:
        'flex h-9 w-full items-center gap-2.5 rounded-float bg-ink px-3 font-sans text-[12px] text-on-ink shadow-e',
      title: 'min-w-0 truncate',
      icon: 'flex size-3.5 shrink-0 items-center [&>svg]:size-3.5',
      actionButton:
        'ml-auto shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[12px] font-medium text-on-ink underline underline-offset-2',
    },
  },
};
