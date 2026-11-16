// The base ground and the lighting: a textured ground is content (graded with the ground pieces
// beside it), a plain one is the sheet (left as authored), and every redraw moves the revision
// the composite is rebuilt on.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BufferImageSource, Container, Graphics, Texture } from 'pixi.js';

const loaded = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(8 * 8 * 4), width: 8, height: 8 }) });
vi.mock('../assets/textureLoader', () => ({ unitTexture: () => ({ texture: loaded }) }));

import { mapGroundContent, mapGroundRevision, syncMapGround } from './mapGroundRenderer';
import { isolateContent } from './lighting/LightingRenderer';
import { useStore } from '../store/store';

const FRAME = { minX: 0, minY: 0, maxX: 10, maxY: 8 };

beforeEach(() => {
  useStore.getState().resetToDefault();
});

describe('the base ground under the lighting', () => {
  it('is content while textured, and its revision moves when the texture, the frame or the ground changes', () => {
    const host = new Container();
    useStore.getState().setMapGround({ textureId: 'gg-forge:wild_sand_8x8_floor_A' });
    syncMapGround(host, FRAME);
    expect(mapGroundContent(host)).toEqual([host]);

    let rev = mapGroundRevision();
    syncMapGround(host, FRAME);
    expect(mapGroundRevision()).toBe(rev);

    useStore.getState().setMapGround({ textureId: 'gg-forge:wild_dirt_8x8_floor_A' });
    syncMapGround(host, FRAME);
    expect(mapGroundRevision()).not.toBe(rev);

    rev = mapGroundRevision();
    syncMapGround(host, { ...FRAME, maxX: 12 });
    expect(mapGroundRevision()).not.toBe(rev);

    rev = mapGroundRevision();
    useStore.getState().setMapGround(null);
    syncMapGround(host, FRAME);
    expect(mapGroundRevision()).not.toBe(rev);
    expect(mapGroundContent(host)).toEqual([]);
  });

  it('is not content as a plain colour, or with no ground at all', () => {
    const host = new Container();
    useStore.getState().setMapGround({ color: '#556644' });
    syncMapGround(host, FRAME);
    expect(host.children.length).toBeGreaterThan(0);
    expect(mapGroundContent(host)).toEqual([]);
    useStore.getState().setMapGround(null);
    syncMapGround(host, FRAME);
    expect(mapGroundContent(host)).toEqual([]);
  });

  it('draws into the content pass with the ground pieces when textured, so both take one grade; plain, it is muted as the sheet is', () => {
    const root = new Container();
    const background = new Container();
    const fill = new Graphics();
    background.addChild(fill);
    const ground = new Container();
    const layers = new Container();
    const piece = new Graphics();
    layers.addChild(piece);
    for (const c of [background, ground, layers]) root.addChild(c);
    const spec = () => ({ root, content: [background, ...mapGroundContent(ground), layers], exclude: [fill] });

    useStore.getState().setMapGround({ textureId: 'gg-forge:wild_sand_8x8_floor_A' });
    syncMapGround(ground, FRAME);
    let restore = isolateContent(spec());
    expect([ground.alpha, layers.alpha, piece.alpha]).toEqual([1, 1, 1]);
    expect(fill.alpha).toBe(0);
    restore();

    useStore.getState().setMapGround({ color: '#556644' });
    syncMapGround(ground, FRAME);
    restore = isolateContent(spec());
    expect(ground.alpha).toBe(0);
    expect(layers.alpha).toBe(1);
    restore();
    expect(ground.alpha).toBe(1);
  });
});
