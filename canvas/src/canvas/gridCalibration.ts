/**
 * On-canvas grid calibration — the mode a DM lands in after importing a
 * battlemap that arrived with its own printed grid already drawn on it.
 *
 * A square box is dragged over one of the image's own grid squares (or a run of
 * `spans` of them). Where the box sits gives the offset, how big it is gives the
 * scale: applying rescales the image so the box measures exactly `spans` world
 * cells, and shifts it so the box's top-left corner lands on a grid
 * intersection. One gesture, both numbers — which is the whole reason to
 * calibrate on the canvas instead of asking for a px-per-cell figure.
 *
 * The math here is pure and unit-tested; `GridCalibrationOverlay` draws it.
 */

import { useStore } from '@/store/store';
import { zoomToChild } from '@/canvas/panToChild';
import { undoManager } from '@/store/undoManager';
import { CompositeCommand, PropertyCommand, UpdateChildCommand } from '@/store/commands';
import type { AssetChild, DungeonLayer } from '@/store/types';

/**
 * The calibration box, in world units (1 unit == 1 grid cell, everywhere).
 * Square on purpose: `AssetChild` carries a single `scale`, so a rectangle
 * would ask for a non-uniform scale the sprite cannot express.
 * ponytail: square only. A battlemap with a genuinely non-square grid would
 * need separate x/y factors — add scaleX/scaleY to AssetChild first.
 */
export interface CalibrationBox {
  x: number;
  y: number;
  size: number;
}

export interface CalibrationSession {
  layerId: string;
  childId: string;
  box: CalibrationBox;
  spans: number;
}

/**
 * A box below a fiftieth of a cell is a mis-click, not a calibration: the
 * derived scale there is pure pointer noise and would detonate the sprite.
 */
export const MIN_BOX_WORLD = 0.02;
export const MAX_SPANS = 64;
const DEFAULT_SPANS = 3;
/** How much of the visible gap the image fills on entering the mode — enough to
 *  read its printed grid, with margin left to drag the box past an edge. */
const CALIBRATION_FILL = 0.85;
/** The result has to stay a map: bigger than a token, smaller than a continent. */
const MIN_FOOTPRINT_CELLS = 0.5;
const MAX_FOOTPRINT_CELLS = 10000;

/** Whole cells, at least one, never NaN. */
export function clampSpans(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_SPANS, Math.max(1, Math.floor(n)));
}

/**
 * An asset's world footprint. `width`/`height` are multiplied by `scale`
 * everywhere that matters (the sprite sync and the hit test both do it), so
 * this is the one true size.
 */
export function assetFootprint(child: Pick<AssetChild, 'width' | 'height' | 'scale'>): {
  width: number;
  height: number;
} {
  return { width: child.width * child.scale, height: child.height * child.scale };
}

/**
 * Image pixels per cell, for the readout. `nativePx` is the texture's own pixel
 * width. Returns null rather than NaN/Infinity when anything is degenerate —
 * the bar shows a dash for that.
 */
export function pxPerCell(args: {
  boxSize: number;
  footprintWidth: number;
  nativePx: number;
  spans: number;
}): number | null {
  const { boxSize, footprintWidth, nativePx } = args;
  const spans = clampSpans(args.spans);
  if (!(boxSize > 0) || !(footprintWidth > 0) || !(nativePx > 0)) return null;
  const v = ((boxSize / footprintWidth) * nativePx) / spans;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * The transform that lines the image's grid up with the world grid, or null if
 * the box is degenerate or the result would not be a usable sprite.
 *
 * Scale the image about the box's top-left corner (so that corner does not
 * move), then slide it so the corner sits on the nearest grid intersection.
 * `scale` is left alone and `width`/`height` carry the change — that is what
 * the transform gizmo writes, and `scale` is the legacy multiplier folded in
 * on top of it.
 */
export function calibrationTransform(
  child: Pick<AssetChild, 'position' | 'width' | 'height' | 'scale'>,
  box: CalibrationBox,
  spans: number,
): { position: { x: number; y: number }; width: number; height: number } | null {
  if (!Number.isFinite(box.x) || !Number.isFinite(box.y)) return null;
  if (!(box.size >= MIN_BOX_WORLD)) return null;

  const n = clampSpans(spans);
  const k = n / box.size;
  if (!Number.isFinite(k) || k <= 0) return null;

  const foot = assetFootprint(child);
  if (!(foot.width > 0) || !(foot.height > 0)) return null;
  const fw = foot.width * k;
  const fh = foot.height * k;
  if (fw < MIN_FOOTPRINT_CELLS || fh < MIN_FOOTPRINT_CELLS) return null;
  if (fw > MAX_FOOTPRINT_CELLS || fh > MAX_FOOTPRINT_CELLS) return null;

  const position = {
    x: Math.round(box.x) + (child.position.x - box.x) * k,
    y: Math.round(box.y) + (child.position.y - box.y) * k,
  };
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;

  return { position, width: child.width * k, height: child.height * k };
}

// ─── Session state ───────────────────────────────────────
// A module-level store rather than a store slice: the mode is transient canvas
// chrome, it never belongs in a saved map, and one component reads it.

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

function findAsset(
  layerId: string,
  childId: string,
): { layer: DungeonLayer; child: AssetChild } | null {
  const layer = useStore
    .getState()
    .layers.find((l): l is DungeonLayer => l.type === 'dungeon' && l.id === layerId);
  const child = layer?.children.find((c) => c.id === childId);
  if (!layer || !child || child.childType !== 'asset') return null;
  return { layer, child };
}

/**
 * Enter calibration for an already-placed image child. The box starts on the
 * image's top-left corner at a few cells across; the DM drags it onto a real
 * grid square from there.
 *
 * Returns false when `childId` is not an asset child on a dungeon layer.
 */
export function startGridCalibration(childId: string): boolean {
  const layer = useStore
    .getState()
    .layers.find(
      (l): l is DungeonLayer => l.type === 'dungeon' && l.children.some((c) => c.id === childId),
    );
  if (!layer) return false;
  const found = findAsset(layer.id, childId);
  if (!found) return false;

  const foot = assetFootprint(found.child);
  const size = Math.max(MIN_BOX_WORLD, Math.min(DEFAULT_SPANS, foot.width / 2, foot.height / 2));
  emit({
    layerId: layer.id,
    childId,
    spans: DEFAULT_SPANS,
    box: {
      x: found.child.position.x - foot.width / 2,
      y: found.child.position.y - foot.height / 2,
      size,
    },
  });
  // You cannot drag a box onto a grid square you cannot see, and the DM arrives
  // here on whatever camera the last map left them — frame the image itself.
  zoomToChild(childId, CALIBRATION_FILL);
  return true;
}

export function setCalibrationBox(box: CalibrationBox): void {
  if (!session) return;
  emit({ ...session, box: { ...box, size: Math.max(MIN_BOX_WORLD, box.size) } });
}

export function setCalibrationSpans(spans: number): void {
  if (!session) return;
  emit({ ...session, spans: clampSpans(spans) });
}

/**
 * Leave the mode with the image exactly as it was placed and still unlocked —
 * what both `Skip` and Escape do, so nobody is trapped in here.
 */
export function endGridCalibration(): void {
  if (session) emit(null);
}

/**
 * Apply the calibration as one undoable step: the image's new size and position,
 * plus the lock that stops a wall trace nudging it.
 *
 * ponytail: the only lock this codebase has is per-layer — `hitTestAllLayers`
 * skips locked layers and there is no `locked` on `LayerChild` — so the image's
 * layer is what gets locked. Upgrade path: add `locked` to `LayerChild`, honour
 * it in `hitTestAllLayers`, and swap the PropertyCommand target to the child.
 *
 * Returns false when the calibration is degenerate; the mode stays open.
 */
export function applyGridCalibration(): boolean {
  if (!session) return false;
  const { layerId, childId, box, spans } = session;
  const found = findAsset(layerId, childId);
  if (!found) {
    endGridCalibration();
    return false;
  }
  const { layer, child } = found;

  const next = calibrationTransform(child, box, spans);
  if (!next) return false;

  undoManager.execute(
    new CompositeCommand('Align image to grid', [
      new UpdateChildCommand(
        'Align image to grid',
        layerId,
        childId,
        { position: { ...child.position }, width: child.width, height: child.height },
        next,
      ),
      new PropertyCommand(
        'Lock image layer',
        { type: 'layer', layerId },
        { locked: layer.locked },
        { locked: true },
      ),
    ]),
  );
  endGridCalibration();
  return true;
}
