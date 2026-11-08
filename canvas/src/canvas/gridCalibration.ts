/**
 * The grid line-up: the check a DM lands in after founding a map on a battlemap that
 * arrived with its own printed grid.
 *
 * The map frame is the line-up: W by H cells of the canvas grid, from the origin. The
 * picture is scaled so one of its printed cells is one canvas cell (one source pixel is
 * 1 / px-per-cell of a cell) and slid by an offset until its printed lines sit on the canvas
 * grid. All of it is written to the map as it changes, with no undo steps, so the frame and
 * the picture move on screen at once: W and H are the map's fixed size, the px per cell and
 * the offset are the picture's size and place. Skip and Escape put the snapshot taken at the
 * start back; "Use this grid" commits the result as one undo step and locks the picture.
 *
 * It starts where the grid detector (or the size in the file name, or the size the dialog
 * settled on) says the printed grid is. On a map holding nothing but the picture, the
 * picture's first printed line goes on a frame edge; over drawn work (a re-line-up from the
 * sheet or the card) it goes on the nearest grid line to where it is, so traced walls keep
 * their place on it, and the frame starts at the map's own fixed size.
 *
 * The math here is pure and unit-tested; `GridCalibrationOverlay` drives it.
 */

import { Assets, type Texture } from 'pixi.js';
import { MAX_FIXED_CELLS } from '@dnd/core/src/store/slices/mapSettings';
import { computeContentBounds } from '@dnd/core/src/shared/mapBounds';
import { useStore } from '@/store/store';
import { zoomToBounds, zoomToChild } from '@/canvas/panToChild';
import { isBattlemapLayer } from '@/editor/models/layerSheetModel';
import { undoManager } from '@/store/undoManager';
import { CompositeCommand, PropertyCommand, UpdateChildCommand } from '@/store/commands';
import type { AssetChild, Command, DungeonLayer, Layer, MapSettings } from '@/store/types';

/**
 * Where the line-up stands, in world units (1 unit == 1 map cell): the frame's W and H in
 * cells, the picture's top-left corner, and how many of the picture's source pixels make one
 * cell.
 */
export interface LineUp {
  cols: number;
  rows: number;
  offsetX: number;
  offsetY: number;
  pxPerCell: number;
}

/** Where the picture's first printed line goes: a frame edge, or the nearest grid line. */
export type LineUpAnchor = 'origin' | 'nearest';

type Size = { width: number; height: number };

/** The picture and map as the line-up found them, put back by Skip and Escape. */
interface LineUpSnapshot {
  position: { x: number; y: number };
  width: number;
  height: number;
  scale: number;
  fixedSize: MapSettings['fixedSize'];
  gridVisible: boolean;
}

export interface CalibrationSession extends LineUp {
  layerId: string;
  childId: string;
  anchor: LineUpAnchor;
  /** The picture's own pixel size, before any downscale: what px per cell counts. */
  sourcePx: Size;
  before: LineUpSnapshot;
}

/** Where the line-up starts: the squares the dialog settled on and the grid it found. */
export interface LineUpSeed {
  cells?: Size | null;
  /** In the picture's source pixels: a square's size and where a line falls on each axis. */
  grid?: { pxPerCell: number; originX: number; originY: number } | null;
  sourcePx?: Size | null;
}

/** How much of the visible gap the picture and frame fill on entering the mode. */
const CALIBRATION_FILL = 0.85;
/** And after "Use this grid": the picture is the map, so it fills the view. */
const APPLIED_FILL = 0.92;
/**
 * Screen px from the window's foot the line-up bar covers: it floats 136 px up (over the
 * dock) and is about 40 tall; framing keeps the picture above it with some air.
 */
export const LINE_UP_BAR_CLEARANCE = 136 + 40 + 16;
const EPS = 1e-6;
/** The result has to stay a map: bigger than a token, smaller than a continent. */
const MIN_FOOTPRINT_CELLS = 0.5;
const MAX_FOOTPRINT_CELLS = 10000;

/** Whole cells, at least one, at most what a fixed size accepts, never NaN. */
export function clampCells(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_FIXED_CELLS, Math.max(1, Math.round(n)));
}

/**
 * An asset's world footprint. `width`/`height` are multiplied by `scale` everywhere that
 * matters (the sprite sync and the hit test both do it), so this is the one true size.
 */
export function assetFootprint(child: Pick<AssetChild, 'width' | 'height' | 'scale'>): Size {
  return { width: child.width * child.scale, height: child.height * child.scale };
}

/** The picture's top-left corner and size in the world. */
function pictureBox(child: Pick<AssetChild, 'position' | 'width' | 'height' | 'scale'>) {
  const foot = assetFootprint(child);
  return { left: child.position.x - foot.width / 2, top: child.position.y - foot.height / 2, ...foot };
}

/**
 * The px per cell a picture of `source` pixels can take: at least one pixel, at most a
 * picture half a cell across, and never a picture past the largest map.
 */
export function pxPerCellRange(source: Size): { min: number; max: number } {
  const min = Math.max(1, Math.max(source.width, source.height) / MAX_FOOTPRINT_CELLS);
  const max = Math.max(min, Math.min(source.width, source.height) / MIN_FOOTPRINT_CELLS);
  return { min, max };
}

export function clampPxPerCell(v: number, source: Size): number {
  const { min, max } = pxPerCellRange(source);
  if (!Number.isFinite(v)) return Math.min(max, Math.max(min, source.width));
  return Math.min(max, Math.max(min, v));
}

const frac = (v: number) => v - Math.floor(v);

/**
 * The picture's left (or top) edge on a frame `count` cells long, given its first printed
 * line sits `o` (0..1) of a cell in from that edge and the picture is `size` cells long:
 * with the line on the frame edge, or on the next line in, whichever leaves less of the
 * picture outside the frame (and, at a tie, centres it). A detector reads an edge line at
 * the far end of a cell as often as at zero; this keeps the picture on the frame.
 */
function insideOffset(o: number, size: number, count: number): number {
  const options = o > EPS && o < 1 - EPS ? [-o, 1 - o] : [0];
  const outside = (v: number) => Math.max(0, -v) + Math.max(0, v + size - count);
  const offCentre = (v: number) => Math.abs(v + size / 2 - count / 2);
  return options.reduce((a, b) => {
    const d = outside(b) - outside(a);
    return d < -EPS || (Math.abs(d) <= EPS && offCentre(b) < offCentre(a)) ? b : a;
  });
}

/**
 * The line-up to start on. px per cell: the detector's, else the picture's width over the
 * squares given, else what the picture is placed at now. W and H: the squares given, else
 * the picture in whole cells; over drawn work, the map's pinned size when it has one. The
 * offset puts the first printed line on a grid line (see the file comment).
 */
export function startLineUp(
  child: Pick<AssetChild, 'position' | 'width' | 'height' | 'scale'>,
  seed: LineUpSeed & { sourcePx: Size },
  anchor: LineUpAnchor = 'origin',
  fixedSize: MapSettings['fixedSize'] = null,
): LineUp {
  const src = seed.sourcePx;
  const box = pictureBox(child);
  const raw =
    seed.grid && seed.grid.pxPerCell > 0
      ? seed.grid.pxPerCell
      : seed.cells && seed.cells.width >= 1
        ? src.width / seed.cells.width
        : src.width / box.width;
  const pxPerCell = clampPxPerCell(raw, src);
  const fw = src.width / pxPerCell;
  const fh = box.width > 0 ? (fw * box.height) / box.width : src.height / pxPerCell;
  const ox = seed.grid ? frac(seed.grid.originX / pxPerCell) : 0;
  const oy = seed.grid ? frac(seed.grid.originY / pxPerCell) : 0;
  if (anchor === 'origin') {
    const cols = clampCells(seed.cells?.width ?? fw);
    const rows = clampCells(seed.cells?.height ?? fh);
    return { cols, rows, pxPerCell, offsetX: insideOffset(ox, fw, cols), offsetY: insideOffset(oy, fh, rows) };
  }
  const offsetX = Math.round(box.left + ox) - ox;
  const offsetY = Math.round(box.top + oy) - oy;
  return {
    cols: fixedSize ? fixedSize.width : clampCells(Math.ceil(offsetX + fw - EPS)),
    rows: fixedSize ? fixedSize.height : clampCells(Math.ceil(offsetY + fh - EPS)),
    pxPerCell,
    offsetX,
    offsetY,
  };
}

/**
 * The picture's place under a line-up, as the child fields to write: scaled from `base` (the
 * picture as the line-up found it, so it keeps its aspect) to `source.width / pxPerCell`
 * cells across, its top-left corner on the offset. `scale` is left alone and `width`/`height`
 * carry the change, which is what the transform gizmo writes. Null for a picture of no size.
 */
export function lineUpPlacement(
  base: Pick<AssetChild, 'width' | 'height' | 'scale'>,
  source: Size,
  lineUp: Pick<LineUp, 'offsetX' | 'offsetY' | 'pxPerCell'>,
): { position: { x: number; y: number }; width: number; height: number } | null {
  const foot = assetFootprint(base);
  if (!(foot.width > 0) || !(foot.height > 0) || !(lineUp.pxPerCell > 0)) return null;
  const k = source.width / lineUp.pxPerCell / foot.width;
  if (!Number.isFinite(k) || !(k > 0)) return null;
  const fw = foot.width * k;
  const fh = foot.height * k;
  if (![lineUp.offsetX, lineUp.offsetY].every(Number.isFinite)) return null;
  return { position: { x: lineUp.offsetX + fw / 2, y: lineUp.offsetY + fh / 2 }, width: base.width * k, height: base.height * k };
}

/** The picture's world box under the session's line-up: what a drag on it grabs. */
export function lineUpBox(s: Pick<CalibrationSession, 'before' | 'sourcePx' | 'offsetX' | 'offsetY' | 'pxPerCell'>): {
  left: number;
  top: number;
  width: number;
  height: number;
} | null {
  const placed = lineUpPlacement(s.before, s.sourcePx, s);
  if (!placed) return null;
  const foot = assetFootprint({ ...placed, scale: s.before.scale });
  return { left: s.offsetX, top: s.offsetY, ...foot };
}

/** The map's size under a line-up: its whole cells. */
export function lineUpFixedSize(lineUp: Pick<LineUp, 'cols' | 'rows'>): Size {
  return { width: clampCells(lineUp.cols), height: clampCells(lineUp.rows) };
}

/**
 * Whether the map holds anything but the picture `childId`: floors, walls, other children,
 * water, paint. A first line-up anchors on the origin; one over drawn work keeps its place.
 */
export function mapHoldsOtherContent(
  layers: readonly Layer[],
  childId: string,
  terrainBounds: Parameters<typeof computeContentBounds>[1] = null,
): boolean {
  const without = layers.map((l) => (l.type === 'dungeon' ? { ...l, children: l.children.filter((c) => c.id !== childId) } : l));
  return computeContentBounds(without, terrainBounds) !== null;
}

/** The map's pinned size as one undo step. */
class FixedSizeCommand implements Command {
  readonly label = 'Set map size';
  private readonly before: MapSettings['fixedSize'];
  private readonly after: MapSettings['fixedSize'];
  constructor(before: MapSettings['fixedSize'], after: MapSettings['fixedSize']) {
    this.before = before;
    this.after = after;
  }
  execute(): void {
    useStore.getState().setFixedSize(this.after);
  }
  undo(): void {
    useStore.getState().setFixedSize(this.before);
  }
}

// ─── Session state ───────────────────────────────────────
// A module-level store rather than a store slice: the mode is transient canvas chrome, it
// never belongs in a saved map, and one component reads it.

let session: CalibrationSession | null = null;
const listeners = new Set<() => void>();

function emit(next: CalibrationSession | null): void {
  session = next;
  for (const fn of listeners) fn();
}

export function subscribeGridCalibration(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getGridCalibration(): CalibrationSession | null {
  return session;
}

function findAsset(layerId: string, childId: string): { layer: DungeonLayer; child: AssetChild } | null {
  const layer = useStore
    .getState()
    .layers.find((l): l is DungeonLayer => l.type === 'dungeon' && l.id === layerId);
  const child = layer?.children.find((c) => c.id === childId);
  if (!layer || !child || child.childType !== 'asset') return null;
  return { layer, child };
}

/** The texture's own pixel size, when the picture carries no source size. Null when not resolved. */
function texturePx(assetId: string): Size | null {
  try {
    const t = Assets.get<Texture>(assetId);
    return t && t.width > 0 && t.height > 0 ? { width: t.width, height: t.height } : null;
  } catch {
    return null;
  }
}

const sameSize = (a: MapSettings['fixedSize'], b: MapSettings['fixedSize']) =>
  a === b || (!!a && !!b && a.width === b.width && a.height === b.height);

/** The session's line-up onto the map, live: the picture's place and the fixed size. */
function writeLive(s: CalibrationSession): void {
  const store = useStore.getState();
  const placed = lineUpPlacement(s.before, s.sourcePx, s);
  if (placed) store.updateChild(s.layerId, s.childId, placed);
  const size = lineUpFixedSize(s);
  if (!sameSize(store.mapSettings.fixedSize ?? null, size)) store.setFixedSize(size);
}

/** Put the snapshot back, quietly: the picture, the size, Show grid. */
function restore(s: CalibrationSession): void {
  const store = useStore.getState();
  const { position, width, height, fixedSize, gridVisible } = s.before;
  store.updateChild(s.layerId, s.childId, { position: { ...position }, width, height });
  if (!sameSize(store.mapSettings.fixedSize ?? null, fixedSize)) store.setFixedSize(fixedSize);
  if (store.grid.visible !== gridVisible) store.setGridVisible(gridVisible);
}

function update(patch: Partial<LineUp>): void {
  if (!session) return;
  const next = { ...session, ...patch };
  next.cols = clampCells(next.cols);
  next.rows = clampCells(next.rows);
  next.pxPerCell = clampPxPerCell(next.pxPerCell, next.sourcePx);
  if (!Number.isFinite(next.offsetX) || !Number.isFinite(next.offsetY)) return;
  emit(next);
  if (findAsset(next.layerId, next.childId)) writeLive(next);
}

/**
 * Enter the line-up for an already-placed image child, started from `seed` (the picture's
 * own source size when the seed has none). Snapshots the picture and the map, writes the
 * start, turns Show grid on so the printed grid can be checked against the canvas grid, and
 * frames the picture and the frame once. Returns false when `childId` is not an asset child
 * on a dungeon layer.
 */
export function startGridCalibration(childId: string, seed: LineUpSeed = {}): boolean {
  // One line-up at a time: an open one is left (and put back) before this one looks.
  endGridCalibration();
  const layer = useStore
    .getState()
    .layers.find((l): l is DungeonLayer => l.type === 'dungeon' && l.children.some((c) => c.id === childId));
  if (!layer) return false;
  const found = findAsset(layer.id, childId);
  if (!found) return false;
  const { child } = found;
  const own = child.imageSource;
  const foot = assetFootprint(child);
  const sourcePx = seed.sourcePx ??
    (own ? { width: own.width, height: own.height } : null) ??
    texturePx(child.assetId) ?? { width: foot.width * 100, height: foot.height * 100 };
  const state = useStore.getState();
  const fixedSize = state.mapSettings.fixedSize ?? null;
  const anchor: LineUpAnchor = mapHoldsOtherContent(state.layers, childId, state.mapSettings.terrain?.bounds ?? null) ? 'nearest' : 'origin';
  const lineUp = startLineUp(child, { ...seed, sourcePx }, anchor, fixedSize);
  const s: CalibrationSession = {
    layerId: layer.id,
    childId,
    anchor,
    sourcePx,
    ...lineUp,
    before: { position: { ...child.position }, width: child.width, height: child.height, scale: child.scale, fixedSize, gridVisible: state.grid.visible },
  };
  emit(s);
  writeLive(s);
  if (!state.grid.visible) state.setGridVisible(true);
  // You cannot check a printed grid against lines you cannot see, and the DM arrives here on
  // whatever camera the last map left them: frame the picture and the frame, over the bar.
  const box = lineUpBox(s);
  if (box) {
    const left = Math.min(0, box.left);
    const top = Math.min(0, box.top);
    const right = Math.max(s.cols, box.left + box.width);
    const bottom = Math.max(s.rows, box.top + box.height);
    zoomToBounds({ x: left, y: top, width: right - left, height: bottom - top }, CALIBRATION_FILL, LINE_UP_BAR_CLEARANCE);
  }
  return true;
}

/** W and H, in whole cells: the map's fixed size, at once. */
export function setCalibrationCells(cols: number, rows: number): void {
  update({ cols, rows });
}

/** The picture's top-left corner, in cells. */
export function setCalibrationOffset(offsetX: number, offsetY: number): void {
  update({ offsetX, offsetY });
}

/** Slide the picture by a share of a cell. */
export function nudgeCalibration(dx: number, dy: number): void {
  if (session) update({ offsetX: session.offsetX + dx, offsetY: session.offsetY + dy });
}

/** The picture's scale as source pixels per cell, about its top-left corner. */
export function setCalibrationPxPerCell(pxPerCell: number): void {
  update({ pxPerCell });
}

/**
 * Leave the mode with the picture, the map size and Show grid as they were: Skip and Escape.
 * A picture gone from the map (another map opened) leaves nothing to put back.
 */
export function endGridCalibration(): void {
  if (!session) return;
  const s = session;
  if (findAsset(s.layerId, s.childId)) restore(s);
  emit(null);
}

/**
 * Take the line-up as one undoable step: the picture's size and place, the map's fixed size,
 * and the lock that stops a wall trace nudging it. Show grid goes back to what it was. Then
 * frame the picture.
 *
 * On a Battlemap layer the lock is the layer's, though a child can be locked on its own
 * (LayerChild.locked): a locked child is still picked by a click, while a locked layer keeps
 * every tool's click and stroke off it, so walls are traced on the layer above and never land
 * on the Battlemap layer. A picture lined up among other things locks only itself.
 *
 * Returns false when the picture has no size; the mode stays open.
 */
export function applyGridCalibration(): boolean {
  if (!session) return false;
  const s = session;
  const found = findAsset(s.layerId, s.childId);
  if (!found) {
    emit(null);
    return false;
  }
  const { layer, child } = found;
  const placed = lineUpPlacement(s.before, s.sourcePx, s);
  if (!placed) return false;
  const size = lineUpFixedSize(s);

  // Back to the snapshot first, so the one command carries the whole change and undoes to it.
  restore(s);
  const { position, width, height, fixedSize } = s.before;
  const label = 'Line up grid';
  undoManager.execute(
    new CompositeCommand(label, [
      new UpdateChildCommand(label, s.layerId, s.childId, { position: { ...position }, width, height }, placed),
      ...(sameSize(fixedSize, size) ? [] : [new FixedSizeCommand(fixedSize, size)]),
      isBattlemapLayer(layer)
        ? new PropertyCommand('Lock image layer', { type: 'layer', layerId: s.layerId }, { locked: layer.locked }, { locked: true })
        : new PropertyCommand('Lock image', { type: 'child', layerId: s.layerId, childId: s.childId }, { locked: child.locked ?? false }, { locked: true }),
    ]),
  );
  emit(null);
  zoomToChild(s.childId, APPLIED_FILL);
  return true;
}
