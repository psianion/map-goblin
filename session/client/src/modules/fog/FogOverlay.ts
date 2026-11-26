// The fog brush on the DM's map: the cursor that shows which cells the next stamp changes, and
// the stroke itself. Nothing here ever renders for a player, and nothing here draws the fog: the
// DM's exact-cell view is the fog layer's own (`FogRenderer`).
//
// ponytail: pixi through @dnd/core, the same reach-through TokenRenderer documents.
import { Container, Graphics } from 'pixi.js';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import type { Cell, FogBrushOp, Frame } from '@dnd/mechanics/fog';
import { addScreenOverlay, mountWhenEngineReady, worldPointOf } from '../../renderer/overlayLayer';
import { useSessionStore } from '../../session/store';
import { useActiveTool } from '../../session/tools';
import { BRUSH_FLUSH_CELLS, brushLevelId, useFogBrush } from './brush';
import { cellAt, cellOutline, cellRuns, fogFrame } from './fog';

/**
 * The brush cursor: the cells the stamp will change, lightly filled and ringed with a dashed dark
 * line along their edges. Line and dashes in screen pixels, so they keep one weight at any zoom.
 */
const CURSOR = { fill: 0xffffff, fillAlpha: 0.42, line: 0x1b1b1b, linePx: 1.2, dashPx: 4, gapPx: 3 };

const send = (action: string, payload: unknown, group?: string): void =>
  useSessionStore.getState().sendCommand('fog', action, payload, group);

/** One id per stroke, so the DM's undo takes every batch of it back as one step. */
let strokes = 0;

/** The cells inside a disc of `size` cells diameter around `center`. */
export function disc(center: Cell, size: number): Cell[] {
  const r = size / 2;
  const reach = Math.ceil(r - 0.5);
  const cells: Cell[] = [];
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      if (dc * dc + dr * dr <= r * r) cells.push([center[0] + dc, center[1] + dr]);
    }
  }
  return cells;
}

/** The cells one stamp of `size` at `center` sends: its disc, clamped to the frame. */
export function stampCells(center: Cell, size: number, frame: Frame): Cell[] {
  const cols = Math.round(frame.maxX - frame.minX);
  const rows = Math.round(frame.maxY - frame.minY);
  return disc(center, size).filter(([col, row]) => col >= 0 && row >= 0 && col < cols && row < rows);
}

/** A polyline as dashes, `on` drawn and `off` skipped along its length, into `g`'s path. */
function dashed(g: Graphics, points: readonly [number, number][], closed: boolean, on: number, off: number): void {
  const path = closed ? [...points, points[0]!] : points;
  let phase = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1]!;
    const [bx, by] = path[i]!;
    const len = Math.hypot(bx - ax, by - ay);
    for (let t = 0; t < len; ) {
      const at = phase % (on + off);
      const step = Math.min(at < on ? on - at : on + off - at, len - t);
      if (at < on) {
        const [s, e] = [t / len, (t + step) / len];
        g.moveTo(ax + (bx - ax) * s, ay + (by - ay) * s).lineTo(ax + (bx - ax) * e, ay + (by - ay) * e);
      }
      t += step;
      phase += step;
    }
  }
}

function mountFogOverlay(engine: RenderEngine, sceneGraph: SceneGraph): () => void {
  // The cursor lives in screen space, over the lighting composite, so a dark dungeon does not
  // swallow it; it mirrors the camera every frame.
  const cursor = new Container();
  const cellsFill = new Graphics();
  const edge = new Graphics();
  cursor.addChild(cellsFill, edge);
  cursor.eventMode = 'none';
  addScreenOverlay(sceneGraph, cursor, 'fogOverlay');

  let hoverCell: Cell | null = null;
  const armed = (): boolean =>
    useSessionStore.getState().you?.role === 'dm' && useActiveTool.getState().activeTool === 'fog';
  const frameNow = (): Frame | null => fogFrame(useSessionStore.getState().mapData);
  const worldPerPx = (): number => engine.screenToWorld(1, 0).x - engine.screenToWorld(0, 0).x;
  let drawnPx = 0;

  const draw = (): void => {
    cellsFill.clear();
    edge.clear();
    const frame = armed() && hoverCell ? frameNow() : null;
    cursor.visible = frame !== null;
    if (!frame || !hoverCell) return;
    const size = useFogBrush.getState().size;
    const cells = stampCells(hoverCell, size, frame);
    const marked = new Set(cells.map((c) => c.join()));
    const inStamp = (col: number, row: number): boolean => marked.has(`${col},${row}`);
    const reach = Math.ceil(size / 2);
    const box = { col: hoverCell[0] - reach, row: hoverCell[1] - reach, cols: 2 * reach + 1, rows: 2 * reach + 1 };
    for (const [col, row, n] of cellRuns(box, inStamp)) cellsFill.rect(frame.minX + col, frame.minY + row, n, 1);
    if (cells.length > 0) cellsFill.fill({ color: CURSOR.fill, alpha: CURSOR.fillAlpha });
    const px = (drawnPx = worldPerPx());
    if (!(px > 0)) return;
    for (const chain of cellOutline(box, inStamp)) {
      const points = chain.points.map(([col, row]): [number, number] => [frame.minX + col, frame.minY + row]);
      dashed(edge, points, chain.closed, CURSOR.dashPx * px, CURSOR.gapPx * px);
    }
    if (cells.length > 0) edge.stroke({ color: CURSOR.line, alpha: 1, width: CURSOR.linePx * px });
  };

  const world = sceneGraph.worldContainer;
  const tick = (): void => {
    cursor.position.copyFrom(world.position);
    cursor.scale.copyFrom(world.scale);
    // The dashes keep their pixel size: redrawn when the zoom moves, not every frame.
    if (cursor.visible && Math.abs(worldPerPx() - drawnPx) > drawnPx * 0.01) draw();
  };
  const ticker = engine.ticker();
  ticker.add(tick);

  // ── The stroke ──────────────────────────────────────────────────────────
  // Gathered and sent in batches: every `BRUSH_FLUSH_CELLS * size` cells mid-drag, so the
  // players watch the ground open as the DM paints, and always again on pointerup. `painted`
  // dedupes across the whole stroke, so scrubbing over one doorway sends each cell once.
  let painting = false;
  let strokeOp: FogBrushOp = 'clear';
  let strokeLevel = '';
  let strokeFrame: Frame | null = null;
  let strokeGroup = '';
  let batch: Cell[] = [];
  const painted = new Set<string>();
  let lastCell: Cell | null = null;

  const flush = (): void => {
    if (batch.length === 0) return;
    send('region-set', { levelId: strokeLevel, op: strokeOp, cells: batch }, strokeGroup);
    batch = [];
  };

  const mark = (cell: Cell): void => {
    const key = cell.join();
    if (painted.has(key)) return;
    painted.add(key);
    batch.push(cell);
    if (batch.length >= BRUSH_FLUSH_CELLS * useFogBrush.getState().size) flush();
  };

  /** Stamp the disc at one path cell, clamped to the frame: one cell off it refuses the write. */
  const stamp = (cell: Cell): void => {
    if (!strokeFrame) return;
    for (const c of stampCells(cell, useFogBrush.getState().size, strokeFrame)) mark(c);
  };

  /** Every cell between the last one painted and this one, so a fast flick leaves no gaps. */
  const paintTo = (cell: Cell): void => {
    const from = lastCell;
    lastCell = cell;
    if (!from) return stamp(cell);
    const [dc, dr] = [cell[0] - from[0], cell[1] - from[1]];
    const steps = Math.max(Math.abs(dc), Math.abs(dr));
    for (let i = 1; i <= steps; i++) {
      stamp([from[0] + Math.round((dc * i) / steps), from[1] + Math.round((dr * i) / steps)]);
    }
  };

  const cellUnder = (e: PointerEvent): Cell | null => {
    const point = worldPointOf(engine, e);
    const frame = point && frameNow();
    return point && frame ? cellAt(frame, point.x, point.y) : null;
  };

  // Document capture, so an armed brush is answered before anything on the canvas: a drag
  // with the brush armed paints, never grabs a token or pans.
  const onMove = (e: PointerEvent): void => {
    if (!armed()) {
      if (hoverCell === null) return;
      hoverCell = null;
      draw();
      return;
    }
    const cell = cellUnder(e);
    if (painting && cell) {
      e.stopPropagation();
      e.preventDefault();
      paintTo(cell);
    }
    if (cell?.join() === hoverCell?.join()) return;
    hoverCell = cell;
    draw();
  };

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !armed()) return;
    const cell = cellUnder(e);
    // Off the frame there is nothing to paint, and a left-drag out there still pans.
    if (!cell) return;
    e.stopPropagation();
    e.preventDefault();
    // Alt is read once, at the start: a stroke is one way end to end.
    const { op } = useFogBrush.getState();
    strokeOp = e.altKey ? (op === 'clear' ? 'fog' : 'clear') : op;
    strokeLevel = brushLevelId();
    strokeFrame = frameNow();
    strokeGroup = `stroke-${Date.now().toString(36)}-${(strokes += 1)}`;
    painting = true;
    painted.clear();
    batch = [];
    lastCell = null;
    paintTo(cell);
    hoverCell = cell;
    draw();
  };

  // Anywhere, not only on the canvas: a stroke that ends off-screen still lands.
  const onUp = (): void => {
    if (!painting) return;
    painting = false;
    lastCell = null;
    flush();
  };

  const onLeave = (): void => {
    if (hoverCell === null) return;
    hoverCell = null;
    draw();
  };

  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);
  document.addEventListener('pointerleave', onLeave, true);
  const unsubTool = useActiveTool.subscribe(draw);
  const unsubBrush = useFogBrush.subscribe(draw);
  draw();

  return () => {
    // A stroke in flight when the table unmounts is still the DM's act: send it.
    onUp();
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    document.removeEventListener('pointerleave', onLeave, true);
    unsubTool();
    unsubBrush();
    // The engine may already be gone (GameRenderer unmounting first).
    try {
      ticker.remove(tick);
      if (!cursor.destroyed) cursor.destroy({ children: true });
    } catch {
      /* engine torn down first */
    }
  };
}

/** Call from an effect; the returned function is the effect's cleanup. */
export const mountFogOverlayWhenReady = (pollMs?: number): (() => void) => mountWhenEngineReady(mountFogOverlay, pollMs);
