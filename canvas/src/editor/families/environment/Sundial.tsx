// The sundial: while the Sky sheet is open and Cast shadows is on, a ring around the map with
// one handle at the direction the sun and moon rise from. Dragging it turns the map's
// orientation; the sun then passes overhead and sets opposite (`sunAt`).
//
// The ring is the map's: centred on its bounds with MAP_GAP squares of air past the corners,
// following the camera through pan and zoom. It never leaves the canvas area the editor's
// chrome (rail, tool panel, title bar, sheet, dock, status bar) leaves clear: zoomed in past
// that, it rests at the interface's borders and a soft shadow outside it says the map runs on
// beyond. Only the ring's line and the handle take the pointer, and a wheel over them is handed
// to the canvas; the map pans and zooms everywhere else.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useStore } from '@/store/store';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { computeMapWorldBounds } from '@/engine/export/exportPipeline';
import { useShell } from '@/editor/shell/shellStore';
import { usePreview } from '@/editor/viewPrefs';
import { fallbackClearArea, mapCircle, orientationFor, riseAngle, sundialFrame, turnSun, type Camera, type ClearArea } from './sundialModel';

/** The ring's grab width around its line, px. */
const HIT_WIDTH = 16;
/** The ring: a pale casing under a fine line, so it reads on a pale floor and on a dark cave. */
const RING_CASING = 5;
const RING_CASING_OPACITY = 0.75;
const RING_LINE = 1.5;
/** The handle's disc, the icon on it, and the grab target around it, px. */
const HANDLE_R = 16;
const HANDLE_HIT_R = 22;
const ICON_SIZE = 18;
/** The editor's icon stroke. */
const ICON_STROKE = 1.75;
/** A small lift under the handle, so it reads as something to pick up. */
const HANDLE_LIFT = 'drop-shadow(0 1px 3px rgb(0 0 0 / 0.25))';
/** The shadow outside a ring resting at the borders: how far it reaches, px, and its darkest. */
const SHADOW_SPREAD = 28;
const SHADOW_ALPHA = 0.28;
/** The label's air inside the handle's edge, px, and its half size (11 px "Rises here"). */
const LABEL_GAP = 8;
const LABEL_HALF_W = 30;
const LABEL_HALF_H = 8;

/** The chrome that bounds the clear area, by the side of the canvas it covers. */
const LEFT_CHROME = ['shell-rail', 'shell-slot'];
const RIGHT_CHROME = ['shell-sky-sheet'];
const TOP_CHROME = ['shell-title-card', 'shell-top-actions'];
const BOTTOM_CHROME = ['shell-dock', 'shell-status'];
const CHROME = [...LEFT_CHROME, ...RIGHT_CHROME, ...TOP_CHROME, ...BOTTOM_CHROME];

interface View {
  viewport: { width: number; height: number };
  area: ClearArea;
}

const chromeOf = (shell: Element | null, id: string): Element | null => shell?.querySelector(`:scope > [data-testid="${id}"]`) ?? null;

/** The window and the canvas area the shell's chrome leaves clear. */
function measure(shell: Element | null): View {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const area = fallbackClearArea(viewport);
  const rect = (id: string): DOMRect | null => {
    const r = chromeOf(shell, id)?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? r : null;
  };
  let left: number | null = null;
  for (const id of LEFT_CHROME) {
    const r = rect(id);
    if (r) left = Math.max(left ?? 0, r.right);
  }
  if (left !== null) area.left = left;
  for (const id of RIGHT_CHROME) {
    const r = rect(id);
    if (r) area.right = r.left;
  }
  for (const id of TOP_CHROME) {
    const r = rect(id);
    if (r) area.top = Math.max(area.top, r.bottom);
  }
  for (const id of BOTTOM_CHROME) {
    const r = rect(id);
    if (r) area.bottom = Math.min(area.bottom, r.top);
  }
  return { viewport, area };
}

const sameView = (a: View, b: View): boolean =>
  a.viewport.width === b.viewport.width &&
  a.viewport.height === b.viewport.height &&
  a.area.left === b.area.left &&
  a.area.top === b.area.top &&
  a.area.right === b.area.right &&
  a.area.bottom === b.area.bottom;

/** The stage's offset and zoom (the canvas fills the window), or null before the engine is up. */
function cameraNow(): Camera | null {
  const engine = getEngineSingleton()?.engine;
  if (!engine) return null;
  const stage = engine.stage();
  return { x: stage.position.x, y: stage.position.y, zoom: stage.scale.x };
}

/**
 * Ends a drag as one undo step, however long it took: the orientation is put back where the
 * press found it, then turned to where the drag let go. A drag back to its start leaves none.
 */
function endDrag(before: number | undefined): void {
  const after = useStore.getState().mapSettings.orientation ?? 0;
  useStore.getState().setEnvironmentSettings({ orientation: before });
  turnSun(after);
}

const sameCamera = (a: Camera | null, b: Camera | null): boolean =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.zoom === b.zoom);

export function Sundial() {
  const open = useShell((s) => s.sheet === 'sky');
  const casting = useStore((s) => s.mapSettings.naturalLight === true);
  const orientation = useStore((s) => s.mapSettings.orientation ?? 0);
  const night = usePreview() === 'night';
  const layers = useStore((s) => s.layers);
  const terrain = useStore((s) => s.mapSettings.terrain?.bounds ?? null);
  const fixedSize = useStore((s) => s.mapSettings.fixedSize ?? null);
  const [view, setView] = useState<View>(() => measure(null));
  const [camera, setCamera] = useState<Camera | null>(null);
  /** The pointer turning the sun and the orientation the drag started from. */
  const drag = useRef<{ pointerId: number; before: number | undefined } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const shadowId = useId();
  const shown = open && casting;

  // Re-measured when the window resizes, a piece of chrome changes size, or one comes or goes.
  useLayoutEffect(() => {
    if (!shown) return;
    const shell = document.querySelector('[data-testid="shell"]');
    const update = () => setView((prev) => {
      const next = measure(shell);
      return sameView(prev, next) ? prev : next;
    });
    const sizes = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    const watch = () => {
      sizes?.disconnect();
      for (const id of CHROME) {
        const el = chromeOf(shell, id);
        if (el) sizes?.observe(el);
      }
    };
    const pieces = shell && typeof MutationObserver !== 'undefined' ? new MutationObserver(() => { watch(); update(); }) : null;
    pieces?.observe(shell!, { childList: true });
    watch();
    update();
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      sizes?.disconnect();
      pieces?.disconnect();
    };
  }, [shown]);

  // The camera, read on the render ticker as the light overlay follows it; a frame that moved
  // nothing renders nothing.
  useLayoutEffect(() => {
    if (!shown) return;
    const follow = () => setCamera((prev) => {
      const next = cameraNow();
      return sameCamera(prev, next) ? prev : next;
    });
    follow();
    const ticker = getEngineSingleton()?.engine.ticker?.();
    ticker?.add(follow);
    return () => {
      ticker?.remove(follow);
    };
  }, [shown]);

  // The map's bounds as Fit frames them, in squares; worked out again only when the map changes.
  const bounds = useMemo(() => (shown ? computeMapWorldBounds(layers, terrain, fixedSize) : null), [shown, layers, terrain, fixedSize]);
  const frame = sundialFrame(view.area, bounds && camera ? mapCircle(bounds, camera) : null);
  const drawn = shown && frame !== null;

  // A wheel over the ring or the handle still zooms the map: handed on to the canvas. Native and
  // not passive, so Ctrl+wheel there zooms the map rather than the page.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      const canvas = getEngineSingleton()?.engine.canvas();
      if (!canvas) return;
      e.preventDefault();
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaZ: e.deltaZ,
          deltaMode: e.deltaMode,
          clientX: e.clientX,
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [drawn]);

  // A drag still in hand when the dial goes (the sheet closed mid-drag) lands as its one step.
  useEffect(
    () => () => {
      if (!drag.current) return;
      endDrag(drag.current.before);
      drag.current = null;
    },
    [drawn],
  );

  if (!drawn || !frame) return null;
  const { cx, cy, r, shadow } = frame;

  // Live while the pointer is down, written straight to the map; the undo step lands on release.
  const turnTo = (e: ReactPointerEvent<SVGElement>) => {
    const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const angle = (Math.atan2(e.clientY - box.top - cy, e.clientX - box.left - cx) * 180) / Math.PI;
    const next = orientationFor(angle);
    if ((useStore.getState().mapSettings.orientation ?? 0) !== next) useStore.getState().setEnvironmentSettings({ orientation: next });
  };
  const onDown = (e: ReactPointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = { pointerId: e.pointerId, before: useStore.getState().mapSettings.orientation };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    turnTo(e);
  };
  const onMove = (e: ReactPointerEvent<SVGElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    e.preventDefault();
    turnTo(e);
  };
  const onUp = (e: ReactPointerEvent<SVGElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    endDrag(drag.current.before);
    drag.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const grab = { onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp };

  const a = (riseAngle(orientation) * Math.PI) / 180;
  const hx = cx + Math.cos(a) * r;
  const hy = cy + Math.sin(a) * r;
  // The label sits inside the ring, so it never leaves the clear area, and clear of the handle
  // whichever side it is on: pushed in by its own half size along the radius.
  const inset = HANDLE_R + LABEL_GAP + Math.abs(Math.cos(a)) * LABEL_HALF_W + Math.abs(Math.sin(a)) * LABEL_HALF_H;
  const lx = cx + Math.cos(a) * (r - inset);
  const ly = cy + Math.sin(a) * (r - inset);
  const Icon = night ? Moon : Sun;
  const reach = r + SHADOW_SPREAD;

  return (
    <div data-testid="sundial" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <svg ref={svgRef} width={view.viewport.width} height={view.viewport.height} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
        {shadow > 0 && (
          <>
            <defs>
              <radialGradient id={shadowId} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={reach}>
                <stop offset={r / reach} stopColor="rgb(0 0 0)" stopOpacity={SHADOW_ALPHA * shadow} />
                <stop offset={(r + SHADOW_SPREAD * 0.35) / reach} stopColor="rgb(0 0 0)" stopOpacity={SHADOW_ALPHA * shadow * 0.4} />
                <stop offset={1} stopColor="rgb(0 0 0)" stopOpacity={0} />
              </radialGradient>
            </defs>
            <circle
              data-testid="sundial-shadow"
              data-strength={shadow}
              cx={cx}
              cy={cy}
              r={r + SHADOW_SPREAD / 2}
              fill="none"
              stroke={`url(#${shadowId})`}
              strokeWidth={SHADOW_SPREAD}
            />
          </>
        )}
        <circle cx={cx} cy={cy} r={r} fill="none" className="stroke-panel" strokeWidth={RING_CASING} strokeOpacity={RING_CASING_OPACITY} />
        <circle cx={cx} cy={cy} r={r} fill="none" className="stroke-text" strokeWidth={RING_LINE} />
        <circle
          data-testid="sundial-ring"
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="transparent"
          strokeWidth={HIT_WIDTH}
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          {...grab}
        />
        <g data-testid="sundial-handle" data-icon={night ? 'moon' : 'sun'} style={{ pointerEvents: 'auto', cursor: 'grab' }} {...grab}>
          <circle cx={hx} cy={hy} r={HANDLE_HIT_R} fill="transparent" />
          <circle cx={hx} cy={hy} r={HANDLE_R} className="fill-panel stroke-text" strokeWidth={RING_LINE} style={{ filter: HANDLE_LIFT }} />
          <Icon
            aria-hidden
            x={hx - ICON_SIZE / 2}
            y={hy - ICON_SIZE / 2}
            size={ICON_SIZE}
            strokeWidth={ICON_STROKE}
            className="text-text"
          />
        </g>
        <text
          x={lx}
          y={ly}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-text stroke-panel text-[11px] font-medium"
          strokeWidth={4}
          style={{ paintOrder: 'stroke', pointerEvents: 'none' }}
        >
          Rises here
        </text>
      </svg>
    </div>
  );
}
