// Boundary occlusion (contract rows O1–O5): a room the DM drew is walled by its own
// outline, and the joint drawn across that outline is the doorway through it.
//
// Every row here goes through `extractWallSegments`, which is the *one* segment source both
// the referee's sweep (session/server/src/fog/sweep.ts) and the table's compositor
// (session/client/src/modules/fog/visionSight.ts) take their occluders from. Proving it here
// is proving it on both, which is the whole reason the promotion lives upstream of it.

import { describe, expect, it } from 'vitest';
import { clockwiseSweep } from '../engine/lighting/ClockwiseSweep';
import { extractWallSegments } from '../engine/lighting/raycaster';
import { resolveWalls } from './wallResolve';
import type { AnyChild, ConnectorChild, RoomChild, WallSegment } from './types';
import type { DungeonLayer } from '../store/types';

// ── Two drawn chambers with a gap between them ──────────────────────────────
//
//   hall 0..10          crypt 12..22        (both 0..10 in y)
//        └─ joint blob 9..13 x 4..6 straddling the gap ─┘

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const roomChild = (id: string, x0: number, y0: number, x1: number, y1: number): RoomChild => ({
  id,
  name: id,
  childType: 'room',
  visible: true,
  contours: [rect(x0, y0, x1, y1)],
});

const HALL = roomChild('hall', 0, 0, 10, 10);
const CRYPT = roomChild('crypt', 12, 0, 22, 10);

const joint = (over: Partial<ConnectorChild> = {}): ConnectorChild => ({
  id: 'joint',
  name: 'the neck',
  childType: 'connector',
  visible: true,
  contours: [rect(9, 4, 13, 6)],
  kind: 'door',
  state: 'open',
  isSecret: false,
  ...over,
});

function layerOf(children: readonly AnyChild[], walls: WallSegment[] = []): DungeonLayer {
  return {
    // A fresh id per layer: `resolveWalls` memoizes per layer id on input identity, and these
    // build a new children array every call.
    id: `layer-${Math.random()}`,
    name: 'Warren',
    type: 'dungeon',
    visible: true,
    locked: false,
    opacity: 1,
    children: [...children],
    standaloneWalls: walls,
    mergedFloor: null,
    style: {} as DungeonLayer['style'],
    sublayerVisibility: { floor: true, grid: true, walls: true },
    rooms: [],
    roomNameOverrides: {},
  } as unknown as DungeonLayer;
}

/** Whether an eye at `from` can see `to`, through whatever the layer occludes with. */
function sees(layer: DungeonLayer, from: [number, number], to: [number, number]): boolean {
  const polygon = clockwiseSweep(from, 200, extractWallSegments([layer])).map((v) => v.point);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > to[1] !== yj > to[1] && to[0] < ((xj - xi) * (to[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

const EYE: [number, number] = [5, 5];
const ACROSS: [number, number] = [17, 5];

// ── O1 — the boundary is the wall ──────────────────────────────────────────

describe('O1 — a drawn room boundary is a sight occluder', () => {
  it('promotes one wall per boundary edge, named for the child that drew it', () => {
    const walls = resolveWalls(layerOf([HALL]));
    expect(walls).toHaveLength(4);
    expect(walls.map((w) => w.id)).toEqual([
      'room:hall:0',
      'room:hall:1',
      'room:hall:2',
      'room:hall:3',
    ]);
    expect(walls.every((w) => w.kind === 'room' && w.roomId === 'hall')).toBe(true);
    // It occludes like any solid wall — the same `normal` the floor-ring promotion uses.
    expect(walls.every((w) => w.wallType === 'normal')).toBe(true);
  });

  it('bakes the child transform in, so a dragged room walls where it now is', () => {
    const moved = resolveWalls(
      layerOf([{ ...HALL, transform: { translate: [100, 0], rotate: 0, scale: [1, 1] } }]),
    );
    expect(moved[0].points[0][0]).toBeCloseTo(100);
  });

  it('leaves a layer nobody drew a room on exactly as it was', () => {
    expect(resolveWalls(layerOf([]))).toEqual([]);
  });

  it('stops sight at the boundary with no joint drawn', () => {
    const layer = layerOf([HALL, CRYPT]);
    expect(sees(layer, EYE, [8, 5])).toBe(true);
    expect(sees(layer, EYE, ACROSS)).toBe(false);
  });
});

// ── O2 — the joint is the doorway, and the state gates it ──────────────────

describe('O2 — a connector cuts the aperture, by construction', () => {
  it('lets sight through an open joint', () => {
    expect(sees(layerOf([HALL, CRYPT, joint()]), EYE, ACROSS)).toBe(true);
  });

  it('holds sight back at a closed one', () => {
    expect(sees(layerOf([HALL, CRYPT, joint({ state: 'closed' })]), EYE, ACROSS)).toBe(false);
  });

  it('holds sight back at a locked one', () => {
    expect(sees(layerOf([HALL, CRYPT, joint({ state: 'locked' })]), EYE, ACROSS)).toBe(false);
  });

  it('stands an arch open whatever the map authored on it', () => {
    const shut = joint({ kind: 'arch', state: 'closed' });
    expect(sees(layerOf([HALL, CRYPT, shut]), EYE, ACROSS)).toBe(true);
  });

  it('cuts the doorway in both rooms it crosses, not only the nearer one', () => {
    const layer = layerOf([HALL, CRYPT, joint()]);
    const cuts = extractWallSegments([layer]);
    const spans = (x: number) =>
      cuts.filter((s) => Math.abs(s.x1 - x) < 1e-6 && Math.abs(s.x2 - x) < 1e-6);
    // Each boundary edge the blob swallows comes back as two solid stubs either side of
    // the hole rather than one wall end to end.
    expect(spans(10)).toHaveLength(2);
    expect(spans(12)).toHaveLength(2);
  });

  it('opens only the doorway, leaving the rest of the boundary solid', () => {
    const layer = layerOf([HALL, CRYPT, joint()]);
    // Level with the doorway, sight crosses; a step above or below it does not.
    expect(sees(layer, EYE, ACROSS)).toBe(true);
    expect(sees(layer, [5, 1], [17, 1])).toBe(false);
    expect(sees(layer, [5, 9], [17, 9])).toBe(false);
  });
});

// ── O3 — real walls and boundaries union, and overlap is inert ─────────────

describe('O3 — real walls and boundary walls union', () => {
  const alongTheEdge: WallSegment = {
    id: 'w1',
    points: [
      [10, 0],
      [10, 10],
    ],
    wallType: 'normal',
    direction: 'both',
    color: '#000000',
    width: 1,
    roughness: 0,
  };

  it('leaves a wall drawn along a boundary harmless — still shut, still one wall', () => {
    expect(sees(layerOf([HALL, CRYPT], [alongTheEdge]), EYE, ACROSS)).toBe(false);
  });

  it('opens the real wall too where the blob swallows it', () => {
    expect(sees(layerOf([HALL, CRYPT, joint()], [alongTheEdge]), EYE, ACROSS)).toBe(true);
  });

  it('keeps a real wall the blob does not touch', () => {
    const elsewhere: WallSegment = { ...alongTheEdge, id: 'w2', points: [[14, 0], [14, 10]] };
    expect(sees(layerOf([HALL, CRYPT, joint()], [elsewhere]), EYE, ACROSS)).toBe(false);
  });

  // Tracked from P1b: a door twin re-anchors onto whatever wall is within range, and a
  // boundary is a wall now — so a real wall standing beside a joint could in principle
  // capture it. The aperture never re-anchors: it is the span the blob actually swallows,
  // on every wall it swallows, so a decoy alongside opens nothing it does not cross.
  it('cuts no aperture in a wall the blob merely stands near', () => {
    const decoy: WallSegment = { ...alongTheEdge, id: 'w3', points: [[10, 6.2], [12, 6.2]] };
    const layer = layerOf([HALL, CRYPT, joint()], [decoy]);
    const cut = extractWallSegments([layer]).filter(
      (s) => Math.abs(s.y1 - 6.2) < 1e-6 && Math.abs(s.y2 - 6.2) < 1e-6,
    );
    expect(cut).toHaveLength(1);
    expect(Math.hypot(cut[0].x2 - cut[0].x1, cut[0].y2 - cut[0].y1)).toBeCloseTo(2);
  });
});

// ── O4 — no joint, no hole ─────────────────────────────────────────────────

describe('O4 — boundaries with no connector between them', () => {
  it('keeps two touching boundaries mutually opaque', () => {
    const abutting = roomChild('crypt', 10, 0, 20, 10);
    expect(sees(layerOf([HALL, abutting]), EYE, [15, 5])).toBe(false);
  });

  it('keeps two overlapping boundaries mutually opaque', () => {
    const overlapping = roomChild('crypt', 8, 0, 20, 10);
    expect(sees(layerOf([HALL, overlapping]), EYE, [15, 5])).toBe(false);
  });

  it('cuts nothing for a joint that reaches no boundary at all', () => {
    const inside = joint({ contours: [rect(4, 4, 6, 6)] });
    const before = extractWallSegments([layerOf([HALL, CRYPT])]).length;
    expect(extractWallSegments([layerOf([HALL, CRYPT, inside])])).toHaveLength(before);
  });

  it('leaves the void between two loops void — sight reaches it, nothing stands there', () => {
    // The gap 10..12 is outside both boundaries: an open joint lets sight into it, and it
    // is still not floor. Standability is the mechanics lane's (S2); occlusion says only
    // that nothing here invented ground.
    const layer = layerOf([HALL, CRYPT, joint()]);
    expect(sees(layer, EYE, [11, 5])).toBe(true);
    expect(layer.mergedFloor).toBeNull();
  });
});

// ── O5 — the shipped containment composition still governs ─────────────────
//
// Mirrors containment-contract R1–R9: `live = (full ∩ held) ∪ near`. No new sight rule was
// added at an aperture, so the composition across one is the composition anywhere. `full` is
// the sweep these rows already take; `held` and `near` are set algebra over it.

describe('O5 — containment composition across an open aperture', () => {
  const layer = layerOf([HALL, CRYPT, joint()]);
  const full = (p: [number, number]) => sees(layer, EYE, p);
  const live = (p: [number, number], held: boolean, near: boolean) =>
    (full(p) && held) || near;

  it('shows the next room through the joint only where the DM opened ground', () => {
    expect(live(ACROSS, true, false)).toBe(true);
    expect(live(ACROSS, false, false)).toBe(false);
  });

  it('lets a token at the joint peer its own range in whatever the DM held back', () => {
    expect(live(ACROSS, false, true)).toBe(true);
  });

  it('gives held ground nothing a shut joint would not have given it', () => {
    const shut = layerOf([HALL, CRYPT, joint({ state: 'closed' })]);
    expect(sees(shut, EYE, ACROSS) && true).toBe(false);
  });
});
