// The stone sprite pool. Layout itself is wallLayout.test.ts's job — what is
// checkable here is that a rebuild reuses the sprites already in the container
// instead of destroying every stone and allocating a fresh one, which on a drag
// happened for every wall on the map, every frame.

import { describe, it, expect, vi } from 'vitest';

vi.mock('pixi.js', () => {
  class MockContainer {
    label = '';
    destroyed = false;
    alpha = 1;
    visible = true;
    children: MockContainer[] = [];
    addChild(...cs: MockContainer[]): MockContainer {
      this.children.push(...cs);
      return cs[0];
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
  class MockGraphics extends MockContainer {
    ops: string[] = [];
    moveTo(): this {
      this.ops.push('move');
      return this;
    }
    lineTo(): this {
      this.ops.push('line');
      return this;
    }
    clear(): this {
      this.ops = [];
      return this;
    }
    stroke(): this {
      this.ops.push('stroke');
      return this;
    }
  }
  return { Container: MockContainer, Sprite: MockSprite, Graphics: MockGraphics };
});

vi.mock('../assets/textureLoader', () => ({
  resolveTexture: (id: string) => ({ id, width: 200, height: 200 }),
  load: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../assets/packCatalog', () => ({
  isBandSet: () => false,
  getBandSet: () => [],
  bandSetArt: () => new Map(),
  GRID_CELL_PX: 200,
  getWallPieces: (_set: string, piece: string) =>
    piece === 'straight'
      ? [{ id: 'straight-a', naturalWidth: 200, naturalHeight: 200, contentRect: { x: 0, y: 0, w: 200, h: 60 }, tags: [] }]
      : [],
}));

import { Container } from 'pixi.js';
import { authoredWallMarks, renderNodeWalls, withoutDoorGaps, WALL_MARK_ALPHA, type DoorGap } from './wallNodeRenderer';
import { layoutWall, pieceWorldLength } from './wallLayout';
import type { WallNode, WallPieceSpec } from './wallLayout';
import type { DungeonStyle, WallSegment } from '../store/types';
import type { Polygon } from '../types/geometry';

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

type Spr = { tint: number; scale: { x: number; y: number }; position: { x: number; y: number } };
const sprites = (c: Container) => c.children as unknown as Spr[];
const typed = (id: string, wallType: WallSegment['wallType'], y = 0): WallSegment =>
  ({ id, points: [[0, y], [10, y]], wallType }) as WallSegment;

describe('renderNodeWalls — look pins', () => {
  it('a wall without a width takes the layer width, so it moves with it', () => {
    const own = render([wall('w1', 10)]);
    const bare = render([{ id: 'w1', points: [[0, 0], [10, 0]] } as WallSegment]);
    expect(sprites(bare).map((s) => s.scale.y)).toEqual(sprites(own).map((s) => s.scale.y));
    const thick = new Container();
    renderNodeWalls(thick, [], [{ id: 'w1', points: [[0, 0], [10, 0]] } as WallSegment], { ...style, wallWidth: 0.8 });
    expect(sprites(thick)[0].scale.y).toBeCloseTo(sprites(bare)[0].scale.y * 2);
  });

  it('an empty set pin keeps a wall bare on a layer with stones', () => {
    const c = render([{ ...wall('w1', 10), textureSetId: '' }]);
    expect(c.children).toHaveLength(0);
  });

  it('each floor ring draws with its own style: a pinned floor keeps its tint and width', () => {
    const ring = (x: number): Polygon => [[x, 0], [x + 6, 0], [x + 6, 6], [x, 6]];
    const c = new Container();
    const pinned = { ...style, wallTextureTint: '#b09878', wallWidth: 0.8 } as DungeonStyle;
    renderNodeWalls(c, [ring(0), ring(20)], [], { ...style, wallTextureTint: '#ffffff' }, [], {}, {
      ringStyles: [pinned, { ...style, wallTextureTint: '#ffffff' }],
    });
    const left = sprites(c).filter((s) => s.position.x < 10);
    const right = sprites(c).filter((s) => s.position.x > 10);
    expect(new Set(left.map((s) => s.tint))).toEqual(new Set([0xb09878]));
    expect(new Set(right.map((s) => s.tint))).toEqual(new Set([0xffffff]));
    expect(Math.max(...left.map((s) => s.scale.y))).toBeGreaterThan(Math.max(...right.map((s) => s.scale.y)));
  });
});

describe('renderNodeWalls — per-edge styles (a room pins its walls)', () => {
  // A 12×6 ring: edges 0 top, 1 right, 2 bottom, 3 left.
  const ring: Polygon = [[0, 0], [12, 0], [12, 6], [0, 6]];
  const base = { ...style, wallTextureTint: '#ffffff' } as DungeonStyle;
  type Pos = { tint: number; position: { x: number; y: number }; scale: { y: number } };
  const laid = (c: Container) => (c.children as unknown as Pos[]).map((s) => ({ x: s.position.x, y: s.position.y, tint: s.tint, sy: s.scale.y }));

  it('a ring with null edges lays out exactly as without the option', () => {
    const plain = new Container();
    renderNodeWalls(plain, [ring], [], base, [], {}, { ringStyles: [base] });
    const nulled = new Container();
    renderNodeWalls(nulled, [ring], [], base, [], {}, { ringStyles: [base], edgeStyles: [null] });
    expect(laid(nulled)).toEqual(laid(plain));
  });

  it('a tint pinned on some edges keeps the ring layout and tints only their stones', () => {
    const plain = new Container();
    renderNodeWalls(plain, [ring], [], base, [], {}, { ringStyles: [base] });
    const green = { ...base, wallTextureTint: '#00ff00' } as DungeonStyle;
    const c = new Container();
    renderNodeWalls(c, [ring], [], base, [], {}, { ringStyles: [base], edgeStyles: [[green, base, base, base]] });
    const pos = (l: ReturnType<typeof laid>) => l.map(({ x, y }) => `${x.toFixed(3)},${y.toFixed(3)}`).sort();
    // Same stones, same places.
    expect(pos(laid(c))).toEqual(pos(laid(plain)));
    const top = laid(c).filter((s) => s.y < 0.5 && s.x > 1 && s.x < 11);
    const bottom = laid(c).filter((s) => s.y > 5.5 && s.x > 1 && s.x < 11);
    expect(top.length).toBeGreaterThan(0);
    expect(new Set(top.map((s) => s.tint))).toEqual(new Set([0x00ff00]));
    expect(new Set(bottom.map((s) => s.tint))).toEqual(new Set([0xffffff]));
  });

  it('a width pinned on some edges lays those edges as their own run at that width', () => {
    const wide = { ...base, wallWidth: 0.8 } as DungeonStyle;
    const c = new Container();
    renderNodeWalls(c, [ring], [], base, [], {}, { ringStyles: [base], edgeStyles: [[wide, base, base, base]] });
    const top = laid(c).filter((s) => s.y < 0.5 && s.x > 1 && s.x < 11);
    const bottom = laid(c).filter((s) => s.y > 5.5 && s.x > 1 && s.x < 11);
    expect(top.length).toBeGreaterThan(0);
    expect(bottom.length).toBeGreaterThan(0);
    expect(Math.max(...top.map((s) => s.sy))).toBeGreaterThan(Math.max(...bottom.map((s) => s.sy)));
  });

  it('an edge pinned to no set draws no stones there', () => {
    const bare = { ...base, wallTextureSetId: '' } as DungeonStyle;
    const c = new Container();
    renderNodeWalls(c, [ring], [], base, [], {}, { ringStyles: [base], edgeStyles: [[bare, base, base, base]] });
    expect(laid(c).filter((s) => s.y < 0.5 && s.x > 2 && s.x < 10)).toHaveLength(0);
    expect(laid(c).filter((s) => s.y > 5.5 && s.x > 2 && s.x < 10).length).toBeGreaterThan(0);
  });
});

describe('renderNodeWalls — editor marks for walls that let light through', () => {
  const lines = (marks: Container) => marks.children[2] as unknown as { ops: string[]; visible: boolean };

  it('without a marks container every wall draws in the walls container as authored', () => {
    const c = new Container();
    renderNodeWalls(c, [], [typed('a', 'normal'), typed('b', 'window', 2), typed('c', 'invisible', 4)], style);
    const one = new Container();
    renderNodeWalls(one, [], [typed('a', 'normal')], style);
    expect(c.children.length).toBe(one.children.length * 3);
  });

  it('a window draws lighter, an open wall lighter still and dashed, a solid one as before', () => {
    const c = new Container();
    const marks = new Container();
    renderNodeWalls(c, [], [typed('a', 'normal'), typed('b', 'window', 2), typed('c', 'terrain', 4)], style, [], {}, {
      marks,
    });
    const [win, open] = marks.children as Container[];
    expect(c.children.length).toBeGreaterThan(0);
    expect(win.children.length).toBe(c.children.length);
    expect(open.children.length).toBe(c.children.length);
    expect(win.alpha).toBe(WALL_MARK_ALPHA.window);
    expect(open.alpha).toBe(WALL_MARK_ALPHA.open);
    expect(WALL_MARK_ALPHA.open).toBeLessThan(WALL_MARK_ALPHA.window);
    // Ten cells at 0.3 on, 0.2 off is twenty dashes along the open wall only.
    expect(lines(marks).ops.filter((o) => o === 'move')).toHaveLength(20);
  });

  it('ethereal reads as solid and invisible as open, the way light treats them', () => {
    const c = new Container();
    const marks = new Container();
    renderNodeWalls(c, [], [typed('a', 'ethereal'), typed('b', 'invisible', 2)], style, [], {}, { marks });
    const [win, open] = marks.children as Container[];
    expect(win.children).toHaveLength(0);
    expect(open.children.length).toBe(c.children.length);
  });

  it('dashes an open wall even with no stones to lighten', () => {
    const marks = new Container();
    renderNodeWalls(new Container(), [], [typed('b', 'invisible')], { ...style, wallTextureSetId: '' }, [], {}, {
      marks,
    });
    expect(lines(marks).ops).toContain('line');
  });

  it('holds the authored look for an export and puts the marks back after', () => {
    const marks = new Container();
    renderNodeWalls(new Container(), [], [typed('b', 'window'), typed('c', 'invisible', 2)], style, [], {}, { marks });
    const [win, open] = marks.children as Container[];
    const release = authoredWallMarks(marks);
    expect([win.alpha, open.alpha, lines(marks).visible]).toEqual([1, 1, false]);
    release();
    expect([win.alpha, open.alpha, lines(marks).visible]).toEqual([WALL_MARK_ALPHA.window, WALL_MARK_ALPHA.open, true]);
  });

  it('turning a window back to solid moves its stones out of the marks', () => {
    const c = new Container();
    const marks = new Container();
    renderNodeWalls(c, [], [typed('b', 'window')], style, [], {}, { marks });
    const n = (marks.children[0] as Container).children.length;
    renderNodeWalls(c, [], [typed('b', 'normal')], style, [], {}, { marks });
    expect((marks.children[0] as Container).children).toHaveLength(0);
    expect(c.children).toHaveLength(n);
  });
});

// The pool has to survive the transition that opens a doorway: the second pass
// lays out fewer stones than the first, and the ones it does lay out land at
// different indices. A stone left behind inside the opening is the e2e's
// "doorway is clear of stones" row failing.
describe('renderNodeWalls — door gaps through the pool', () => {
  const ROOM: Polygon = [
    [-6, 0],
    [6, 0],
    [6, 8],
    [-6, 8],
  ];
  const GAP = { wallId: 'floor:0:0', position: [1, 0] as [number, number], width: 3, ring: 0 };

  const inGap = (c: Container): unknown[] =>
    c.children.filter((s) => {
      const p = (s as unknown as { position: { x: number; y: number } }).position;
      return Math.hypot(p.x - GAP.position[0], p.y - GAP.position[1]) < GAP.width / 2;
    });

  it('leaves no stone in the opening when a door is added to an already-drawn ring', () => {
    const container = new Container();
    renderNodeWalls(container, [ROOM], [], style);
    expect(inGap(container).length).toBeGreaterThan(0); // stones run through it

    renderNodeWalls(container, [ROOM], [], style, [GAP]);
    expect(inGap(container)).toHaveLength(0);
  });

  it('leaves no stone behind when the opening moves', () => {
    const container = new Container();
    renderNodeWalls(container, [ROOM], [], style, [{ ...GAP, position: [-3, 0] }]);
    renderNodeWalls(container, [ROOM], [], style, [GAP]);
    expect(inGap(container)).toHaveLength(0);
  });

  // A door as wide as its wall. It was already pixel-perfect
  // under the old centre-radius cull, so the new cut must not disturb it.
  it('still clears the whole edge when the opening is the full wall', () => {
    const container = new Container();
    renderNodeWalls(container, [], [wall('w1', 10)], style, [
      { wallId: 'w1', position: [5, 0], width: 10 },
    ]);
    const onEdge = container.children.filter((s) => {
      const p = (s as unknown as { position: { x: number; y: number } }).position;
      return Math.abs(p.y) < 0.5 && p.x > 0 && p.x < 10;
    });
    expect(onEdge).toHaveLength(0);
  });
});

/**
 * The cut itself. A door narrower than its wall used to lose a whole stone for a
 * sliver of overlap — up to a stone of dead wall on each side of every opening —
 * because the old rule only asked whether a stone's CENTRE was inside the door.
 *
 * Numbers are chosen to be exact: at wallWidth 0.5 the piece below is
 * `100 * (0.5 / 50)` = 1 world unit long, so its half-length is 0.5.
 */
describe('withoutDoorGaps', () => {
  const WALL_WIDTH = 0.5;
  const SPEC: WallPieceSpec = { id: 'p', role: 'straight', lengthPx: 100, thicknessPx: 50 };
  const SPECS = new Map([[SPEC.id, SPEC]]);
  const HALF_LENGTH = 0.5;

  /** A stone lying along +x at `x`. */
  const stone = (x: number, y = 0, angle = 0): WallNode =>
    ({ t: 0.25, x, y, angle, pieceId: 'p', scale: 1, sizeScale: 1, kind: 'straight' });

  /** A two-unit opening centred on the origin: it spans x -1..1. */
  const gap = { wallId: 'w1', position: [0, 0] as [number, number], width: 2 };

  const cut = (nodes: WallNode[]) => withoutDoorGaps(nodes, [gap], SPECS, WALL_WIDTH);

  it('drops a stone sitting inside the opening', () => {
    expect(cut([stone(0.2)])).toHaveLength(0);
  });

  it('leaves a stone clear of the opening exactly as it was', () => {
    const clear = stone(3);
    const out = cut([clear]);
    // Same object, not a copy: nothing about it changed.
    expect(out).toEqual([clear]);
    expect(out[0]).toBe(clear);
  });

  it('slides a clipped stone out by exactly its overlap', () => {
    // Centre at 1.3, so the stone spans 0.8..1.8 and the opening eats 0.2 of it.
    const clipped = stone(1.3);
    const [moved] = cut([clipped]);
    expect(moved.x).toBeCloseTo(1.5);
    // Its inner edge now lands on the opening's edge, not inside it.
    expect(moved.x - HALF_LENGTH).toBeCloseTo(gap.width / 2);
    expect(moved.y).toBeCloseTo(0);
    // The input is shared with the overlay and `t` anchors every hand edit.
    expect(clipped.x).toBe(1.3);
    expect(moved.t).toBe(clipped.t);
  });

  it('slides the stone on the other side the other way', () => {
    const [moved] = cut([stone(-1.3)]);
    expect(moved.x).toBeCloseTo(-1.5);
  });

  it('ignores an opening that belongs to a different edge', () => {
    // Projects onto this stone's axis at along = 0, but sits two units off it.
    const other = stone(0, 2);
    expect(cut([other])).toEqual([other]);
  });
});

/**
 * The cut against real stone, on a real layout.
 *
 * stone-slate's straights are 600, 400, 200 and 100 px of content over a 61px
 * band, so at the default 0.5-cell wall width they are 4.92, 3.28, 1.75 and 0.94
 * CELLS long. The longest is more than half a nine-cell wall, which is the whole
 * problem: a door on that wall almost never lands between two stones, it lands
 * inside one. Treating that stone as a unit that has to end up wholly outside
 * the opening throws away the two or three cells of it that were covering the
 * wall on the far side.
 */
describe('withoutDoorGaps — a door that lands inside a stone', () => {
  const WALL_WIDTH = 0.5;
  const LENGTH = 9;
  const SLATE: WallPieceSpec[] = [
    { id: 'straight-a', role: 'straight', lengthPx: 600, thicknessPx: 61 },
    { id: 'straight-b', role: 'straight', lengthPx: 400, thicknessPx: 61 },
    { id: 'straight-c', role: 'straight', lengthPx: 200, thicknessPx: 57 },
    { id: 'straight-d', role: 'straight', lengthPx: 100, thicknessPx: 53 },
    { id: 'ending-a', role: 'ending', lengthPx: 200, thicknessPx: 61 },
  ];
  const BY_ID = new Map(SLATE.map((s) => [s.id, s]));

  /** The art director's repro: one straight nine-cell wall, laid out for real. */
  const laid = (): WallNode[] =>
    layoutWall([[0, 0], [LENGTH, 0]], false, SLATE, { wallWidth: WALL_WIDTH, seed: 1 });

  const door = (x: number, width = 1): DoorGap =>
    ({ wallId: 'w1', position: [x, 0], width });

  const cut = (gaps: DoorGap[], nodes = laid()): WallNode[] =>
    withoutDoorGaps(nodes, gaps, BY_ID, WALL_WIDTH, [[0, 0], [LENGTH, 0]]);

  /** What each stone actually paints on the wall's axis, `[start, end]`. */
  const span = (n: WallNode): [number, number] => {
    const s = BY_ID.get(n.pieceId)!;
    const half = (pieceWorldLength(s, WALL_WIDTH) * n.scale * n.sizeScale) / 2;
    return [n.x - half, n.x + half];
  };

  /** Stretches of `[from, to]` no stone covers — bare floor where wall belongs. */
  function bare(nodes: WallNode[], from: number, to: number): [number, number][] {
    const spans = nodes.map(span).sort((a, b) => a[0] - b[0]);
    const out: [number, number][] = [];
    let cursor = from;
    for (const [a, b] of spans) {
      if (cursor >= to) break;
      if (a > cursor + 1e-6) out.push([cursor, Math.min(a, to)]);
      if (b > cursor) cursor = b;
    }
    if (cursor < to - 1e-6) out.push([cursor, to]);
    return out;
  }

  it('leaves no bare floor between the wall start and a door two cells along', () => {
    const out = cut([door(2)]);
    expect(bare(out, 0, 1.5)).toEqual([]);
    expect(bare(out, 2.5, LENGTH)).toEqual([]);
  });

  it('leaves no bare floor between a door and the wall end', () => {
    const out = cut([door(7)]);
    expect(bare(out, 7.5, LENGTH)).toEqual([]);
    expect(bare(out, 0, 6.5)).toEqual([]);
  });

  it('keeps the run trapped between two doors and no stone off the end', () => {
    const out = cut([door(2), door(6)]);
    expect(bare(out, 2.5, 5.5)).toEqual([]);
    // The orphan cobble: nothing may be pushed past either end of the wall.
    expect(out.every((n) => n.x >= -1e-6 && n.x <= LENGTH + 1e-6)).toBe(true);
  });

  it('strands nothing outside the wall when the door is the whole wall', () => {
    // A door filling the whole edge. The end caps sit ON the ends, so a rule that only
    // knows how to slide a clipped stone outward slides them off the wall.
    expect(cut([door(LENGTH / 2, LENGTH)])).toEqual([]);
  });

  it('puts nothing inside the opening', () => {
    for (const [a, b] of cut([door(2)]).map(span)) {
      // Every stone sits wholly on one side of the opening or the other.
      expect(b <= 1.5 + 1e-6 || a >= 2.5 - 1e-6).toBe(true);
    }
  });

  /** What fraction of its own natural length a stone is actually drawn at. */
  const frac = (n: WallNode): number => n.scale * n.sizeScale;

  it('fills a short run with few stones near their natural length', () => {
    // A door at 7 leaves 7.5..9 — a cell and a half, less than a third of the
    // longest straight. Squeezing that straight onto it drew one stone at 0.30
    // of its natural length, and every stone reaching the run drew its own
    // full-run copy on top: a picket fence of hairline slivers with doubled ink
    // outlines. The run wants smaller stones, not a thinner one.
    const out = cut([door(7)]);
    const inRun = out.filter((n) => {
      const [a, b] = span(n);
      return b > 7.5 + 1e-6 && a < 9 - 1e-6;
    });

    expect(bare(out, 7.5, 9)).toEqual([]);
    // A cell and a half of stone-slate is two of its smallest straights, not
    // fourteen slivers.
    expect(inRun.length).toBeLessThanOrEqual(4);
    expect(inRun.length).toBeGreaterThan(0);
    for (const n of inRun) {
      // MIN_FIT_FRAC. Below this a stone stops reading as masonry.
      expect(frac(n)).toBeGreaterThanOrEqual(0.65);
    }
  });

  it('never slides a stone across a second door further along', () => {
    // A run is bounded by every opening on the wall, not only the ones already
    // cutting the stone. Bounded by the near door alone, a stone clipped at 2.5
    // slid flush and ran on to 9 — straight over the door at 6.
    const openings: [number, number][] = [[1.5, 2.5], [5.5, 6.5]];
    for (const [a, b] of cut([door(2), door(6)]).map(span)) {
      for (const [lo, hi] of openings) {
        expect(b <= lo + 1e-6 || a >= hi - 1e-6).toBe(true);
      }
    }
  });

  it('leaves the end caps on the wall ends when a door is elsewhere', () => {
    // Caps straddle their endpoint on purpose. Bounding their runs by a distant
    // door must not slide them inboard.
    const capsBefore = laid().filter((n) => n.pieceId === 'ending-a');
    const capsAfter = cut([door(4.5)]).filter((n) => n.pieceId === 'ending-a');
    expect(capsAfter.map((n) => n.x).sort((p, q) => p - q))
      .toEqual(capsBefore.map((n) => n.x).sort((p, q) => p - q));
  });
});
