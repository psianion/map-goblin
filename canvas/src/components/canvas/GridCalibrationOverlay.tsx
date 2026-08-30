import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Assets, type Texture } from 'pixi.js';
import { Button } from '@/components/ui/button';
import { notify } from '@/lib/toast';
import { useStore } from '@/store/store';
import { getEngineSingleton } from '@/engine/engineSingleton';
import type { AssetChild, DungeonLayer } from '@/store/types';
import {
  MAX_SPANS,
  MIN_BOX_WORLD,
  applyGridCalibration,
  assetFootprint,
  calibrationTransform,
  clampSpans,
  endGridCalibration,
  getGridCalibration,
  pxPerCell,
  setCalibrationBox,
  setCalibrationSpans,
  subscribeGridCalibration,
  type CalibrationBox,
} from '@/canvas/gridCalibration';

/** Arrow-key nudge, in cells. Shift moves a whole cell. */
const NUDGE = 0.1;

type DragMode = 'move' | 'tl' | 'br';

function worldAt(clientX: number, clientY: number): { x: number; y: number } | null {
  return getEngineSingleton()?.engine.screenToWorld(clientX, clientY) ?? null;
}

/** The texture's own pixel width, for the px/cell readout. 0 when not resolved yet. */
function nativePxWidth(assetId: string): number {
  try {
    return Assets.get<Texture>(assetId)?.width ?? 0;
  } catch {
    return 0;
  }
}

/**
 * On-canvas grid calibration: a draggable, resizable box over the imported
 * battlemap plus a compact bar at bottom-centre. The box's position sets the
 * grid offset and its size sets px/cell, so one gesture gives both.
 *
 * Chrome, not canvas overlay — it wants DOM focus semantics and the theme
 * accent. The container is pointer-transparent so pan and zoom still work
 * underneath while the mode is up.
 *
 * Motion: nothing here animates beyond CSS transitions, and index.css already
 * flattens those under `prefers-reduced-motion: reduce`.
 */
export function GridCalibrationOverlay() {
  const session = useSyncExternalStore(
    subscribeGridCalibration,
    getGridCalibration,
    getGridCalibration,
  );
  const active = session !== null;
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: DragMode; start: { x: number; y: number }; box: CalibrationBox } | null>(
    null,
  );
  const [spansDraft, setSpansDraft] = useState('');

  const child = useStore((s) => {
    if (!session) return null;
    const layer = s.layers.find(
      (l): l is DungeonLayer => l.type === 'dungeon' && l.id === session.layerId,
    );
    const found = layer?.children.find((c) => c.id === session.childId);
    return found?.childType === 'asset' ? (found as AssetChild) : null;
  });

  // Escape leaves the mode, ahead of the canvas's own document-level handler so
  // one press does not also cancel a tool. Standing rule: Escape exits.
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

  useEffect(() => {
    if (session) setSpansDraft(String(session.spans));
    // Only when the mode opens — typing must not be overwritten by its own commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // The camera moves without a store update, so the box's screen rect is
  // recomputed every frame from world coordinates rather than held in state.
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = boxRef.current;
      const s = getGridCalibration();
      const engine = getEngineSingleton()?.engine;
      if (!el || !s || !engine) return;
      const tl = engine.worldToScreen(s.box.x, s.box.y);
      const br = engine.worldToScreen(s.box.x + s.box.size, s.box.y + s.box.size);
      const w = Math.max(1, br.x - tl.x);
      const h = Math.max(1, br.y - tl.y);
      el.style.transform = `translate(${Math.round(tl.x)}px, ${Math.round(tl.y)}px)`;
      el.style.width = `${Math.round(w)}px`;
      el.style.height = `${Math.round(h)}px`;
      // Subdivisions, so the fit against the image's own lines is visible.
      const step = w / s.spans;
      el.style.backgroundImage =
        s.spans > 1 && step >= 3
          ? `repeating-linear-gradient(to right, rgb(var(--accent-active) / 0.55) 0 1px, transparent 1px ${step}px),` +
            `repeating-linear-gradient(to bottom, rgb(var(--accent-active) / 0.55) 0 1px, transparent 1px ${h / s.spans}px)`
          : 'none';
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const onPointerDown = useCallback((mode: DragMode) => (e: React.PointerEvent) => {
    const s = getGridCalibration();
    const start = worldAt(e.clientX, e.clientY);
    if (!s || !start) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode, start, box: s.box };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const w = worldAt(e.clientX, e.clientY);
    if (!w) return;
    const b = d.box;
    if (d.mode === 'move') {
      setCalibrationBox({ ...b, x: b.x + (w.x - d.start.x), y: b.y + (w.y - d.start.y) });
      return;
    }
    if (d.mode === 'br') {
      const size = Math.max(MIN_BOX_WORLD, w.x - b.x, w.y - b.y);
      setCalibrationBox({ x: b.x, y: b.y, size });
      return;
    }
    const brX = b.x + b.size;
    const brY = b.y + b.size;
    const size = Math.max(MIN_BOX_WORLD, brX - w.x, brY - w.y);
    setCalibrationBox({ x: brX - size, y: brY - size, size });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  // Zoom is bound to the canvas element, and the box sits on top of it — without
  // this you cannot scroll-zoom onto the very square you are trying to align to.
  // ponytail: wheel only. Middle-drag pan over the box would need the same
  // forwarding; move the cursor off the box, or lift these listeners to the
  // window in useCanvasInput.
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
    const step = e.shiftKey ? 1 : NUDGE;
    const b = s.box;
    const moves: Record<string, CalibrationBox> = {
      ArrowLeft: { ...b, x: b.x - step },
      ArrowRight: { ...b, x: b.x + step },
      ArrowUp: { ...b, y: b.y - step },
      ArrowDown: { ...b, y: b.y + step },
      '+': { ...b, size: b.size + step },
      '=': { ...b, size: b.size + step },
      '-': { ...b, size: b.size - step },
    };
    const next = moves[e.key];
    if (!next) return;
    e.preventDefault();
    setCalibrationBox(next);
  }, []);

  if (!session || !child) return null;

  const foot = assetFootprint(child);
  const perCell = pxPerCell({
    boxSize: session.box.size,
    footprintWidth: foot.width,
    nativePx: nativePxWidth(child.assetId),
    spans: session.spans,
  });
  const canApply = calibrationTransform(child, session.box, session.spans) !== null;

  const commitSpans = (raw: string) => {
    setSpansDraft(raw);
    if (raw.trim() === '') return;
    const n = clampSpans(Number(raw));
    setCalibrationSpans(n);
  };

  const apply = () => {
    if (applyGridCalibration()) {
      notify.success('Grid aligned — the image layer is locked, so trace on a layer above it');
    } else {
      notify.warning('That box is too small to calibrate from — draw it over a full grid square');
    }
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <div
        ref={boxRef}
        tabIndex={0}
        role="group"
        aria-label="Calibration box — drag to move, arrow keys to nudge, plus and minus to resize"
        onPointerDown={onPointerDown('move')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onBoxKeyDown}
        className="pointer-events-auto absolute left-0 top-0 cursor-move border-2 border-accent-active bg-accent-active/10 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span
          onPointerDown={onPointerDown('tl')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute -left-1.5 -top-1.5 size-3 cursor-nwse-resize rounded-sm border border-surface-0 bg-accent-active"
        />
        <span
          onPointerDown={onPointerDown('br')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize rounded-sm border border-surface-0 bg-accent-active"
        />
      </div>

      <div
        role="group"
        aria-label="Grid calibration"
        className="pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border-default bg-surface-1/95 px-2.5 py-1.5 shadow-xl backdrop-blur"
      >
        <span className="text-xs text-text-secondary">Drag the box onto the image&rsquo;s own grid</span>
        <span className="h-[22px] w-px bg-border-default" />
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          spans
          <input
            type="number"
            min={1}
            max={MAX_SPANS}
            step={1}
            inputMode="numeric"
            aria-label="Cells spanned"
            value={spansDraft}
            onChange={(e) => commitSpans(e.target.value)}
            onBlur={() => setSpansDraft(String(session.spans))}
            className="h-6 w-12 rounded-md border border-border-default bg-surface-0 px-1.5 text-center text-xs tabular-nums text-text-primary outline-none focus-visible:border-border-focus"
          />
          cells
        </label>
        <span className="text-xs tabular-nums text-accent-active" aria-live="polite">
          {perCell === null ? '= — px/cell' : `= ${perCell.toFixed(1)} px/cell`}
        </span>
        <span className="h-[22px] w-px bg-border-default" />
        <Button variant="outline" size="sm" onClick={endGridCalibration}>
          Skip
        </Button>
        <Button size="sm" disabled={!canApply} onClick={apply}>
          Use this grid
        </Button>
      </div>
    </div>
  );
}
