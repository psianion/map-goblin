// A painted cave owns its edge: its rings, its wall in resolveWalls (and no floor edge along
// it), light stopped at it inside another floor, and Suggest rooms seeing it there.

import { beforeAll, describe, expect, it } from 'vitest';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { caveCutters, caveEdges, caveFloorShape, onCaveEdge } from './caveFloor';
import { resolveWalls } from './wallResolve';
import { suggestRooms } from './suggestRooms';
import { extractWallSegments } from '../engine/lighting/raycaster';
import { computeMergedFloor } from '../engine/mergedFloor';
import { layerFaces } from '../store/roomSync';
import { createDungeonLayer } from '../store/factories';
import type { DungeonLayer, ShapeChild } from '../store/types';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule(await mod.default({ wasmBinary }));
}, 30_000);

type Ring = [number, number][];
const square = (x: number, y: number, s: number): Ring => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const look = { material: 'GG_Cave_Ink', fill: 'p:cave_floor', border: true };
const cave = (id: string, ring: Ring): ShapeChild => caveFloorShape([ring], look, id, id);
const floor = (id: string, ring: Ring): ShapeChild => ({ ...caveFloorShape([ring], { ...look, border: false }, id, id), styleOverrides: undefined, textureId: undefined });

let n = 0;
/** A dungeon layer holding `children`, its floor unioned as the engine unions it. */
function layerOf(children: ShapeChild[]): DungeonLayer {
  const l = { ...createDungeonLayer('Caves'), id: `cave-layer-${n++}`, children } as DungeonLayer;
  return { ...l, mergedFloor: computeMergedFloor(l) };
}

describe('caveEdges', () => {
  it('gives a lone marked floor’s rings as they are, and none for an unmarked or hidden one', () => {
    expect(caveEdges(layerOf([cave('a', square(0, 0, 4))]))).toEqual([{ material: 'GG_Cave_Ink', rings: [square(0, 0, 4)] }]);
    expect(caveEdges(layerOf([floor('f', square(0, 0, 4))]))).toEqual([]);
    expect(caveEdges(layerOf([{ ...cave('a', square(0, 0, 4)), visible: false }]))).toEqual([]);
  });

  it('unions the overlapping floors of one material into one outline', () => {
    const [edge] = caveEdges(layerOf([cave('a', square(0, 0, 4)), cave('b', square(2, 0, 4))]));
    expect(edge.rings).toHaveLength(1);
  });

  it('knows a point on the outline from one off it, and cuts the faces along each ring', () => {
    const l = layerOf([cave('a', square(0, 0, 4))]);
    expect(onCaveEdge([2, 0], caveEdges(l))).toBe(true);
    expect(onCaveEdge([2, 0.5], caveEdges(l))).toBe(false);
    const [cut] = caveCutters(l);
    expect(cut.points).toHaveLength(5);
    expect(cut.points[0]).toEqual(cut.points[4]);
  });
});

describe('resolveWalls with a painted cave', () => {
  it('on empty ground: one closed cave wall, and no floor edge along it', () => {
    const walls = resolveWalls(layerOf([cave('a', square(0, 0, 4))]));
    expect(walls.filter((w) => w.kind === 'floor')).toEqual([]);
    const caves = walls.filter((w) => w.kind === 'cave');
    expect(caves).toHaveLength(1);
    expect(caves[0]).toMatchObject({ id: 'cave:GG_Cave_Ink:0', wallType: 'normal', direction: 'both', textureSetId: 'GG_Cave_Ink' });
    expect(caves[0].points[0]).toEqual(caves[0].points.at(-1));
  });

  it('inside a rectangle floor: the rectangle’s four edges and the cave’s closed wall', () => {
    const walls = resolveWalls(layerOf([floor('base', square(-10, -10, 30)), cave('a', square(0, 0, 4))]));
    expect(walls.filter((w) => w.kind === 'floor')).toHaveLength(4);
    expect(walls.filter((w) => w.kind === 'cave')).toHaveLength(1);
  });

  it('stops a light inside the cave at its edge, though the floor runs on past it', () => {
    const l = layerOf([floor('base', square(-10, -10, 30)), cave('a', square(0, 0, 4))]);
    const segs = extractWallSegments([l], 'light');
    // A ray from the cave's middle straight up crosses the cave's top edge at y = 0.
    const blocked = segs.some((s) => Math.min(s.y1, s.y2) <= 0 && Math.max(s.y1, s.y2) >= 0 && Math.min(s.x1, s.x2) <= 2 && Math.max(s.x1, s.x2) >= 2 && Math.abs(s.y1 - s.y2) < 1e-9 && s.y1 > -1);
    expect(blocked).toBe(true);
  });
});

describe('rooms and a painted cave inside a floor', () => {
  it('makes the cave a face of its own, and Suggest rooms proposes it', () => {
    const l = layerOf([floor('base', square(-10, -10, 30)), cave('a', square(0, 0, 4))]);
    const faces = layerFaces(l);
    expect(faces.length).toBeGreaterThanOrEqual(2);
    const proposed = suggestRooms(l, null);
    // One proposal sits inside the cave.
    expect(proposed.some((r) => r.anchor[0] > 0 && r.anchor[0] < 4 && r.anchor[1] > 0 && r.anchor[1] < 4)).toBe(true);
  });
});
