// The fog brush on the DM's map: the cursor that shows where the next stamp lands, and the
// stroke itself. Nothing here ever renders for a player, and nothing here draws the fog: the
// DM's see-through cloud is the fog layer's own (`FogRenderer`).
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
import { cellAt, fogFrame } from './fog';

/**
 * The brush cursor: a white ring on a dark halo, so it reads on grass, on stone and in a cave
 * alike, with the faintest fill to show the disc it covers.
 */
const CURSOR = { fill: 0xffffff, fillAlpha: 0.12, halo: 0x1b1b1b, haloAlpha: 0.6, haloWidth: 0.14, line: 0xffffff, lineWidth: 0.05 };

const send = (action: string, payload: unknown): void => useSessionStore.getState().sendCommand('fog', action, payload);

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

function mountFogOverlay(engine: RenderEngine, sceneGraph: SceneGraph): () => void {
  // The cursor lives in screen space, over the lighting composite, so a dark dungeon does not
  // swallow it; it mirrors the camera every frame.
  const cursor = new Container();
  const ring = new Graphics();
  cursor.addChild(ring);
  cursor.eventMode = 'none';
  addScreenOverlay(sceneGraph, cursor, 'fogOverlay');

  let hoverCell: Cell | null = null;
  const armed = (): boolean =>
    useSessionStore.getState().you?.role === 'dm' && useActiveTool.getState().activeTool === 'fog';
  const frameNow = (): Frame | null => fogFrame(useSessionStore.getState().mapData);

  const draw = (): void => {
    ring.clear();
    const frame = armed() && hoverCell ? frameNow() : null;
    cursor.visible = frame !== null;
    if (!frame || !hoverCell) return;
    const radius = useFogBrush.getState().size / 2;
    const [cx, cy] = [frame.minX + hoverCell[0] + 0.5, frame.minY + hoverCell[1] + 0.5];
    ring.circle(cx, cy, radius).fill({ color: CURSOR.fill, alpha: CURSOR.fillAlpha });
    ring.circle(cx, cy, radius).stroke({ color: CURSOR.halo, alpha: CURSOR.haloAlpha, width: CURSOR.haloWidth });
    ring.circle(cx, cy, radius).stroke({ color: CURSOR.line, alpha: 1, width: CURSOR.lineWidth });
  };

  const world = sceneGraph.worldContainer;
  const tick = (): void => {
    cursor.position.copyFrom(world.position);
    cursor.scale.copyFrom(world.scale);
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
  let batch: Cell[] = [];
  const painted = new Set<string>();
  let lastCell: Cell | null = null;

  const flush = (): void => {
    if (batch.length === 0) return;
    send('region-set', { levelId: strokeLevel, op: strokeOp, cells: batch });
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
    const cols = Math.round(strokeFrame.maxX - strokeFrame.minX);
    const rows = Math.round(strokeFrame.maxY - strokeFrame.minY);
    for (const [col, row] of disc(cell, useFogBrush.getState().size)) {
      if (col >= 0 && row >= 0 && col < cols && row < rows) mark([col, row]);
    }
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
