// Where the Door tool's Stairs style lays a flight: whole cells along the plateau's own edge under
// the pointer, as wide as asked, never over other stairs; and the stairs under the pointer.
import { beforeAll, describe, expect, it } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import type { DungeonLayer, PlateauChild } from '../store/types';
import { resizeStairs, stairSpanAt, stairsAt } from './stairPlace';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule((await mod.default({ wasmBinary })) as MainModule);
}, 30_000);

const plat = (id: string, height: number, extra: Partial<PlateauChild> = {}): PlateauChild => ({
  id,
  name: id,
  childType: 'plateau',
  visible: true,
  contours: [[[10, 10], [14, 10], [14, 14], [10, 14]]],
  height,
  edge: 'cliff',
  ...extra,
});
const layerOf = (...children: PlateauChild[]) => ({ children }) as unknown as DungeonLayer;

describe('laying stairs with the Door tool', () => {
  it('lays a run of whole cells along the edge under the pointer, centred on it', () => {
    const plan = stairSpanAt(layerOf(plat('top', 2)), [12.3, 9.8], 2)!;
    expect(plan.plateau.id).toBe('top');
    expect(plan.span).toEqual({ ring: 0, from: 1, to: 3 });
    expect(plan.valid).toBe(true);
    expect(plan.flight?.length).toBe(2);
  });

  it('keeps the run on its edge by a corner, and to as many cells as a short edge holds', () => {
    expect(stairSpanAt(layerOf(plat('top', 1)), [10.1, 9.9], 1)!.span).toEqual({ ring: 0, from: 0, to: 1 });
    expect(stairSpanAt(layerOf(plat('top', 1)), [13.9, 9.9], 2)!.span).toEqual({ ring: 0, from: 2, to: 4 });
    expect(stairSpanAt(layerOf(plat('top', 1)), [12, 9.9], 9)!.span).toEqual({ ring: 0, from: 0, to: 4 });
    // Down the east side: the outline's second edge, from 4 along it.
    expect(stairSpanAt(layerOf(plat('top', 1)), [14.2, 11.6], 1)!.span).toEqual({ ring: 0, from: 5, to: 6 });
  });

  it('lays into a pit from its rim, and nothing far from every edge', () => {
    const plan = stairSpanAt(layerOf(plat('pit', -1)), [12, 10.3], 2)!;
    expect(plan.span).toEqual({ ring: 0, from: 1, to: 3 });
    expect(plan.flight?.down[1]).toBeCloseTo(1);
    expect(stairSpanAt(layerOf(plat('top', 1)), [12, 12], 1)).toBeNull();
    expect(stairSpanAt(layerOf(plat('top', 1)), [12, 7], 1)).toBeNull();
  });

  it('will not lay over other stairs, but a span being moved is no obstacle to itself', () => {
    const top = plat('top', 1, { stairs: [{ id: 's', ring: 0, from: 1, to: 3 }] });
    expect(stairSpanAt(layerOf(top), [12.5, 9.9], 1)!.valid).toBe(false);
    expect(stairSpanAt(layerOf(top), [12.5, 9.9], 1, 's')!.valid).toBe(true);
    expect(stairSpanAt(layerOf(top), [10.4, 9.9], 1)!.valid).toBe(true);
  });

  it('finds the stairs under the pointer, on the flight or its top', () => {
    const top = plat('top', 2, { stairs: [{ id: 's', ring: 0, from: 1, to: 3 }] });
    expect(stairsAt(layerOf(top), [12, 9])?.span.id).toBe('s');
    expect(stairsAt(layerOf(top), [12, 10.1])?.span.id).toBe('s');
    expect(stairsAt(layerOf(top), [12, 7.5])).toBeNull();
    expect(stairsAt(layerOf(top), [13.5, 9])).toBeNull();
  });
});

describe('resizing stairs', () => {
  it('keeps the start where the edge allows, shifts back at its end, and never runs onto other stairs', () => {
    const top = plat('top', 1, { stairs: [{ id: 's', ring: 0, from: 1, to: 2 }, { id: 't', ring: 0, from: 5, to: 6 }] });
    const s = top.stairs![0];
    expect(resizeStairs(top, s, 2)).toMatchObject({ from: 1, to: 3 });
    expect(resizeStairs(top, s, 9)).toMatchObject({ from: 0, to: 4 });
    expect(resizeStairs(top, { ...s, from: 3, to: 4 }, 3)).toMatchObject({ from: 1, to: 4 });
    expect(resizeStairs(top, top.stairs![1], 3)).toMatchObject({ from: 5, to: 8 });
    const crowded = plat('top', 1, { stairs: [{ id: 's', ring: 0, from: 0, to: 1 }, { id: 'u', ring: 0, from: 2, to: 3 }] });
    expect(resizeStairs(crowded, crowded.stairs![0], 3)).toBeNull();
  });
});
