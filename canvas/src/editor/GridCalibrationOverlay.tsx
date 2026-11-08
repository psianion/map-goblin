import { useEffect, useSyncExternalStore } from 'react';
import { notify } from '@dnd/ui/toast';
import { useStore } from '@/store/store';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { canvasKeysAllowed } from '@/shortcuts/keyGuard';
import { FloatBox, PrimaryButton, SecondaryButton, Stepper } from '@dnd/ui';
import { MAX_FIXED_CELLS } from '@dnd/core/src/store/slices/mapSettings';
import {
  applyGridCalibration,
  endGridCalibration,
  getGridCalibration,
  lineUpBox,
  nudgeCalibration,
  pxPerCellRange,
  setCalibrationCells,
  setCalibrationOffset,
  setCalibrationPxPerCell,
  subscribeGridCalibration,
} from '@/canvas/gridCalibration';

/** Arrow-key nudge, as a share of a cell; Shift nudges by the larger one. */
const NUDGE = 0.05;
const NUDGE_SHIFT = 0.25;
/** The px per cell stepper's step. */
const PX_STEP = 0.5;

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** The next step of `PX_STEP` from `from` in the direction the stepper moved to `to`. */
function halfStep(from: number, to: number): number {
  return to > from ? Math.ceil((from + 1e-6) / PX_STEP) * PX_STEP : Math.floor((from - 1e-6) / PX_STEP) * PX_STEP;
}

const Sep = () => <span aria-hidden className="h-[22px] w-px bg-line" />;

/**
 * The grid line-up: the map frame is W by H cells of the canvas grid, and the picture under
 * it is dragged (left button, anywhere on it) or nudged with the arrow keys until its printed
 * lines sit on the canvas grid. The bar holds W and H, the px per cell, Skip and Use this grid.
 *
 * There is no box of its own over the canvas: a left press on the picture is taken at the
 * window before the tools see it, and every other press (a middle-button pan, a right-click
 * menu, a click off the picture, anything with the Pan tool) goes through untouched.
 */
export function GridCalibrationOverlay() {
  const session = useSyncExternalStore(subscribeGridCalibration, getGridCalibration, getGridCalibration);
  const active = session !== null;
  const hasChild = useStore((s) => {
    if (!session) return false;
    const layer = s.layers.find((l) => l.type === 'dungeon' && l.id === session.layerId);
    return layer?.type === 'dungeon' && layer.children.some((c) => c.id === session.childId && c.childType === 'asset');
  });

  // Escape leaves the mode, ahead of the canvas's own document-level handler so one press
  // does not also cancel a tool (standing rule: Escape exits). The arrows nudge the picture
  // wherever the canvas keys would be heard, and not in the canvas's own nudge as well.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        endGridCalibration();
        return;
      }
      const dir = ARROWS[e.key];
      if (!dir || e.ctrlKey || e.metaKey || e.altKey || !canvasKeysAllowed(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? NUDGE_SHIFT : NUDGE;
      nudgeCalibration(dir[0] * step, dir[1] * step);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  // Drag the picture: a left press on it, followed until the button lifts, the pointer is
  // cancelled or its capture is lost. Move events check the button too, so a release the
  // window never heard (a context menu swallowing it) cannot leave the picture on the pointer.
  useEffect(() => {
    if (!active) return;
    const canvas = getEngineSingleton()?.engine.canvas();
    if (!canvas) return;
    let drag: { pointerId: number; start: { x: number; y: number }; offset: { x: number; y: number } } | null = null;
    const worldAt = (e: PointerEvent) => getEngineSingleton()?.engine.screenToWorld(e.clientX, e.clientY) ?? null;
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const release = () => {
      if (!drag) return;
      const id = drag.pointerId;
      drag = null;
      if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
    };
    const onDown = (e: PointerEvent) => {
      if (e.target !== canvas || e.button !== 0 || drag) return;
      if (useStore.getState().tools.activeTool === 'pan') return;
      const s = getGridCalibration();
      const box = s ? lineUpBox(s) : null;
      const w = worldAt(e);
      if (!s || !box || !w) return;
      if (w.x < box.left || w.x > box.left + box.width || w.y < box.top || w.y > box.top + box.height) return;
      stop(e);
      drag = { pointerId: e.pointerId, start: w, offset: { x: s.offsetX, y: s.offsetY } };
      canvas.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      stop(e);
      if ((e.buttons & 1) === 0) {
        release();
        return;
      }
      const w = worldAt(e);
      if (w) setCalibrationOffset(drag.offset.x + (w.x - drag.start.x), drag.offset.y + (w.y - drag.start.y));
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      stop(e);
      release();
    };
    const onLost = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.pointerId) drag = null;
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    canvas.addEventListener('lostpointercapture', onLost);
    return () => {
      release();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      canvas.removeEventListener('lostpointercapture', onLost);
    };
  }, [active]);

  if (!session || !hasChild) return null;

  const range = pxPerCellRange(session.sourcePx);

  const apply = () => {
    if (applyGridCalibration()) {
      notify.success('Grid lined up · the picture’s layer is locked, so trace on the layer above');
    } else {
      notify.warning('That picture has no size to line up');
    }
  };

  // Above the dock (12 from the edge, 112 tall), centred; LINE_UP_BAR_CLEARANCE keeps the
  // framing clear of it.
  return (
    <FloatBox
      role="group"
      aria-label="Line up the grid"
      data-testid="grid-lineup-bar"
      className="fixed bottom-[136px] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 py-1.5 text-[12px]"
    >
      <span className="pl-1 text-text">Line up the grid</span>
      <Sep />
      <Stepper label="Squares across" value={session.cols} min={1} max={MAX_FIXED_CELLS} onValueChange={(v) => setCalibrationCells(v, session.rows)} />
      <span className="text-text-3">×</span>
      <Stepper label="Squares down" value={session.rows} min={1} max={MAX_FIXED_CELLS} onValueChange={(v) => setCalibrationCells(session.cols, v)} />
      <span className="text-text-2">cells</span>
      <Sep />
      <Stepper
        label="Pixels per cell"
        value={session.pxPerCell}
        min={range.min}
        max={range.max}
        step={PX_STEP}
        format={(v) => String(Math.round(v * 10) / 10)}
        // Onto the half-pixel steps, so a detected 70.37 steps to 70.5 or 70, not 70.87.
        onValueChange={(v) => setCalibrationPxPerCell(halfStep(session.pxPerCell, v))}
      />
      <span className="text-text-2" data-testid="grid-lineup-px">
        px per cell
      </span>
      <Sep />
      <SecondaryButton onClick={endGridCalibration}>Skip</SecondaryButton>
      <PrimaryButton onClick={apply}>Use this grid</PrimaryButton>
    </FloatBox>
  );
}
