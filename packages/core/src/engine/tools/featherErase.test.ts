// Feather and Strength on the brush (shared/pieceFades.ts): a feathered erase cuts only the
// stroke's core and fades the piece over the rest, a part-strength one cuts nothing and fades
// it by that much; fades follow the piece, are split and dropped with its cuts, and paint
// clears them. A ground texture paints with a soft edge as wide as the feathered share.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setClipperModule } from '../../geometry/Clipper2Engine';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import type { DungeonLayer, MaterialToolSettings, PieceFade, ShapeChild } from '../../store/types';
import type { Polygon } from '../../types/geometry';
import { patchArea, strokeArea } from '../../shared/materialPatch';
import { pieceCovers } from '../../shared/pieces';
import { computeMergedFloor } from '../mergedFloor';
import { FEATHER_DEFAULT, bakedFades, fadeErasedAt, fadesKeepAt, featherOf } from '../../shared/pieceFades';
import { maskGridFor, softMaskPixels } from '../softMask';
import { MaterialTool, paintGroundPiece, pieceLook, softErase } from './MaterialTool';
import type { Container } from 'pixi.js';
import type { RenderEngine } from '../RenderEngine';
import { carveFloors, pieceRegion } from './eraseShapes';
import { snapshotChild, transformChild } from './childTransform';
import { buildTargets, flipCommand, translation } from '../transformTargets';

const manager = {
  catalogVersion: 1,
  getPackManifests: () => [
    {
      packId: 'gg-forge',
      manifest: {
        entries: {
          wild_grass_8x8_floor_A: { type: 'floor', material: 'wild_grass', gridSize: '8x8', set: 'GG_Wild_Ground', tags: ['outdoor', 'grass'] },
          wild_water_8x8_floor_A: { type: 'floor', material: 'wild_water', gridSize: '8x8', set: 'GG_Wild_Ground', tags: ['outdoor', 'water'] },
          cave_floor_8x8_floor_A: { type: 'floor', material: 'cave_floor', gridSize: '8x8', set: 'GG_Cave_Floor', tags: [] },
        },
      },
    },
  ],
  subscribeTextures: () => () => {},
  waitForTexture: () => Promise.resolve(null),
};
vi.mock('../assetPackInstance', () => ({ getAssetPackManager: () => manager }));

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule(await mod.default({ wasmBinary }));
}, 30_000);

const GRASS = 'gg-forge:wild_grass_8x8_floor_A';
const WATER = 'gg-forge:wild_water_8x8_floor_A';
const CAVE_FILL = 'gg-forge:cave_floor_8x8_floor_A';

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function piece(id: string, ring: Polygon, extra: Partial<ShapeChild> = {}): ShapeChild {
  return {
    id, name: id, childType: 'shape', visible: true, shapeType: 'polygon', contours: [ring],
    textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
    ground: true, textureId: GRASS,
    ...extra,
  };
}

let layerId = '';
beforeEach(() => {
  undoManager.clear();
  useStore.getState().resetToDefault();
  layerId = useStore.getState().layers.find((l) => l.type === 'dungeon')!.id;
});

function setPieces(...children: ShapeChild[]): DungeonLayer {
  useStore.setState((s) => {
    const l = s.layers.find((x) => x.id === layerId) as DungeonLayer;
    l.children = children;
    l.mergedFloor = computeMergedFloor({ ...l, children } as DungeonLayer);
  });
  return layer();
}

const layer = () => useStore.getState().layers.find((l) => l.id === layerId) as DungeonLayer;
const shapes = () => layer().children.filter((c): c is ShapeChild => c.childType === 'shape');
const byId = (id: string) => shapes().find((c) => c.id === id)!;
const settings = (extra: Partial<MaterialToolSettings> = {}): MaterialToolSettings => ({ material: GRASS, radius: 2, smooth: false, border: false, floor: false, ...extra });

/** A brush erase stroke along `points`, as the tool runs it on release. */
function erase(points: [number, number][], radius: number, s: Pick<MaterialToolSettings, 'feather' | 'strength'>): boolean {
  const swept = strokeArea(points, radius);
  return carveFloors(layer(), layerId, swept, [], 'Erase', softErase(points, radius, swept, s));
}

describe('a fade at a point', () => {
  // Made once Clipper is in, before each test.
  let disc: Polygon[] = [];
  let fade: PieceFade;
  beforeEach(() => {
    disc = strokeArea([[0, 0]], 2);
    fade = { rings: disc, feather: 1, within: [rect(-5, -5, 0, 5)] };
  });

  it('is nothing at the outline, half mid-feather, the depth in the core, nothing outside within', () => {
    expect(fadeErasedAt(fade, -1.97, 0)).toBeLessThan(0.1);
    expect(fadeErasedAt(fade, -1.5, 0)).toBeCloseTo(0.5, 1);
    expect(fadeErasedAt(fade, -0.5, 0)).toBe(1);
    expect(fadeErasedAt(fade, 0.5, 0)).toBe(0);
    expect(fadeErasedAt(fade, -3, 0)).toBe(0);
    expect(fadeErasedAt({ ...fade, depth: 0.5 }, -0.5, 0)).toBe(0.5);
    expect(fadeErasedAt({ ...fade, depth: 0.5 }, -1.5, 0)).toBeCloseTo(0.25, 1);
  });

  it('with no feather is an even patch, and fades multiply', () => {
    const even: PieceFade = { rings: disc, feather: 0, depth: 0.5 };
    expect(fadeErasedAt(even, 1.9, 0)).toBe(0.5);
    expect(fadeErasedAt(even, 0, 0)).toBe(0.5);
    expect(fadesKeepAt([even, even], 0, 0)).toBeCloseTo(0.25);
    expect(fadesKeepAt(undefined, 0, 0)).toBe(1);
  });
});

describe('the brush settings', () => {
  it('reads Feather as half the radius unless set', () => {
    expect(featherOf({})).toBe(FEATHER_DEFAULT);
    expect(FEATHER_DEFAULT).toBe(0.5);
    expect(featherOf({ feather: 0 })).toBe(0);
    expect(featherOf({ feather: 3 })).toBe(1);
  });

  it('paints a ground texture with an edge the feathered share of the radius wide; water and cave stay crisp', () => {
    expect(pieceLook(GRASS, settings({ radius: 3, feather: 0.5 }))).toEqual({ textureId: GRASS, soft: 1.5 });
    expect(pieceLook(GRASS, settings({ radius: 2 }))).toEqual({ textureId: GRASS, soft: 1 });
    expect(pieceLook(GRASS, settings({ radius: 3, feather: 0 }))).toEqual({ textureId: GRASS });
    expect(pieceLook(WATER, settings({ radius: 3, feather: 0.5 })).soft).toBeUndefined();
    expect(pieceLook('GG_Cave_Ink', settings({ radius: 3, feather: 0.5, material: 'GG_Cave_Ink', border: true })).soft).toBeUndefined();
    // A band set with Border off has no rim: its fill feathers like any ground.
    expect(pieceLook('GG_Cave_Ink', settings({ radius: 3, feather: 0.5, material: 'GG_Cave_Ink' }))).toEqual({ textureId: CAVE_FILL, soft: 1.5 });
  });

  it('erases hard at no feather and full strength', () => {
    expect(softErase([[5, 5]], 2, strokeArea([[5, 5]], 2), { feather: 0 })).toBeUndefined();
    expect(softErase([[5, 5]], 2, strokeArea([[5, 5]], 2), { feather: 0, strength: 1 })).toBeUndefined();
    expect(softErase([[5, 5]], 2, strokeArea([[5, 5]], 2), {})).toMatchObject({ feather: 1, strength: 1 });
  });
});

describe('a soft erase', () => {
  it('at no feather and full strength cuts as before and stores no fade', () => {
    setPieces(piece('a', rect(0, 0, 10, 10)));
    expect(erase([[5, 5]], 2, { feather: 0 })).toBe(true);
    const a = byId('a');
    expect('fades' in a).toBe(false);
    expect(a.contours).toHaveLength(2);
    expect(patchArea(pieceRegion(a))).toBeCloseTo(100 - Math.PI * 4, 0);
  });

  it('at full strength cuts the core only and fades the piece over its whole share', () => {
    setPieces(piece('a', rect(0, 0, 10, 10)));
    expect(erase([[5, 5]], 2, { feather: 0.5 })).toBe(true);
    const a = byId('a');
    // The hole is the core, radius 1.
    expect(patchArea(pieceRegion(a))).toBeCloseTo(100 - Math.PI, 0);
    expect(pieceCovers(a, 5, 6.5)).toBe(true);
    expect(pieceCovers(a, 5, 5.5)).toBe(false);
    expect(a.fades).toHaveLength(1);
    const [fade] = a.fades!;
    expect(fade.feather).toBe(1);
    expect(fade.depth).toBeUndefined();
    expect(patchArea(fade.rings)).toBeCloseTo(Math.PI * 4, 0);
    expect(patchArea(fade.within!)).toBeCloseTo(Math.PI * 4, 0);
    expect(fadesKeepAt(a.fades, 5, 6.5)).toBeCloseTo(0.5, 1);
    expect(undoManager.size()).toBe(1);
    undoManager.undo();
    expect(byId('a').contours).toEqual([rect(0, 0, 10, 10)]);
    expect(byId('a').fades).toBeUndefined();
  });

  it('below full strength cuts nothing and fades by that much; a second pass adds a second fade', () => {
    setPieces(piece('a', rect(0, 0, 10, 10)));
    expect(erase([[5, 5]], 2, { feather: 0, strength: 0.5 })).toBe(true);
    expect(byId('a').contours).toEqual([rect(0, 0, 10, 10)]);
    expect(byId('a').fades).toEqual([expect.objectContaining({ feather: 0, depth: 0.5 })]);
    erase([[5, 5]], 2, { feather: 0.5, strength: 0.5 });
    const a = byId('a');
    expect(a.contours).toEqual([rect(0, 0, 10, 10)]);
    expect(a.fades).toHaveLength(2);
    expect(a.fades![1]).toMatchObject({ feather: 1, depth: 0.5 });
    expect(fadesKeepAt(a.fades, 5, 5)).toBeCloseTo(0.25);
    expect(undoManager.size()).toBe(2);
  });

  it('leaves a crisp piece a fade its mask carries, its edge channel full', () => {
    setPieces(piece('a', rect(0, 0, 10, 10)));
    erase([[5, 5]], 3, { feather: 0.5, strength: 0.5 });
    const a = byId('a');
    expect(a.soft).toBeUndefined();
    const outline = a.contours as Polygon[];
    const grid = maskGridFor(outline, 0.25, 16, 1024)!;
    const px = softMaskPixels(outline, 0, bakedFades(a) ?? [], grid);
    let minKeep = 255;
    let minEdge = 255;
    for (let k = 0; k < px.length; k += 4) {
      minEdge = Math.min(minEdge, px[k]);
      minKeep = Math.min(minKeep, px[k + 1]);
    }
    expect(minEdge).toBe(255);
    expect(minKeep).toBe(128);
  });

  it('cuts and fades only the top piece where it is on top', () => {
    setPieces(piece('low', rect(0, 0, 10, 10)), piece('top', rect(0, 0, 5, 10), { textureId: 'gg-forge:other' }));
    erase([[5, 5]], 2, { feather: 0.5 });
    const low = byId('low');
    const top = byId('top');
    // The top piece takes the left half of the stroke, the low one only the right.
    expect(patchArea(top.fades![0].within!)).toBeCloseTo(Math.PI * 2, 0);
    expect(patchArea(low.fades![0].within!)).toBeCloseTo(Math.PI * 2, 0);
    expect(fadeErasedAt(low.fades![0], 4, 5)).toBe(0);
    expect(fadeErasedAt(top.fades![0], 6, 5)).toBe(0);
    expect(pieceCovers(top, 4.5, 5)).toBe(false);
    expect(pieceCovers(low, 4.5, 5)).toBe(true);
    expect(pieceCovers(low, 5.5, 5)).toBe(false);
  });

  it('keeps to the selected piece', () => {
    setPieces(piece('low', rect(0, 0, 10, 10)), piece('top', rect(0, 0, 10, 10), { textureId: 'gg-forge:other' }));
    useStore.setState((s) => {
      s.selection.selectedIds = ['low'];
    });
    erase([[5, 5]], 2, { feather: 0.5, strength: 0.5 });
    expect(byId('low').fades).toHaveLength(1);
    expect(byId('top').fades).toBeUndefined();
  });

  it('bakes a moved piece first, its fade in the space of its contours', () => {
    setPieces(piece('a', rect(0, 0, 4, 4), { transform: { translate: [10, 0], rotate: 0, scale: [1, 1] } }));
    erase([[12, 2]], 1, { feather: 0, strength: 0.5 });
    const a = byId('a');
    expect(a.transform).toBeUndefined();
    expect(a.contours).toEqual([rect(10, 0, 14, 4)]);
    expect(fadeErasedAt(a.fades![0], 12, 2)).toBe(0.5);
  });
});

describe('fades and cuts', () => {
  it('hands a split piece’s fades to the parts they reach', () => {
    setPieces(piece('a', rect(0, 0, 10, 2)));
    erase([[1, 1]], 0.8, { feather: 0, strength: 0.5 });
    // A full-strength feathered pass across the strip: its core cuts it in two.
    erase([[5, 1]], 3, { feather: 0.5 });
    const parts = shapes();
    expect(parts).toHaveLength(2);
    const left = parts.find((p) => pieceCovers(p, 1, 1))!;
    const right = parts.find((p) => pieceCovers(p, 9, 1))!;
    expect(left.fades).toHaveLength(2);
    expect(right.fades).toHaveLength(1);
    expect(right.fades![0].feather).toBe(1.5);
  });

  it('drops a fade the piece no longer reaches after a cut', () => {
    setPieces(piece('a', rect(0, 0, 10, 2)));
    erase([[9, 1]], 0.8, { feather: 0, strength: 0.5 });
    erase([[1, 1]], 0.8, { feather: 0, strength: 0.5 });
    expect(byId('a').fades).toHaveLength(2);
    // The floor tools' Carve out: a hard cut, no feather.
    carveFloors(layer(), layerId, [rect(8, -1, 11, 3)]);
    expect(byId('a').fades).toHaveLength(1);
    expect(fadeErasedAt(byId('a').fades![0], 1, 1)).toBe(0.5);
    carveFloors(layer(), layerId, [rect(-1, -1, 3, 3)]);
    expect(byId('a').fades).toBeUndefined();
  });

  it('leaves a lean outline after a feathered stroke, the fade stored as lean', () => {
    setPieces(piece('a', rect(0, 0, 10, 10)));
    // A stroke as the tool records it: a point every brush step, across the piece and past it.
    const points = Array.from({ length: 81 }, (_, i): [number, number] => [-2 + i * 0.1, 3 + i * 0.05]);
    erase(points, 1.5, { feather: 0.5 });
    const outlines = shapes().flatMap((s) => s.contours);
    expect(outlines.length).toBeGreaterThan(0);
    for (const ring of outlines) {
      ring.forEach(([x, y], i) => {
        const [nx, ny] = ring[(i + 1) % ring.length];
        expect(Math.hypot(nx - x, ny - y)).toBeGreaterThanOrEqual(0.05);
      });
    }
    const fadePoints = shapes().flatMap((s) => s.fades ?? []).flatMap((f) => [...f.rings, ...(f.within ?? [])]).reduce((n, r) => n + r.length, 0);
    const rawPoints = strokeArea(points, 1.5).reduce((n, r) => n + r.length, 0);
    expect(fadePoints).toBeLessThan(rawPoints);
  });

  it('drops a crumb a cut leaves, and the piece with it when nothing else is left', () => {
    setPieces(piece('a', rect(0, 0, 10, 1)));
    // The cut leaves 0.2 square cells at the left end and 5 at the right.
    carveFloors(layer(), layerId, [rect(0.2, -1, 5, 2)]);
    expect(shapes()).toHaveLength(1);
    expect(patchArea(pieceRegion(shapes()[0]))).toBeCloseTo(5);
    setPieces(piece('b', rect(0, 0, 1, 0.4)));
    // A small piece cut keeps what is left when that is half of it or more.
    carveFloors(layer(), layerId, [rect(0.6, -1, 2, 2)]);
    expect(patchArea(pieceRegion(byId('b')))).toBeCloseTo(0.24);
    carveFloors(layer(), layerId, [rect(0.1, -1, 2, 2)]);
    expect(shapes()).toHaveLength(0);
  });
});

describe('fades follow the piece', () => {
  const faded = () => {
    setPieces(piece('a', rect(0, 0, 4, 4)));
    erase([[1, 1]], 1, { feather: 0, strength: 0.5 });
    return byId('a');
  };

  it('moves, scales and turns with a transform', () => {
    const a = faded();
    const moved = transformChild(snapshotChild(a), translation(10, 0)) as Partial<ShapeChild>;
    expect(fadeErasedAt(moved.fades![0], 11, 1)).toBe(0.5);
    expect(fadeErasedAt(moved.fades![0], 1, 1)).toBe(0);
    const scaled = transformChild(snapshotChild(a), { translateX: 0, translateY: 0, scaleX: 2, scaleY: 2, rotation: 0, anchorX: 0, anchorY: 0 }) as Partial<ShapeChild>;
    expect(fadeErasedAt(scaled.fades![0], 2, 2)).toBe(0.5);
    // A piece with no fades gets no field from a move.
    setPieces(piece('b', rect(0, 0, 4, 4)));
    expect('fades' in transformChild(snapshotChild(byId('b')), translation(1, 0))).toBe(false);
  });

  it('flips with the piece', () => {
    faded();
    const cmd = flipCommand(buildTargets(useStore.getState(), ['a']).targets, 'h');
    undoManager.execute(cmd!);
    const a = byId('a');
    expect(fadeErasedAt(a.fades![0], 3, 1)).toBe(0.5);
    expect(fadeErasedAt(a.fades![0], 1, 1)).toBe(0);
    undoManager.undo();
    expect(fadeErasedAt(byId('a').fades![0], 1, 1)).toBe(0.5);
  });
});

describe('painting over a fade', () => {
  it('clears the fades inside the stroke, and hands the merged piece the stroke’s softness', () => {
    setPieces(piece('a', rect(0, 0, 10, 10), { soft: 0.6 }));
    erase([[5, 5]], 2, { feather: 0, strength: 0.5 });
    erase([[2, 2]], 1, { feather: 0, strength: 0.5 });
    expect(byId('a').fades).toHaveLength(2);
    paintGroundPiece(layer(), layerId, strokeArea([[5, 5]], 1), GRASS, { textureId: GRASS, soft: 0.4 }, false);
    const a = byId('a');
    expect(shapes()).toHaveLength(1);
    expect(a.soft).toBe(0.4);
    expect(a.fades).toHaveLength(2);
    expect(fadeErasedAt(a.fades![0], 5, 5)).toBe(0);
    expect(fadeErasedAt(a.fades![0], 5, 6.5)).toBe(0.5);
    paintGroundPiece(layer(), layerId, strokeArea([[5, 5]], 3), GRASS, { textureId: GRASS, soft: 0.4 }, false);
    expect(byId('a').fades).toHaveLength(1);
    expect(fadeErasedAt(byId('a').fades![0], 2, 2)).toBe(0.5);
  });
});

describe('a band set’s stroke', () => {
  const fakeEngine = { stage: () => ({ scale: { x: 1 } }) } as unknown as RenderEngine;
  const preview = { addChild: () => undefined } as unknown as Container;

  /** A stroke of the brush along `points`, as the tool runs it, with `extra` set on the brush. */
  function stroke(points: [number, number][], extra: Partial<MaterialToolSettings>): void {
    useStore.setState((s) => {
      Object.assign(s.tools.settings.material, { material: 'GG_Cave_Ink', smooth: false, overRooms: true, ...extra });
      s.ui.activeLayerId = layerId;
      s.tools.eraseMode = false;
    });
    const tool = new MaterialTool(fakeEngine, preview);
    const [first, ...rest] = points;
    tool.onPointerDown({ x: first[0], y: first[1] });
    for (const [x, y] of rest) tool.onPointerMove({ x, y });
    tool.onPointerUp();
  }

  it('with Border off paints a ground piece of the fill, feathered, at Strength and Height, whatever Paint a real floor says', () => {
    setPieces();
    stroke([[5, 5], [8, 5]], { border: false, floor: true, feather: 0.5, radius: 2, strength: 0.6, height: 1 });
    expect(shapes()).toHaveLength(1);
    const p = shapes()[0];
    expect(p).toMatchObject({ ground: true, textureId: CAVE_FILL, soft: 1, opacity: 0.6, height: 1 });
    expect(p.edgeMaterial).toBeUndefined();
  });

  it('with Border and Paint a real floor on paints a walled floor at Strength, which a stroke of another strength does not merge into', () => {
    setPieces();
    stroke([[5, 5], [8, 5]], { border: true, floor: true, radius: 2, strength: 0.6 });
    expect(shapes()).toHaveLength(1);
    expect(shapes()[0]).toMatchObject({ textureId: CAVE_FILL, edgeMaterial: 'GG_Cave_Ink', opacity: 0.6 });
    expect(shapes()[0].ground).toBeFalsy();
    stroke([[7, 5], [10, 5]], { border: true, floor: true, radius: 2, strength: 1 });
    expect(shapes()).toHaveLength(2);
    expect(shapes()[1].opacity).toBeUndefined();
  });
});
