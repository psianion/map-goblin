// The sundial: while the Sky sheet is open and Cast shadows is on, a ring over the canvas with
// one sun handle at the direction the sun and moon rise from. Dragging it turns the map's
// orientation; the sun then passes overhead and sets opposite (`sunAt`).
//
// It is part of the interface, not of the map: the ring fills the canvas area the editor's
// chrome (rail, tool panel, title bar, sheet, dock, status bar) leaves clear and stays put
// through pan and zoom, so one zoomed-in piece's shadow can be checked from every direction.
// It never reads the map's bounds or the camera. Only the ring's line and the handle take the
// pointer, and a wheel over them is handed to the canvas; the map pans, zooms and selects
// everywhere else.

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '@/store/store';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { useShell } from '@/editor/shell/shellStore';
import { fallbackClearArea, orientationFor, riseAngle, sundialFrame, turnSun, type ClearArea } from './sundialModel';

/** The ring's grab width around its line, px. */
const HIT_WIDTH = 16;
const HANDLE_R = 11;

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

/** The window and the canvas area the shell's chrome leaves clear: never the map or the camera. */
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

export function Sundial() {
  const open = useShell((s) => s.sheet === 'sky');
  const casting = useStore((s) => s.mapSettings.naturalLight === true);
  const orientation = useStore((s) => s.mapSettings.orientation ?? 0);
  const [view, setView] = useState<View>(() => measure(null));
  const drag = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
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

  const frame = sundialFrame(view.area);
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

  if (!drawn || !frame) return null;
  const { cx, cy, r } = frame;

  const turnTo = (e: ReactPointerEvent<SVGElement>) => {
    const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const angle = (Math.atan2(e.clientY - box.top - cy, e.clientX - box.left - cx) * 180) / Math.PI;
    turnSun(orientationFor(angle), 'sky.orientation');
  };
  const onDown = (e: ReactPointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    turnTo(e);
  };
  const onMove = (e: ReactPointerEvent<SVGElement>) => {
    if (drag.current !== e.pointerId) return;
    e.preventDefault();
    turnTo(e);
  };
  const onUp = (e: ReactPointerEvent<SVGElement>) => {
    if (drag.current !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const grab = { onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp };

  const a = (riseAngle(orientation) * Math.PI) / 180;
  const hx = cx + Math.cos(a) * r;
  const hy = cy + Math.sin(a) * r;
  // The label sits inside the ring, so it never leaves the clear area.
  const lx = cx + Math.cos(a) * (r - HANDLE_R - 18);
  const ly = cy + Math.sin(a) * (r - HANDLE_R - 18);

  return (
    <div data-testid="sundial" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <svg ref={svgRef} width={view.viewport.width} height={view.viewport.height} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" className="stroke-panel" strokeWidth={4} strokeOpacity={0.7} />
        <circle cx={cx} cy={cy} r={r} fill="none" className="stroke-text" strokeWidth={1.5} />
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
        <g data-testid="sundial-handle" style={{ pointerEvents: 'auto', cursor: 'grab' }} {...grab}>
          <circle cx={hx} cy={hy} r={HANDLE_R} className="fill-panel stroke-text" strokeWidth={1.5} />
          <circle cx={hx} cy={hy} r={5} fill="#ffe27a" stroke="#c9a52e" strokeWidth={1.5} />
        </g>
        <text
          x={lx}
          y={ly}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-text stroke-panel text-[11px]"
          strokeWidth={3}
          style={{ paintOrder: 'stroke', pointerEvents: 'none' }}
        >
          Rises here
        </text>
      </svg>
    </div>
  );
}
