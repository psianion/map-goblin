import { Container, Graphics } from 'pixi.js';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import type { Point } from '../../types/geometry';
import type { RenderEngine } from '../RenderEngine';
import type { Command, DungeonLayer, MaterialToolSettings, ShapeChild } from '../../store/types';
import type { Polygon } from '../../types/geometry';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { AddChildCommand, CompositeCommand, PropertyCommand, RemoveChildCommand, UpdateChildCommand } from '../../store/commands';
import { MATERIAL_BRUSH_RANGES } from '../../store/slices/tools';
import { erasePatches, paintPatch, patchArea, pointInRings, strokeArea, type MaterialPatch, type PatchLook } from '../../shared/materialPatch';
import { caveFloorContours, caveFloorShape, closeCaveOpenings, hasCaveLook, openCaveAt, strokeOnCave, type CaveLook } from '../../shared/caveFloor';
import { floorPieces } from '../../shared/floorPieces';
import { nextAuthoredName } from '../../shared/authoredName';
import { clipper2Engine } from '../../geometry/Clipper2Engine';
import { isTextureMaterial, isWaterMaterial, materialFillId } from '../../assets/materialKit';
import { carveFloors, drawnRings } from './eraseShapes';

/** The stroke drawn while painting: the brush's sweep, before it closes into a patch. */
const SWEEP_PAINT = 0x8f877b;
const SWEEP_ERASE = 0xb3261e;
/** Points closer than this to the last, in cells, are not kept. */
const MIN_STEP = 0.1;

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
  settings: Pick<MaterialToolSettings, 'material' | 'smooth' | 'border'>,
): void {
  const look: CaveLook = { material: settings.material, fill: materialFillId(settings.material), border: settings.border };
  const stroke = caveFloorContours(area, settings.smooth);
  if (stroke.length === 0) return;
  const region = stroke.flat();
  // A floor as the region it covers: its outer ring less its holes, wound for a non-zero union.
  const regionOf = (shape: ShapeChild): Polygon[] => {
    const [outer, ...holes] = drawnRings(shape);
    return outer ? clipper2Engine.difference([outer], holes) : [];
  };
  const touching = layer.children.filter(
    (c): c is ShapeChild =>
      c.childType === 'shape' &&
      !c.locked &&
      c.visible !== false &&
      hasCaveLook(c, look) &&
      patchArea(clipper2Engine.intersection(regionOf(c), region)) > 1e-6,
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
    const pieces = floorPieces(clipper2Engine.union([...touching.flatMap(regionOf), ...region], []));
    if (pieces.length === 0) return;
    commands.push(
      new UpdateChildCommand(
        label,
        layerId,
        first.id,
        { contours: first.contours, tangents: first.tangents, transform: first.transform } as Partial<ShapeChild>,
        { contours: pieces[0], tangents: undefined, transform: undefined } as Partial<ShapeChild>,
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

/** What a new patch is drawn with: Smooth and Border, its height, and a water material's shore. */
export function patchLook(s: MaterialToolSettings): PatchLook {
  const look: PatchLook = { smooth: s.smooth, border: s.border };
  if (s.height) look.height = s.height;
  if (!isWaterMaterial(s.material)) return look;
  return { ...look, shore: s.shore, shoreWidth: s.shoreWidth, shallowLine: s.shallowLine };
}

/**
 * The Material brush: a freehand stroke as wide as the brush that closes into one solid
 * patch on release, merging with the patches of the same material it touches; Erase (the
 * mode, or Alt held) cuts the stroke out of every patch on the layer. One undo step a stroke.
 * With Paint a real floor on, the stroke paints cave floor instead (`paintCaveFloor`) and
 * Erase carves it out of the floors under it, as the floor tools' Carve out does.
 */
export class MaterialTool implements DrawingTool {
  readonly type = 'material' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;

  private engine: RenderEngine;
  private sweep: Graphics;
  private ring: Graphics;
  private stroke: { layerId: string; points: [number, number][]; radius: number; erase: boolean } | null = null;

  constructor(engine: RenderEngine, previewContainer: Container) {
    this.engine = engine;
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
    const area = strokeArea(s.points, s.radius);
    const look = this.settings();
    if (look.floor && !isTextureMaterial(look.material)) {
      // Paint a real floor: the stroke carves the floors under it, or lands as cave floor.
      // A plain texture has no band to wall it with, so it always paints a patch.
      if (s.erase) this.carve(layer, s.layerId, area, look.rockOnCut === true);
      else paintCaveFloor(layer, s.layerId, area, look);
      return;
    }
    const before = layer.materials ?? [];
    const after = s.erase ? erasePatches(before, area) : this.paint(layer, before, area, s.points[0], look);
    if (JSON.stringify(after) === JSON.stringify(before)) return;
    undoManager.execute(
      new PropertyCommand(
        s.erase ? 'Erase material' : 'Paint material',
        { type: 'layer', layerId: s.layerId },
        { materials: layer.materials },
        { materials: after.length > 0 ? after : undefined },
      ),
    );
  }

  /**
   * An erase over real floors: the stroke is carved out of them, and where it crosses a
   * cave's rock (or only brushes the rock from outside) its area is kept as an opening, so
   * the cut stays open to the ground outside instead of the rock closing round it. With
   * Rock on cut edge on nothing is kept and the rock re-forms, for reshaping a cave. One
   * undo step either way.
   */
  private carve(layer: DungeonLayer, layerId: string, area: Polygon[], rockOnCut: boolean): void {
    const opened = rockOnCut ? null : openCaveAt(layer, area);
    // On a cave the eraser takes the cave alone: the floor it stands on stays whole under the
    // cut, so an opened cave meets that floor instead of a hole in it.
    const only = strokeOnCave(layer, area) ? (shape: ShapeChild) => !!shape.edgeMaterial : undefined;
    carveFloors(
      layer,
      layerId,
      area,
      opened ? [new PropertyCommand('Carve out', { type: 'layer', layerId }, { caveOpenings: layer.caveOpenings }, { caveOpenings: opened })] : [],
      only,
    );
  }

  /**
   * A stroke's patch. A plain texture is one of two things, by where the stroke starts: on a
   * floor of the layer it is paint on that floor, cut to the floors and stored that way; off
   * every floor (or with none) it is ground, stored whole and drawn under the floors, which
   * cover it. Water goes by the same rule: a pond in a cave, a river on open ground.
   */
  private paint(layer: DungeonLayer, before: readonly MaterialPatch[], area: Polygon[], start: [number, number], settings: MaterialToolSettings): MaterialPatch[] {
    const look = patchLook(settings);
    if (!isTextureMaterial(settings.material)) return paintPatch(before, area, settings.material, look, crypto.randomUUID());
    const floor = (layer.mergedFloor ?? []).filter((r) => r.length >= 3);
    if (floor.length > 0 && pointInRings(start[0], start[1], floor)) {
      return paintPatch(before, clipper2Engine.intersection(area, floor), settings.material, look, crypto.randomUUID());
    }
    return paintPatch(before, area, settings.material, { ...look, ground: true }, crypto.randomUUID());
  }

  /** The sweep so far: the brush's width along the stroke, released to close into a patch. */
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
    if (event.key === 'Escape') this.cancel();
    else if (event.key === '[' || event.key === ']') this.resize(event.key === ']' ? 1 : -1);
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
    this.ring.clear();
    this.ring.circle(p.x, p.y, this.settings().radius).stroke({ width: 1.5 / zoom, color: erase ? SWEEP_ERASE : SWEEP_PAINT, alpha: 0.9 });
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
