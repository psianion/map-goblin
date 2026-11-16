import { Graphics, type Container } from 'pixi.js';
import type { Point, Polygon } from '../../types/geometry';
import { snapToAngle } from '../../geometry/drawAssist';
import { simplifyPath } from '../../geometry/simplify';
import { isDoubleClick, type DrawingTool, type PreviewShape } from './DrawingTool';
import type { RenderEngine } from '../RenderEngine';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { AddChildCommand, CompositeCommand, RemoveChildCommand, UpdateChildCommand } from '../../store/commands';
import type { Command, DungeonLayer, PlateauChild, PlateauToolSettings } from '../../store/types';
import { MATERIAL_BRUSH_RANGES } from '../../store/slices/tools';
import { resolveEditableLayer } from './layerGuard';
import { notify } from '../../shared/notify';
import { GROUND_MESSAGE, PLATEAU_MIN_AREA, SMALL_MESSAGE, ringArea } from '../../shared/plateauGround';
import { plateauGround } from '../plateauGround';
import { cutToFrame } from '../mapFrame';
import { floorPieces } from '../../shared/floorPieces';
import { tidyRing } from '../../shared/tidyRings';
import { flattenRing, smoothRing, type RingTangents } from '../../shared/bezier';
import { strokeArea, patchArea } from '../../shared/materialPatch';
import { clipper2Engine } from '../../geometry/Clipper2Engine';
import { edgeOf, ownHeight, unionShapes } from '../../shared/plateaus';
import { faceDirectionOf, wrapDirection } from '../../shared/plateauShade';

/** A press that travels this far (screen px) before release draws freehand, as the Path tool's does. */
const FREEHAND_PX = 4;
/** Freehand samples are taken this far apart, cells… */
const FREEHAND_STEP = 0.3;
/** …and simplified (Douglas-Peucker) to points no further than this off the stroke. */
const FREEHAND_TOLERANCE = 0.08;
/** How close a click lands to the first point to close the ring, cells. */
const CLOSE_RADIUS = 0.35;
/** Brush samples closer than this to the last, cells, are not kept (as the Material brush's). */
const BRUSH_STEP = 0.1;
/** A brushed outline is thinned to points no further than this off the stroke, cells: tens of nodes, not hundreds. */
const BRUSH_TOLERANCE = 0.04;
/** An overlap smaller than this, square cells, is no overlap. */
const TOUCH = 1e-6;
/** The brush's sweep while it is dragged, and its ring at the cursor. */
const BRUSH_COLOR = 0x8f877b;

export const PLATEAU_DEFAULTS: PlateauToolSettings = { height: 1, edge: 'cliff' };
/** The brush's radius when the tool names none, cells. */
export const PLATEAU_BRUSH_RADIUS = 1;

/** The tool's settings with their defaults filled in. */
export function plateauSettings(): PlateauToolSettings {
  return { ...PLATEAU_DEFAULTS, ...useStore.getState().tools.settings.plateau };
}

/** What a new plateau stores besides its ring. */
export type PlateauFields = Pick<PlateauChild, 'height' | 'edge' | 'edgeArt' | 'borderWidth' | 'faceArt' | 'faceDir' | 'topArt'>;

/**
 * The fields a plateau drawn with settings `s` stores: its height, edge and top; a cliff the
 * art (and a painted border the width) the tool is set to; a slope its face texture and its
 * direction, the tool's, else the map's stored one, else the default.
 */
export function plateauFieldsOf(s: PlateauToolSettings): PlateauFields {
  const map = useStore.getState().mapSettings.faceDirection;
  return {
    height: s.height,
    edge: s.edge,
    ...(s.edge === 'cliff' && s.edgeArt !== undefined ? { edgeArt: s.edgeArt } : {}),
    ...(s.edge === 'cliff' && s.borderWidth !== undefined ? { borderWidth: s.borderWidth } : {}),
    ...(s.edge === 'slope' && s.faceArt !== undefined ? { faceArt: s.faceArt } : {}),
    ...(s.edge === 'slope' ? { faceDir: wrapDirection(faceDirectionOf(s, map)) } : {}),
    ...(s.topArt !== undefined ? { topArt: s.topArt } : {}),
  };
}

/** The settings a brush stroke must share with a plateau to grow it, besides its height and direction. */
const MERGE_KEYS = ['edgeArt', 'borderWidth', 'topArt', 'faceArt', 'contourLines', 'sightOverride', 'crossingId'] as const;

/** Whether plateau `p` is what a plateau drawn with `fields` would be: its own height, every setting, its direction as it resolves. */
export function samePlateau(p: PlateauChild, fields: PlateauFields): boolean {
  const map = useStore.getState().mapSettings.faceDirection;
  const stored = fields as Partial<PlateauChild>;
  return (
    ownHeight(p) === fields.height &&
    edgeOf(p) === fields.edge &&
    MERGE_KEYS.every((k) => (p[k] ?? null) === (stored[k] ?? null)) &&
    faceDirectionOf(p, map) === faceDirectionOf(fields, map)
  );
}

/** The point on the grid when snap is on. */
function snapToGrid(point: Point): Point {
  const { snapEnabled, snapDivision } = useStore.getState().grid;
  if (!snapEnabled) return point;
  const interval = 1 / snapDivision;
  return { x: Math.round(point.x / interval) * interval, y: Math.round(point.y / interval) * interval };
}

/** A plateau's rings as they will be stored: its outline and holes, and the outline's curve handles when it keeps them. */
interface RingPart {
  contours: Polygon[];
  tangents?: RingTangents[];
}

/** Rings cut to a sized map's frame as plateaus: each outer ring with its holes, tidied, those under a cell dropped. */
function framedParts(rings: Polygon[], tolerance?: number): Polygon[][] {
  const tidy = (r: Polygon) => (tolerance === undefined ? tidyRing(r) : tidyRing(r, tolerance));
  return floorPieces(rings)
    .map((piece) => piece.map(tidy).filter((r) => r.length >= 3))
    .filter((piece) => piece.length > 0 && ringArea(piece[0]) >= PLATEAU_MIN_AREA);
}

/** Whether every part stands on ground; else the toast, and false. */
async function partsOnGround(layer: DungeonLayer, parts: readonly Polygon[]): Promise<boolean> {
  for (const outer of parts) {
    const verdict = await plateauGround(layer, outer);
    if (verdict !== 'ok') {
      notify.warning(verdict === 'small' ? SMALL_MESSAGE : GROUND_MESSAGE);
      return false;
    }
  }
  return true;
}

/** New plateaus for `parts`, named on from the layer's count, with the tool's fields. */
function newPlateaus(layer: DungeonLayer, parts: readonly RingPart[], fields: PlateauFields): PlateauChild[] {
  const count = layer.children.filter((c) => c.childType === 'plateau').length;
  return parts.map(
    (part, i): PlateauChild => ({
      id: crypto.randomUUID(),
      name: `Plateau ${count + i + 1}`,
      childType: 'plateau',
      visible: true,
      contours: part.contours,
      ...(part.tangents ? { tangents: part.tangents } : {}),
      ...fields,
    }),
  );
}

/**
 * Adds plateau `ring` to layer `layerId` with the tool's settings, selected, as one undo step:
 * only where it stands on ground (the layer's floor or painted terrain) and covers a cell, else
 * a toast and nothing. With `curve` the ring is smoothed through every point (its handles
 * stored, its nodes as clicked). On a sized map the ring is cut to the frame first, and each
 * part inside that covers a cell becomes a plateau, holes kept, all in the one step; a ring the
 * frame cuts is stored as cut, without handles. Resolves to the (first) new plateau, or null.
 */
export async function commitPlateau(layerId: string, ring: Point[], options: { curve?: boolean } = {}): Promise<PlateauChild | null> {
  const layer = resolveEditableLayer(layerId);
  if (!layer || ring.length < 3) return null;
  const contour = ring.map((p): [number, number] => [p.x, p.y]);
  const tangents = options.curve ? smoothRing(contour) : undefined;
  // The ground check and the frame cut work on the outline as drawn: curves flattened.
  const flat = tangents ? flattenRing(contour, tangents) : contour;
  const cut = cutToFrame([flat]);
  const whole = cut.length === 1 && cut[0] === flat;
  const parts: RingPart[] = whole
    ? [{ contours: [contour], ...(tangents ? { tangents: [tangents] } : {}) }]
    : framedParts(cut).map((contours) => ({ contours }));
  if (parts.length === 0) {
    notify.warning(SMALL_MESSAGE);
    return null;
  }
  if (!(await partsOnGround(layer as DungeonLayer, whole ? [flat] : parts.map((p) => p.contours[0])))) return null;
  const now = resolveEditableLayer(layerId);
  if (!now) return null;
  const added = newPlateaus(now as DungeonLayer, parts, plateauFieldsOf(plateauSettings()));
  const commands = added.map((p) => new AddChildCommand('Add plateau', layerId, p));
  undoManager.execute(commands.length === 1 ? commands[0] : new CompositeCommand('Add plateau', commands));
  useStore.getState().setSelectedIds(added.map((p) => p.id));
  return added[0];
}

/**
 * A brush stroke's area (`strokeArea`) as a plateau, one undo step. The plateaus on the layer
 * the tool would draw again (`samePlateau`) that it overlaps grow by it: the earliest of them
 * takes the union (its handles dropped and its transform baked in), the others are deleted.
 * Otherwise the stroke is a new plateau. Holes are kept. The result is cut to a sized map's
 * frame (the earliest takes the largest part, the rest are new) and must stand on ground, as
 * `commitPlateau`'s. Resolves to the plateau that holds the stroke, or null.
 */
export async function commitPlateauStroke(layerId: string, area: Polygon[]): Promise<PlateauChild | null> {
  const layer = resolveEditableLayer(layerId) as DungeonLayer | null;
  if (!layer || area.length === 0) return null;
  const fields = plateauFieldsOf(plateauSettings());
  const stroke = clipper2Engine.union(area, []);
  const grown = layer.children.filter(
    (c): c is PlateauChild =>
      c.childType === 'plateau' &&
      c.visible !== false &&
      !c.locked &&
      samePlateau(c, fields) &&
      patchArea(clipper2Engine.intersection(unionShapes([c]), stroke)) > TOUCH,
  );
  const union = grown.length === 0 ? stroke : clipper2Engine.union([...stroke, ...grown.flatMap((c) => unionShapes([c]))], []);
  // Thinned, then joined once more so a thinned ring never crosses itself.
  const thin = cutToFrame(union).map((r) => tidyRing(r, BRUSH_TOLERANCE)).filter((r) => r.length >= 3);
  const pieces = framedParts(thin.length > 0 ? clipper2Engine.union(thin, []) : [], BRUSH_TOLERANCE);
  if (pieces.length === 0) {
    notify.warning(SMALL_MESSAGE);
    return null;
  }
  if (!(await partsOnGround(layer, pieces.map((p) => p[0])))) return null;
  const now = resolveEditableLayer(layerId) as DungeonLayer | null;
  if (!now) return null;
  const label = 'Paint plateau';
  const commands: Command[] = [];
  const [first, ...rest] = grown;
  const fresh = newPlateaus(now, (first ? pieces.slice(1) : pieces).map((contours) => ({ contours })), fields);
  if (first) {
    commands.push(
      new UpdateChildCommand(
        label,
        layerId,
        first.id,
        { contours: first.contours, tangents: first.tangents, transform: first.transform },
        { contours: pieces[0], tangents: undefined, transform: undefined },
      ),
    );
    for (const p of rest) commands.push(new RemoveChildCommand(label, layerId, p.id));
  }
  for (const p of fresh) commands.push(new AddChildCommand(label, layerId, p));
  undoManager.execute(commands.length === 1 ? commands[0] : new CompositeCommand(label, commands));
  const ids = [...(first ? [first.id] : []), ...fresh.map((p) => p.id)];
  useStore.getState().setSelectedIds(ids);
  const after = resolveEditableLayer(layerId) as DungeonLayer | null;
  return (after?.children.find((c): c is PlateauChild => c.id === ids[0] && c.childType === 'plateau') ?? null);
}

/**
 * The Plateau tool (L): a ring of relief over floors or painted terrain.
 *
 * With the pen, a press dragged past a few pixels draws the ring freehand, simplified as the
 * Path tool simplifies, and finishes on release. Clicks place points; a click on the first
 * point closes the ring; Shift holds a segment to 15° steps; Enter or a double-click finishes;
 * Escape drops it. With Curve on, clicked points are smoothed through. With the brush, a press
 * and drag paints the area (a click is one dab), growing the plateau it overlaps when that one
 * is what the tool would draw (`commitPlateauStroke`); [ and ] and the wheel size it. The ring
 * must stand on ground. One undo entry per plateau or stroke.
 */
export class PlateauTool implements DrawingTool {
  readonly type = 'plateau' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;
  private points: Point[] = [];
  private cursorPoint: Point | null = null;
  private lastClick: { point: Point; time: number } | null = null;
  private press: { screen: { x: number; y: number }; samples: Point[]; freehand: boolean } | null = null;
  /** Some of the ring was drawn freehand: Curve leaves it as drawn. */
  private drewFreehand = false;
  /** The active layer when the ring started — see WallTool for why. */
  private chainLayerId: string | null = null;
  /** The brush stroke under way. */
  private stroke: { layerId: string; points: [number, number][]; radius: number } | null = null;
  private readonly engine: RenderEngine | null;
  private readonly sweep: Graphics | null;
  private readonly ring: Graphics | null;

  constructor(engine?: RenderEngine, previewContainer?: Container) {
    this.engine = engine ?? null;
    this.sweep = previewContainer ? new Graphics() : null;
    this.ring = previewContainer ? new Graphics() : null;
    if (previewContainer && this.sweep && this.ring) previewContainer.addChild(this.sweep, this.ring);
  }

  private brush(): boolean {
    return plateauSettings().input === 'brush';
  }

  private radius(): number {
    return plateauSettings().brushRadius ?? PLATEAU_BRUSH_RADIUS;
  }

  private curved(): boolean {
    return useStore.getState().tools.curveMode && !this.drewFreehand && !this.press?.freehand;
  }

  private place(point: Point, event?: PointerEvent): Point {
    const anchor = this.points[this.points.length - 1];
    return event?.shiftKey && anchor ? snapToAngle(anchor, point) : snapToGrid(point);
  }

  onPointerDown(point: Point, event?: PointerEvent, raw?: Point): void {
    if (this.brush()) {
      if (event && event.button !== undefined && event.button !== 0) return;
      const layerId = useStore.getState().ui.activeLayerId;
      if (!layerId) return;
      const p = raw ?? point;
      this.stroke = { layerId, points: [[p.x, p.y]], radius: this.radius() };
      this.drawSweep();
      return;
    }
    const now = Date.now();
    if (this.points.length >= 3 && isDoubleClick(this.lastClick, point, now)) {
      this.lastClick = null;
      this.finish();
      return;
    }
    if (this.points.length === 0) this.chainLayerId = useStore.getState().ui.activeLayerId;
    const first = this.points[0];
    if (first && this.points.length >= 3 && Math.hypot(point.x - first.x, point.y - first.y) <= CLOSE_RADIUS) {
      this.finish();
      return;
    }
    const at = this.place(point, event);
    this.points.push(at);
    this.lastClick = { point: at, time: now };
    this.cursorPoint = at;
    this.press = { screen: { x: event?.clientX ?? 0, y: event?.clientY ?? 0 }, samples: [point], freehand: false };
  }

  onPointerMove(point: Point, event?: PointerEvent, raw?: Point): void {
    if (this.brush() || this.stroke) {
      const p = raw ?? point;
      this.drawRing(p);
      const s = this.stroke;
      if (!s) return;
      const [lx, ly] = s.points[s.points.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) < BRUSH_STEP) return;
      s.points.push([p.x, p.y]);
      this.drawSweep();
      return;
    }
    const press = this.press;
    if (press && event && (event.buttons & 1) === 1) {
      if (!press.freehand && Math.hypot(event.clientX - press.screen.x, event.clientY - press.screen.y) > FREEHAND_PX) {
        press.freehand = true;
      }
      if (press.freehand) {
        const last = press.samples[press.samples.length - 1];
        if (Math.hypot(point.x - last.x, point.y - last.y) >= FREEHAND_STEP) press.samples.push(point);
      }
    }
    const anchor = this.points[this.points.length - 1];
    this.cursorPoint = anchor && event?.shiftKey ? snapToAngle(anchor, point) : point;
  }

  onPointerUp(point: Point): void {
    const stroke = this.stroke;
    if (stroke) {
      this.stroke = null;
      this.sweep?.clear();
      void commitPlateauStroke(stroke.layerId, strokeArea(stroke.points, stroke.radius));
      return;
    }
    const press = this.press;
    this.press = null;
    if (!press?.freehand) return;
    this.drewFreehand = true;
    const samples = [...press.samples];
    const tail = samples[samples.length - 1];
    if (Math.hypot(point.x - tail.x, point.y - tail.y) > 1e-6) samples.push(point);
    // A freehand stroke is the whole ring when it started it; otherwise it adds to the clicks.
    const kept = simplifyPath(samples, FREEHAND_TOLERANCE);
    this.points.pop();
    this.points.push(...kept);
    // A ring that comes back to its start drops the repeat.
    const a = this.points[0];
    const b = this.points[this.points.length - 1];
    if (this.points.length > 3 && Math.hypot(a.x - b.x, a.y - b.y) <= CLOSE_RADIUS) this.points.pop();
    this.finish();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
    else if (this.brush() && (event.key === '[' || event.key === ']')) this.resize(event.key === ']' ? 1 : -1);
    else if (event.key === 'Enter') this.finish();
    else if ((event.key === 'Backspace' || event.key === 'Delete') && this.points.length > 0) {
      this.points.pop();
      if (this.points.length === 0) this.cancel();
    }
  }

  /** In brush mode the wheel sizes the brush, as the Material brush's does; with the pen it zooms. */
  onWheel(e: WheelEvent, world: Point): boolean {
    if (!this.brush()) return false;
    const delta = e.deltaY || e.deltaX;
    if (delta !== 0) this.resize(delta < 0 ? 1 : -1);
    this.drawRing(world);
    return true;
  }

  private resize(dir: 1 | -1): void {
    const { radius } = MATERIAL_BRUSH_RANGES;
    const next = Math.min(radius.max, Math.max(radius.min, this.radius() + dir * radius.step));
    const st = useStore.getState();
    st.updateToolSettings({ plateau: { ...plateauSettings(), brushRadius: next } });
  }

  /** The stroke so far: the brush's width along it; a dab is its circle. */
  private drawSweep(): void {
    const s = this.stroke;
    const g = this.sweep;
    if (!g) return;
    g.clear();
    if (!s) return;
    const [x0, y0] = s.points[0];
    if (s.points.length === 1) {
      g.circle(x0, y0, s.radius).fill({ color: BRUSH_COLOR, alpha: 0.45 });
      return;
    }
    g.moveTo(x0, y0);
    for (const [x, y] of s.points.slice(1)) g.lineTo(x, y);
    g.stroke({ width: s.radius * 2, color: BRUSH_COLOR, alpha: 0.45, cap: 'round', join: 'round' });
  }

  /** The brush's circle at the cursor. */
  private drawRing(p: Point): void {
    const g = this.ring;
    if (!g) return;
    g.clear();
    if (!this.brush()) return;
    const zoom = this.engine?.stage().scale.x || 1;
    g.circle(p.x, p.y, this.stroke?.radius ?? this.radius()).stroke({ width: 1.5 / zoom, color: BRUSH_COLOR, alpha: 0.9 });
  }

  getPreview(): PreviewShape | null {
    if (this.points.length === 0) return null;
    const pts = [...this.points];
    if (this.press?.freehand) pts.push(...this.press.samples.slice(1));
    else if (this.cursorPoint) pts.push(this.cursorPoint);
    // Curve previews the curve the plateau will take.
    if (this.curved() && pts.length >= 3) {
      const ring = pts.map((p): [number, number] => [p.x, p.y]);
      return { type: 'polygon', points: flattenRing(ring, smoothRing(ring)).map(([x, y]) => ({ x, y })) };
    }
    return { type: 'polygon', points: pts };
  }

  cancel(): void {
    this.points = [];
    this.cursorPoint = null;
    this.lastClick = null;
    this.press = null;
    this.drewFreehand = false;
    this.chainLayerId = null;
    this.stroke = null;
    this.sweep?.clear();
    this.ring?.clear();
  }

  isActive(): boolean {
    return this.points.length > 0 || this.stroke !== null;
  }

  private finish(): void {
    const ring = this.points;
    const layerId = this.chainLayerId;
    const curve = this.curved();
    this.cancel();
    if (!layerId || ring.length < 3) return;
    void commitPlateau(layerId, ring, { curve });
  }
}
