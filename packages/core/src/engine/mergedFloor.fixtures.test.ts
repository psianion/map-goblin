// Old maps' rooms are untouched by the plateau bands: for every saved test map, the merged
// floor and the room faces cut from it come out identical to the union the floor used to
// be (copied below as it stood before bands), and adding a cliff plateau beside a map's
// floor moves none of its rooms.
import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { clipper2Engine, setClipperModule } from '../geometry/Clipper2Engine';
import { flattenRing } from '../shared/bezier';
import type { DungeonLayer, ShapeChild } from '../store/types';
import type { Polygon } from '../types/geometry';
import { migrateToLatest } from '../store/migration';
import { computeMergedFloor } from './mergedFloor';
import { roomFaces } from './roomDetection';

let fs: { readFileSync(p: string, enc: string): string; readdirSync(p: string): string[] };
let root = '';

beforeAll(async () => {
  fs = (await import('node:fs' as string)) as typeof fs;
  const { createRequire } = await import('node:module' as string);
  const { resolve } = await import('node:path' as string);
  root = resolve(process.cwd(), '../../session/testdata');
  const wasmBinary = (fs as unknown as { readFileSync(p: string): Uint8Array }).readFileSync(
    createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'),
  );
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

/** The merged floor as it was computed before plateau bands. */
function legacyMergedFloor(layer: DungeonLayer): Polygon[] | null {
  const shapes = layer.children.filter((c): c is ShapeChild => c.childType === 'shape' && c.visible);
  if (shapes.length === 0) return null;
  const outer: Polygon[] = [];
  const holes: Polygon[] = [];
  for (const shape of shapes) {
    for (let i = 0; i < shape.contours.length; i++) {
      let pts = flattenRing(shape.contours[i], shape.tangents?.[i]);
      const t = shape.transform;
      if (t) {
        pts = pts.map(([x, y]) => {
          const px = x * t.scale[0];
          const py = y * t.scale[1];
          const cos = Math.cos(t.rotate);
          const sin = Math.sin(t.rotate);
          return [px * cos - py * sin + t.translate[0], px * sin + py * cos + t.translate[1]] as [number, number];
        });
      }
      (i === 0 ? outer : holes).push(pts);
    }
  }
  let merged = outer.length === 1 ? [outer[0]] : clipper2Engine.union(outer, []);
  if (holes.length > 0) merged = clipper2Engine.difference(merged, holes);
  return merged;
}

function dungeonLayers(file: string): DungeonLayer[] {
  const data = migrateToLatest(JSON.parse(fs.readFileSync(`${root}/${file}`, 'utf8')));
  return (data.layers as unknown as DungeonLayer[]).filter((l) => l.type === 'dungeon');
}

const faces = (layer: DungeonLayer, floor: Polygon[] | null) =>
  roomFaces(floor ?? [], layer.standaloneWalls ?? [], 1, layer.style?.wallWidth ?? 0, layer.thresholds ?? []);

function bounds(layer: DungeonLayer): [number, number] {
  let maxX = 0;
  let maxY = 0;
  for (const c of layer.children) {
    if (c.childType !== 'shape') continue;
    for (const [x, y] of c.contours[0] ?? []) {
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return [maxX, maxY];
}

describe('old maps keep their floor and rooms', () => {
  it('every test map unions and cuts exactly as before', () => {
    const files = fs.readdirSync(root).filter((f) => f.endsWith('.mapbuilder'));
    expect(files.length).toBeGreaterThan(3);
    let layers = 0;
    for (const file of files) {
      for (const layer of dungeonLayers(file)) {
        const before = legacyMergedFloor(layer);
        const after = computeMergedFloor(layer);
        expect(after, file).toEqual(before);
        expect(JSON.stringify(faces(layer, after)), file).toBe(JSON.stringify(faces(layer, before)));
        layers++;
      }
    }
    expect(layers).toBeGreaterThan(3);
  });

  it('a cliff plateau beside the floor moves none of its rooms', () => {
    for (const file of fs.readdirSync(root).filter((f) => f.endsWith('.mapbuilder'))) {
      for (const layer of dungeonLayers(file)) {
        const before = legacyMergedFloor(layer);
        if (!before) continue;
        const [x, y] = bounds(layer);
        const outcrop = {
          ...(layer.children.find((c) => c.childType === 'shape') as ShapeChild),
          id: 'outcrop',
          contours: [[[x + 5, y + 5], [x + 9, y + 5], [x + 9, y + 9], [x + 5, y + 9]]],
          tangents: undefined,
          transform: undefined,
          visible: true,
          height: 2,
          edge: 'cliff' as const,
        };
        const raised = { ...layer, children: [...layer.children, outcrop] } as DungeonLayer;
        expect(JSON.stringify(faces(raised, computeMergedFloor(raised))), file).toBe(
          JSON.stringify(faces(layer, before)),
        );
      }
    }
  });
});
