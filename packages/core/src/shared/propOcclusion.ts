// Props that block light and sight ("Blocks light and sight" on the prop card) occlude as the
// four edges of their rotated footprint, both directions. One flag, for light and sight alike.

import type { AnyChild, AssetChild, PathwayChild } from './types';
import { pathwayLine } from './pathway';

/** One edge of a blocking prop's footprint, in world units. */
export interface PropEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Whether a child is a visible prop with "Blocks light and sight" on. */
export function blocksLightProp(child: AnyChild): child is AssetChild {
  return child.childType === 'asset' && child.visible !== false && child.blocksLight === true;
}

/** The four edges of one prop's rotated footprint (`width × scale` by `height × scale` about its centre). */
export function propEdges(prop: AssetChild): PropEdge[] {
  const hw = (prop.width * prop.scale) / 2;
  const hh = (prop.height * prop.scale) / 2;
  const c = Math.cos(prop.rotation);
  const s = Math.sin(prop.rotation);
  const { x, y } = prop.position;
  const corner = (u: number, v: number): [number, number] => [x + u * c - v * s, y + u * s + v * c];
  const pts = [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)];
  const edges: PropEdge[] = [];
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % 4]!;
    edges.push({ x1, y1, x2, y2 });
  }
  return edges;
}

/** Whether a child is a visible path with Block light on: its line occludes, like a wall. */
function blocksLightPath(child: AnyChild): child is PathwayChild {
  return child.childType === 'pathway' && child.visible !== false && child.blocksLight === true;
}

/** A blocking path's line as segments. */
function pathEdges(path: PathwayChild): PropEdge[] {
  const line = pathwayLine(path);
  const edges: PropEdge[] = [];
  for (let i = 0; i < line.length - 1; i++) edges.push({ x1: line[i][0], y1: line[i][1], x2: line[i + 1][0], y2: line[i + 1][1] });
  return edges;
}

/** Every blocking prop's edges among `children`, and every blocking path's line. */
export function propSegments(children: readonly AnyChild[]): PropEdge[] {
  const out: PropEdge[] = [];
  for (const child of children) {
    if (blocksLightProp(child)) out.push(...propEdges(child));
    else if (blocksLightPath(child)) out.push(...pathEdges(child));
  }
  return out;
}

/**
 * What the occlusion depends on, as a string: the blocking props' ids and footprints. Rides
 * into the store subscription's lighting key so moving, turning or resizing one re-sweeps.
 */
export function propOccluderKey(children: readonly AnyChild[]): string {
  const parts: string[] = [];
  for (const c of children) {
    if (blocksLightPath(c)) {
      parts.push(`${c.id}|${JSON.stringify([c.contours, c.transform, c.curve, c.smoothness])}`);
      continue;
    }
    if (!blocksLightProp(c)) continue;
    parts.push(`${c.id}|${c.position.x}|${c.position.y}|${c.width * c.scale}|${c.height * c.scale}|${c.rotation}|${c.flipX}|${c.flipY}`);
  }
  return parts.join(',');
}
