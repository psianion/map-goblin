// Cave rock turning into a cut-stone wall: where a floor outline's measured rock meets a stone
// wall, the kit's transition piece is laid across the vertex, the rock and the stone each stopping
// at its joint; anywhere else the two meet as they always did. A seeded kit whose transitions are
// measured as a real cave kit's are.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../assets/textureLoader', async (orig) => (await import('../testing/caveSpeed')).mockTextureLoader(await orig<object>()));

import { Container, Sprite } from 'pixi.js';
import { freshMods, seedTransitionKit, TURN_CAVE as CAVE, TURN_STONE as STONE, TURN_WOOD as WOOD } from '../testing/caveSpeed';
import type { DungeonLayer, DungeonStyle } from '../store/types';
import type { Polygon } from '../types/geometry';
import type { WalkPlacement } from './caveWalk';

type V = [number, number];

async function setup(walls: string[] | null = [STONE]) {
  const mods = await freshMods();
  seedTransitionKit(mods, walls);
  const wallsMod = await import('./wallNodeRenderer');
  const turns = await import('./caveTransitions');
  const kit = (await import('../assets/caveWallKit')).bandPiecesFor(CAVE);
  return { mods, wallsMod, turns, kit };
}

const look = (setId: string, tint = '#ffffff'): DungeonStyle => ({ floorColor: '#F1ECDF', wallColor: '#000', wallWidth: 0.5, lineWidth: 0.04, wallTextureSetId: setId, wallTextureTint: tint }) as unknown as DungeonStyle;
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('where a transition is laid', () => {
  it('lays the long straight where the runs meet in line with room to spare, and the short one where they have not', async () => {
    const { turns, kit } = await setup();
    // Walking east along y 0, the floor below (right of travel): rock in, stone out.
    const long = turns.transitionAt(kit, STONE, [6, 0], [1, 0], [1, 0], true, 6, 6, 1)!;
    expect(long.pl.piece.key).toMatch(/^to_wall_b/);
    const short = turns.transitionAt(kit, STONE, [6, 0], [1, 0], [1, 0], true, 3, 6, 1)!;
    expect(short.pl.piece.key).toMatch(/^to_wall_a/);
    // Too short a side for either: the join as it always was.
    expect(turns.transitionAt(kit, STONE, [6, 0], [1, 0], [1, 0], true, 0.8, 6, 1)).toBeNull();
  }, 30_000);

  it('takes the hand whose wall joint faces the stone, its wall joint on the stone wall’s line and its rock joint where the rock’s joints lie', async () => {
    const { turns, kit } = await setup();
    const { BAND_OUT } = await import('./caveWalk');
    for (const caveIn of [true, false]) {
      const t = turns.transitionAt(kit, STONE, [6, 0], [1, 0], [1, 0], caveIn, 6, 6, 1)!;
      const w = t.pl.piece.wallJoint!;
      const [jw, jc] = w === 0 ? [t.pl.P, t.pl.Q] : [t.pl.Q, t.pl.P];
      // The stone lies east of the vertex walking in with the rock, west walking out of it.
      expect(Math.sign(jw[0] - 6)).toBe(caveIn ? 1 : -1);
      expect(jw[1]).toBeCloseTo(0, 6);
      // The void is left of travel, up the screen.
      expect(jc[1]).toBeCloseTo(-2 * BAND_OUT, 6);
      expect(Math.abs(t.pl.at.position.x - 6)).toBeLessThan(0.2);
      expect(t.wall).toBeCloseTo(1.15, 6);
      // The rock stops short of its joint by the lap two of its pieces take, and a hair under the piece.
      expect(t.cave).toBeLessThan(1.15 - 0.15 + 1e-9);
      expect(t.cave).toBeGreaterThan(0.8);
    }
    const hands = new Set([true, false].map((caveIn) => turns.transitionAt(kit, STONE, [6, 0], [1, 0], [1, 0], caveIn, 6, 6, 1)!.pl.piece.key));
    expect(hands.size).toBe(2);
  }, 30_000);

  it('lays the corner where they meet at a right angle turning the way the art turns, both hands, and nothing turning the other way or at other angles', async () => {
    const { turns, kit } = await setup();
    // A cave room's bottom edge running west into a stone room's left wall going down, and back.
    const into = turns.transitionAt(kit, STONE, [6, 6], [0, -1], [-1, 0], false, 6, 4, 1);
    const outOf = turns.transitionAt(kit, STONE, [6, 2], [0, 1], [1, 0], true, 2, 8, 1);
    expect(into?.pl.piece.key).toMatch(/^to_wall_corner/);
    expect(outOf?.pl.piece.key).toMatch(/^to_wall_corner/);
    expect(into!.pl.piece.key).not.toBe(outOf!.pl.piece.key);
    // The same corner walked the other way round turns the other way: no piece.
    expect(turns.transitionAt(kit, STONE, [6, 6], [1, 0], [0, 1], true, 6, 4, 1)).toBeNull();
    // 45 degrees, and 20 off in line: neither.
    const d = Math.SQRT1_2;
    expect(turns.transitionAt(kit, STONE, [6, 0], [1, 0], [d, d], true, 6, 6, 1)).toBeNull();
    expect(turns.transitionAt(kit, STONE, [6, 0], [1, 0], [Math.cos(0.35), Math.sin(0.35)], true, 6, 6, 1)).toBeNull();
  }, 30_000);

  it('keeps today’s join for a wall set not on the list, a kit with no list, and a door within the piece’s length', async () => {
    const { turns, kit } = await setup();
    expect(turns.transitionAt(kit, WOOD, [6, 0], [1, 0], [1, 0], true, 6, 6, 1)).toBeNull();
    expect(turns.transitionAt(kit, STONE, [6, 0], [1, 0], [1, 0], true, 6, 6, 1, [{ position: [8, 0], width: 1 }])).toBeNull();
    expect(turns.transitionAt(kit, STONE, [6, 0], [1, 0], [1, 0], true, 6, 6, 1, [{ position: [9.5, 0], width: 1 }])).not.toBeNull();
    const none = await setup(null);
    expect(none.turns.transitionAt(none.kit, STONE, [6, 0], [1, 0], [1, 0], true, 6, 6, 1)).toBeNull();
  }, 30_000);
});

/** A 12 by 6 floor: rock along the west half and the bottom's west half, stone round the rest (the bottom's east half in `east`). */
const RING: Polygon = [[0, 0], [6, 0], [12, 0], [12, 6], [6, 6], [0, 6]];

function laid(m: Awaited<ReturnType<typeof setup>>, stone: string, east = look(STONE, '#cccccc')) {
  const rock: WalkPlacement[][] = [];
  const root = new Container();
  const c = look(CAVE);
  m.wallsMod.renderNodeWalls(root, [RING], [], c, [], {}, {
    ringStyles: [c],
    edgeStyles: [[c, look(stone), look(stone), east, c, c]],
    onRockLaid: ({ placed }) => rock.push(placed),
  });
  // The stones: every sprite that is not one of the rock's pieces.
  const pieces = rock.flat().map((pl): V => [pl.at.position.x, pl.at.position.y]);
  const stones: V[] = [];
  const visit = (k: Container): void => {
    for (const ch of k.children) {
      if (ch instanceof Sprite && !pieces.some((p) => dist(p, [ch.position.x, ch.position.y]) < 1e-6)) stones.push([ch.position.x, ch.position.y]);
      visit(ch as Container);
    }
  };
  visit(root);
  return { rock: rock.flat(), stones };
}

describe('how a transition sits on the outline', () => {
  it('stops the rock at the piece’s rock joint and the stone at its wall joint, nothing under the piece; a wall set not listed meets the rock as before', async () => {
    const m = await setup();
    const withTurn = laid(m, STONE);
    const pieces = withTurn.rock.filter((pl) => pl.branch === 'transition');
    // One at each end of the rock: (6, 0) into the stone, and (6, 6) out of the east stone.
    expect(pieces).toHaveLength(2);
    const at = pieces.find((pl) => dist([pl.at.position.x, pl.at.position.y], [6, 0]) < 0.3)!;
    expect(at).toBeDefined();
    const jw = at.piece.wallJoint === 0 ? at.P : at.Q;
    // No stone is laid between the vertex and the wall joint along the top edge.
    const top = withTurn.stones.filter((p) => Math.abs(p[1]) < 0.5 && p[0] > 5 && p[0] < 12);
    expect(top.length).toBeGreaterThan(0);
    expect(Math.min(...top.map((p) => p[0]))).toBeGreaterThanOrEqual(jw[0] - 1e-6);
    // The rock's last piece laps the piece's rock joint by exactly the kit's overlap, as two of its own pieces lap.
    const jc = at.piece.wallJoint === 0 ? at.Q : at.P;
    const { jointsOf } = await import('../assets/caveWallKit');
    const nearest = Math.min(...withTurn.rock.filter((pl) => pl.branch !== 'transition').flatMap((pl) => jointsOf(pl.piece, pl.at)).map((j) => dist(j, jc)));
    expect(nearest).toBeCloseTo(0.3, 6);
    // No rock past the vertex into the stone.
    const rockAlongTop = withTurn.rock.filter((pl) => pl.branch !== 'transition' && Math.abs(pl.at.position.y) < 1);
    for (const pl of rockAlongTop) expect(Math.max(pl.P[0], pl.Q[0])).toBeLessThan(6);
    // Wood is not listed: no piece at (6, 0), and the stone runs right up to the vertex as it did.
    const wood = laid(m, WOOD);
    expect(wood.rock.filter((pl) => pl.branch === 'transition' && dist([pl.at.position.x, pl.at.position.y], [6, 0]) < 0.3)).toHaveLength(0);
    const woodTop = wood.stones.filter((p) => Math.abs(p[1]) < 0.5 && p[0] > 5 && p[0] < 12);
    expect(Math.min(...woodTop.map((p) => p[0]))).toBeLessThan(jw[0]);
  }, 30_000);
});

describe('blocking at a transition', () => {
  it('leaves no gap between the rock’s edge and the stone wall’s: their blocking lines meet at the vertex within 0.05 cell', async () => {
    const m = await setup();
    const { computeMergedFloor } = await import('./mergedFloor');
    const { extractWallSegments } = await import('./lighting/raycaster');
    const rect = (x0: number, y0: number, x1: number, y1: number): V[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const shape = (id: string, ring: V[]) => ({ id, name: id, childType: 'shape', visible: true, shapeType: 'polygon', contours: [ring] });
    for (const stoneRoom of [rect(6, 0, 14, 6), rect(6, 2, 14, 10)]) {
      const caveRoom = rect(0, 0, 6, 6);
      const layer = {
        id: 'l', name: 'Dungeon', type: 'dungeon', visible: true, standaloneWalls: [], caveOpenings: [], mergedFloor: null,
        children: [shape('cave', caveRoom), shape('stone', stoneRoom)],
        rooms: [
          { id: 'r-cave', name: 'cave', anchor: [3, 3], boundary: caveRoom, face: caveRoom, look: { wallTextureSetId: CAVE } },
          { id: 'r-stone', name: 'stone', anchor: [10, 4], boundary: stoneRoom, face: stoneRoom },
        ],
        style: look(STONE),
      } as unknown as DungeonLayer;
      layer.mergedFloor = computeMergedFloor(layer);
      // The rock and the stone meet where the cave room's right side leaves the outline.
      const V: V = stoneRoom[0][1] === 0 ? [6, 0] : [6, 2];
      expect(laid(m, STONE).rock.length).toBeGreaterThan(0);
      const segs = extractWallSegments([layer]);
      const ends = segs.flatMap((s) => [[s.x1, s.y1], [s.x2, s.y2]]).filter((p) => dist(p, V) < 0.05);
      // A segment of each side ends at the vertex: no gap for light, sight or a token to slip through.
      expect(ends.length).toBeGreaterThanOrEqual(2);
    }
  }, 30_000);
});
