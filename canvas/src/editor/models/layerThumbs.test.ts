import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import type { Layer } from '@/store/types';
import {
  THUMB_LATE_MS,
  TERRAIN_THUMB,
  ThumbScheduler,
  clearThumbs,
  diffThumbs,
  fitFrame,
  getThumb,
  startLayerThumbs,
  thumbKeys,
  thumbPixels,
  type ThumbClock,
  type ThumbSnapshot,
} from './layerThumbs';

/** Timers and frames that only move when the test says so. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  let timers: { id: number; at: number; fn: () => void }[] = [];
  let frames: { id: number; fn: () => void }[] = [];
  const clock: ThumbClock = {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimeout: (h) => {
      timers = timers.filter((t) => t.id !== h);
    },
    requestFrame: (fn) => {
      const id = nextId++;
      frames.push({ id, fn });
      return id;
    },
    cancelFrame: (h) => {
      frames = frames.filter((f) => f.id !== h);
    },
  };
  return {
    clock,
    advance(ms: number) {
      now += ms;
      // Timers set by a timer that fired are due too when they land inside the step.
      for (;;) {
        const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at);
        if (due.length === 0) break;
        timers = timers.filter((t) => t.at > now);
        for (const t of due) t.fn();
      }
    },
    /** Run one animation frame. */
    frame() {
      const run = frames;
      frames = [];
      for (const f of run) f.fn();
    },
    get framesWaiting() {
      return frames.length;
    },
  };
}

function snap(layers: Layer[], extra: Partial<ThumbSnapshot> = {}): ThumbSnapshot {
  return { mapId: 'm1', layers, terrain: undefined, splatRev: 0, ...extra };
}

const bg = (texture: string | null): Layer =>
  ({
    id: 'bg',
    type: 'background',
    name: 'Background',
    visible: true,
    locked: false,
    opacity: 1,
    backgroundColor: '#2d2d2d',
    backgroundTexture: texture,
    textureScale: 1,
  }) as unknown as Layer;

describe('thumbPixels', () => {
  it('is 40 CSS px at up to 2x', () => {
    expect(thumbPixels(1)).toBe(40);
    expect(thumbPixels(1.5)).toBe(60);
    expect(thumbPixels(3)).toBe(80);
    expect(thumbPixels(0)).toBe(40);
  });
});

describe('fitFrame', () => {
  it('fits a wide frame across, centred top to bottom', () => {
    const { scale, tx, ty } = fitFrame({ minX: 10, minY: 0, maxX: 30, maxY: 10 }, 40);
    expect(scale).toBe(2);
    // Left edge lands on 0, the 20 px tall picture sits 10 px down.
    expect(10 * scale + tx).toBe(0);
    expect(0 * scale + ty).toBe(10);
    expect(30 * scale + tx).toBe(40);
  });

  it('fits a tall frame down, centred left to right', () => {
    const { scale, tx, ty } = fitFrame({ minX: -5, minY: -10, maxX: 5, maxY: 10 }, 80);
    expect(scale).toBe(4);
    expect(-5 * scale + tx).toBe(20);
    expect(-10 * scale + ty).toBe(0);
  });
});

describe('thumbKeys', () => {
  it('pictures every dungeon layer, a textured background and painted terrain only', () => {
    const a = createDungeonLayer('A');
    expect(thumbKeys({ layers: [bg(null), a], terrain: undefined })).toEqual([a.id]);
    expect(
      thumbKeys({
        layers: [bg('data:x'), a],
        terrain: { palette: [], bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } },
      }),
    ).toEqual(['bg', a.id, TERRAIN_THUMB]);
    expect(thumbKeys({ layers: [a], terrain: { palette: [], bounds: null } })).toEqual([a.id]);
  });
});

describe('diffThumbs', () => {
  it('treats the first look and a different map as opened', () => {
    const a = createDungeonLayer('A');
    expect(diffThumbs(null, snap([a]))).toEqual({ opened: true, dirty: [a.id], drop: [] });
    const b = createDungeonLayer('B');
    const d = diffThumbs(snap([a]), snap([b]));
    expect(d.opened).toBe(true);
    expect(d.dirty).toEqual([b.id]);
    expect(d.drop).toEqual([a.id]);
    expect(diffThumbs(snap([a]), snap([a], { mapId: 'm2' })).opened).toBe(true);
  });

  it('repaints only layers whose object changed, and new ones', () => {
    const a = createDungeonLayer('A');
    const b = createDungeonLayer('B');
    const c = createDungeonLayer('C');
    const a2 = { ...a, name: 'A2' };
    const d = diffThumbs(snap([a, b]), snap([a2, b, c]));
    expect(d.opened).toBe(false);
    expect(d.dirty).toEqual([a.id, c.id]);
    expect(d.drop).toEqual([]);
  });

  it('drops removed layers and a background that lost its texture', () => {
    const a = createDungeonLayer('A');
    const b = createDungeonLayer('B');
    const d = diffThumbs(snap([bg('data:x'), a, b]), snap([bg(null), a]));
    expect(d.drop.sort()).toEqual(['bg', b.id].sort());
    expect(d.dirty).toEqual([]);
  });

  it('repaints terrain on a new terrain object or a new splat revision', () => {
    const a = createDungeonLayer('A');
    const terrain = { palette: [], bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } };
    const before = snap([a], { terrain });
    expect(diffThumbs(before, snap([a], { terrain })).dirty).toEqual([]);
    expect(diffThumbs(before, snap([a], { terrain, splatRev: 1 })).dirty).toEqual([TERRAIN_THUMB]);
    expect(diffThumbs(before, snap([a], { terrain: { ...terrain } })).dirty).toEqual([TERRAIN_THUMB]);
  });
});

describe('ThumbScheduler', () => {
  it('waits for a quiet spell, then paints one tile per frame', () => {
    const t = fakeClock();
    const paint = vi.fn();
    const s = new ThumbScheduler(paint, t.clock, 300);
    s.mark(['a', 'b']);
    t.advance(200);
    s.mark(['a', 'c']); // still editing: the wait starts over
    t.advance(200);
    expect(t.framesWaiting).toBe(0);
    t.advance(100);
    expect(paint).not.toHaveBeenCalled();
    t.frame();
    expect(paint).toHaveBeenCalledTimes(1);
    t.frame();
    t.frame();
    expect(paint.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c']);
    expect(t.framesWaiting).toBe(0);
  });

  it('forgets tiles that went away and stops on dispose', () => {
    const t = fakeClock();
    const paint = vi.fn();
    const s = new ThumbScheduler(paint, t.clock, 300);
    s.mark(['a', 'b'], 0);
    t.advance(0);
    s.forget(['a']);
    expect(s.pending()).toEqual(['b']);
    s.dispose();
    t.frame();
    expect(paint).not.toHaveBeenCalled();
  });

  it('keeps going after a paint throws', () => {
    const t = fakeClock();
    const paint = vi.fn((key: string) => {
      if (key === 'a') throw new Error('boom');
    });
    const s = new ThumbScheduler(paint, t.clock, 0);
    s.mark(['a', 'b'], 0);
    t.advance(0);
    expect(() => t.frame()).toThrow('boom');
    t.frame();
    expect(paint).toHaveBeenCalledWith('b');
  });
});

describe('startLayerThumbs', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    clearThumbs();
  });

  it('paints every tile on start, edited ones after the debounce, and all once more later', () => {
    const a = createDungeonLayer('A');
    const b = createDungeonLayer('B');
    useStore.setState({ layers: [a, b] });
    const t = fakeClock();
    const paint = vi.fn((key: string) => `data:${key}`);
    const stop = startLayerThumbs(paint, t.clock);

    t.advance(0);
    t.frame();
    t.frame();
    expect(paint.mock.calls.map((c) => c[0])).toEqual([a.id, b.id]);
    expect(getThumb(a.id)).toBe(`data:${a.id}`);

    paint.mockClear();
    useStore.setState({ layers: [{ ...a, name: 'A2' }, b] });
    t.advance(299);
    t.frame();
    expect(paint).not.toHaveBeenCalled();
    t.advance(1);
    t.frame();
    expect(paint.mock.calls.map((c) => c[0])).toEqual([a.id]);

    paint.mockClear();
    t.advance(THUMB_LATE_MS);
    t.frame();
    t.frame();
    expect(paint).toHaveBeenCalledTimes(2);
    stop();
  });

  it('forgets the picture of a removed layer and keeps a picture while there is no canvas', () => {
    const a = createDungeonLayer('A');
    const b = createDungeonLayer('B');
    useStore.setState({ layers: [a, b] });
    const t = fakeClock();
    const paint = vi.fn((key: string) => (key === b.id ? undefined : `data:${key}`));
    const stop = startLayerThumbs(paint, t.clock);
    t.advance(0);
    t.frame();
    t.frame();
    expect(getThumb(a.id)).toBe(`data:${a.id}`);
    expect(getThumb(b.id)).toBeUndefined();

    useStore.setState({ layers: [b] });
    expect(getThumb(a.id)).toBeUndefined();
    stop();
  });

  it('does not paint while a map switch is in flight', () => {
    const a = createDungeonLayer('A');
    useStore.setState({ layers: [a], isMapSwitching: true });
    const t = fakeClock();
    const paint = vi.fn(() => 'data:x');
    const stop = startLayerThumbs(paint, t.clock);
    t.advance(0);
    t.frame();
    expect(paint).not.toHaveBeenCalled();
    stop();
  });
});
