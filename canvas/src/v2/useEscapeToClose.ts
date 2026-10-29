import { useEffect } from 'react';

/**
 * Escape closes a v2 dialog from anywhere in it, a focused field included. Heard on the
 * window in the capture phase, ahead of everything else: the dialogs stop keys at their
 * form so canvas shortcuts stay out (which also keeps Escape from the dialog's own
 * document listener), the home page's key shield drops keys aimed outside the page, and
 * the editor's Escape cascade must not act on the same press.
 *
 * While `blocked` is set (an import running, say) Escape is still kept from the canvas,
 * but the dialog stays open.
 */
export function useEscapeToClose(open: boolean, onClose: () => void, blocked = false) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      if (!blocked) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose, blocked]);
}
