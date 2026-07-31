// The stone sprite pool. Layout itself is wallLayout.test.ts's job — what is
// checkable here is that a rebuild reuses the sprites already in the container
// instead of destroying every stone and allocating a fresh one, which on a drag
// happened for every wall on the map, every frame.

import { describe, it, expect, vi } from 'vitest';

vi.mock('pixi.js', () => {
  class MockContainer {
    label = '';
    destroyed = false;
    children: MockContainer[] = [];
    addChild(c: MockContainer): MockContainer {
      this.children.push(c);
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
  return { Container: MockContainer, Sprite: MockSprite };
});

vi.mock('../assets/textureLoader', () => ({
  resolveTexture: (id: string) => ({ id, width: 200, height: 200 }),
  load: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../assets/textureManifest', () => ({
  getWallPieces: (_set: string, piece: string) =>
    piece === 'straight'
      ? [{ id: 'straight-a', naturalWidth: 200, naturalHeight: 200, contentRect: { x: 0, y: 0, w: 200, h: 60 } }]
      : [],
}));

import { Container } from 'pixi.js';
import { renderNodeWalls } from './wallNodeRenderer';
import type { DungeonStyle, WallSegment } from '../store/types';

const style = { wallTextureSetId: 'stone-slate', wallTextureTint: '#ffffff', wallWidth: 0.4 } as DungeonStyle;

const wall = (id: string, length: number): WallSegment =>
  ({ id, points: [[0, 0], [length, 0]], width: 0.4 }) as WallSegment;

function render(walls: WallSegment[], container = new Container()): Container {
  renderNodeWalls(container, [], walls, style);
  return container;
}

describe('renderNodeWalls — stone sprite pool', () => {
  it('draws a stone per laid-out node', () => {
    expect(render([wall('w1', 10)]).children.length).toBeGreaterThan(0);
  });

  it('reuses the same sprites when the same wall is drawn again', () => {
    const container = render([wall('w1', 10)]);
    const before = [...container.children];

    render([wall('w1', 10)], container);

    expect(container.children).toEqual(before);
    expect(before.every((s) => !s.destroyed)).toBe(true);
  });

  it('destroys only the tail when the wall gets shorter', () => {
    const container = render([wall('w1', 30)]);
    const before = [...container.children];

    render([wall('w1', 6)], container);

    expect(container.children.length).toBeLessThan(before.length);
    // Everything still on screen is the object it was...
    expect(container.children).toEqual(before.slice(0, container.children.length));
    // ...and only what fell off the end was destroyed.
    expect(before.slice(container.children.length).every((s) => s.destroyed)).toBe(true);
  });

  it('empties the container when the style has no wall set', () => {
    const container = render([wall('w1', 10)]);
    renderNodeWalls(container, [], [wall('w1', 10)], { ...style, wallTextureSetId: '' } as DungeonStyle);
    expect(container.children).toHaveLength(0);
  });
});
