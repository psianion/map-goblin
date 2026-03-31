import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Returns { isIdle } — true when the user has been idle for `ms` milliseconds.
 *
 * Tracks pointerdown + keydown globally. pointermove is intentionally NOT
 * tracked — callers should use onMouseEnter/onMouseLeave on UI chrome elements
 * so canvas mouse movement never restores faded panels.
 *
 * When `enabled` is false, always returns { isIdle: false }.
 */
export function useIdleTimer(ms: number, enabled: boolean): { isIdle: boolean; resetTimer: () => void } {
  const [idle, setIdle] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setIdle(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIdle(true), ms);
  }, [ms]);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }
    // Start the idle timer without calling setState synchronously in the effect body
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIdle(true), ms);
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
    };
  }, [enabled, reset, ms]);

  // When disabled, report non-idle without calling setState inside the above effect
  return { isIdle: enabled && idle, resetTimer: reset };
}
