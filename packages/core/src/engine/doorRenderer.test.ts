import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DoorChild, DoorStyle } from '../shared/types';
import type { ResolvedDoor } from '../shared/wallResolve';
import type { DungeonStyle } from '../store/types';

// Graphics stub: every draw call is chainable. Geometry goes unrecorded — the
// tests care about *which* display object lands in the container — but the
// paints are kept, because a badge struck into the same Graphics as the art it
// sits on is not otherwise tellable from the art.
interface Paint { op: 'stroke' | 'fill'; color?: number }

class FakeGraphics {
  destroyed = false;
  paints: Paint[] = [];
  moveTo() { return this; }
  lineTo() { return this; }
  arc() { return this; }
  circle() { return this; }
  closePath() { return this; }
  stroke(o?: { color?: number }) { this.paints.push({ op: 'stroke', color: o?.color }); return this; }
  fill(o?: { color?: number }) { this.paints.push({ op: 'fill', color: o?.color }); return this; }
  destroy() { this.destroyed = true; }
}

class FakeSprite {
  anchor = { set: vi.fn() };
  position = { set: vi.fn() };
  scale = { set: vi.fn<(x: number, y?: number) => void>() };
  rotation = 0;
  tint = 0xffffff;
  alpha = 1;
  constructor(public texture: unknown) {}
}

class FakeRectangle {
  constructor(
    public x: number, public y: number,
    public width: number, public height: number,
  ) {}
}

/** Enough of a Texture for the trim path: a source plus the frame onto it. */
class FakeTexture {
  source: unknown;
  frame: FakeRectangle;
  constructor(opts: { source: unknown; frame: FakeRectangle }) {
    this.source = opts.source;
    this.frame = opts.frame;
  }
  get width(): number { return this.frame.width; }
  get height(): number { return this.frame.height; }
}

vi.mock('pixi.js', () => ({
  Graphics: FakeGraphics,
  Sprite: FakeSprite,
  Rectangle: FakeRectangle,
  Texture: FakeTexture,
}));

/** A pack texture as `getTextureOrNull` hands one back: whole file, no atlas. */
function packTexture(w: number, h: number) {
  return { width: w, height: h, source: 'src', frame: new FakeRectangle(0, 0, w, h) };
}

vi.mock('../assets/textureLoader', () => ({
  resolveTexture: vi.fn(() => ({ width: 0 })),
}));

const getTextureOrNull = vi.fn<(id: string) => unknown>(() => null);
vi.mock('./assetPackInstance', () => ({
  getAssetPackManager: () => ({ getTextureOrNull }),
}));

const { renderDoors, doorSpriteFit } = await import('./doorRenderer');

const STYLE = { wallColor: '#333333', wallWidth: 0.4 } as DungeonStyle;

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

/** The badge colour, mirrored from the table's DM seat. */
const SECRET_AMBER = 0xe0b252;

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
    getTextureOrNull.mockReturnValue(packTexture(200, 200));
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
      // Locked asks for the closed art; a closed archway still asks for the open
      // art, so there is no `door-archway-closed` key to ship.
      'dungeon-classic:door-archway-open',
    ]));
  });

  it('leaves locked art untinted and secret art unfaded', () => {
    getTextureOrNull.mockReturnValue(packTexture(200, 200));
    const [locked] = render([resolved('portcullis', { state: 'locked' })]) as FakeSprite[];
    // Locked is panel information now, not a red wash over the art.
    expect(locked.tint).toBe(0xffffff);
    // Secret art used to be faded to 0.35 — fog semantics on a view that is not
    // a fog view. The DM's own map never hides what the DM has to see.
    const [secret] = render([resolved('archway', { isSecret: true })]) as FakeSprite[];
    expect(secret.alpha).toBe(1);
  });

  it('badges a secret door, whatever the style and whatever drew the art', () => {
    for (const style of STYLES) {
      // Glyph fallback: the badge is struck into the same Graphics as the art.
      getTextureOrNull.mockReturnValue(null);
      const [glyph] = render([resolved(style, { isSecret: true })]) as FakeGraphics[];
      expect(glyph.paints.some((p) => p.color === SECRET_AMBER)).toBe(true);

      // Sprite path: the art sprite, then the badge over it.
      getTextureOrNull.mockReturnValue(packTexture(200, 200));
      const out = render([resolved(style, { isSecret: true })]);
      expect(out).toHaveLength(2);
      expect((out[0] as FakeSprite).alpha).toBe(1);
      expect((out[1] as FakeGraphics).paints.some((p) => p.color === SECRET_AMBER)).toBe(true);
    }
  });

  it('badges nothing that is not secret', () => {
    for (const style of STYLES) {
      getTextureOrNull.mockReturnValue(null);
      const [glyph] = render([resolved(style)]) as FakeGraphics[];
      expect(glyph.paints.some((p) => p.color === SECRET_AMBER)).toBe(false);
    }
  });

  it('gives a secret door the same art as a plain one', () => {
    // A secret closed single door used to throw its art away for a faint dashed
    // line, so it could not be told from a plain one — or found at all.
    getTextureOrNull.mockReturnValue(null);
    const [plain] = render([resolved('single', { state: 'closed' })]) as FakeGraphics[];
    const [secret] = render([
      resolved('single', { state: 'closed', isSecret: true }),
    ]) as FakeGraphics[];
    expect(secret.paints.filter((p) => p.color !== SECRET_AMBER)).toEqual(plain.paints);
    expect(plain.paints.length).toBeGreaterThan(0);
  });

  it('draws no status marker over the art', () => {
    // The state dot was a second display object stacked on the door. One door,
    // one display object — on the sprite path and on the glyph fallback alike.
    for (const style of STYLES) {
      for (const state of ['closed', 'open', 'locked'] as const) {
        getTextureOrNull.mockReturnValue(null);
        expect(render([resolved(style, { state })])).toHaveLength(1);
        getTextureOrNull.mockReturnValue(packTexture(200, 200));
        expect(render([resolved(style, { state })])).toHaveLength(1);
      }
    }
  });

  it('leaves portals on their authored texture, never the door pack', () => {
    render([resolved('portal', { portalTextureId: 'pack:portal-a' })]);
    expect(getTextureOrNull).not.toHaveBeenCalled();
  });
});

/**
 * The measurements the sprite path lives or dies on. Door art is painted into a
 * padded cell, so a sprite scaled by its texture is scaled by mostly nothing —
 * that is the whole reason a default-width door used to draw as a hairline.
 *
 * World units are grid cells: a fit is right when `alongPx * scale` is the
 * door's width and `acrossPx * scale` is at least the wall's.
 */
describe('doorSpriteFit', () => {
  const WALL = 0.4;

  it('spans the door width on tight art and never thins below the wall', () => {
    // 200x200 canvas, 200x45 of paint.
    const fit = doorSpriteFit('door-single-closed', 200, 200, 1, WALL);
    expect(fit.frame).toEqual({ x: 0, y: 77, w: 200, h: 45 });
    expect(fit.rotate).toBe(0);
    expect(fit.frame.w * fit.scaleX).toBeCloseTo(1);
    expect(fit.frame.h * fit.scaleY).toBeCloseTo(WALL);
  });

  it('measures padded art by its paint, not by its canvas', () => {
    // 400x200 canvas, 281x81 of paint at (60,59) — over a third of it is padding.
    const fit = doorSpriteFit('door-single-open', 400, 200, 1, WALL);
    expect(fit.frame).toEqual({ x: 60, y: 59, w: 281, h: 81 });
    expect(fit.frame.w * fit.scaleX).toBeCloseTo(1);
    expect(fit.frame.h * fit.scaleY).toBeCloseTo(WALL);
    // The bug this replaces: canvas-scaling put 400px of texture across one cell,
    // so the 281px of paint covered well under the door's own footprint.
    expect(fit.scaleX).toBeGreaterThan(1 / 400);
  });

  it('quarter-turns the archway so its long side runs along the wall', () => {
    // 200x400 canvas, a 27x212 upright sliver at (87,94).
    const fit = doorSpriteFit('door-archway-open', 200, 400, 1, WALL);
    expect(fit.frame).toEqual({ x: 87, y: 94, w: 27, h: 212 });
    expect(fit.rotate).toBeCloseTo(Math.PI / 2);
    // Turned, so the frame's HEIGHT is the along-wall axis and scaleY drives it.
    expect(fit.frame.h * fit.scaleY).toBeCloseTo(1);
    expect(fit.frame.w * fit.scaleX).toBeCloseTo(WALL);
  });

  it('keeps thickness independent of width, with the wall as its floor', () => {
    const narrow = doorSpriteFit('door-single-closed', 200, 200, 0.5, WALL);
    const wide = doorSpriteFit('door-single-closed', 200, 200, 4, WALL);
    // Halving the door does not halve its thickness — the old uniform scale did.
    expect(narrow.frame.h * narrow.scaleY).toBeCloseTo(WALL);
    expect(narrow.frame.w * narrow.scaleX).toBeCloseTo(0.5);
    // A wide door is allowed to be thicker than the wall: the art's own
    // proportions take over once they exceed the floor.
    expect(wide.frame.h * wide.scaleY).toBeCloseTo(45 * (4 / 200));
    expect(wide.frame.w * wide.scaleX).toBeCloseTo(4);
  });

  it('uses the whole canvas for an entry with no measured paint', () => {
    const fit = doorSpriteFit('door-portcullis-open', 400, 200, 2, WALL);
    expect(fit.frame).toEqual({ x: 0, y: 0, w: 400, h: 200 });
  });
});
