// A sized map's frame as the tools read it: what is on the map, and what a drawn area keeps of itself.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setClipperModule } from '../geometry/Clipper2Engine';
import type { ShapeChild } from '../store/types';
import type { Polygon } from '../types/geometry';
import { useStore } from '../store/store';
import { patchArea } from '../shared/materialPatch';
import { cutToFrame, onMap } from './mapFrame';
import { floorsOnMap } from './tools/newFloor';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule(await mod.default({ wasmBinary }));
}, 30_000);

beforeEach(() => useStore.getState().resetToDefault());

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function floor(id: string, ring: Polygon): ShapeChild {
  return {
    id, name: id, childType: 'shape', visible: true, shapeType: 'polygon', contours: [ring],
    textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
  };
}

const lock = () => useStore.getState().setFixedSize({ width: 10, height: 10, locked: true });

describe('cutToFrame and onMap', () => {
  it('leave a map that grows alone', () => {
    const rings = [rect(5, 5, 15, 15)];
    expect(cutToFrame(rings)).toBe(rings);
    expect(onMap(50, 50)).toBe(true);
  });

  it('keep a sized map’s drawing and points to its frame', () => {
    lock();
    expect(patchArea(cutToFrame([rect(5, 5, 15, 15)]))).toBeCloseTo(25);
    const inside = [rect(1, 1, 4, 4)];
    expect(cutToFrame(inside)).toBe(inside);
    expect(cutToFrame([rect(20, 20, 25, 25)])).toEqual([]);
    expect(onMap(10, 10)).toBe(true);
    expect(onMap(10.5, 5)).toBe(false);
  });
});

describe('floorsOnMap', () => {
  it('cuts a new floor to a sized map’s frame, drops one wholly past it, and keeps one inside as it is', () => {
    lock();
    const cut = floorsOnMap(floor('f', rect(5, 5, 15, 15)));
    expect(cut.length).toBe(1);
    expect(cut[0].id).toBe('f');
    for (const [x, y] of cut[0].contours[0]) {
      expect(x).toBeLessThanOrEqual(10);
      expect(y).toBeLessThanOrEqual(10);
    }
    expect(floorsOnMap(floor('g', rect(20, 20, 25, 25)))).toEqual([]);
    const kept = floor('h', rect(1, 1, 4, 4));
    expect(floorsOnMap(kept)).toEqual([kept]);
  });
});
