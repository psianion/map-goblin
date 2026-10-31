import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import type { AnyChild, DungeonLayer } from '@/store/types';
import { THUMB_DEBOUNCE_MS, THUMB_PAD, fitFrame, startLayerThumbs, thumbFrame, type ThumbClock } from './layerThumbs';

const MAP = { minX: 0, minY: 0, maxX: 100, maxY: 80 };

const crate = (id: string, x: number, y: number): AnyChild =>
  ({ id, name: id, childType: 'asset', visible: true, assetId: 't:c', position: { x, y }, rotation: 0, scale: 1, width: 2, height: 2 }) as AnyChild;

/** A clock the test drives: timers by due time, frames one at a time. */
function fakeClock() {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let frames: (() => void)[] = [];
  let nextId = 1;
  const clock: ThumbClock = {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout: (h) => {
      timers = timers.filter((t) => t.id !== h);
    },
    requestFrame: (fn) => {
      frames.push(fn);
      return frames.length;
    },
    cancelFrame: () => {},
  };
  return {
    clock,
    advance(ms: number) {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      for (const t of due) t.fn();
    },
    frame() {
      const run = frames;
      frames = [];
      for (const fn of run) fn();
      return run.length;
    },
  };
}

describe('thumbnail framing', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('frames a layer to its own content, padded on every side', () => {
    const layer = { ...createDungeonLayer('A'), children: [crate('a', 10, 10), crate('b', 20, 10)] } as DungeonLayer;
    const f = thumbFrame(layer, MAP);
    // Content 10..22 × 10..12 (assets are boxes centred on their position, 2 wide).
    const w = f.maxX - f.minX;
    expect(w).toBeGreaterThan(12);
    expect(w).toBeCloseTo(12 * (1 + 2 * THUMB_PAD), 1);
    expect(f.minX).toBeLessThan(10);
  });

  it('frames an empty layer to the whole map', () => {
    expect(thumbFrame(createDungeonLayer('Empty'), MAP)).toEqual(MAP);
  });

  it('frames the background and terrain to the whole map', () => {
    const bg = useStore.getState().layers[0];
    expect(thumbFrame(bg, MAP)).toEqual(MAP);
    expect(thumbFrame(undefined, MAP)).toEqual(MAP);
  });

  it('fits a frame into a wide tile, centred', () => {
    const { scale, tx, ty } = fitFrame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 60, 40);
    expect(scale).toBe(4);
    expect(tx).toBe(10);
    expect(ty).toBe(0);
  });

  it('re-frames an edited layer one debounce and one frame after the edit', () => {
    const level = useStore.getState().levels[0].id;
    const layer = { ...createDungeonLayer('A', level), children: [crate('a', 10, 10)] } as DungeonLayer;
    useStore.setState((s) => {
      s.layers = [s.layers[0], layer];
    });
    const t = fakeClock();
    const painted: string[] = [];
    const frames: Record<string, ReturnType<typeof thumbFrame>> = {};
    const stop = startLayerThumbs((key, layers) => {
      painted.push(key);
      frames[key] = thumbFrame(layers.find((l) => l.id === key), MAP);
      return 'data:';
    }, t.clock);
    t.advance(0);
    while (t.frame() > 0);
    painted.length = 0;
    const before = frames[layer.id];

    useStore.getState().updateChild(layer.id, 'a', { position: { x: 40, y: 30 } } as Partial<AnyChild>);
    t.advance(THUMB_DEBOUNCE_MS - 1);
    expect(t.frame()).toBe(0);
    t.advance(1);
    expect(t.frame()).toBe(1);
    expect(painted).toEqual([layer.id]);
    console.log(`[metric] thumbnail re-frame after an edit: ${THUMB_DEBOUNCE_MS} ms debounce + 1 frame`);
    expect(frames[layer.id].minX).toBeGreaterThan(before.minX);
    stop();
  });

  it('paints twelve edited layers twelve times in one batch, one tile per frame', () => {
    const level = useStore.getState().levels[0].id;
    const twelve = Array.from({ length: 12 }, (_, i) => ({ ...createDungeonLayer(`L${i}`, level), children: [crate(`c${i}`, i, i)] }) as DungeonLayer);
    useStore.setState((s) => {
      s.layers = [s.layers[0], ...twelve];
    });
    const t = fakeClock();
    const painted: string[] = [];
    const stop = startLayerThumbs((key) => {
      painted.push(key);
      return 'data:';
    }, t.clock);
    t.advance(0);
    while (t.frame() > 0);
    painted.length = 0;

    // One change batch: every layer edited, then edited again within the debounce.
    for (const l of twelve) useStore.getState().updateChild(l.id, l.children[0].id, { position: { x: 50, y: 50 } } as Partial<AnyChild>);
    t.advance(100);
    for (const l of twelve) useStore.getState().updateChild(l.id, l.children[0].id, { position: { x: 60, y: 60 } } as Partial<AnyChild>);
    t.advance(THUMB_DEBOUNCE_MS);
    let frameCount = 0;
    while (t.frame() > 0) frameCount++;
    expect(painted).toHaveLength(12);
    expect(new Set(painted).size).toBe(12);
    expect(frameCount).toBe(12);
    console.log(`[metric] 12 layers edited in one batch: ${painted.length} paints over ${frameCount} frames`);
    stop();
  });
});
