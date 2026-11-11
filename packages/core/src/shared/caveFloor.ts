// A painted cave as real floors. With the Material brush's "Paint a real floor" on, a stroke
// lands as floor shapes rather than a paint-only patch, so the union, walls, rooms, doors,
// light, fog and the table see it like any floor. The look is pinned on the shape the way
// the floor tools pin theirs: the floor texture is the material's fill and the wall set is
// the material itself (a band kit, whose rock the cave band renderer lays round the ring),
// or no stone at all with Border off. A 3.10 patch whose edge was a wall loads as the same
// floors (`wallPatchesToFloors`). Pure: no Clipper, so it runs at load as well as in the tool.

import type { Polygon } from '../types/geometry';
import type { AnyChild, ShapeChild } from './types';
import { DEFAULT_TEXTURE_SCALE } from './types';
import type { Layer } from '../store/types';
import { simplifyPath } from '../geometry/simplify';
import { cutCorners } from './materialPatch';
import { floorPieces } from './floorPieces';
import { nextAuthoredName } from './authoredName';

/** How closely a smoothed ring keeps to the painted one before it is rounded, in cells (the patch's rule). */
const SMOOTH_SIMPLIFY = 0.2;
/** Corner-cutting passes: each rounds every corner further (the patch's rule). */
const SMOOTH_PASSES = 3;
/** The rounded ring thinned again, so a cave ring carries a few hundred points rather than thousands. */
const SMOOTH_THIN = 0.04;

/** What a cave floor is pinned to. */
export interface CaveLook {
  /** The band set the floor's rock is laid with ('GG_Cave_Ink'). */
  material: string;
  /** The material's fill, a pack-scoped floor texture id; undefined when none is known. */
  fill: string | undefined;
  /** Off, the floor is pinned to no stone at all. */
  border: boolean;
}

/** Douglas-Peucker over a closed ring: its seam point is kept, so the ring stays closed. */
function simplifyRing(ring: Polygon, epsilon: number): Polygon {
  if (ring.length < 4) return ring;
  const open = simplifyPath([...ring, ring[0]].map(([x, y]) => ({ x, y })), epsilon);
  const out = open.slice(0, -1).map((p): [number, number] => [p.x, p.y]);
  return out.length >= 3 ? out : ring;
}

/** A ring smoothed as a patch is (simplified, corners cut), then thinned again. Winding is kept. */
export function smoothCaveRing(ring: Polygon): Polygon {
  let out = simplifyRing(ring, SMOOTH_SIMPLIFY);
  if (out.length < 3) return ring;
  for (let k = 0; k < SMOOTH_PASSES; k++) out = cutCorners(out);
  return simplifyRing(out, SMOOTH_THIN);
}

/**
 * Rings (outer rings and holes, wound opposite ways, as Clipper and a patch leave them) as
 * floor contours: one entry per outer ring, `[outer, ...holes]`, each ring smoothed first
 * with `smooth`.
 */
export function caveFloorContours(rings: readonly Polygon[], smooth: boolean): Polygon[][] {
  return floorPieces(smooth ? rings.map(smoothCaveRing) : [...rings]);
}

/** The wall set a cave floor pins: the material, or '' for no stone. */
function wallPin(look: CaveLook): string {
  return look.border ? look.material : '';
}

/** A floor shape for `contours`, pinned to the look. */
export function caveFloorShape(contours: Polygon[], look: CaveLook, id: string, name: string): ShapeChild {
  const shape: ShapeChild = {
    id,
    name,
    childType: 'shape',
    visible: true,
    shapeType: 'polygon',
    contours,
    textureScale: DEFAULT_TEXTURE_SCALE,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    styleOverrides: { wallTextureSetId: wallPin(look) },
  };
  if (look.fill) shape.textureId = look.fill;
  return shape;
}

/** Whether `shape` carries the same two pins as a cave floor of `look`, so a stroke merges with it. */
export function hasCaveLook(shape: ShapeChild, look: CaveLook): boolean {
  return shape.textureId === look.fill && shape.styleOverrides?.wallTextureSetId === wallPin(look);
}

/** Floors for a whole patch's rings, named on from `children` (`Cave N`). */
export function caveFloors(
  rings: readonly Polygon[],
  smooth: boolean,
  look: CaveLook,
  children: readonly Pick<AnyChild, 'name'>[],
  newId: () => string,
): ShapeChild[] {
  const named: Pick<AnyChild, 'name'>[] = [...children];
  return caveFloorContours(rings, smooth).map((contours) => {
    const shape = caveFloorShape(contours, look, newId(), nextAuthoredName(named, 'Cave'));
    named.push(shape);
    return shape;
  });
}

interface LoadedPatch {
  id: string;
  material: string;
  rings: Polygon[];
  smooth: boolean;
  border: boolean;
  wall?: boolean;
}

/**
 * A 3.10 map's patches whose edge was a wall, as the floors the brush now paints: each such
 * patch becomes floor shapes (appended to its layer's children) and is dropped; every other
 * patch stays. `fillOf` names a material's fill from the pack catalog; a patch whose fill it
 * cannot name yet is left as it is, so a map opened before the packs land converts once they
 * do (the caller runs this again then). Hands back `layers` itself when nothing changed.
 */
export function wallPatchesToFloors<L extends Layer>(
  layers: L[],
  fillOf: (material: string) => string | undefined,
  newId: () => string = () => crypto.randomUUID(),
): L[] {
  let changed = false;
  const out = layers.map((layer) => {
    if (layer.type !== 'dungeon') return layer;
    const patches = (layer.materials ?? []) as LoadedPatch[];
    if (!patches.some((p) => p.wall === true && fillOf(p.material))) return layer;
    changed = true;
    const children: AnyChild[] = [...layer.children];
    const kept: LoadedPatch[] = [];
    for (const p of patches) {
      const fill = p.wall === true ? fillOf(p.material) : undefined;
      if (!fill) {
        kept.push(p);
        continue;
      }
      children.push(...caveFloors(p.rings, p.smooth, { material: p.material, fill, border: p.border }, children, newId));
    }
    return { ...layer, children, materials: kept.length > 0 ? kept : undefined } as L;
  });
  return changed ? out : layers;
}
