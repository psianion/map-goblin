import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DoorChild, DoorStyle } from '../shared/types';
import type { ResolvedDoor } from '../shared/wallResolve';
import type { DungeonStyle } from '../store/types';

// Graphics stub: every draw call is chainable and recorded nowhere — the tests
// only care about *which* display object lands in the container.
class FakeGraphics {
  destroyed = false;
  moveTo() { return this; }
  lineTo() { return this; }
  arc() { return this; }
  circle() { return this; }
  closePath() { return this; }
  stroke() { return this; }
  fill() { return this; }
  destroy() { this.destroyed = true; }
}

class FakeSprite {
  anchor = { set: vi.fn() };
  position = { set: vi.fn() };
  scale = { set: vi.fn() };
  rotation = 0;
  tint = 0xffffff;
  alpha = 1;
  constructor(public texture: { width: number }) {}
}

vi.mock('pixi.js', () => ({
  Graphics: FakeGraphics,
  Sprite: FakeSprite,
}));

vi.mock('../assets/textureLoader', () => ({
  resolveTexture: vi.fn(() => ({ width: 0 })),
}));

const getTextureOrNull = vi.fn<(id: string) => { width: number } | null>(() => null);
vi.mock('./assetPackInstance', () => ({
  getAssetPackManager: () => ({ getTextureOrNull }),
}));

const { renderDoors } = await import('./doorRenderer');

const STYLE = { wallColor: '#333333' } as DungeonStyle;

function resolved(style: DoorStyle, patch: Partial<DoorChild> = {}): ResolvedDoor {
  const door = {
    id: 'd1', childType: 'door', visible: true,
    wallId: 'w1', position: [0, 0], angle: 0,
    width: 1, style, state: 'closed', isSecret: false,
    ...patch,
  } as DoorChild;
  return { door, wall: null, t: 0.5, position: [0, 0], angle: 0, detached: false };
}

function render(doors: ResolvedDoor[]) {
  const children: unknown[] = [];
  renderDoors({ addChild: (c: unknown) => children.push(c) } as never, doors, STYLE, 1);
  return children;
}

const STYLES: DoorStyle[] = ['single', 'double', 'portcullis', 'archway'];

describe('renderDoors sprite dispatch', () => {
  beforeEach(() => {
    getTextureOrNull.mockReset();
    getTextureOrNull.mockReturnValue(null);
  });

  it.each(STYLES)('%s falls back to the vector glyph when the pack has no art', (style) => {
    const children = render([resolved(style)]);
    expect(getTextureOrNull).toHaveBeenCalled();
    expect(children.some((c) => c instanceof FakeGraphics)).toBe(true);
    expect(children.some((c) => c instanceof FakeSprite)).toBe(false);
  });

  it.each(STYLES)('%s renders the sprite when the pack has art', (style) => {
    getTextureOrNull.mockReturnValue({ width: 64 });
    const children = render([resolved(style)]);
    expect(children.some((c) => c instanceof FakeSprite)).toBe(true);
  });

  it('asks for the documented manifest keys', () => {
    render([
      resolved('single'), resolved('double', { state: 'open' }),
      resolved('portcullis'), resolved('portcullis', { state: 'open' }),
      resolved('archway'), resolved('archway', { state: 'open' }),
      resolved('single', { state: 'locked' }),
    ]);
    expect(new Set(getTextureOrNull.mock.calls.map((c) => c[0]))).toEqual(new Set([
      'dungeon-classic:door-single-closed',
      'dungeon-classic:door-double-open',
      'dungeon-classic:door-portcullis-closed',
      'dungeon-classic:door-portcullis-open',
      // Locked reuses the closed art; a closed archway still asks for the open
      // art, so there is no `door-archway-closed` key to ship.
      'dungeon-classic:door-archway-open',
    ]));
  });

  it('tints locked and fades secret on the sprite path, whatever the style', () => {
    getTextureOrNull.mockReturnValue({ width: 64 });
    const [locked] = render([resolved('portcullis', { state: 'locked' })]) as FakeSprite[];
    expect(locked.tint).toBe(0xe74c3c);
    const [secret] = render([resolved('archway', { isSecret: true })]) as FakeSprite[];
    expect(secret.alpha).toBe(0.35);
  });

  it('leaves portals on their authored texture, never the door pack', () => {
    render([resolved('portal', { portalTextureId: 'pack:portal-a' })]);
    expect(getTextureOrNull).not.toHaveBeenCalled();
  });
});
