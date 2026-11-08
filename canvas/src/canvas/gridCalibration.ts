/**
 * The grid line-up: the check a DM lands in after founding a map on a battlemap that
 * arrived with its own printed grid.
 *
 * A lattice of W by H square cells lies over the whole picture, started where the grid
 * detector (or the file name's size) says the printed grid is. The DM checks it against the
 * picture's own lines, nudges its corner or its cell size, changes W or H, and takes it with
 * "Use this grid": the picture is scaled so one of its cells is one map cell, slid so the
 * lattice's corner sits on the map origin, and the map's fixed size becomes W by H, so the
 * lattice and the map are the same rectangle. The picture's own edge may hang a fraction of
 * a cell past it; the frame cuts that sliver (shared/mapBounds.ts).
 *
 * The math here is pure and unit-tested; `GridCalibrationOverlay` draws it.
 */

import { MAX_FIXED_CELLS } from '@dnd/core/src/store/slices/mapSettings';
import { useStore } from '@/store/store';
import { zoomToChild } from '@/canvas/panToChild';
import { undoManager } from '@/store/undoManager';
import { CompositeCommand, PropertyCommand, UpdateChildCommand } from '@/store/commands';
import type { AssetChild, Command, DungeonLayer, MapSettings } from '@/store/types';

/**
 * The lattice, in world units (1 unit == 1 map cell, everywhere): its top-left corner, the
 * side of one of its square cells, and how many cells across and down. Square on purpose:
 * `AssetChild` carries one scale for both axes.
 */
export interface Lattice {
  x: number;
  y: number;
  cell: number;
  cols: number;
  rows: number;
}

export interface CalibrationSession {
  layerId: string;
  childId: string;
  lattice: Lattice;
  /** The picture's own pixel size, before any downscale, for the px per cell readout. */
  sourcePx: { width: number; height: number } | null;
}

/** Where the line-up starts: the squares the dialog settled on and the grid it found. */
export interface LineUpSeed {
  cells?: { width: number; height: number } | null;
  /** In the picture's source pixels: a square's size and where a line falls on each axis. */
  grid?: { pxPerCell: number; originX: number; originY: number } | null;
  sourcePx?: { width: number; height: number } | null;
}

/**
 * A cell below a fiftieth of a map cell is a mis-drag, not a grid: the scale derived from
 * it is pointer noise and would detonate the sprite.
 */
export const MIN_CELL_WORLD = 0.02;
/** How much of the visible gap the picture fills on entering the mode. */
const CALIBRATION_FILL = 0.85;
/** And after "Use this grid": the picture is the map, so it fills the view. */
const APPLIED_FILL = 0.92;
const EPS = 1e-6;

/** Whole cells, at least one, at most what a fixed size accepts, never NaN. */
export function clampCells(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_FIXED_CELLS, Math.max(1, Math.round(n)));
}

/**
 * An asset's world footprint. `width`/`height` are multiplied by `scale` everywhere that
 * matters (the sprite sync and the hit test both do it), so this is the one true size.
 */
export function assetFootprint(child: Pick<AssetChild, 'width' | 'height' | 'scale'>): {
  width: number;
  height: number;
} {
  return { width: child.width * child.scale, height: child.height * child.scale };
}

/** The picture's top-left corner and size in the world. */
function pictureBox(child: Pick<AssetChild, 'position' | 'width' | 'height' | 'scale'>) {
  const foot = assetFootprint(child);
  return { left: child.position.x - foot.width / 2, top: child.position.y - foot.height / 2, ...foot };
}

/**
 * Of a line offset `o` and the one a cell before it, the one that centres `count` cells of
 * `cell` on a picture `size` long. A detector reads an edge line at the far end of a cell
 * as often as at zero; this keeps the lattice on the picture.
 */
function centredOffset(o: number, cell: number, count: number, size: number): number {
  const options = o > EPS ? [o, o - cell] : [o];
  const off = (v: number) => Math.abs(v + (count * cell) / 2 - size / 2);
  return options.reduce((a, b) => (off(b) < off(a) ? b : a));
}

/**
 * The lattice the line-up starts on. With a grid estimate and the source size: its cell and
 * offsets, scaled onto the picture as placed. With only squares: the picture's width over
 * them, from its corner. With neither: the map grid itself, from the first line on the
 * picture (an image lined up before sits exactly there).
 */
export function startLattice(child: Pick<AssetChild, 'position' | 'width' | 'height' | 'scale'>, seed: LineUpSeed = {}): Lattice {
  const box = pictureBox(child);
  const perPx = seed.sourcePx && seed.sourcePx.width > 0 ? box.width / seed.sourcePx.width : null;
  let cell: number;
  let ox: number;
  let oy: number;
  if (seed.grid && perPx && seed.grid.pxPerCell > 0) {
    cell = seed.grid.pxPerCell * perPx;
    ox = seed.grid.originX * perPx;
    oy = seed.grid.originY * perPx;
  } else if (seed.cells && seed.cells.width >= 1) {
    cell = box.width / seed.cells.width;
    ox = 0;
    oy = 0;
  } else {
    cell = 1;
    ox = Math.ceil(box.left - EPS) - box.left;
    oy = Math.ceil(box.top - EPS) - box.top;
  }
  cell = Math.max(MIN_CELL_WORLD, cell);
  const cols = clampCells(seed.cells?.width ?? (box.width - ox) / cell);
  const rows = clampCells(seed.cells?.height ?? (box.height - oy) / cell);
  return {
    x: box.left + centredOffset(ox, cell, cols, box.width),
    y: box.top + centredOffset(oy, cell, rows, box.height),
    cell,
    cols,
    rows,
  };
}

/**
 * Image pixels per cell, for the readout: the lattice's cell against the picture's own
 * pixel width, not the texture's, which is halved for a downscaled import. Null rather than
 * NaN or Infinity when anything is degenerate; the bar shows a dash for that.
 */
export function pxPerCell(lattice: Pick<Lattice, 'cell'>, footprintWidth: number, sourcePxWidth: number): number | null {
  if (!(lattice.cell > 0) || !(footprintWidth > 0) || !(sourcePxWidth > 0)) return null;
  const v = (lattice.cell / footprintWidth) * sourcePxWidth;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** The result has to stay a map: bigger than a token, smaller than a continent. */
const MIN_FOOTPRINT_CELLS = 0.5;
const MAX_FOOTPRINT_CELLS = 10000;

/**
 * What "Use this grid" does to the picture, or null if the lattice is degenerate or the
 * result would not be a usable sprite: scaled by 1 / cell, so a lattice cell becomes one map
 * cell, and slid so the lattice's corner lands on the map origin. `scale` is left alone and
 * `width`/`height` carry the change, which is what the transform gizmo writes too.
 */
export function calibrationTransform(
  child: Pick<AssetChild, 'position' | 'width' | 'height' | 'scale'>,
  lattice: Lattice,
): { position: { x: number; y: number }; width: number; height: number } | null {
  if (!Number.isFinite(lattice.x) || !Number.isFinite(lattice.y)) return null;
  if (!(lattice.cell >= MIN_CELL_WORLD)) return null;
  const k = 1 / lattice.cell;
  const box = pictureBox(child);
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const fw = box.width * k;
  const fh = box.height * k;
  if (fw < MIN_FOOTPRINT_CELLS || fh < MIN_FOOTPRINT_CELLS) return null;
  if (fw > MAX_FOOTPRINT_CELLS || fh > MAX_FOOTPRINT_CELLS) return null;
  const left = (box.left - lattice.x) * k;
  const top = (box.top - lattice.y) * k;
  const position = { x: left + fw / 2, y: top + fh / 2 };
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  return { position, width: child.width * k, height: child.height * k };
}

/** The map's size once the grid is taken: the lattice's whole cells. */
export function latticeFixedSize(lattice: Pick<Lattice, 'cols' | 'rows'>): { width: number; height: number } {
  return { width: clampCells(lattice.cols), height: clampCells(lattice.rows) };
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

/**
 * Enter the line-up for an already-placed image child, the lattice started from `seed`
 * (the picture's own source size when the seed has none). Returns false when `childId` is
 * not an asset child on a dungeon layer.
 */
export function startGridCalibration(childId: string, seed: LineUpSeed = {}): boolean {
  const layer = useStore
    .getState()
    .layers.find((l): l is DungeonLayer => l.type === 'dungeon' && l.children.some((c) => c.id === childId));
  if (!layer) return false;
  const found = findAsset(layer.id, childId);
  if (!found) return false;
  const own = found.child.imageSource;
  const sourcePx = seed.sourcePx ?? (own ? { width: own.width, height: own.height } : null);
  emit({ layerId: layer.id, childId, sourcePx, lattice: startLattice(found.child, { ...seed, sourcePx }) });
  // You cannot check a lattice against lines you cannot see, and the DM arrives here on
  // whatever camera the last map left them: frame the picture itself.
  zoomToChild(childId, CALIBRATION_FILL);
  return true;
}

/**
 * Frame the picture under an open line-up, for a shell that mounts after it started (the
 * map-change fit would otherwise undo the line-up's own framing). False when none is open.
 */
export function frameGridCalibration(): boolean {
  if (!session) return false;
  zoomToChild(session.childId, CALIBRATION_FILL);
  return true;
}

/** Move or resize the lattice; its cell never shrinks below `MIN_CELL_WORLD`. */
export function setCalibrationLattice(lattice: Pick<Lattice, 'x' | 'y' | 'cell'>): void {
  if (!session) return;
  emit({ ...session, lattice: { ...session.lattice, ...lattice, cell: Math.max(MIN_CELL_WORLD, lattice.cell) } });
}

/** W and H, in whole cells: the lattice reflows from its corner. */
export function setCalibrationCells(cols: number, rows: number): void {
  if (!session) return;
  emit({ ...session, lattice: { ...session.lattice, cols: clampCells(cols), rows: clampCells(rows) } });
}

/** Leave the mode with the image exactly as it was placed and still unlocked: Skip and Escape. */
export function endGridCalibration(): void {
  if (session) emit(null);
}

/**
 * Take the lattice as one undoable step: the picture's new size and place, the map's fixed
 * size, and the lock that stops a wall trace nudging it. Then frame the picture.
 *
 * The image's layer is what gets locked, as before per-child locks existed: the Battlemap
 * layer holds nothing else, and a locked layer keeps every tool's click off it.
 *
 * Returns false when the lattice is degenerate; the mode stays open.
 */
export function applyGridCalibration(): boolean {
  if (!session) return false;
  const { layerId, childId, lattice } = session;
  const found = findAsset(layerId, childId);
  if (!found) {
    endGridCalibration();
    return false;
  }
  const { layer, child } = found;

  const next = calibrationTransform(child, lattice);
  if (!next) return false;

  const label = 'Line up grid';
  undoManager.execute(
    new CompositeCommand(label, [
      new UpdateChildCommand(label, layerId, childId, { position: { ...child.position }, width: child.width, height: child.height }, next),
      new FixedSizeCommand(useStore.getState().mapSettings.fixedSize ?? null, latticeFixedSize(lattice)),
      new PropertyCommand('Lock image layer', { type: 'layer', layerId }, { locked: layer.locked }, { locked: true }),
    ]),
  );
  endGridCalibration();
  zoomToChild(childId, APPLIED_FILL);
  return true;
}
