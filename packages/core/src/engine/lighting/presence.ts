// A light's presence in the rendered set, as a weight that moves over time instead of a
// membership that flips. Pure and Pixi-free so the renderer's per-frame rule is testable.

/** How long a light takes to come up or go out when it enters or leaves the rendered set. */
export const LIGHT_FADE_MS = 300

/**
 * The renderer culls to the lights nearest the camera's centre, so a zoom or a pan moves
 * lights in and out of the rendered set — and a pool that appears fully lit in one frame
 * reads as a torch being struck. Each light carries a presence weight instead: it climbs
 * to 1 over `fadeMs` after it joins the set and falls back to 0 after it leaves, and only
 * when it reaches 0 is it dropped. Takes the last frame's weights, returns this frame's.
 * A `fadeMs` of 0 snaps (reduced motion, and the very first frame, which has nothing to
 * fade in from).
 */
export function advancePresence(
  prev: ReadonlyMap<string, number>,
  active: ReadonlySet<string>,
  dtMs: number,
  fadeMs: number,
): Map<string, number> {
  const step = fadeMs > 0 ? Math.max(0, dtMs) / fadeMs : 1
  const next = new Map<string, number>()
  for (const id of active) next.set(id, Math.min(1, (prev.get(id) ?? 0) + step))
  for (const [id, w] of prev) {
    if (active.has(id)) continue
    const down = w - step
    if (down > 0) next.set(id, down)
  }
  return next
}

/** Ease-out on a presence weight, so a pool blooms quickly and settles softly. */
export const easePresence = (w: number): number => 1 - (1 - w) * (1 - w)
