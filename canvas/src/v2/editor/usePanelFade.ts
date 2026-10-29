import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the pointer stays off the chrome before it fades. */
export const PANEL_FADE_DELAY_MS = 5000;

/**
 * Focus mode Auto: one global fade for all the editor chrome. After the pointer has been
 * off the chrome for `PANEL_FADE_DELAY_MS`, `faded` turns true; moving onto any
 * `[data-chrome]` element turns it back and holds it until the pointer leaves again.
 *
 * Polls pointermove on the document rather than counting enter/leave per panel, which
 * goes wrong when panels unmount and remount (the v1 right panel collapsing swaps
 * components). Both routes use it: v1 fades its panels inline, v2 off `data-faded` on the shell.
 */
export function usePanelFade(active: boolean) {
  const [faded, setFaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overChrome = useRef(false);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFaded(true), PANEL_FADE_DELAY_MS);
  }, []);

  useEffect(() => {
    if (!active) {
      if (timerRef.current) clearTimeout(timerRef.current);
      const id = setTimeout(() => setFaded(false), 0);
      return () => clearTimeout(id);
    }

    startTimer();

    const onPointerMove = (e: PointerEvent) => {
      const target = e.target as Element | null;
      const isOverChrome = !!target?.closest?.('[data-chrome]');
      if (isOverChrome && !overChrome.current) {
        // Entered chrome
        overChrome.current = true;
        if (timerRef.current) clearTimeout(timerRef.current);
        setFaded(false);
      } else if (!isOverChrome && overChrome.current) {
        // Left chrome
        overChrome.current = false;
        startTimer();
      }
    };

    document.addEventListener('pointermove', onPointerMove);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, startTimer]);

  return { faded };
}
