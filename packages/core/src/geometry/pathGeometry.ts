// A path child's derived geometry, cached per child object: the store hands back a new
// object on every edit, so a WeakMap on the child is exactly as fresh as the child.

import type { PathChild } from '../shared/types';
import type { Polygon } from './GeometryEngine';
import { ribbonOutline, sampleCentreline, shoreReach, type Centreline, type ShoreReach } from './ribbon';

interface Derived {
  line: Centreline;
  outline?: Polygon[];
  shore?: ShoreReach | null;
}

const cache = new WeakMap<PathChild, Derived>();

function derived(path: PathChild): Derived {
  let d = cache.get(path);
  if (!d) {
    d = { line: sampleCentreline(path.points, path.closed, path.width, { ends: path.ends }) };
    cache.set(path, d);
  }
  return d;
}

/** The flattened centreline with width and height per sample. */
export function pathCentreline(path: PathChild): Centreline {
  return derived(path).line;
}

/** The outline for hit testing: the ribbon, and the interior too when closed and filled. */
export function pathOutline(path: PathChild): Polygon[] {
  const d = derived(path);
  d.outline ??= ribbonOutline(d.line, !!path.fill && path.closed);
  return d.outline;
}

/** Even-odd over the outline's rings, so a closed ribbon's hole is not the path. */
export function pointInPath(path: PathChild, [x, y]: [number, number]): boolean {
  let inside = false;
  for (const ring of pathOutline(path)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * For a filled closed path (a lake, a pool): how far its shoreline band may reach to each side
 * of each sample without crossing another stretch of shore. Null for any other path, which
 * keeps its width.
 */
export function pathShoreReach(path: PathChild): ShoreReach | null {
  const d = derived(path);
  if (d.shore === undefined) d.shore = path.closed && path.fill ? shoreReach(d.line) : null;
  return d.shore;
}

/** The narrowest the shoreline band is drawn, when the shape is too tight for its width; else null. */
export function pathNarrowestWidth(path: PathChild): number | null {
  const reach = pathShoreReach(path);
  if (!reach) return null;
  const { width } = pathCentreline(path);
  let narrowest = Infinity;
  let clamped = false;
  width.forEach((w, i) => {
    const drawn = reach.inward[i] + reach.outward[i];
    if (drawn < w - 1e-3) clamped = true;
    narrowest = Math.min(narrowest, drawn);
  });
  return clamped ? Math.round(narrowest * 100) / 100 : null;
}
