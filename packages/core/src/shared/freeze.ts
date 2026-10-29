// Deterministic mode for pixel tests. `?freeze=<minutes>` on the editor or table URL sets
// `window.__GG_FREEZE__ = { minutes }`, and everything that moves on its own reads this one
// place: the clock stands at `minutes`, the living-fog cloud and flicker/pulse stand at a fixed
// phase, and eased fades snap to their end.

export interface Freeze {
  /** The clock the frame is pinned at, minutes 0-1439. */
  minutes: number;
}

type FreezeHost = { __GG_FREEZE__?: Freeze; location?: { search?: string } };

const host = (): FreezeHost | undefined =>
  typeof globalThis === 'undefined' ? undefined : (globalThis as unknown as FreezeHost);

/** The freeze in force, or null. Reads the global first, then the `?freeze=` URL param once. */
export function freezeOf(): Freeze | null {
  const g = host();
  if (!g) return null;
  if (g.__GG_FREEZE__) return g.__GG_FREEZE__;
  const search = g.location?.search;
  if (!search) return null;
  const raw = new URLSearchParams(search).get('freeze');
  if (raw === null) return null;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes)) return null;
  g.__GG_FREEZE__ = { minutes: ((Math.floor(minutes) % 1440) + 1440) % 1440 };
  return g.__GG_FREEZE__;
}

/** Whether a freeze is in force. */
export const isFrozen = (): boolean => freezeOf() !== null;

/** The animation clock, seconds: fixed at 0 under a freeze, else `now`. */
export function animationTime(nowMs: number): number {
  return isFrozen() ? 0 : nowMs / 1000;
}

/** Clears the freeze (tests). */
export function clearFreeze(): void {
  const g = host();
  if (g) delete g.__GG_FREEZE__;
}
