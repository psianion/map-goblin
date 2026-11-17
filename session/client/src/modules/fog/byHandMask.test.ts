// T14 — what a player's By hand mask shows: the whole frame once Outdoors and every room are
// revealed (testing-cave), bar the plateau tops no party token stands high enough to see; and no
// hard sliver of cloud in a hidden gap thinner than a cell between revealed rooms.
import { beforeAll, describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '@dnd/core/src/geometry/Clipper2Engine';
import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import { pointInPolygon } from '@dnd/core/src/engine/hitTest';
import { pieceRings } from '@dnd/core/src/shared/pieces';
import { syncRooms } from '@dnd/core/src/store/roomSync';
import type { DungeonLayer, Layer, SerializedMapData, ShapeChild } from '@dnd/core/src/store/types';
import type { Token } from '@dnd/mechanics/tokens';
import { FOG_FEATHER, coveredTops, drawFog, type FogScene, type RoomView } from './FogRenderer';
import { fogPad, type TableRoom } from './fog';
import { DEFAULT_FOG_LOOK } from './livingFog';

let testingCave: SerializedMapData;

beforeAll(async () => {
  // `as string` keeps these untyped — the package has no @types/node.
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule((await mod.default({ wasmBinary })) as MainModule);
  // Relative to the package, where vitest runs.
  testingCave = JSON.parse(readFileSync('../testdata/testing-cave.ggvtt', 'utf8'));
}, 30_000);

const VOID = { fill: 0x131316, dot: 0x3a3a3a, dotAlpha: 0.45, dotsVisible: true };

const base = (over: Partial<FogScene>): FogScene => ({
  rooms: [],
  views: new Map(),
  bounds: null,
  pad: fogPad([]),
  sceneId: 's1',
  isPlayer: true,
  darkness: 1,
  grade: '#ffffff',
  cloudTint: '#ffffff',
  timeBucket: 0,
  void: VOID,
  look: DEFAULT_FOG_LOOK,
  ...over,
});

type PathLike = { instructions?: { action: string; data: unknown[] }[] };
const ringsOf = (path?: PathLike): Polygon[] =>
  (path?.instructions ?? [])
    .filter((step) => step.action === 'poly' || step.action === 'rect')
    .map((step) => {
      if (step.action === 'rect') {
        const [x, y, w, h] = step.data as number[];
        return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as Polygon;
      }
      const flat = step.data[0] as number[];
      const poly: Polygon = [];
      for (let k = 0; k + 1 < flat.length; k += 2) poly.push([flat[k], flat[k + 1]]);
      return poly;
    });

/** Whether the mask reads shown at a point: the last fill over it is white. */
const shown = (mask: Graphics, point: [number, number]): boolean => {
  let color: number | null = null;
  for (const i of mask.context.instructions) {
    if (i.action !== 'fill') continue;
    const { path, hole, style } = i.data as { path?: PathLike; hole?: PathLike; style: { color: number } };
    if (ringsOf(path).some((r) => pointInPolygon(point, r)) && !ringsOf(hole).some((r) => pointInPolygon(point, r))) {
      color = style.color;
    }
  }
  return color === 0xffffff;
};

const maskOf = (scene: FogScene): Graphics => {
  const mask = new Graphics();
  drawFog(new Graphics(), scene, mask);
  return mask;
};

describe('By hand, everything revealed, on testing-cave (T14)', () => {
  it('shows the whole frame but the plateau tops the DM hid from the ground', () => {
    const frame = testingCave.mapSettings.fixedSize!;
    const layer = testingCave.layers.find((l) => l.type === 'dungeon') as DungeonLayer;
    // The rooms' faces as the referee derives them (`sceneMap.ts`), and the open ground it sends
    // a base-ground map: the frame, the zoned cave cut out (`outdoors.test.ts`).
    const rooms = syncRooms({ ...layer, children: layer.children ?? [] }).rooms.map(
      (room) => ({ ...room, boundary: room.face! }) as TableRoom,
    );
    const cave = layer.children.find((c): c is ShapeChild => c.childType === 'shape' && !c.ground)!;
    const holes = pieceRings(cave).filter((ring) => rooms.some((room) => pointInPolygon(room.anchor, ring)));
    const FRAME: Polygon = [[0, 0], [frame.width, 0], [frame.width, frame.height], [0, frame.height]];
    const views = new Map<string, RoomView>([...rooms.map((r) => [r.id, 'visible'] as const), ['@outdoors', 'visible']]);
    const onGround = { id: 'pc', x: 2.5, y: 25.5, ownerId: 'p1', hidden: false, elevation: 0 } as Token;
    const layers = testingCave.layers as Layer[];
    const hide = coveredTops(layers, [onGround], testingCave.mapSettings.sightDropCells);
    const mask = maskOf(
      base({
        rooms,
        views,
        bounds: { minX: 0, minY: 0, maxX: frame.width, maxY: frame.height },
        pad: fogPad(layers),
        outdoors: '@outdoors',
        open: [FRAME, ...holes],
        openParts: { outers: [FRAME], holes },
        hide,
      }),
    );

    // The rule: a height band one of whose edges hides it (here the +2 and +3 bands along the top
    // rows, where the DM set two plateaus to Hide) stays under cover until a party token stands
    // that high — the same tops the referee withholds (`coveredOf`).
    expect(hide.length).toBeGreaterThan(0);
    expect(Math.max(...hide.flat().map(([, y]) => y))).toBeLessThan(8);
    const wrong: string[] = [];
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const p: [number, number] = [x + 0.5, y + 0.5];
        const top = hide.some((ring) => pointInPolygon(p, ring));
        if (shown(mask, p) === top) wrong.push(`${p}${top ? ' (top)' : ''}`);
      }
    }
    expect(wrong).toEqual([]);
    // …and the frame's own corners and edges, where the cut used to stop short.
    for (const p of [[29.9, 29.9], [0.1, 29.9], [29.9, 15], [15, 29.9]] as [number, number][]) {
      expect(shown(mask, p), `edge at ${p}`).toBe(true);
    }
  });

  it('shows those tops once a party token stands as high as them', () => {
    const layers = testingCave.layers as Layer[];
    const high = { id: 'pc', x: 2.5, y: 2.5, ownerId: 'p1', hidden: false, elevation: 3 } as Token;
    expect(coveredTops(layers, [high], testingCave.mapSettings.sightDropCells)).toEqual([]);
  });
});

describe('a hidden gap thinner than a cell between revealed rooms (T14)', () => {
  const hall = (id: string, x0: number, x1: number): TableRoom =>
    ({ id, name: id, anchor: [(x0 + x1) / 2, 3], boundary: [[x0, 0], [x1, 0], [x1, 6], [x0, 6]] }) as unknown as TableRoom;
  /** How far a revealed room's shown ground reaches past its floor. */
  const REACH = fogPad([]) + FOG_FEATHER;

  const sceneOf = (rooms: TableRoom[], views: Record<string, RoomView>): FogScene =>
    base({
      rooms,
      views: new Map(Object.entries(views)),
      bounds: { minX: -10, minY: -10, maxX: 40, maxY: 20 },
      outdoors: '@outdoors',
    });

  it('shows the gap with the rooms round it, so no hard edge crosses it', () => {
    // Outdoors hidden: only the rooms' reaches are shown, and they miss each other by 0.3.
    const west = hall('west', 0, 4);
    const eastAt = 4 + 2 * REACH + 0.3;
    const east = hall('east', eastAt, eastAt + 4);
    const mask = maskOf(sceneOf([west, east], { west: 'visible', east: 'visible', '@outdoors': 'dark' }));
    for (let x = 4 + REACH - 0.2; x <= eastAt - REACH + 0.2; x += 0.05) {
      expect(shown(mask, [x, 3]), `gap at ${x.toFixed(2)}`).toBe(true);
    }
    // The ground past the rooms' outer reach is still hidden.
    expect(shown(mask, [-REACH - 0.2, 3])).toBe(false);
    expect(shown(mask, [2, 6 + REACH + 0.2])).toBe(false);
  });

  it('leaves a gap of a cell or more hidden', () => {
    const west = hall('west', 0, 4);
    const eastAt = 4 + 2 * REACH + 1.2;
    const east = hall('east', eastAt, eastAt + 4);
    const mask = maskOf(sceneOf([west, east], { west: 'visible', east: 'visible', '@outdoors': 'dark' }));
    expect(shown(mask, [(4 + eastAt) / 2, 3])).toBe(false);
  });

  it('never shows a hidden room standing in such a gap', () => {
    const west = hall('west', 0, 4);
    const eastAt = 4 + 2 * REACH + 0.3;
    const east = hall('east', eastAt, eastAt + 4);
    const mid = (4 + eastAt) / 2;
    const slot = hall('slot', mid - 0.15, mid + 0.15);
    const mask = maskOf(
      sceneOf([west, east, slot], { west: 'visible', east: 'visible', slot: 'dark', '@outdoors': 'dark' }),
    );
    expect(shown(mask, [mid, 3])).toBe(false);
    expect(shown(mask, [mid - 0.3, 3])).toBe(true);
  });
});
