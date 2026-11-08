import { useRef } from 'react';

/**
 * A control that writes live while it moves and lands as one undo step: the value at the
 * first change is held, and when the gesture ends (pointer or key up, or focus leaving)
 * `commit(start, end)` runs once if anything changed. Spread `wrap` on an element round the
 * control; a picker in a portal still reports its pointer up there, as React events bubble.
 */
export function useLiveEdit<T>(read: () => T, apply: (v: T) => void, commit: (start: T, end: T) => void) {
  const start = useRef<{ value: T } | null>(null);
  const change = (v: T) => {
    if (!start.current) start.current = { value: read() };
    apply(v);
  };
  const end = () => {
    const held = start.current;
    if (!held) return;
    start.current = null;
    const now = read();
    if (!Object.is(held.value, now)) commit(held.value, now);
  };
  return { change, wrap: { onPointerUp: end, onKeyUp: end, onBlur: end } };
}
