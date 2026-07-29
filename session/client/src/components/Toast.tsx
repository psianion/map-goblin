import { useEffect } from 'react';
import { prefersReducedMotion } from '../session/motion';
import { useToasts } from '../session/toasts';

/**
 * The table's only toast, bottom-centre over the map. One component for every use — the
 * undo window after a bulk fog change and the refusal from a locked door read the same,
 * because they are the same thing: something happened, here is the one move you have.
 *
 * The dismissal timer lives here rather than in the store so a toast never outlives the
 * table it belongs to, and so tests can drive it with fake timers without touching state.
 */
export function ToastHost() {
  const toast = useToasts((s) => s.toast);
  const dismiss = useToasts((s) => s.dismiss);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => dismiss(toast.id), toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;

  // The entrance conveys arrival — with reduced motion the toast is simply already there.
  const entrance = prefersReducedMotion() ? '' : 'animate-toast-in';

  return (
    // max-sm lift: clears the bottom-left tool indicator once the map pane gets
    // narrow enough for the centred track to reach it.
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-toast flex justify-center px-4 max-sm:bottom-14">
      <div
        role="status"
        aria-live="polite"
        data-testid="toast"
        data-toast-id={toast.id}
        data-animated={entrance ? 'true' : 'false'}
        className={`pointer-events-auto flex max-w-md items-center gap-3 rounded border border-border-default bg-surface-2 px-3 py-2 text-sm text-text-primary shadow-lg shadow-black/50 ${entrance}`}
      >
        <span className="min-w-0 flex-1">{toast.message}</span>
        {toast.action && (
          <button
            type="button"
            data-testid="toast-action"
            onClick={() => {
              toast.action?.onAction();
              dismiss(toast.id);
            }}
            className="shrink-0 rounded-chip border border-border-default px-2 py-1 text-xs font-medium text-text-primary transition-colors duration-150 ease-out-quart hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:bg-surface-1 motion-reduce:transition-none"
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  );
}
