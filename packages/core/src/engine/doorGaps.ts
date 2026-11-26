// What the doors on a layer take out of its cave rock, in one place, so a floor ring's rock, a
// painted cave's rock and the floor's fade agree. On cave rock (a band set) an Opening is a mouth:
// the rock ends round it as at a carved mouth and the floor fades out across it. A whole-leaf
// door's gap reaches past its edges by its frame's posts, so the rock's tapered ends stop against them.

import type { Polygon } from '../types/geometry';
import type { DoorChild } from '../shared/types';
import type { DungeonLayer } from '../store/types';
import { doorOpeningCuts, type ResolvedDoor, type ResolvedWall } from '../shared/wallResolve';
import { doorWallLook, edgeStyles, ringStyles } from '../shared/wallLook';
import { isBandSet } from '../assets/packCatalog';
import { doorPostDepth } from '../assets/doorKits';
import { wallMouthPiece } from '../assets/caveWallKit';
import { layerDrawStyle, layerLevelLook } from './levelLook';
import type { DoorGap } from './wallNodeRenderer';

/**
 * A door's cuts as gaps in the rock of the wall set `setId`: an Opening's a mouth's, a framed door's
 * widened by its posts. An Opening in rock whose kit has a mouth piece its width carries that piece
 * on its own wall's cut (the first).
 */
export function rockGaps<G extends Omit<DoorGap, 'mouth' | 'entrance'>>(cuts: G[], door: DoorChild, setId: string | undefined): (G & { mouth?: true; entrance?: string })[] {
  if (!setId || !isBandSet(setId)) return cuts;
  if (door.bare) {
    const piece = wallMouthPiece(setId, door.width, door.piece);
    return cuts.map((c, k) => ({ ...c, mouth: true, ...(piece && k === 0 && { entrance: piece.key }) }));
  }
  const post = doorPostDepth(door, setId);
  return post > 0 ? cuts.map((c) => ({ ...c, width: c.width + 2 * post })) : cuts;
}

/** The wall set each resolved door's wall draws with. */
function wallSetsOf(layer: DungeonLayer): (d: ResolvedDoor) => string | undefined {
  const level = layerLevelLook(layer);
  const style = layerDrawStyle(layer);
  const rings = ringStyles(layer, level);
  const edges = edgeStyles(layer, level);
  return (d) => doorWallLook(d, style, rings, edges).setId;
}

/** Every gap `doors` cut in `walls`' stones and rock (`doorOpeningCuts`), shaped for the rock they are in (`rockGaps`). */
export function doorGaps(layer: DungeonLayer, doors: readonly ResolvedDoor[], walls: ResolvedWall[]): DoorGap[] {
  const setOf = wallSetsOf(layer);
  return doors.flatMap((d) => rockGaps(doorOpeningCuts(d, walls), d.door, setOf(d)));
}

/** The Openings on cave rock among `doors`: each the line across its span, where the floor fades out as at a carved mouth. */
export function openingLines(layer: DungeonLayer, doors: readonly ResolvedDoor[]): Polygon[] {
  const setOf = wallSetsOf(layer);
  const out: Polygon[] = [];
  for (const d of doors) {
    if (!d.door.bare || d.detached || d.door.visible === false) continue;
    const setId = setOf(d);
    if (!setId || !isBandSet(setId)) continue;
    const [ux, uy] = [Math.cos(d.angle), Math.sin(d.angle)];
    const h = d.door.width / 2;
    out.push([
      [d.position[0] - ux * h, d.position[1] - uy * h],
      [d.position[0] + ux * h, d.position[1] + uy * h],
    ]);
  }
  return out;
}

/** How far either side of its line an Opening counts as open ground for the rock's floor shadow, cells: a cave rock's reach. */
const OPENING_REACH = 0.6;

/** Each of `lines` (`openingLines`) as the region a carved mouth would leave: kept clear of the rock's floor shadow. */
export function openingRegions(lines: readonly Polygon[]): Polygon[] {
  return lines.map(([a, b]) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const [nx, ny] = [(-(b[1] - a[1]) / L) * OPENING_REACH, ((b[0] - a[0]) / L) * OPENING_REACH];
    return [
      [a[0] + nx, a[1] + ny],
      [b[0] + nx, b[1] + ny],
      [b[0] - nx, b[1] - ny],
      [a[0] - nx, a[1] - ny],
    ];
  });
}
