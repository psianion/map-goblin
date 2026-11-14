// Brush outlines on load: a 3.11 map whose pieces were stored as a boolean handed them back
// has its dense brush rings and fades tidied, and the crumbs erases left removed, on every
// load. No version bump; a second load changes nothing.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateToLatest, tidyBrushOutlines } from './migration';
import { useStore } from './store';
import type { DungeonLayer, SerializedMapData, ShapeChild } from './types';
import type { Polygon } from '../types/geometry';
import { setClipperModule } from '../geometry/Clipper2Engine';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule(await mod.default({ wasmBinary }));
}, 30_000);

beforeEach(() => useStore.getState().resetToDefault());

const circle = (n: number, r: number, cx = 0, cy = 0): Polygon =>
  Array.from({ length: n }, (_, i): [number, number] => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);
const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function piece(id: string, contours: Polygon[], extra: Partial<ShapeChild> = {}): ShapeChild {
  return {
    id, name: id, childType: 'shape', visible: true, shapeType: 'polygon', contours,
    textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
    ...extra,
  };
}

const dungeon = (data: SerializedMapData) => data.layers.find((l) => l.type === 'dungeon') as unknown as DungeonLayer;
const byId = (data: SerializedMapData, id: string) => dungeon(data).children.find((c) => c.id === id) as ShapeChild | undefined;

/** The default map with `children` on its dungeon layer, as a saved 3.11 file. */
function saved(children: ShapeChild[], caveOpenings?: Polygon[]): SerializedMapData {
  useStore.setState((s) => {
    const l = s.layers.find((x) => x.type === 'dungeon') as DungeonLayer;
    l.children = children;
    if (caveOpenings) l.caveOpenings = caveOpenings;
  });
  return JSON.parse(JSON.stringify(useStore.getState().getSerializableState())) as SerializedMapData;
}

describe('brush outlines on load', () => {
  const doc = () =>
    saved(
      [
        piece('dirt', [circle(300, 4, 10, 10)], { ground: true }),
        piece('crumb', [circle(40, 0.25, 30, 30)], { ground: true, fades: [{ rings: [circle(158, 1, 30, 30)], feather: 0.5 }] }),
        piece('floor', [rect(40, 40, 40.5, 40.5)]),
        piece('curved', [circle(300, 4, 50, 10)], { tangents: [Array.from({ length: 300 }, () => null)] }),
        piece('faded', [rect(0, 20, 10, 30)], { ground: true, fades: [{ rings: [circle(158, 1, 5, 25)], feather: 0.5, within: [circle(158, 1, 5, 25)] }] }),
      ],
      [circle(158, 1, 60, 60)],
    );

  it('thins a dense ring, removes a brush crumb, and keeps a small drawn floor and a curved shape', () => {
    const before = doc();
    const after = migrateToLatest(before);
    expect(after.version).toBe(before.version);
    const dirt = byId(after, 'dirt')!;
    expect(dirt.contours[0].length).toBeLessThan(100);
    expect(byId(after, 'crumb')).toBeUndefined();
    expect(byId(after, 'floor')!.contours).toEqual(byId(before, 'floor')!.contours);
    expect(byId(after, 'curved')!.contours).toEqual(byId(before, 'curved')!.contours);
    const fade = byId(after, 'faded')!.fades![0];
    expect(fade.rings[0].length).toBeLessThan(158);
    expect(fade.within![0].length).toBeLessThan(158);
    expect(dungeon(after).caveOpenings![0].length).toBeLessThan(158);
  });

  it('changes nothing the second time', () => {
    const once = migrateToLatest(doc());
    const twice = migrateToLatest(JSON.parse(JSON.stringify(once)) as SerializedMapData);
    expect(twice).toEqual(once);
    expect(tidyBrushOutlines(once.layers)).toBe(once.layers);
  });
});
