import { describe, expect, it } from 'vitest';
import { moveSnapPoint } from './SelectTool';
import type { AnyChild, AssetChild } from '../../store/types';

const picture = (over: Partial<AssetChild> = {}): AssetChild => ({
  id: 'img', name: 'Battlemap', childType: 'asset', visible: true, objectType: 'image', assetId: 'pic',
  position: { x: 17.7, y: 11.6 }, rotation: 0, scale: 0.5, width: 72, height: 48, tint: '#ffffff', flipX: false, flipY: false,
  ...over,
});

describe('moveSnapPoint', () => {
  const box = { x: -3, y: -4 };

  it('is a picture’s or prop’s top-left corner', () => {
    const p = moveSnapPoint(picture(), box)!;
    expect(p.x).toBeCloseTo(-0.3, 9);
    expect(p.y).toBeCloseTo(-0.4, 9);
  });

  it('is the selection box corner for a turned prop', () => {
    expect(moveSnapPoint(picture({ rotation: 0.4 }), box)).toEqual(box);
  });

  it('is a light’s own position', () => {
    const light = { id: 'l', name: 'Torch', childType: 'light', visible: true, position: { x: 4.5, y: 2.5 }, radius: 6 } as unknown as AnyChild;
    expect(moveSnapPoint(light, box)).toEqual({ x: 4.5, y: 2.5 });
  });

  it('is none for several things, a floor or a wall, which keep the snapped delta', () => {
    expect(moveSnapPoint(null, box)).toBeNull();
  });
});
