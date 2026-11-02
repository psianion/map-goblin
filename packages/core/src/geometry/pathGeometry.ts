// A path child's derived geometry, cached per child object: the store hands back a new
// object on every edit, so a WeakMap on the child is exactly as fresh as the child.

import type { PathChild } from '../shared/types';
import type { Polygon } from './GeometryEngine';
import { ribbonOutline, sampleCentreline, type Centreline } from './ribbon';

interface Derived {
  line: Centreline;
  outline?: Polygon[];
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
