// The client's half of §2: that the sweep answers the same three questions the server's does
// — a wall stops it, a shut door stops it, an open one lets it through — and that the memo
// only recomputes what actually moved.
//
// The fixture is the server's, deliberately: two halls either side of one long wall with a
// two-cell door in it (`session/testdata/vision-two-rooms.mapbuilder`, and
// `session/server/src/fog/vision-mode.test.ts` asks the same geometry the same questions).
// The two sweeps have to agree, so they are checked against the same shape.

import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '@dnd/core/src/engine/hitTest';
import type { DoorChild, WallSegment } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import type { Token } from '@dnd/mechanics/tokens';
import { createSightCache, sighted } from './visionSight';

const SPINE = 11;

const wall: WallSegment = {
  id: 'wall-mid',
  points: [
    [SPINE, -20],
    [SPINE, 20],
  ],
  wallType: 'normal',
  direction: 'both',
  color: '#000000',
  width: 0.5,
  roughness: 0,
} as WallSegment;

const door = (over: Partial<DoorChild> = {}): DoorChild =>
  ({
    id: 'door-mid',
    name: 'Middle Door',
    childType: 'door',
    visible: true,
    wallId: 'wall-mid',
    position: [SPINE, 5],
    angle: 0,
    width: 2,
    style: 'single',
    state: 'closed',
    isSecret: false,
    roomA: 'west',
    roomB: 'east',
    ...over,
  }) as DoorChild;

/** A fresh layers array every call — core replaces its own on every write, and so must this. */
const layersWith = (doors: DoorChild[]): Layer[] => [
  {
    id: 'l1',
    type: 'dungeon',
    visible: true,
    children: doors,
    standaloneWalls: [wall],
    mergedFloor: null,
    rooms: [],
  } as unknown as Layer,
];

const scout = (over: Partial<Token> = {}): Token => ({
  id: 't1',
  name: 'Scout',
  imageAssetId: null,
  size: 'medium',
  disposition: 'friendly',
  sight: { range: 8, angle: 360, visionMode: 'normal' },
  light: null,
  defId: null,
  x: 5,
  y: 5,
  elevation: 0,
  z: 0,
  hidden: false,
  ownerId: 'p1',
  ...over,
});

const sees = (polygons: readonly [number, number][][], point: [number, number]): boolean =>
  polygons.some((polygon) => pointInPolygon(point, polygon));

describe('the party sweep the mask is cut to (S3 P2 §2)', () => {
  it('reaches across its own hall and stops on the wall', () => {
    const sight = createSightCache().partySight(layersWith([door()]), [scout()]);
    expect(sight).toHaveLength(1);
    expect(sees(sight, [9.5, 5])).toBe(true);
    expect(sees(sight, [12.5, 5])).toBe(false);
  });

  it('lets the same sight through the moment the door is open — and only through the gap', () => {
    const sight = createSightCache().partySight(layersWith([door({ state: 'open' })]), [scout()]);
    expect(sees(sight, [12.5, 5])).toBe(true);
    // The doorway is two cells of wall, not a hole in the whole of it.
    expect(sees(sight, [12.5, 2.5])).toBe(false);
  });

  it('treats a secret door the party has not found as the wall it is disguised as', () => {
    // A player's copy of the document simply has no child for it (D4), so the wall is never
    // split — which is the server's answer for the same party, arrived at the same way.
    const unfound = createSightCache().partySight(layersWith([]), [scout({ y: 5 })]);
    const found = createSightCache().partySight(layersWith([door({ state: 'open' })]), [scout()]);
    expect(sees(unfound, [12.5, 5])).toBe(false);
    expect(sees(found, [12.5, 5])).toBe(true);
  });

  it('sweeps against the walls the referee has, never core’s recomputed floor rings', () => {
    // Core unions a room's floor shapes into `mergedFloor` after every load, and
    // `resolveWalls` promotes every one of that ring's edges to a light-blocking wall. The
    // document the server sweeps carries `mergedFloor: null` — nothing ever saves the field —
    // so a floor edge is not an occluder there. Left in, the party is boxed inside their own
    // floor and this canvas answers "what can they see" differently from the referee that is
    // redacting their tokens off the same question.
    const boxed = layersWith([door({ state: 'open' })]);
    (boxed[0] as unknown as { mergedFloor: unknown }).mergedFloor = [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    ];
    expect(sees(createSightCache().partySight(boxed, [scout()]), [12.5, 5])).toBe(true);
  });

  it('draws through claimed, unhidden, sighted eyes and no others', () => {
    const tokens = [
      scout({ id: 't1' }),
      scout({ id: 't2', ownerId: null }), // the DM's scenery
      scout({ id: 't3', hidden: true }),
      scout({ id: 't4', sight: null }),
      scout({ id: 't5', sight: { range: 0, angle: 360, visionMode: 'normal' } }),
    ];
    expect(sighted(tokens).map((t) => t.id)).toEqual(['t1']);
  });

  /**
   * S3 P5 — the same filter with the seed narrowed to one seat, which is the whole of the
   * client's individual-share change. Written so party share would answer differently: the
   * other player's token is one this seat legitimately *holds* (it walked into their sight),
   * and drawing the mask through its eyes too would hand back the party view.
   */
  it('draws through this seat’s own eyes alone when the share is individual', () => {
    const mine = (t: Token) => t.ownerId === 'p1';
    // The edges are symmetric, the way `set-sight-link` writes them on both ends.
    const tokens = [
      scout({ id: 'mine', sharesSightWith: ['familiar'] }),
      scout({ id: 'familiar', ownerId: null, sharesSightWith: ['mine'] }),
      scout({ id: 'theirs', ownerId: 'p2', sharesSightWith: ['their-familiar'] }),
      scout({ id: 'their-familiar', ownerId: null, sharesSightWith: ['theirs'] }),
    ];
    // Own claimed token plus the closure over the DM's links, and nothing of the other seat's.
    expect(sighted(tokens, mine).map((t) => t.id).sort()).toEqual(['familiar', 'mine']);
    // …and with no seed at all it is the party: every claimed token and their familiars.
    expect(sighted(tokens).map((t) => t.id).sort()).toEqual([
      'familiar',
      'mine',
      'their-familiar',
      'theirs',
    ]);
  });
});

describe('the memo that keeps a still party from paying twice', () => {
  it('sweeps once for a token that has not moved, and again when it does', () => {
    const cache = createSightCache();
    const layers = layersWith([door()]);

    cache.partySight(layers, [scout()]);
    expect(cache.sweeps()).toBe(1);
    cache.partySight(layers, [scout()]);
    expect(cache.sweeps()).toBe(1);

    cache.partySight(layers, [scout({ x: 6 })]);
    expect(cache.sweeps()).toBe(2);
    // …and back where it started is a cache hit, not a third sweep.
    cache.partySight(layers, [scout()]);
    expect(cache.sweeps()).toBe(2);
  });

  it('recomputes an unmoved token when the door under its sight swings', () => {
    const cache = createSightCache();
    const before = cache.partySight(layersWith([door()]), [scout()]);
    expect(cache.sweeps()).toBe(1);

    // The swing is a write to core's layers (`syncDoorsToLighting`), which is a new array —
    // and that array *is* the dirty flag. Nothing calls an invalidate.
    const after = cache.partySight(layersWith([door({ state: 'open' })]), [scout()]);
    expect(cache.sweeps()).toBe(2);
    expect(sees(before, [12.5, 5])).toBe(false);
    expect(sees(after, [12.5, 5])).toBe(true);
  });

  it('costs one sweep per pair of eyes and nothing for a party of none', () => {
    const cache = createSightCache();
    const layers = layersWith([door()]);
    expect(cache.partySight(layers, [])).toEqual([]);
    expect(cache.sweeps()).toBe(0);

    expect(cache.partySight(layers, [scout({ id: 't1' }), scout({ id: 't2', x: 3 })])).toHaveLength(2);
    expect(cache.sweeps()).toBe(2);
  });
});
