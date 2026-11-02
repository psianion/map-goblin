import { describe, it, expect } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { pathColour, renderPaths } from './pathRenderer';
import type { PathChild } from '../shared/types';

const road = (over: Partial<PathChild> = {}): PathChild => ({
  id: 'road',
  name: 'Road',
  childType: 'path',
  visible: true,
  points: [{ x: 0, y: 0 }, { x: 4, y: 0 }],
  closed: false,
  width: 2,
  heightMode: 'ground',
  materialId: 'gg-forge:road-dirt',
  tint: '#ffffff',
  opacity: 1,
  offset: 0,
  flip: false,
  edge: 'soft',
  edgeStrip: false,
  ends: { start: 'cut', end: 'cut', length: 1 },
  sort: 'under',
  ...over,
});

describe('flat path ribbons', () => {
  it('colours a path by its material, times its tint', () => {
    expect(pathColour(road())).toBe(0x8b6b4a);
    expect(pathColour(road({ tint: '#808080' }))).toBe(0x463625);
    expect(pathColour(road({ materialId: 'someone:else' }))).toBe(0x8a8a8a);
  });

  it('redraws a layer’s paths into one graphic, skipping hidden ones', () => {
    const container = new Container();
    renderPaths(container, [road(), road({ id: 'b', visible: false })]);
    expect(container.children).toHaveLength(1);
    const g = container.children[0] as Graphics;
    const bounds = g.getLocalBounds();
    expect(bounds.width).toBeGreaterThan(5.9);
    expect(bounds.height).toBeCloseTo(2, 1);
    renderPaths(container, []);
    expect(container.children).toHaveLength(1);
    expect((container.children[0] as Graphics).getLocalBounds().width).toBe(0);
  });
});
