// The eraser: boolean-subtract an area from floor pieces. One rule behind the floor tools'
// Carve out mode, Alt while drawing, and the brush's Erase.
//
// With no piece selected, at every point of the area only the topmost visible, unlocked
// piece is cut: the pieces are walked top down, each losing what of it lies in the area
// still left, and the area left shrinks by that piece's region. So erasing a dirt path shows
// the grass under it, and the grass under the path is untouched. With pieces selected, only
// those are cut, by the whole area. The base ground is no piece and is never cut.
//
// Curved rings flatten before the boolean (Clipper2 only speaks polygons) and the result
// IS flattened geometry, so any tangents the shape carried are cleared with it rather
// than left pointing at vertices that no longer exist; the caller says so. A piece the
// cut splits becomes one piece per part, each with a new id; a piece it covers is
// deleted. Walls, rooms and doors are not the floor's children and are left alone.
//
// A painted cave keeps its own behaviour when it is the piece being cut: within its rock's
// reach it takes the eraser alone, and where the cut crosses its rock the area is kept as an
// opening (`caveOpenings`), unless Rock on cut edge is on.
//
// The brush's erase can be soft (`SoftErase`): with Feather only the stroke's core is cut and
// the band round it fades the piece out (a fade, shared/pieceFades.ts); below full Strength
// nothing is cut and the whole stroke fades it. Which pieces it touches, and where, is the
// same walk. A cut or a first fade bakes the piece's transform into its contours and its
// fades; a fade that no longer reaches its piece after a cut is dropped, and a split piece
// gives each part the fades that reach it.

import type { Command, DungeonLayer, PieceFade, ShapeChild } from '../../store/types';
import { AddChildCommand, CompositeCommand, PropertyCommand, RemoveChildCommand, UpdateChildCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import { useStore } from '../../store/store';
import { clipper2Engine } from '../../geometry/Clipper2Engine';
import { flattenRing, ringHasCurves } from '../../shared/bezier';
import { applyShapeTransform } from '../../shared/plateaus';
import { notify } from '../../shared/notify';
import { floorPieces } from '../../shared/floorPieces';
import { CAVE_ROCK_REACH, openCaveAt } from '../../shared/caveFloor';
import { patchArea } from '../../shared/materialPatch';
import { pieceShowsAt } from '../../shared/pieces';
import { bakedFades, fadesReaching } from '../../shared/pieceFades';
import { tidyRings } from '../../shared/tidyRings';
import { ringArea } from '../../shared/plateauGround';

export { floorPieces };

type Polygon = [number, number][];

/** Parts of a cut smaller than this, in square cells, cut nothing. */
const MIN_CUT = 1e-6;
/** A part a cut leaves smaller than this, in square cells (and under half the piece it came from), is a crumb and goes. */
const CRUMB = 0.5;

/** The area of a piece's contours, square cells: its outer ring less its holes. */
const contoursArea = ([outer, ...holes]: Polygon[]): number => (outer ? ringArea(outer) : 0) - holes.reduce((a, h) => a + ringArea(h), 0);

/** A shape's rings as the floor draws them: flattened, and with its transform baked in. */
export function drawnRings(shape: ShapeChild): Polygon[] {
  return shape.contours.map((r, i) => {
    const flat = flattenRing(r, shape.tangents?.[i]);
    return shape.transform ? applyShapeTransform(flat, shape.transform) : flat;
  });
}

/** A piece as the region it covers: its outer ring less its own holes, wound for a non-zero boolean. */
export function pieceRegion(shape: ShapeChild): Polygon[] {
  const [outer, ...holes] = drawnRings(shape);
  if (!outer || outer.length < 3) return [];
  return clipper2Engine.difference([outer], holes);
}

/** A piece as the region it shows over: a patch kept to the floors only where the layer's walled floors are. */
export function shownRegion(layer: Pick<DungeonLayer, 'mergedFloor'>, shape: ShapeChild): Polygon[] {
  const region = pieceRegion(shape);
  const floor = layer.mergedFloor;
  return shape.keptToFloors && floor && floor.length > 0 ? clipper2Engine.intersection(region, floor) : region;
}

/** A walled painted cave: its rock is a wall, and the eraser opens it. */
const isCave = (shape: ShapeChild): boolean => !!shape.edgeMaterial && !shape.ground;

/** One piece's share of an erase. */
export interface PieceCut {
  shape: ShapeChild;
  /** What comes off it. */
  cut: Polygon[];
  /** A soft erase's fade it takes as well (`softCuts`). */
  fade?: PieceFade;
}

/** A soft brush erase: what `softCuts` makes of the walk's cuts. */
export interface SoftErase {
  /** The stroke at the full brush radius: what the walk ran over. */
  area: Polygon[];
  /** The stroke at the radius less the feather: all a full-strength pass cuts. */
  core: Polygon[];
  /** The feather, cells. */
  feather: number;
  /** Strength, 0 to 1: below 1 nothing is cut, and the fade takes this much. */
  strength: number;
}

/**
 * The walk's cuts as a soft erase makes them: at full strength each piece loses its share of
 * the stroke's core, and with a feather takes a fade over its whole share; below it nothing is
 * cut and each piece takes a fade of that depth.
 */
export function softCuts(cuts: readonly PieceCut[], soft: SoftErase): PieceCut[] {
  return cuts.map(({ shape, cut: hit }) => {
    const fade: PieceFade = { rings: tidyRings(soft.area), feather: soft.feather, within: tidyRings(hit) };
    if (soft.strength < 1) return { shape, cut: [], fade: { ...fade, depth: Math.max(0, soft.strength) } };
    const core = soft.core.length > 0 ? clipper2Engine.intersection(hit, soft.core) : [];
    return { shape, cut: patchArea(core) > MIN_CUT ? core : [], ...(soft.feather > 0 ? { fade } : {}) };
  });
}

/**
 * What an erase over `area` cuts from which piece on `layer`. With `only` (ids, the
 * selection) each of those pieces loses the whole area; without, the pieces are walked top
 * down and each point of the area comes off the topmost visible, unlocked piece alone.
 * `caveArea` is the area as the layer's caves meet it (what no piece above them took), for
 * recording an opening; null when no cave is reached.
 */
export function planErase(layer: DungeonLayer, area: Polygon[], only?: ReadonlySet<string>): { cuts: PieceCut[]; caveArea: Polygon[] | null } {
  const cuts: PieceCut[] = [];
  let caveArea: Polygon[] | null = null;
  let remaining = area;
  for (let i = layer.children.length - 1; i >= 0 && remaining.length > 0; i--) {
    const c = layer.children[i];
    if (c.childType !== 'shape' || c.locked || c.visible === false) continue;
    if (only && !only.has(c.id)) continue;
    const region = shownRegion(layer, c);
    if (region.length === 0) continue;
    const from = only ? area : remaining;
    if (isCave(c)) caveArea ??= from;
    const cut = clipper2Engine.intersection(region, from);
    const hit = patchArea(cut) > MIN_CUT;
    if (hit) cuts.push({ shape: c, cut });
    if (only) continue;
    if (isCave(c)) {
      // A cave takes the eraser alone out to its rock's reach, cut or only brushed: the floor
      // it stands on stays whole under the rim, so an opened cave meets that floor, not a notch in it.
      const reach = clipper2Engine.inflate(region, CAVE_ROCK_REACH);
      if (hit || patchArea(clipper2Engine.intersection(reach, remaining)) > MIN_CUT) remaining = clipper2Engine.difference(remaining, reach);
    } else if (hit) {
      remaining = clipper2Engine.difference(remaining, region);
    }
  }
  return { cuts, caveArea };
}

export interface Carve {
  commands: Command[];
  /** A carved floor had curved edges, now flat. */
  flattened: boolean;
}

/** Commands that take each cut off its piece. Empty when nothing was touched; the caller wraps and executes. */
export function cutCommands(layer: DungeonLayer, layerId: string, cuts: readonly PieceCut[], label = 'Carve out'): Carve {
  const commands: Command[] = [];
  let flattened = false;
  const byId = new Map(cuts.map((c) => [c.shape.id, c]));
  // Where the next floor sits once the commands before it have run: a delete takes one
  // place out of the order, a split adds the extra pieces.
  let shift = 0;
  layer.children.forEach((c, i) => {
    const index = i + shift;
    const entry = byId.get(c.id);
    if (!entry || c.childType !== 'shape') return;
    const { cut, fade } = entry;
    const shape = c as ShapeChild;
    const [outer, ...holes] = drawnRings(shape);
    if (!outer) return;
    // The piece's fades as its baked contours carry them, and the new one.
    const baked = bakedFades(shape);
    const fades = fade ? [...(baked ?? []), fade] : baked;
    if (cut.length === 0) {
      // A fade alone: the outline stays, but a transform or curves bake as a cut bakes them.
      if (!fade) return;
      const bake = !!shape.transform || !!shape.tangents;
      if (shape.tangents?.some((t) => ringHasCurves(t))) flattened = true;
      commands.push(
        new UpdateChildCommand(
          label,
          layerId,
          shape.id,
          { ...(bake ? { contours: shape.contours, tangents: shape.tangents, transform: shape.transform } : {}), fades: shape.fades } as Partial<ShapeChild>,
          { ...(bake ? { contours: [outer, ...holes], tangents: undefined, transform: undefined } : {}), fades } as Partial<ShapeChild>,
        ),
      );
      return;
    }
    // The parts are tidied as they are stored, and crumbs the cut leaves go with what it took.
    const before = contoursArea([outer, ...holes]);
    const pieces = floorPieces(tidyRings(clipper2Engine.difference([outer], [...holes, ...cut]))).filter((p) => {
      const a = contoursArea(p);
      return a >= CRUMB || a >= before / 2;
    });
    if (shape.tangents?.some((t) => ringHasCurves(t))) flattened = true;
    // A part keeps the fades that still reach it; a piece with none carries no field at all.
    const fadesOf = (contours: Polygon[]): Partial<ShapeChild> => {
      if (!fades) return {};
      const reaching = fadesReaching(fades, clipper2Engine.difference([contours[0]], contours.slice(1)));
      return { fades: reaching.length > 0 ? reaching : undefined };
    };
    if (pieces.length === 0) {
      commands.push(new RemoveChildCommand(label, layerId, shape.id));
      shift -= 1;
    } else if (pieces.length === 1) {
      commands.push(
        new UpdateChildCommand(
          label,
          layerId,
          shape.id,
          { contours: shape.contours, tangents: shape.tangents, transform: shape.transform, ...(fades ? { fades: shape.fades } : {}) } as Partial<ShapeChild>,
          { contours: pieces[0], tangents: undefined, transform: undefined, ...fadesOf(pieces[0]) } as Partial<ShapeChild>,
        ),
      );
    } else {
      // A split: the floor gives way to one floor per piece, each new, in its place in the order.
      commands.push(new RemoveChildCommand(label, layerId, shape.id));
      pieces.forEach((contours, k) => {
        const piece: ShapeChild = { ...shape, id: crypto.randomUUID(), contours, tangents: undefined, transform: undefined };
        if (fades) {
          const kept = fadesOf(contours).fades;
          if (kept) piece.fades = kept;
          else delete piece.fades;
        }
        commands.push(new AddChildCommand(label, layerId, piece, index + k));
      });
      shift += pieces.length - 1;
    }
  });
  return { commands, flattened };
}

/**
 * Commands that subtract `carvePolys` from the pieces of `layer` by the eraser's rule (the
 * top piece at each point, or the pieces `only` names).
 */
export function carveCommands(layer: DungeonLayer, layerId: string, carvePolys: Polygon[], only?: ReadonlySet<string>): Carve {
  return cutCommands(layer, layerId, planErase(layer, carvePolys, only).cuts);
}

/** The selected pieces of `layer`: what an erase is confined to. Undefined when the selection holds none. */
export function selectedPieceIds(layer: DungeonLayer, selectedIds: readonly string[]): ReadonlySet<string> | undefined {
  if (selectedIds.length === 0) return undefined;
  const ids = new Set(layer.children.filter((c) => c.childType === 'shape' && selectedIds.includes(c.id)).map((c) => c.id));
  return ids.size > 0 ? ids : undefined;
}

/**
 * The pieces an erase at a point would cut: the selected pieces of the layer when there are
 * any, else the topmost visible, unlocked piece showing at the point. None over the base
 * ground alone. What the erase hover washes red.
 */
export function eraseTargets(layer: DungeonLayer, x: number, y: number, selectedIds: readonly string[]): ShapeChild[] {
  const only = selectedPieceIds(layer, selectedIds);
  if (only) return layer.children.filter((c): c is ShapeChild => c.childType === 'shape' && only.has(c.id) && !c.locked && c.visible !== false);
  for (let i = layer.children.length - 1; i >= 0; i--) {
    const c = layer.children[i];
    if (c.childType !== 'shape' || c.locked || c.visible === false) continue;
    if (pieceShowsAt(c, layer.mergedFloor, x, y)) return [c];
  }
  return [];
}

/**
 * Erase `carvePolys` from the pieces of `layer` as one undo step, by the eraser's rule; the
 * selection and Rock on cut edge are read from the store. Whether anything changed. `also`
 * rides in the same step, cut or not. With `soft` (the brush's feathered or part-strength
 * erase, `carvePolys` being its full stroke) the cuts are `softCuts`.
 */
export function carveFloors(layer: DungeonLayer, layerId: string, carvePolys: Polygon[], also: Command[] = [], label = 'Carve out', soft?: SoftErase): boolean {
  const state = useStore.getState();
  const only = selectedPieceIds(layer, state.selection.selectedIds);
  const plan = planErase(layer, carvePolys, only);
  const cuts = soft ? softCuts(plan.cuts, soft) : plan.cuts;
  // A soft erase opens a cave only where it cuts: its core, at full strength.
  let caveArea = plan.caveArea;
  if (soft && caveArea) {
    const core = soft.strength < 1 || soft.core.length === 0 ? [] : clipper2Engine.intersection(caveArea, soft.core);
    caveArea = patchArea(core) > MIN_CUT ? core : null;
  }
  const { commands, flattened } = cutCommands(layer, layerId, cuts, label);
  // Where the cut crosses a cave's rock its area is kept as an opening, so the cut stays open
  // to the ground outside instead of the rock closing round it. With Rock on cut edge on
  // nothing is kept and the rock re-forms, for reshaping a cave.
  const rockOnCut = state.tools.settings.material.rockOnCut === true;
  const opened = rockOnCut || !caveArea ? null : openCaveAt(layer, tidyRings(caveArea));
  if (opened) commands.push(new PropertyCommand(label, { type: 'layer', layerId }, { caveOpenings: layer.caveOpenings }, { caveOpenings: opened }));
  commands.push(...also);
  if (commands.length === 0) return false;
  undoManager.execute(commands.length === 1 ? commands[0] : new CompositeCommand(label, commands));
  if (flattened) notify.subtle('Curved edges were flattened to carve');
  return true;
}
