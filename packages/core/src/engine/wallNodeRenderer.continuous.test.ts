// Continuous, coloured wall sets as drawn: art that carries its own colour is not
// tinted, and walls that meet get a joint piece laid over both.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => {
  class MockContainer {
    label = '';
    destroyed = false;
    alpha = 1;
    visible = true;
    children: MockContainer[] = [];
    addChild(...cs: MockContainer[]): MockContainer {
      this.children.push(...cs);
      return cs[0];
    }
    addChildAt(c: MockContainer, i: number): MockContainer {
      this.children.splice(i, 0, c);
      return c;
    }
    removeChildAt(i: number): MockContainer {
      return this.children.splice(i, 1)[0];
    }
    removeChildren(): MockContainer[] {
      const out = this.children;
      this.children = [];
      return out;
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  class MockSprite extends MockContainer {
    texture: unknown;
    rotation = 0;
    tint = 0;
    anchor = { set: (): void => {} };
    position = { x: 0, y: 0, set(x: number, y: number): void { this.x = x; this.y = y; } };
    scale = { x: 1, y: 1, set(x: number, y: number): void { this.x = x; this.y = y; } };
    constructor(texture?: unknown) {
      super();
      this.texture = texture;
    }
  }
  class MockGraphics extends MockContainer {
    clear(): this {
      return this;
    }
    poly(): this {
      return this;
    }
    fill(): this {
      return this;
    }
  }
  return { Container: MockContainer, Sprite: MockSprite, Graphics: MockGraphics };
});

vi.mock('../assets/textureLoader', () => ({
  resolveTexture: (id: string) => ({ id, width: 200, height: 200 }),
  load: vi.fn(() => Promise.resolve(null)),
}));

import { Container, Sprite } from 'pixi.js';
import { renderNodeWalls } from './wallNodeRenderer';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import type { ManifestEntry } from './packManifest';
import type { DungeonStyle, WallSegment } from '../store/types';

function set(id: string, tags: string[]): Record<string, ManifestEntry> {
  const piece = (stem: string, pieceType: string, w: number, extra: Partial<ManifestEntry> = {}): [string, ManifestEntry] => [
    `${id}_${stem}`,
    {
      type: 'wall',
      material: `${id}_${stem}`,
      gridSize: `${Math.round(w / 200)}x1`,
      pieceType,
      variant: 'A',
      frame: { x: 0, y: 0, w, h: 200 },
      set: id,
      tags: [],
      ...extra,
    },
  ];
  return Object.fromEntries([
    piece('Straight_2x1', 'straight', 400, { contentRect: { x: 0, y: 66, w: 400, h: 68 }, tags }),
    piece('Straight_1x1', 'straight', 200, { contentRect: { x: 0, y: 66, w: 200, h: 68 }, tags }),
    piece('Corner_A_1x1', 'corner', 200),
    piece('Ending_A_1x1', 'ending', 200),
    piece('Joint_A_1x1', 'joint', 200, { tags: ['cross'] }),
    piece('Joint_B_1x1', 'joint', 200, { tags: ['tee'] }),
  ]);
}

const OUTLINE = 'Test_Outline';
const PLAIN = 'Test_Plain';
const PACK = 'test-walls';

beforeEach(() => seedPack(PACK, { ...set(OUTLINE, ['continuous', 'colored']), ...set(PLAIN, []) }));
afterEach(() => resetAssetPackManager());

type Spr = { tint: number; texture: { id: string } };
const sprites = (c: Container) => c.children as unknown as Spr[];
const style = (setId: string) => ({ wallTextureSetId: setId, wallTextureTint: '#884422', wallWidth: 0.5 }) as DungeonStyle;
const wall = (id: string, points: [number, number][]): WallSegment => ({ id, points }) as WallSegment;

describe('renderNodeWalls: coloured and continuous sets', () => {
  it('draws a coloured set untinted whatever the look, and a plain set in the look’s tint', () => {
    const coloured = new Container();
    renderNodeWalls(coloured, [[[0, 0], [8, 0], [8, 8], [0, 8]]], [wall('w1', [[0, 20], [10, 20]])], style(OUTLINE));
    expect(sprites(coloured).length).toBeGreaterThan(0);
    expect(new Set(sprites(coloured).map((s) => s.tint))).toEqual(new Set([0xffffff]));

    const plain = new Container();
    renderNodeWalls(plain, [[[0, 0], [8, 0], [8, 8], [0, 8]]], [wall('w1', [[0, 20], [10, 20]])], style(PLAIN));
    expect(new Set(sprites(plain).map((s) => s.tint))).toEqual(new Set([0x884422]));
  });

  it('lays a tee over a T, on top, and drops the end cap of the wall that ends there', () => {
    const c = new Container();
    renderNodeWalls(c, [], [wall('bar', [[0, 0], [10, 0]]), wall('stem', [[5, 6], [5, 0]])], style(OUTLINE));
    const ids = sprites(c).map((s) => s.texture.id);
    expect(ids.filter((id) => id === `${PACK}:${OUTLINE}_Joint_B_1x1`)).toHaveLength(1);
    expect(ids[ids.length - 1]).toBe(`${PACK}:${OUTLINE}_Joint_B_1x1`);
    // Two caps on the bar, one on the stem's free end.
    expect(ids.filter((id) => id === `${PACK}:${OUTLINE}_Ending_A_1x1`)).toHaveLength(3);
  });

  it('draws a mitred stone as a sprite under a mask, every other stone as a plain sprite, and reuses both', () => {
    const c = new Container();
    const bend = wall('bend', [[0, 0], [6, 0], [3, 5.196]]);
    renderNodeWalls(c, [], [bend], style(OUTLINE));
    const kids = c.children as unknown as { label: string; mask?: unknown; children: unknown[] }[];
    const clipped = kids.filter((k) => k.label === 'clipped-stone');
    expect(clipped).toHaveLength(2);
    for (const k of clipped) {
      expect(k.children).toHaveLength(2);
      expect(k.children[0]).toBeInstanceOf(Sprite);
      expect(k.mask).toBe(k.children[1]);
    }
    expect(kids.filter((k) => k.label !== 'clipped-stone').every((k) => k instanceof Sprite)).toBe(true);
    // A redraw that changes nothing keeps every object it drew.
    const before = [...c.children];
    renderNodeWalls(c, [], [bend], style(OUTLINE));
    expect(c.children).toEqual(before);
    expect(c.children.every((k, i) => k === before[i])).toBe(true);
  });

  it('lays no joint piece for a set without the continuous trait', () => {
    const c = new Container();
    renderNodeWalls(c, [], [wall('bar', [[0, 0], [10, 0]]), wall('stem', [[5, 6], [5, 0]])], style(PLAIN));
    const ids = sprites(c).map((s) => s.texture.id);
    expect(ids.some((id) => id.includes('Joint'))).toBe(false);
    expect(ids.filter((id) => id === `${PACK}:${PLAIN}_Ending_A_1x1`)).toHaveLength(4);
  });
});
