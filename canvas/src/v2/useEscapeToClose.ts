import { useEffect, useLayoutEffect, useRef } from 'react';

interface EscapeEntry {
  onClose: () => void;
  blocked: boolean;
  keepFieldEscape: boolean;
}

/** What is open, oldest first: Escape closes only the last. */
const stack: { current: EscapeEntry }[] = [];

const isField = (t: EventTarget | null): boolean =>
  !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.isComposing) return;
  const top = stack[stack.length - 1]?.current;
  if (!top || (top.keepFieldEscape && isField(e.target))) return;
  e.preventDefault();
  e.stopPropagation();
  if (!top.blocked) top.onClose();
}

/**
 * Escape closes what was opened last: a dialog, a menu, a popover or a sheet, one per
 * press. Everything open registers here, on one listener heard on the window in the
 * capture phase, ahead of everything else: the dialogs stop keys at their form so canvas
 * shortcuts stay out (which also keeps Escape from the dialog's own document listener),
 * the home page's key shield drops keys aimed outside the page, and the editor's Escape
 * cascade must not act on the same press.
 *
 * While `blocked` is set (an import running, say) Escape is still kept from the canvas,
 * but the dialog stays open. With `keepFieldEscape` (a sheet), a field inside keeps its
 * own Escape (rename, filter).
 */
export function useEscapeToClose(open: boolean, onClose: () => void, blocked = false, keepFieldEscape = false) {
  const entry = useRef<EscapeEntry>({ onClose, blocked, keepFieldEscape });
  useLayoutEffect(() => {
    entry.current = { onClose, blocked, keepFieldEscape };
  });
  // Keyed on `open` alone, so a new onClose each render keeps the entry where it is.
  useEffect(() => {
    if (!open) return;
    stack.push(entry);
    if (stack.length === 1) window.addEventListener('keydown', onKey, true);
    return () => {
      stack.splice(stack.lastIndexOf(entry), 1);
      if (stack.length === 0) window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
}
