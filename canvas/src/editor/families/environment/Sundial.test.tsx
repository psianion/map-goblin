import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { COALESCE_MS } from '@dnd/core/src/store/undoManager';
import { clearEngineSingleton, setEngineSingleton } from '@/engine/engineSingleton';
import { resetShell, useShell } from '@/editor/shell/shellStore';
import { resetViewPrefsForTests, setPreview } from '@/editor/viewPrefs';
import { computeMapWorldBounds } from '@/engine/export/exportPipeline';
import { Sundial } from './Sundial';
import { SkyMoodSheet } from './SkyMoodSheet';
import { mapCircle, orientationFor, riseAngle, riseLabel } from './sundialModel';

const st = () => useStore.getState();

type Rect = { left: number; top: number; right: number; bottom: number };
const rects: Record<string, Rect> = {};
let shell: HTMLElement;

/** A shell whose chrome reports the given rectangles (jsdom measures nothing of its own). */
function mountShell(chrome: Record<string, Rect>): void {
  shell = document.createElement('div');
  shell.setAttribute('data-testid', 'shell');
  for (const [id, r] of Object.entries(chrome)) {
    rects[id] = r;
    const el = document.createElement('div');
    el.setAttribute('data-testid', id);
    el.getBoundingClientRect = () => {
      const c = rects[id]!;
      return { ...c, x: c.left, y: c.top, width: c.right - c.left, height: c.bottom - c.top, toJSON: () => ({}) } as DOMRect;
    };
    shell.appendChild(el);
  }
  document.body.appendChild(shell);
}

const CHROME: Record<string, Rect> = {
  'shell-rail': { left: 0, top: 0, right: 56, bottom: 800 },
  'shell-slot': { left: 56, top: 100, right: 260, bottom: 500 },
  'shell-title-card': { left: 70, top: 0, right: 400, bottom: 50 },
  'shell-top-actions': { left: 800, top: 0, right: 1100, bottom: 44 },
  'shell-sky-sheet': { left: 960, top: 50, right: 1272, bottom: 700 },
  'shell-dock': { left: 300, top: 700, right: 950, bottom: 760 },
  'shell-status': { left: 300, top: 764, right: 950, bottom: 796 },
};
// Right of the rail and tool panel (260), below the title card (50), left of the sheet (960),
// above the dock (700): 700 wide, 650 tall.
const CX = 610;
const CY = 375;
const R = (650 - 48) / 2;

const ring = () => screen.getByTestId('sundial-ring');
const num = (el: Element, name: string) => Number(el.getAttribute(name));

function press(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, id = 1): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(ev, 'pointerId', { value: id });
  fireEvent(el, ev);
}
/** The point on the ring at a screen angle (0 right, 90 down). */
const onRing = (deg: number): [number, number] => [CX + Math.cos((deg * Math.PI) / 180) * R, CY + Math.sin((deg * Math.PI) / 180) * R];

beforeEach(() => {
  localStorage.clear();
  undoManager.clear();
  st().resetToDefault();
  resetShell();
  resetViewPrefsForTests();
  window.innerWidth = 1280;
  window.innerHeight = 800;
  mountShell(CHROME);
  useStore.setState((s) => {
    s.mapSettings.naturalLight = true;
    s.mapSettings.orientation = 0;
  });
  act(() => useShell.getState().openSheet('sky'));
});
afterEach(() => {
  cleanup();
  shell.remove();
  clearEngineSingleton();
});

describe('when the sundial shows', () => {
  it('shows with the Sky sheet open and Cast shadows on', () => {
    render(<Sundial />);
    expect(screen.getByTestId('sundial')).toBeTruthy();
    expect(screen.getByText('Rises here')).toBeTruthy();
  });

  it('is absent when the Sky sheet is closed', () => {
    act(() => useShell.getState().closeSheet());
    render(<Sundial />);
    expect(screen.queryByTestId('sundial')).toBeNull();
  });

  it('is absent under any other sheet', () => {
    act(() => useShell.getState().openSheet('layers'));
    render(<Sundial />);
    expect(screen.queryByTestId('sundial')).toBeNull();
  });

  it('is absent with Cast shadows off, and comes and goes as it is switched', () => {
    useStore.setState((s) => {
      s.mapSettings.naturalLight = false;
    });
    render(<Sundial />);
    expect(screen.queryByTestId('sundial')).toBeNull();
    act(() => useStore.setState((s) => void (s.mapSettings.naturalLight = true)));
    expect(screen.getByTestId('sundial')).toBeTruthy();
    act(() => useShell.getState().closeSheet());
    expect(screen.queryByTestId('sundial')).toBeNull();
  });

  it('carries exactly one handle, labelled Rises here', () => {
    render(<Sundial />);
    expect(screen.getAllByTestId('sundial-handle')).toHaveLength(1);
    expect(screen.getAllByText('Rises here')).toHaveLength(1);
  });
});

/** A camera the test moves, read through a stand-in engine whose ticker the test runs. */
const cam = { x: 0, y: 0, zoom: 10 };
let ticks: Array<() => void> = [];
function mountEngine(canvas?: HTMLCanvasElement): void {
  const stage = {
    position: { get x() { return cam.x; }, get y() { return cam.y; } },
    scale: { get x() { return cam.zoom; } },
  };
  const ticker = { add: (f: () => void) => void ticks.push(f), remove: (f: () => void) => void (ticks = ticks.filter((t) => t !== f)) };
  setEngineSingleton({ stage: () => stage, ticker: () => ticker, canvas: () => canvas } as never, {} as never);
}
const tick = () => act(() => ticks.forEach((f) => f()));
/** The camera that puts the map's centre on the clear area's centre at `zoom`. */
function centreAt(zoom: number): void {
  const b = computeMapWorldBounds(st().layers);
  cam.zoom = zoom;
  cam.x = CX - ((b.minX + b.maxX) / 2) * zoom;
  cam.y = CY - ((b.minY + b.maxY) / 2) * zoom;
}
const expected = () => mapCircle(computeMapWorldBounds(st().layers), cam);
const shadow = () => screen.queryByTestId('sundial-shadow');

describe('the ring around the map', () => {
  beforeEach(() => {
    ticks = [];
    mountEngine();
    centreAt(10);
  });

  it('is the map’s circle, 2 squares past its corners, while that fits, with no shadow', () => {
    render(<Sundial />);
    const c = expected();
    expect(c.r).toBeLessThan(R);
    expect(num(ring(), 'r')).toBeCloseTo(c.r, 6);
    expect(num(ring(), 'cx')).toBeCloseTo(c.cx, 6);
    expect(num(ring(), 'cy')).toBeCloseTo(c.cy, 6);
    expect(shadow()).toBeNull();
  });

  it('follows pan and zoom on the render ticker', () => {
    render(<Sundial />);
    const r0 = num(ring(), 'r');
    const cx0 = num(ring(), 'cx');
    cam.x += 40;
    tick();
    expect(num(ring(), 'cx')).toBeCloseTo(cx0 + 40, 6);
    cam.zoom = 15;
    tick();
    expect(num(ring(), 'r')).toBeCloseTo(r0 * 1.5, 6);
  });

  it('follows the map’s bounds', () => {
    render(<Sundial />);
    const before = num(ring(), 'r');
    act(() => {
      useStore.setState((s) => {
        s.mapSettings.terrain = { palette: [], bounds: { minX: -8, minY: -6, maxX: 12, maxY: 9 } };
      });
    });
    expect(num(ring(), 'r')).not.toBeCloseTo(before, 3);
    expect(num(ring(), 'r')).toBeCloseTo(Math.min(expected().r, R), 6);
  });

  it('zoomed in, rests at the interface’s borders with a shadow outside it', () => {
    render(<Sundial />);
    centreAt(200);
    tick();
    expect(expected().r).toBeGreaterThan(R * 2);
    expect([num(ring(), 'r'), num(ring(), 'cx'), num(ring(), 'cy')]).toEqual([R, CX, CY]);
    // Outside the line: the shadow's band starts at the ring and reaches out from it.
    const band = shadow()!;
    expect(num(band, 'r') - num(band, 'stroke-width') / 2).toBeCloseTo(R, 6);
    expect(Number(band.getAttribute('data-strength'))).toBe(1);
  });

  it('eases the shadow in as the ring starts to rest, rather than switching it on', () => {
    render(<Sundial />);
    const fitZoom = (cam.zoom * R) / expected().r;
    const strength = (k: number) => {
      centreAt(fitZoom * k);
      tick();
      const s = shadow();
      return s ? Number(s.getAttribute('data-strength')) : 0;
    };
    expect(strength(0.99)).toBe(0);
    const a = strength(1.02);
    const b = strength(1.06);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(1);
    expect(strength(1.5)).toBe(1);
  });

  it('stays inside the clear area when the map is panned off it', () => {
    render(<Sundial />);
    cam.x -= 2000;
    tick();
    expect(num(ring(), 'cx') - num(ring(), 'r')).toBeGreaterThanOrEqual(260 + 24 - 1e-6);
  });
});

describe('the ring without a camera yet', () => {
  it('is the largest ring the clear area holds: the smaller side less 48 px, centred on it', () => {
    render(<Sundial />);
    expect(num(ring(), 'r')).toBe(R);
    expect(num(ring(), 'cx')).toBe(CX);
    expect(num(ring(), 'cy')).toBe(CY);
  });

  it('follows the clear area on a resize', () => {
    render(<Sundial />);
    rects['shell-dock'] = { left: 300, top: 500, right: 950, bottom: 760 };
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    // Clear height is now 450: the ring shrinks to fit it.
    expect(num(ring(), 'r')).toBe((450 - 48) / 2);
    expect(num(ring(), 'cy')).toBe(50 + 225);
  });

  it('goes when the area cannot hold a ring', () => {
    render(<Sundial />);
    rects['shell-dock'] = { left: 300, top: 80, right: 950, bottom: 760 };
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.queryByTestId('sundial-ring')).toBeNull();
  });

  it('uses the window less the rail and the sheet when no chrome is mounted', () => {
    shell.remove();
    mountShell({});
    render(<Sundial />);
    // Window 1280 x 800: right of the 56 px rail, left of the 320 px sheet and its 12 px gap.
    const w = 1280 - 320 - 12 - 56;
    expect(num(ring(), 'r')).toBe((Math.min(w, 800) - 48) / 2);
    expect(num(ring(), 'cx')).toBe(56 + w / 2);
  });
});

describe('the handle', () => {
  const handle = () => screen.getByTestId('sundial-handle').querySelector('circle')!;

  it('sits on the ring at the angle the sun rises at', () => {
    for (const orientation of [0, 90, 225]) {
      act(() => useStore.setState((s) => void (s.mapSettings.orientation = orientation)));
      render(<Sundial />);
      const a = (riseAngle(orientation) * Math.PI) / 180;
      expect(num(handle(), 'cx')).toBeCloseTo(CX + Math.cos(a) * R, 6);
      expect(num(handle(), 'cy')).toBeCloseTo(CY + Math.sin(a) * R, 6);
      cleanup();
    }
  });

  it('is a disc of 32 px with a grab target of 44 px', () => {
    render(<Sundial />);
    const radii = [...screen.getByTestId('sundial-handle').querySelectorAll(':scope > circle')].map((c) => num(c, 'r'));
    expect(radii).toEqual([22, 16]);
  });

  it('carries a line sun at Dawn, Day, Dusk and Unlit, and a line moon at Night, no emoji', () => {
    for (const pick of ['unlit', 'dawn', 'day', 'dusk', 'night'] as const) {
      setPreview(pick);
      render(<Sundial />);
      const handle = screen.getByTestId('sundial-handle');
      const icon = pick === 'night' ? 'moon' : 'sun';
      expect(handle.getAttribute('data-icon'), pick).toBe(icon);
      expect(handle.querySelector(`svg.lucide-${icon}`), pick).toBeTruthy();
      expect(handle.textContent, pick).toBe('');
      cleanup();
    }
  });

  it('turns from sun to moon as the preview goes to Night', () => {
    render(<Sundial />);
    expect(screen.getByTestId('sundial-handle').getAttribute('data-icon')).toBe('sun');
    act(() => setPreview('night'));
    expect(screen.getByTestId('sundial-handle').getAttribute('data-icon')).toBe('moon');
  });

  it('passes the pointer through everywhere but the ring’s stroke and the handle', () => {
    render(<Sundial />);
    const style = (el: Element) => (el as HTMLElement | SVGElement).style.pointerEvents;
    expect(style(screen.getByTestId('sundial'))).toBe('none');
    expect(style(screen.getByTestId('sundial').querySelector('svg')!)).toBe('none');
    expect(style(ring())).toBe('stroke');
    expect(style(screen.getByTestId('sundial-handle'))).toBe('auto');
  });
});

describe('dragging the sun', () => {
  it('jumps the handle to where the ring is pressed', () => {
    render(<Sundial />);
    const [x, y] = onRing(90);
    press(ring(), 'pointerdown', x, y);
    expect(st().mapSettings.orientation).toBe(orientationFor(90));
    expect(riseLabel(st().mapSettings.orientation ?? 0)).toBe('Rise at the bottom');
  });

  it('snaps to a compass point within 6 degrees and goes free beyond', () => {
    render(<Sundial />);
    const handle = screen.getByTestId('sundial-handle');
    press(handle, 'pointerdown', ...onRing(93));
    expect(st().mapSettings.orientation).toBe(orientationFor(90));
    press(handle, 'pointermove', ...onRing(100));
    expect(riseAngle(st().mapSettings.orientation ?? 0)).toBeCloseTo(100, 0);
    press(handle, 'pointermove', ...onRing(137));
    expect(st().mapSettings.orientation).toBe(orientationFor(135));
    press(handle, 'pointerup', ...onRing(137));
  });

  it('is one undo step for the whole drag', () => {
    render(<Sundial />);
    const handle = screen.getByTestId('sundial-handle');
    press(handle, 'pointerdown', ...onRing(10));
    for (const deg of [25, 60, 100, 150, 200]) press(handle, 'pointermove', ...onRing(deg));
    press(handle, 'pointerup', ...onRing(200));
    expect(undoManager.size()).toBe(1);
    undoManager.undo();
    expect(st().mapSettings.orientation).toBe(0);
  });

  it('is one undo step however long the drag pauses between moves', () => {
    vi.useFakeTimers();
    try {
      render(<Sundial />);
      const handle = screen.getByTestId('sundial-handle');
      press(handle, 'pointerdown', ...onRing(10));
      for (const deg of [40, 100, 160, 200]) {
        vi.advanceTimersByTime(COALESCE_MS * 2);
        press(handle, 'pointermove', ...onRing(deg));
      }
      vi.advanceTimersByTime(COALESCE_MS * 2);
      press(handle, 'pointerup', ...onRing(200));
      expect(st().mapSettings.orientation).toBe(orientationFor(200));
      expect(undoManager.size()).toBe(1);
      undoManager.undo();
      expect(st().mapSettings.orientation).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('makes a press without a move one step, and a drag back to its start none', () => {
    render(<Sundial />);
    press(ring(), 'pointerdown', ...onRing(90));
    press(ring(), 'pointerup', ...onRing(90));
    expect(undoManager.size()).toBe(1);
    const start = st().mapSettings.orientation;
    press(ring(), 'pointerdown', ...onRing(150));
    press(ring(), 'pointermove', ...onRing(90));
    press(ring(), 'pointerup', ...onRing(90));
    expect(st().mapSettings.orientation).toBe(start);
    expect(undoManager.size()).toBe(1);
  });

  it('lands a drag cut short by the sheet closing as its one step', () => {
    render(<Sundial />);
    press(ring(), 'pointerdown', ...onRing(180));
    act(() => useShell.getState().closeSheet());
    expect(undoManager.size()).toBe(1);
    undoManager.undo();
    expect(st().mapSettings.orientation).toBe(0);
  });

  it('ignores moves with no press, and moves of another pointer', () => {
    render(<Sundial />);
    press(ring(), 'pointermove', ...onRing(120));
    expect(undoManager.size()).toBe(0);
    press(ring(), 'pointerdown', ...onRing(90), 1);
    press(ring(), 'pointermove', ...onRing(200), 2);
    expect(st().mapSettings.orientation).toBe(orientationFor(90));
    press(ring(), 'pointerup', ...onRing(90), 1);
    press(ring(), 'pointermove', ...onRing(200), 1);
    expect(st().mapSettings.orientation).toBe(orientationFor(90));
  });

  it('hands a wheel over the ring to the map canvas', () => {
    const canvas = document.createElement('canvas');
    const seen: WheelEvent[] = [];
    canvas.addEventListener('wheel', (e) => seen.push(e));
    ticks = [];
    mountEngine(canvas);
    render(<Sundial />);
    fireEvent.wheel(ring(), { deltaY: -120, clientX: 400, clientY: 300 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.deltaY).toBe(-120);
    expect(seen[0]!.clientX).toBe(400);
  });
});

describe('the Sky sheet readout', () => {
  const readout = () => screen.getByTestId('sky-rise');

  it('says where the sun rises, as “Rise at the …”', () => {
    for (const [orientation, label] of [[0, 'Rise at the right'], [90, 'Rise at the bottom'], [180, 'Rise at the left'], [270, 'Rise at the top'], [315, 'Rise at the upper right']] as const) {
      cleanup();
      useStore.setState((s) => {
        s.mapSettings.orientation = orientation;
      });
      render(<SkyMoodSheet />);
      expect(readout().textContent).toBe(label);
    }
  });

  it('is a focusable slider, not a slider input', () => {
    render(<SkyMoodSheet />);
    expect(screen.getByRole('slider', { name: 'Where the sun rises' })).toBe(readout());
    expect(readout().tabIndex).toBe(0);
    expect(document.querySelector('input[type="range"]')).toBeNull();
    readout().focus();
    expect(document.activeElement).toBe(readout());
  });

  it('turns the sun 45 degrees on Right and the other way on Left', () => {
    render(<SkyMoodSheet />);
    fireEvent.keyDown(readout(), { key: 'ArrowRight' });
    expect(st().mapSettings.orientation).toBe(45);
    expect(readout().textContent).toBe(riseLabel(45));
    fireEvent.keyDown(readout(), { key: 'ArrowRight' });
    expect(st().mapSettings.orientation).toBe(90);
    fireEvent.keyDown(readout(), { key: 'ArrowLeft' });
    fireEvent.keyDown(readout(), { key: 'ArrowLeft' });
    fireEvent.keyDown(readout(), { key: 'ArrowLeft' });
    expect(st().mapSettings.orientation).toBe(315);
  });

  it('makes each press its own undo step', () => {
    render(<SkyMoodSheet />);
    fireEvent.keyDown(readout(), { key: 'ArrowRight' });
    fireEvent.keyDown(readout(), { key: 'ArrowRight' });
    fireEvent.keyDown(readout(), { key: 'ArrowRight' });
    expect(undoManager.size()).toBe(3);
    undoManager.undo();
    expect(st().mapSettings.orientation).toBe(90);
    undoManager.undo();
    expect(st().mapSettings.orientation).toBe(45);
  });

  it('leaves other keys alone', () => {
    render(<SkyMoodSheet />);
    fireEvent.keyDown(readout(), { key: 'ArrowUp' });
    fireEvent.keyDown(readout(), { key: 'a' });
    expect(undoManager.size()).toBe(0);
  });

  it('moves with the sundial: a drag shows in the readout', () => {
    render(
      <>
        <Sundial />
        <SkyMoodSheet />
      </>,
    );
    press(ring(), 'pointerdown', ...onRing(180));
    expect(readout().textContent).toBe('Rise at the left');
  });
});
