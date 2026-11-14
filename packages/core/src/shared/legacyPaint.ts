// Older maps' brush paint as floor pieces. Before pieces a layer kept its Material brush
// patches (`materials`) and its Water brush mask (`water`) beside its floors; both now load
// as pieces in the layer's one stack, in the order they were drawn: ground patches under the
// floors, the other patches over them, the water on top. Nothing writes either field again.
//
// The patches need no Clipper, so they convert as the file is read. A band set's patch needs
// its fill named by the pack catalog and waits in `materials` until it can be. The water mask
// is a texel grid: its outline is a union, so it converts once Clipper is loaded.

import type { Polygon } from '../types/geometry';
import type { AnyChild, ShapeChild } from './types';
import { DEFAULT_TEXTURE_SCALE } from './types';
import type { Layer } from '../store/types';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { caveFloorContours } from './caveFloor';
import { nextAuthoredName } from './authoredName';
import { decodeWater, WATER_TEXELS_PER_CELL, type WaterBody } from './waterMask';

/** How far a converted plain patch's edge fades, cells: what the patch renderer faded it over. */
export const PATCH_SOFT_EDGE = 1 / 3;

/** A patch as an older file carries it (`MaterialPatch`, and 3.10's `wall`). */
interface LoadedPatch {
  id: string;
  material: string;
  rings: Polygon[];
  smooth: boolean;
  border: boolean;
  wall?: boolean;
  shore?: string;
  shoreWidth?: number;
  shallowLine?: boolean;
  height?: number;
  ground?: boolean;
}

/** What the conversion asks the pack catalog; without it only plain texture patches convert. */
export interface PaintLookup {
  /** A band set's fill texture (materialKit's `materialFillId`). */
  fillOf?: (material: string) => string | undefined;
  /** The name a piece of this texture or band set takes (`Grass`, `Cave`); absent, `Ground`. */
  nameOf?: (material: string) => string;
  newId?: () => string;
  /**
   * Hold a layer's patches back together while any of them must wait: converted in one
   * pass they keep the order they were painted in. Off, whatever can convert does.
   */
  whole?: boolean;
}

function blankPiece(id: string, name: string, contours: Polygon[], textureId: string | undefined): ShapeChild {
  const piece: ShapeChild = {
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
    ground: true,
  };
  if (textureId) piece.textureId = textureId;
  return piece;
}

/** The pieces one patch becomes: one per outer ring, its Smooth outline baked in. Null while its fill cannot be named. */
function patchPieces(p: LoadedPatch, named: Pick<AnyChild, 'name'>[], lookup: PaintLookup): ShapeChild[] | null {
  const plain = p.material.includes(':');
  const fill = plain ? p.material : lookup.fillOf?.(p.material);
  if (!fill) return null;
  const newId = lookup.newId ?? (() => crypto.randomUUID());
  const stem = lookup.nameOf?.(p.material) ?? 'Ground';
  return caveFloorContours(p.rings, p.smooth).map((contours, i) => {
    const piece = blankPiece(i === 0 ? p.id : newId(), nextAuthoredName(named, stem), contours, fill);
    named.push(piece);
    if (plain) {
      // A plain texture faded at its edge (a water patch with a shore stays crisp against it,
      // which the renderer decides from the texture), and one painted on a floor showed only there.
      piece.soft = PATCH_SOFT_EDGE;
      if (!p.ground) piece.keptToFloors = true;
      if (p.shore !== undefined) piece.shore = p.shore;
      if (p.shoreWidth !== undefined) piece.shoreWidth = p.shoreWidth;
      if (p.shallowLine) piece.shallowLine = true;
    } else if (p.border) {
      // A band set's patch: its rock rim, paint only.
      piece.edgeMaterial = p.material;
    }
    if (p.height) piece.height = p.height;
    return piece;
  });
}

/**
 * Every layer's patches as pieces: ground patches go in before the layer's first floor, the
 * rest after its last, each keeping its order among its own. A patch that cannot convert
 * yet (a band set whose fill the catalog cannot name, a 3.10 wall patch waiting to become a
 * cave) stays in `materials`; the caller runs this again once the packs land. Running it
 * twice changes nothing. Hands back `layers` itself when nothing changed.
 */
export function patchesToPieces<L extends Layer>(layers: L[], lookup: PaintLookup = {}): L[] {
  let changed = false;
  const out = layers.map((layer) => {
    if (layer.type !== 'dungeon') return layer;
    const patches = (layer.materials ?? []) as LoadedPatch[];
    if (patches.length === 0) return layer;
    const named: Pick<AnyChild, 'name'>[] = [...(layer.children ?? [])];
    const under: ShapeChild[] = [];
    const over: ShapeChild[] = [];
    const kept: LoadedPatch[] = [];
    for (const p of patches) {
      const pieces = p.wall === true ? null : patchPieces(p, named, lookup);
      if (!pieces) kept.push(p);
      else (p.ground ? under : over).push(...pieces);
    }
    if (lookup.whole && kept.length > 0) return layer;
    if (kept.length === patches.length) return layer;
    changed = true;
    const children = [...(layer.children ?? [])];
    const isFloor = (c: AnyChild) => c.childType === 'shape';
    const first = children.findIndex(isFloor);
    const last = children.reduce((at, c, i) => (isFloor(c) ? i : at), -1);
    // Over first, so the index of the first floor is still right for the ones under.
    children.splice(last + 1, 0, ...over);
    children.splice(first < 0 ? 0 : first, 0, ...under);
    return { ...layer, children, materials: kept.length > 0 ? kept : undefined } as L;
  });
  return changed ? out : layers;
}

/**
 * A water mask's wet area as rings: each wet run of a row is a rectangle one texel high, and
 * the rings are their union. Needs Clipper.
 */
export function waterMaskRings(body: WaterBody): Polygon[] {
  const g = decodeWater(body);
  const t = 1 / WATER_TEXELS_PER_CELL;
  const rects: Polygon[] = [];
  for (let y = 0; y < g.h; y++) {
    let x = 0;
    while (x < g.w) {
      if (!g.data[y * g.w + x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < g.w && g.data[y * g.w + x]) x++;
      const x0 = (g.x + start) * t;
      const x1 = (g.x + x) * t;
      const y0 = (g.y + y) * t;
      rects.push([[x0, y0], [x1, y0], [x1, y0 + t], [x0, y0 + t]]);
    }
  }
  return rects.length === 0 ? [] : clipper2Engine.union(rects, []);
}

/**
 * A layer's water mask as water pieces, on top of everything else on the layer (the mask was
 * drawn above its floors and patches): its outline simplified and rounded as a cave ring is,
 * filled with `textureId` (the pack's water), with no shore, as the mask had none. The mask's
 * own colours are dropped. Needs Clipper; a dry mask yields none.
 */
export function waterToPieces(
  body: WaterBody,
  textureId: string,
  children: readonly Pick<AnyChild, 'name'>[],
  newId: () => string = () => crypto.randomUUID(),
): ShapeChild[] {
  const named: Pick<AnyChild, 'name'>[] = [...children];
  return caveFloorContours(waterMaskRings(body), true).map((contours) => {
    const piece = blankPiece(newId(), nextAuthoredName(named, 'Water'), contours, textureId);
    piece.shore = 'none';
    named.push(piece);
    return piece;
  });
}
