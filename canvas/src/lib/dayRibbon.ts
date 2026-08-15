// Where a clock reading sits on a day ribbon, and what the day looks like painted across one.
// Kept out of `DayRibbon.tsx` so the component file exports only components (fast refresh).

import { DAY_MINUTES } from '@/store/types'

/**
 * The ribbon's left edge, 03:00 — so the night keyframe (midnight) sits inside the track
 * instead of straddling both ends. It is the only offset in here; everything a caller passes
 * or reads back is plain clock minutes.
 */
export const DAY_START = 180

const wrapDay = (m: number): number => ((m % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES

/** Clock minutes → distance along the ribbon, 0-1439. The scrub input's value. */
export const ribbonOffset = (minutes: number): number => wrapDay(minutes - DAY_START)

/** …and back: what the scrub input's value means on the clock. */
export const offsetMinutes = (offset: number): number => wrapDay(offset + DAY_START)

/** Clock minutes → percent across the track. Keyframe handles, playhead, ticks. */
export const ribbonX = (minutes: number): number => (ribbonOffset(minutes) / DAY_MINUTES) * 100

/**
 * Hourly. Dense enough that CSS's own sRGB blend between two neighbouring samples is
 * invisible, sparse enough to stay a cheap string — the shape of the day comes from the
 * engine's OKLCH interpolation at every stop, not from the browser's interpolation between
 * five of them.
 */
const STOPS = 24

/**
 * The day painted as a CSS gradient, sampled from whatever the engine says the colour is at
 * each hour. Callers pass `timeColorAt`/`composeGrade` bound to this map — the ribbon has no
 * colour maths of its own, so it cannot drift from what the canvas renders.
 */
export function dayGradient(colorAt: (minutes: number) => string): string {
  const stops = Array.from({ length: STOPS + 1 }, (_, i) => {
    const along = (i / STOPS) * DAY_MINUTES
    return `${colorAt(offsetMinutes(along))} ${((along / DAY_MINUTES) * 100).toFixed(2)}%`
  })
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

/** Diagonal hatch for a ribbon the map does not take — "time buys you nothing here". */
export const HATCH =
  'repeating-linear-gradient(45deg, rgba(0,0,0,.38) 0 3px, transparent 3px 7px)'
