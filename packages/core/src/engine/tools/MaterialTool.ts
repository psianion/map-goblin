import { Container, Graphics } from 'pixi.js';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import type { Point } from '../../types/geometry';
import type { RenderEngine } from '../RenderEngine';
import type { BrushKind, Command, DungeonLayer, MaterialToolSettings, ShapeChild } from '../../store/types';
import { DEFAULT_TEXTURE_SCALE } from '../../store/types';
import type { Polygon } from '../../types/geometry';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { AddChildCommand, CompositeCommand, PropertyCommand, RemoveChildCommand, UpdateChildCommand } from '../../store/commands';
import { MATERIAL_BRUSH_RANGES } from '../../store/slices/tools';
import { patchArea, strokeArea } from '../../shared/materialPatch';
import { caveFloorContours, caveFloorShape, closeCaveOpenings, hasCaveLook, type CaveLook } from '../../shared/caveFloor';
import { floorPieces } from '../../shared/floorPieces';
import { nextAuthoredName } from '../../shared/authoredName';
import { inRingsEvenOdd } from '../../shared/pieces';
import { clipper2Engine } from '../../geometry/Clipper2Engine';
import { brushMaterial, isTextureMaterial, isWaterMaterial, materialFillId, pieceNameOf } from '../../assets/materialKit';
import { carveFloors, pieceRegion, shownRegion, type SoftErase } from './eraseShapes';
import { cutToFrame } from '../mapFrame';
import { bakedFades, clearFades, featherOf } from '../../shared/pieceFades';
import { tidyRings } from '../../shared/tidyRings';

/** The stroke drawn while painting: the brush's sweep, before it closes into a piece. */
const SWEEP_PAINT = 0x8f877b;
const SWEEP_ERASE = 0xb3261e;
/** Points closer than this to the last, in cells, are not kept. */
const MIN_STEP = 0.1;
/** An overlap smaller than this, in square cells, is no overlap. */
const TOUCH = 1e-6;

/**
 * A stroke's area painted as cave floor, one undo step (`Paint cave floor`): the floors it
 * touches that carry the same pins (the material's fill and band, see caveFloor.ts) merge
 * with it into one, keeping the first one's id and name; a stroke touching none lands as a
 * new floor per piece, `Cave N`.
 */
export function paintCaveFloor(
  layer: DungeonLayer,
  layerId: string,
  area: Polygon[],
  settings: Pick<MaterialToolSettings, 'material' | 'smooth' | 'border' | 'strength' | 'height'>,
): void {
  const look: CaveLook = { material: settings.material, fill: materialFillId(settings.material), border: settings.border };
  // Strength is the floor's opacity and Height its height, as for a ground piece.
  if (settings.strength !== undefined && settings.strength < 1) look.opacity = Math.max(0, settings.strength);
  if (settings.height) look.height = settings.height;
  const stroke = caveFloorContours(area, settings.smooth);
  if (stroke.length === 0) return;
  const region = stroke.flat();
  const touching = layer.children.filter(
    (c): c is ShapeChild =>
      c.childType === 'shape' &&
      !c.locked &&
      c.visible !== false &&
      !c.ground &&
      hasCaveLook(c, look) &&
      patchArea(clipper2Engine.intersection(pieceRegion(c), region)) > TOUCH,
  );
  const label = 'Paint cave floor';
  const commands: Command[] = [];
  const added: { name: string }[] = [...layer.children];
  const add = (contours: Polygon[]) => {
    const shape = caveFloorShape(contours, look, crypto.randomUUID(), nextAuthoredName(added, 'Cave'));
    added.push(shape);
    commands.push(new AddChildCommand(label, layerId, shape));
  };
  if (touching.length === 0) {
    stroke.forEach(add);
  } else {
    const [first, ...rest] = touching;
    const pieces = floorPieces(tidyRings(clipper2Engine.union([...touching.flatMap(pieceRegion), ...region], [])));
    if (pieces.length === 0) return;
    // The floors' fades go to the merged one, cleared where the stroke went.
    const faded = touching.some((c) => c.fades && c.fades.length > 0);
    const fades = faded ? clearFades(touching.flatMap((c) => bakedFades(c) ?? []), region) : [];
    commands.push(
      new UpdateChildCommand(
        label,
        layerId,
        first.id,
        { contours: first.contours, tangents: first.tangents, transform: first.transform, ...(faded ? { fades: first.fades } : {}) } as Partial<ShapeChild>,
        { contours: pieces[0], tangents: undefined, transform: undefined, ...(faded ? { fades: fades.length > 0 ? fades : undefined } : {}) } as Partial<ShapeChild>,
      ),
    );
    for (const shape of rest) commands.push(new RemoveChildCommand(label, layerId, shape.id));
    pieces.slice(1).forEach(add);
  }
  // Cave painted over an opening in the rock closes it, in the same step.
  const openings = closeCaveOpenings(layer.caveOpenings, area);
  if (openings !== layer.caveOpenings) {
    commands.push(new PropertyCommand(label, { type: 'layer', layerId }, { caveOpenings: layer.caveOpenings }, { caveOpenings: openings }));
  }
  undoManager.execute(commands.length === 1 ? commands[0] : new CompositeCommand(label, commands));
}

/** What a stroke of the brush paints a ground piece with, besides its outline. */
export type PieceLook = Pick<ShapeChild, 'textureId' | 'edgeMaterial' | 'soft' | 'shore' | 'shoreWidth' | 'shallowLine' | 'height' | 'opacity'>;

/**
 * The look a new ground piece of `material` takes from the brush: its texture (a band set's
 * fill), the band's rock rim with Border on, a soft edge over the brush's Feather for a
 * piece with no rim (water stays crisp), a water texture's shore, the dock's height, and
 * Strength as its opacity. Fields are set only when they say something, so two strokes of
 * the same settings compare equal.
 */
export function pieceLook(material: string, s: MaterialToolSettings): PieceLook {
  const look: PieceLook = {};
  const fill = materialFillId(material);
  if (fill) look.textureId = fill;
  if (!isTextureMaterial(material)) {
    if (s.border) look.edgeMaterial = material;
  } else if (isWaterMaterial(material)) {
    if (s.shore !== undefined) look.shore = s.shore;
    if (s.shoreWidth !== undefined) look.shoreWidth = s.shoreWidth;
    if (s.shallowLine) look.shallowLine = true;
  }
  if (!look.edgeMaterial && !isWaterMaterial(material)) {
    // The feathered share of the brush is the edge's width: Feather 0 paints it crisp.
    const soft = Math.round(featherOf(s) * s.radius * 100) / 100;
    if (soft > 0) look.soft = soft;
  }
  if (s.height) look.height = s.height;
  if (s.strength !== undefined && s.strength < 1) look.opacity = Math.max(0, s.strength);
  return look;
}

/** What a stroke must share with a piece to merge into it: all of its look but the soft edge, which the merge hands on. */
const LOOK_KEYS: (keyof PieceLook)[] = ['textureId', 'edgeMaterial', 'shore', 'shoreWidth', 'shallowLine', 'height', 'opacity'];

/** Whether a ground piece has `look`, softness aside: a stroke of that look may merge into it. */
export function hasPieceLook(shape: ShapeChild, look: PieceLook): boolean {
  if (!shape.ground || shape.keptToFloors || shape.edgePaint) return false;
  return LOOK_KEYS.every((k) => (shape[k] ?? null) === (look[k] ?? null));
}

/**
 * The piece a stroke over `area` merges into: the topmost visible, unlocked ground piece of
 * the same look that it touches, and only when no piece above that one overlaps the stroke.
 * Merging into a buried piece would put the new paint under what covers it, so such a
 * stroke lands as a new piece on top instead. Null for none.
 */
export function mergeTarget(layer: DungeonLayer, area: Polygon[], look: PieceLook): ShapeChild | null {
  for (let i = layer.children.length - 1; i >= 0; i--) {
    const c = layer.children[i];
    if (c.childType !== 'shape' || c.visible === false) continue;
    if (patchArea(clipper2Engine.intersection(shownRegion(layer, c), area)) <= TOUCH) continue;
    // The topmost piece under the stroke: the one to merge into, or the one in the way.
    return !c.locked && hasPieceLook(c, look) ? c : null;
  }
  return null;
}

/**
 * A stroke's area painted as a ground piece of `look`, one undo step: merged into the piece
 * `mergeTarget` names (which keeps its id, name and place in the stack, and takes the
 * stroke's soft edge; its fades are cleared where the stroke went, so paint restores what a
 * soft erase took), else a new piece per part on top of the stack, named by its texture
 * (`Grass 1`).
 */
export function paintGroundPiece(layer: DungeonLayer, layerId: string, area: Polygon[], material: string, look: PieceLook, smooth: boolean): void {
  const stroke = caveFloorContours(area, smooth);
  if (stroke.length === 0) return;
  const region = stroke.flat();
  const label = 'Paint';
  const commands: Command[] = [];
  const named: { name: string }[] = [...layer.children];
  const add = (contours: Polygon[]) => {
    const piece: ShapeChild = {
      id: crypto.randomUUID(),
      name: nextAuthoredName(named, pieceNameOf(material)),
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
      ...look,
    };
    named.push(piece);
    commands.push(new AddChildCommand(label, layerId, piece));
  };
  const target = mergeTarget(layer, region, look);
  if (!target) {
    stroke.forEach(add);
  } else {
    // Only the parts of the stroke that touch the piece merge into it. A part cut off from it
    // (by a room) lands on top as a piece of its own.
    const home = pieceRegion(target);
    const touching = stroke.filter((contours) => patchArea(clipper2Engine.intersection(home, contours)) > TOUCH);
    const pieces = floorPieces(tidyRings(clipper2Engine.union([...home, ...touching.flat()], [])));
    if (pieces.length === 0) return;
    // Written only when they change, so a stroke of the same edge on an unfaded piece is the update it always was.
    const softens = (target.soft ?? 0) !== (look.soft ?? 0);
    const fades = bakedFades(target);
    const cleared = fades ? clearFades(fades, touching.flat()) : [];
    commands.push(
      new UpdateChildCommand(
        label,
        layerId,
        target.id,
        {
          contours: target.contours,
          tangents: target.tangents,
          transform: target.transform,
          ...(softens ? { soft: target.soft } : {}),
          ...(fades ? { fades: target.fades } : {}),
        } as Partial<ShapeChild>,
        {
          contours: pieces[0],
          tangents: undefined,
          transform: undefined,
          ...(softens ? { soft: look.soft } : {}),
          ...(fades ? { fades: cleared.length > 0 ? cleared : undefined } : {}),
        } as Partial<ShapeChild>,
      ),
    );
    pieces.slice(1).forEach(add);
    stroke.filter((contours) => !touching.includes(contours)).forEach(add);
  }
  undoManager.execute(commands.length === 1 ? commands[0] : new CompositeCommand(label, commands));
}

/**
 * What an erase stroke along `points` with a brush of `radius` cells does besides a plain cut:
 * with Feather only its core (the stroke at the radius less the feathered share) is cut and
 * the rest fades, and below full Strength nothing is cut and it all fades by that much.
 * Undefined for a hard brush at full strength, which cuts as an erase always has. `swept` is
 * the stroke at the full radius, as cut to the map's frame.
 */
export function softErase(
  points: readonly [number, number][],
  radius: number,
  swept: Polygon[],
  settings: Pick<MaterialToolSettings, 'feather' | 'strength'>,
): SoftErase | undefined {
  const feather = featherOf(settings);
  const strength = Math.min(1, Math.max(0, settings.strength ?? 1));
  if (feather <= 0 && strength >= 1) return undefined;
  return { area: swept, core: tidyRings(cutToFrame(strokeArea(points, radius * (1 - feather)))), feather: feather * radius, strength };
}

/**
 * A stroke's area as Paint over rooms leaves it. On, it is as swept. Off, it keeps to the
 * side of the walls it started on: begun outside the walled floors it is cut to stay outside
 * them, begun inside it stays inside. A layer with no walled floor has nothing to keep to.
 */
export function keepToRooms(layer: Pick<DungeonLayer, 'mergedFloor'>, area: Polygon[], start: [number, number], overRooms: boolean): Polygon[] {
  const walled = (layer.mergedFloor ?? []).filter((r) => r.length >= 3);
  if (overRooms || walled.length === 0) return area;
  return inRingsEvenOdd(start[0], start[1], walled) ? clipper2Engine.intersection(area, walled) : clipper2Engine.difference(area, walled);
}

/**
 * The brush: a freehand stroke as wide as the brush that closes into one floor piece on
 * release, merging into the piece of the same look it touches when nothing lies over it
 * (`mergeTarget`); Erase (the mode, or Alt held) cuts the stroke out of the top piece under
 * it, or of the selected pieces (eraseShapes.ts), softly with Feather or part Strength
 * (`softErase`). One undo step a stroke. With a band set and
 * Border and Paint a real floor on, the stroke paints walled cave floor instead (`paintCaveFloor`).
 *
 * The rail's Material, Terrain and Water entries are this one tool: they differ only in the
 * texture each remembers (`brushMaterial`).
 */
export class MaterialTool implements DrawingTool {
  readonly type: BrushKind;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;

  private engine: RenderEngine;
  private sweep: Graphics;
  private ring: Graphics;
  private stroke: { layerId: string; points: [number, number][]; radius: number; erase: boolean } | null = null;

  constructor(engine: RenderEngine, previewContainer: Container, kind: BrushKind = 'material') {
    this.engine = engine;
    this.type = kind;
    this.sweep = new Graphics();
    this.ring = new Graphics();
    previewContainer.addChild(this.sweep, this.ring);
  }

  private settings() {
    return useStore.getState().tools.settings.material;
  }

  private rawWorld(point: Point, event?: PointerEvent): Point {
    if (!event) return point;
    const rect = this.engine.canvas().getBoundingClientRect();
    return this.engine.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  }

  onPointerDown(point: Point, event?: PointerEvent): void {
    if (event && event.button !== 0) return;
    const state = useStore.getState();
    const layer = state.layers.find((l): l is DungeonLayer => l.id === state.ui.activeLayerId && l.type === 'dungeon');
    if (!layer) return;
    const p = this.rawWorld(point, event);
    this.stroke = { layerId: layer.id, points: [[p.x, p.y]], radius: this.settings().radius, erase: state.tools.eraseMode || !!event?.altKey };
    this.drawSweep();
  }

  onPointerMove(point: Point, event?: PointerEvent): void {
    const p = this.rawWorld(point, event);
    this.drawRing(p, event?.altKey);
    const s = this.stroke;
    if (!s) return;
    const [lx, ly] = s.points[s.points.length - 1];
    if (Math.hypot(p.x - lx, p.y - ly) < MIN_STEP) return;
    s.points.push([p.x, p.y]);
    this.drawSweep();
  }

  onPointerUp(): void {
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    this.sweep.clear();
    const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.id === s.layerId && l.type === 'dungeon');
    if (!layer) return;
    // A sized map ends at its frame: the stroke is cut to it.
    const swept = cutToFrame(strokeArea(s.points, s.radius));
    if (swept.length === 0) return;
    if (s.erase) {
      // The stroke is tidied before it cuts, so what it leaves is no denser than it needs to be.
      const area = tidyRings(swept);
      carveFloors(layer, s.layerId, area, [], 'Erase', softErase(s.points, s.radius, area, this.settings()));
      return;
    }
    const settings = this.settings();
    const material = brushMaterial(settings, this.type);
    if (settings.floor && settings.border && !isTextureMaterial(material)) {
      // Paint a real floor: the stroke lands as walled cave floor.
      // A plain texture has no band to wall it with, and a band set with Border off no rock,
      // so either always paints a ground piece.
      paintCaveFloor(layer, s.layerId, swept, { material, smooth: settings.smooth, border: settings.border, strength: settings.strength, height: settings.height });
      return;
    }
    const area = keepToRooms(layer, swept, s.points[0], settings.overRooms === true);
    if (area.length === 0) return;
    paintGroundPiece(layer, s.layerId, area, material, pieceLook(material, settings), settings.smooth);
  }

  /** The sweep so far: the brush's width along the stroke, released to close into a piece. */
  private drawSweep(): void {
    const s = this.stroke;
    this.sweep.clear();
    if (!s) return;
    const color = s.erase ? SWEEP_ERASE : SWEEP_PAINT;
    const [x0, y0] = s.points[0];
    if (s.points.length === 1) {
      this.sweep.circle(x0, y0, s.radius).fill({ color, alpha: 0.45 });
      return;
    }
    this.sweep.moveTo(x0, y0);
    for (const [x, y] of s.points.slice(1)) this.sweep.lineTo(x, y);
    this.sweep.stroke({ width: s.radius * 2, color, alpha: 0.45, cap: 'round', join: 'round' });
  }

  onKeyDown(event: KeyboardEvent): void {
    // Escape drops a stroke in progress; with none, it lets go of the selection the erase keeps to.
    if (event.key === 'Escape') {
      const drawing = this.stroke !== null;
      this.cancel();
      if (!drawing) useStore.getState().setSelectedIds([]);
    } else if (event.key === '[' || event.key === ']') this.resize(event.key === ']' ? 1 : -1);
  }

  onWheel(e: WheelEvent, world: Point): boolean {
    const delta = e.deltaY || e.deltaX;
    if (delta !== 0) this.resize(delta < 0 ? 1 : -1);
    this.drawRing(world, e.altKey);
    return true;
  }

  private resize(dir: 1 | -1): void {
    const { radius } = MATERIAL_BRUSH_RANGES;
    const next = Math.min(radius.max, Math.max(radius.min, this.settings().radius + dir * radius.step));
    useStore.setState((s) => {
      s.tools.settings.material.radius = next;
    });
  }

  private drawRing(p: Point, alt = false): void {
    const erase = this.stroke ? this.stroke.erase : useStore.getState().tools.eraseMode || alt;
    const zoom = this.engine.stage().scale.x;
    const settings = this.settings();
    const line = { width: 1.5 / zoom, color: erase ? SWEEP_ERASE : SWEEP_PAINT, alpha: 0.9 };
    this.ring.clear();
    this.ring.circle(p.x, p.y, settings.radius).stroke(line);
    // With Feather, a second ring where the brush starts to fade, as a light shows its feather.
    const feather = featherOf(settings);
    const inner = settings.radius * (1 - feather);
    if (feather > 0 && inner > 0) this.ring.circle(p.x, p.y, inner).stroke(line);
  }

  getPreview(): PreviewShape | null {
    return null;
  }

  cancel(): void {
    this.stroke = null;
    this.sweep.clear();
    this.ring.clear();
  }

  isActive(): boolean {
    return this.stroke !== null;
  }

  getHoverCursor(): string | null {
    return 'crosshair';
  }
}
