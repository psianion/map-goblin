import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { Assets, type Texture } from 'pixi.js';
import { notify } from '@/lib/toast';
import { useStore } from '@/store/store';
import { getEngineSingleton } from '@/engine/engineSingleton';
import type { AssetChild, DungeonLayer } from '@/store/types';
import { FloatBox, PrimaryButton, SecondaryButton, Stepper } from '@/editor/components';
import { MAX_FIXED_CELLS } from '@dnd/core/src/store/slices/mapSettings';
import {
  MIN_CELL_WORLD,
  applyGridCalibration,
  assetFootprint,
  calibrationTransform,
  endGridCalibration,
  getGridCalibration,
  pxPerCell,
  setCalibrationCells,
  setCalibrationLattice,
  subscribeGridCalibration,
  type Lattice,
} from '@/canvas/gridCalibration';

/** Arrow-key nudge, as a share of a cell. Shift moves a whole cell. */
const NUDGE = 1 / 20;
/** Plus and minus grow and shrink the cell by this share; Shift by ten times it. */
const GROW = 0.005;

type DragMode = 'move' | 'tl' | 'br';

function worldAt(clientX: number, clientY: number): { x: number; y: number } | null {
  return getEngineSingleton()?.engine.screenToWorld(clientX, clientY) ?? null;
}

/** The texture's own pixel width, when the picture carries no source size. 0 when not resolved yet. */
function texturePxWidth(assetId: string): number {
  try {
    return Assets.get<Texture>(assetId)?.width ?? 0;
  } catch {
    return 0;
  }
}

const Sep = () => <span aria-hidden className="h-[22px] w-px bg-line" />;

/**
 * The grid line-up: a lattice of W by H square cells over the battlemap, its corner and
 * size dragged or nudged until it sits on the picture's own lines, and a bar with W and H,
 * the px per cell, Skip and Use this grid.
 *
 * Chrome, not canvas overlay: it wants DOM focus semantics and the theme ink. The container
 * is pointer-transparent so pan and zoom still work underneath while the mode is up.
 */
export function GridCalibrationOverlay() {
  const session = useSyncExternalStore(subscribeGridCalibration, getGridCalibration, getGridCalibration);
  const active = session !== null;
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: DragMode; start: { x: number; y: number }; lattice: Lattice } | null>(null);

  const child = useStore((s) => {
    if (!session) return null;
    const layer = s.layers.find((l): l is DungeonLayer => l.type === 'dungeon' && l.id === session.layerId);
    const found = layer?.children.find((c) => c.id === session.childId);
    return found?.childType === 'asset' ? (found as AssetChild) : null;
  });

  // Escape leaves the mode, ahead of the canvas's own document-level handler so one press
  // does not also cancel a tool. Standing rule: Escape exits.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      endGridCalibration();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  // The camera moves without a store update, so the lattice's screen rect is recomputed
  // every frame from world coordinates rather than held in state.
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = boxRef.current;
      const s = getGridCalibration();
      const engine = getEngineSingleton()?.engine;
      if (!el || !s || !engine) return;
      const { x, y, cell, cols, rows } = s.lattice;
      const tl = engine.worldToScreen(x, y);
      const br = engine.worldToScreen(x + cols * cell, y + rows * cell);
      const w = Math.max(1, br.x - tl.x);
      const h = Math.max(1, br.y - tl.y);
      el.style.transform = `translate(${tl.x}px, ${tl.y}px)`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      // Every cell's lines, so the fit against the picture's own lines is plain to see.
      const step = w / cols;
      const line = 'color-mix(in srgb, var(--ink) 60%, transparent)';
      el.style.backgroundImage =
        step >= 3
          ? `repeating-linear-gradient(to right, ${line} 0 1px, transparent 1px ${step}px),` +
            `repeating-linear-gradient(to bottom, ${line} 0 1px, transparent 1px ${h / rows}px)`
          : 'none';
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const onPointerDown = useCallback(
    (mode: DragMode) => (e: React.PointerEvent) => {
      const s = getGridCalibration();
      const start = worldAt(e.clientX, e.clientY);
      if (!s || !start) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { mode, start, lattice: s.lattice };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const w = worldAt(e.clientX, e.clientY);
    if (!w) return;
    const l = d.lattice;
    if (d.mode === 'move') {
      setCalibrationLattice({ x: l.x + (w.x - d.start.x), y: l.y + (w.y - d.start.y), cell: l.cell });
      return;
    }
    // A corner sizes the cell, kept square: the mean of what the two axes ask for.
    if (d.mode === 'br') {
      const cell = Math.max(MIN_CELL_WORLD, ((w.x - l.x) / l.cols + (w.y - l.y) / l.rows) / 2);
      setCalibrationLattice({ x: l.x, y: l.y, cell });
      return;
    }
    const brX = l.x + l.cols * l.cell;
    const brY = l.y + l.rows * l.cell;
    const cell = Math.max(MIN_CELL_WORLD, ((brX - w.x) / l.cols + (brY - w.y) / l.rows) / 2);
    setCalibrationLattice({ x: brX - l.cols * cell, y: brY - l.rows * cell, cell });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  // Zoom is bound to the canvas element, and the lattice sits on top of it: without this
  // you cannot scroll-zoom onto the very lines you are checking.
  const onWheel = useCallback((e: React.WheelEvent) => {
    const canvas = getEngineSingleton()?.engine.canvas();
    if (!canvas) return;
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        clientX: e.clientX,
        clientY: e.clientY,
        ctrlKey: e.ctrlKey,
        cancelable: true,
      }),
    );
  }, []);

  const onBoxKeyDown = useCallback((e: React.KeyboardEvent) => {
    const s = getGridCalibration();
    if (!s) return;
    const l = s.lattice;
    const step = e.shiftKey ? l.cell : l.cell * NUDGE;
    const grow = 1 + (e.shiftKey ? 10 * GROW : GROW);
    const moves: Record<string, Pick<Lattice, 'x' | 'y' | 'cell'>> = {
      ArrowLeft: { x: l.x - step, y: l.y, cell: l.cell },
      ArrowRight: { x: l.x + step, y: l.y, cell: l.cell },
      ArrowUp: { x: l.x, y: l.y - step, cell: l.cell },
      ArrowDown: { x: l.x, y: l.y + step, cell: l.cell },
      '+': { x: l.x, y: l.y, cell: l.cell * grow },
      '=': { x: l.x, y: l.y, cell: l.cell * grow },
      '-': { x: l.x, y: l.y, cell: l.cell / grow },
    };
    const next = moves[e.key];
    if (!next) return;
    e.preventDefault();
    setCalibrationLattice(next);
  }, []);

  if (!session || !child) return null;

  const { lattice } = session;
  const foot = assetFootprint(child);
  const perCell = pxPerCell(lattice, foot.width, session.sourcePx?.width ?? texturePxWidth(child.assetId));
  const canApply = calibrationTransform(child, lattice) !== null;

  const apply = () => {
    if (applyGridCalibration()) {
      notify.success('Grid lined up · the picture’s layer is locked, so trace on the layer above');
    } else {
      notify.warning('That grid is too small to line up from · size it over the picture’s own squares');
    }
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <div
        ref={boxRef}
        tabIndex={0}
        role="group"
        aria-label="Grid lattice · drag to move, arrow keys to nudge, plus and minus to resize"
        data-testid="grid-lineup-lattice"
        onPointerDown={onPointerDown('move')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onBoxKeyDown}
        className="pointer-events-auto absolute left-0 top-0 cursor-move border-2 border-ink outline-none focus-visible:ring-3 focus-visible:ring-focus"
      >
        <span
          onPointerDown={onPointerDown('tl')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute -left-1.5 -top-1.5 size-3 cursor-nwse-resize rounded-sm border border-bg bg-ink"
        />
        <span
          onPointerDown={onPointerDown('br')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize rounded-sm border border-bg bg-ink"
        />
      </div>

      {/* Above the dock (12 from the edge, 112 tall), centred. */}
      <FloatBox
        role="group"
        aria-label="Line up the grid"
        data-testid="grid-lineup-bar"
        className="pointer-events-auto absolute bottom-[136px] left-1/2 flex -translate-x-1/2 items-center gap-2 py-1.5 text-[12px]"
      >
        <span className="pl-1 text-text">Line up the grid</span>
        <Sep />
        <Stepper label="Squares across" value={lattice.cols} min={1} max={MAX_FIXED_CELLS} onValueChange={(v) => setCalibrationCells(v, lattice.rows)} />
        <span className="text-text-3">×</span>
        <Stepper label="Squares down" value={lattice.rows} min={1} max={MAX_FIXED_CELLS} onValueChange={(v) => setCalibrationCells(lattice.cols, v)} />
        <span className="text-text-2">cells</span>
        <Sep />
        <span className="font-mono text-[11px] tabular-nums text-text-2" aria-live="polite" data-testid="grid-lineup-px">
          {perCell === null ? '- px per cell' : `${Math.round(perCell)} px per cell`}
        </span>
        <Sep />
        <SecondaryButton onClick={endGridCalibration}>Skip</SecondaryButton>
        <PrimaryButton disabled={!canApply} onClick={apply}>
          Use this grid
        </PrimaryButton>
      </FloatBox>
    </div>
  );
}
