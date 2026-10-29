import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container, Graphics, TilingSprite, Texture } from 'pixi.js';

const textures: Record<string, { width: number; height: number }> = {};
vi.mock('../../assets/textureLoader', () => ({
  unitTexture: (id: string) => ({
    texture: (textures[id] ?? { width: 1, height: 1 }) as unknown as Texture,
    cellsWide: 1,
    cellsHigh: 1,
  }),
}));

import { rebuildWaterSublayer, flatWaterColor, WATER_FALLBACK_COLOR } from './waterRenderer';
import type { DungeonLayer } from '../../store/types';
import type { WaterChild } from '../../shared/types';

function water(extra?: Partial<WaterChild>): WaterChild {
  return {
    id: 'w1',
    name: 'Lake 1',
    childType: 'water',
    visible: true,
    waterType: 'lake',
    contours: [[[0, 0], [4, 0], [4, 3], [0, 3]]],
    textureId: 'water-still-a-01',
    tint: '#9fc8e8',
    opacity: 0.8,
    bankTextureId: 'bank-grassy-01-a1',
    bankWidth: 0.5,
    ...extra,
  };
}

function layerWith(children: WaterChild[]): DungeonLayer {
  return { children } as unknown as DungeonLayer;
}

describe('rebuildWaterSublayer without installed water textures', () => {
  beforeEach(() => {
    for (const k of Object.keys(textures)) delete textures[k];
  });

  it('draws a flat fill at the body opacity so the body is still visible', () => {
    const root = new Container();
    rebuildWaterSublayer(root, layerWith([water()]));
    expect(root.children).toHaveLength(1);
    const body = root.children[0] as Container;
    expect(body.label).toBe('water-w1');
    const flat = body.children[0];
    expect(flat).toBeInstanceOf(Graphics);
    expect(flat.label).toBe('water-flat');
    expect(flat.alpha).toBeCloseTo(0.8);
  });

  it('leaves banks off when the bank texture is missing', () => {
    const root = new Container();
    rebuildWaterSublayer(root, layerWith([water()]));
    expect(root.children.some((c) => c.label === 'water-banks')).toBe(false);
  });

  it('still draws banks beside a flat fill when the bank texture exists', () => {
    textures['bank-grassy-01-a1'] = { width: 200, height: 100 };
    const root = new Container();
    rebuildWaterSublayer(root, layerWith([water()]));
    const banks = root.children.find((c) => c.label === 'water-banks') as Container;
    expect(banks).toBeDefined();
    expect(banks.children[0]).toBeInstanceOf(TilingSprite);
  });

  it('skips hidden bodies', () => {
    const root = new Container();
    rebuildWaterSublayer(root, layerWith([water({ visible: false })]));
    expect(root.children).toHaveLength(0);
  });
});

describe('rebuildWaterSublayer with an installed water texture', () => {
  beforeEach(() => {
    for (const k of Object.keys(textures)) delete textures[k];
    textures['water-still-a-01'] = { width: 256, height: 256 };
  });

  it('tiles a still surface anchored to the world origin, ignoring legacy flow fields', () => {
    const root = new Container();
    rebuildWaterSublayer(
      root,
      layerWith([water({ contours: [[[2, 1], [6, 1], [6, 4], [2, 4]]], flowSpeed: 0.5, flowAngle: 1 })]),
    );
    const body = root.children[0] as Container;
    const ts = body.children.find((c) => c instanceof TilingSprite) as TilingSprite;
    expect(ts).toBeDefined();
    expect(ts.alpha).toBeCloseTo(0.8);
    expect(ts.tilePosition.x).toBe(-2);
    expect(ts.tilePosition.y).toBe(-1);
    expect(root.filters ?? []).toHaveLength(0);
  });
});

describe('flatWaterColor', () => {
  it('uses the body tint', () => {
    expect(flatWaterColor('#336699')).toBe(0x336699);
  });

  it('falls back to the default water blue for white, empty or bad tints', () => {
    const blue = parseInt(WATER_FALLBACK_COLOR.slice(1), 16);
    expect(flatWaterColor('#ffffff')).toBe(blue);
    expect(flatWaterColor('#FFFFFF')).toBe(blue);
    expect(flatWaterColor(undefined)).toBe(blue);
    expect(flatWaterColor('nonsense')).toBe(blue);
  });
});
