import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, it } from 'vitest';
import { setClipperModule } from '@dnd/core/src/geometry/Clipper2Engine';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { clockwiseSweep } from '@dnd/core/src/engine/lighting/ClockwiseSweep';
import { extractWallSegments } from '@dnd/core/src/engine/lighting/raycaster';
import type { DungeonLayer, Layer } from '@dnd/core/src/store/types';
import { cellsCoveredByPolygon, regionOf, setCells, SIGHT_REACH } from '@dnd/mechanics/fog';
import { computeMapFrame } from '@dnd/core/src/shared/mapBounds';
import { maskField, maskRings, regionCells } from './memoryMask';

beforeAll(async () => {
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule((await mod.default({ wasmBinary })) as MainModule);
}, 30_000);

const PARTY = ['Sealed Vault', 'Vestibule of Ash', 'Torchlit Chamber', 'East Gallery', 'Ossuary', 'Ossuary Crawl', 'Shaft of Bones', 'South Passage'];
it('memory outline cost', () => {
  const doc = JSON.parse(readFileSync('D:/Labs/map-goblin/session/testdata/emberhold-crypt.mapbuilder', 'utf8'));
  const layers = (doc.layers as Layer[]).filter((l): l is DungeonLayer => l.type === 'dungeon').map((l) => ({ ...l, mergedFloor: null }));
  const segs = extractWallSegments(layers);
  const frame = computeMapFrame(doc.layers, doc.mapSettings?.terrain?.bounds ?? null)!;
  const centre = (n: string) => { const r = layers[0].rooms!.find((r) => r.name === n)!; return [r.centroid[0], r.centroid[1]] as [number, number]; };
  for (const reach of [8, SIGHT_REACH]) {
    let region = regionOf(frame)!;
    const cells: [number, number][] = [];
    for (const n of PARTY) cells.push(...cellsCoveredByPolygon(clockwiseSweep(centre(n), reach, segs).map((v) => v.point), frame));
    region = setCells(region, cells);
    const t0 = performance.now();
    const field = maskField(region);
    const t1 = performance.now();
    const rings = field ? maskRings(field) : [];
    const t2 = performance.now();
    console.log('reach', reach, 'cells', regionCells(region), 'field', (t1 - t0).toFixed(1), 'rings', (t2 - t1).toFixed(1), 'ringVerts', rings.reduce((n, r) => n + r.length, 0));
  }
});
