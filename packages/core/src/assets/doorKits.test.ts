import { describe, it, expect } from 'vitest';
import {
  CAVE_ROCK,
  DOOR_KIT_IDS,
  doorKitById,
  doorKitFor,
  doorKitOf,
  kitWallSet,
  doorOpenAngle,
  hingeDepth,
  kitAt,
  leafPoses,
  leafSlices,
  wallHalfDepth,
  type LeafPose,
} from './doorKits';
import { bandScale } from './packCatalog';

const stone = doorKitFor('GG_Fieldstone')!;
const wood = doorKitFor('GG_Palisade')!;
const cave = doorKitFor('GG_Cave_Ink')!;

/** World point at distance `t` along a posed leaf's centre line. */
function along(p: LeafPose, t: number): [number, number] {
  return [p.origin[0] + Math.cos(p.rotation) * t, p.origin[1] + Math.sin(p.rotation) * t];
}

const close = (a: [number, number], b: [number, number]): void => {
  expect(a[0]).toBeCloseTo(b[0], 9);
  expect(a[1]).toBeCloseTo(b[1], 9);
};

const door = (over: Partial<Parameters<typeof leafPoses>[0]> = {}) => ({
  width: 2,
  style: 'single' as const,
  state: 'open' as const,
  ...over,
});

describe('doorKitFor', () => {
  it('maps each kit wall set to its door kit and nothing else', () => {
    expect(doorKitFor('GG_Fieldstone')?.id).toBe('stone');
    expect(doorKitFor('GG_Palisade')?.id).toBe('wood');
    expect(doorKitFor('GG_Cave_Ink')?.id).toBe('cave');
    expect(doorKitFor('stone-slate')).toBeNull();
    expect(doorKitFor(undefined)).toBeNull();
  });
});

describe('leafSlices', () => {
  it('keeps the caps at their drawn length at every width', () => {
    for (const len of [0.98, 1.98, 3.4, 5.98]) {
      const s = leafSlices(stone, len);
      expect(s[0]).toMatchObject({ piece: 'hinge', x: 0, length: stone.hingeLength });
      expect(s.at(-1)).toMatchObject({ piece: 'latch', length: stone.latchLength });
      const end = s.at(-1)!;
      expect(end.x + end.length).toBeCloseTo(len, 9);
    }
  });

  it('adds tiles as the door widens instead of stretching one', () => {
    const tiles = (len: number) => leafSlices(stone, len).filter((s) => s.piece.startsWith('tile'));
    expect(tiles(0.98)).toHaveLength(1);
    expect(tiles(4.48)).toHaveLength(8);
    for (const t of tiles(4.48)) expect(t.length).toBeCloseTo((4.48 - 0.32) / 8, 9);
  });

  it('alternates the two tile boards and leaves no gap between slices', () => {
    const s = leafSlices(stone, 2.98);
    expect(s.map((p) => p.piece)).toEqual(['hinge', 'tile-a', 'tile-b', 'tile-a', 'tile-b', 'tile-a', 'latch']);
    for (let i = 1; i < s.length; i++) expect(s[i].x).toBeCloseTo(s[i - 1].x + s[i - 1].length, 9);
  });
});

describe('doorOpenAngle', () => {
  it('is shut unless the door is open, and 90 when no angle was ever set', () => {
    expect(doorOpenAngle({ state: 'closed', openAngle: 120 })).toBe(0);
    expect(doorOpenAngle({ state: 'locked' })).toBe(0);
    expect(doorOpenAngle({ state: 'open' })).toBe(90);
    expect(doorOpenAngle({ state: 'open', openAngle: 180 })).toBe(180);
    expect(doorOpenAngle({ state: 'open', openAngle: 400 })).toBe(180);
    expect(doorOpenAngle({ state: 'open', openAngle: -5 })).toBe(0);
  });
});

describe('leafPoses', () => {
  const at: [number, number] = [5, 3];

  it('lays a shut single leaf on the wall centre line across the whole opening', () => {
    const [p] = leafPoses(door({ state: 'closed' }), at, 0, stone, 0.5);
    close(p.origin, [4, 3]);
    close(along(p, p.length), [4 + 2 - 0.02, 3]);
  });

  it('hangs a single door on the end edge when asked, mirrored', () => {
    const [p] = leafPoses(door({ state: 'closed', hinge: 'end' }), at, 0, stone, 0.5);
    close(p.origin, [6, 3]);
    expect(p.flip).toBe(true);
    close(along(p, p.length), [6 - 1.98, 3]);
  });

  it('stands an open leaf square to the wall on the swing side', () => {
    const [p] = leafPoses(door({ openAngle: 90 }), at, 0, stone, 0.5);
    const tip = along(p, p.length);
    expect(tip[1] - 3).toBeGreaterThan(1.9);
    const [q] = leafPoses(door({ openAngle: 90, swing: -1 }), at, 0, stone, 0.5);
    expect(along(q, q.length)[1] - 3).toBeLessThan(-1.9);
  });

  it('folds a leaf at 180 flat against the wall face, never through the wall', () => {
    for (const [kit, wallWidth] of [[stone, 0.5], [stone, 1.2], [wood, 0.5]] as const) {
      const [p] = leafPoses(door({ openAngle: 180 }), at, 0, kit, wallWidth);
      const faceToCentre = wallHalfDepth(kit, wallWidth) + kit.thickness / 2;
      close(p.origin, [4, 3 + faceToCentre]);
      close(along(p, p.length), [4 - p.length, 3 + faceToCentre]);
    }
  });

  /**
   * Every pose of every kit, in the wall's own frame: `u` along the wall from the opening's
   * centre, `v` across it toward the swing side. The hinge end's two corners are the leaf's
   * centre line at its hinge end, plus and minus half a thickness across the leaf.
   */
  describe('keeps the hinge end on the jamb at every angle', () => {
    const wallAngle = 0.7; // a diagonal wall, so nothing leans on an axis
    const dir: [number, number] = [Math.cos(wallAngle), Math.sin(wallAngle)];
    const nrm: [number, number] = [-dir[1], dir[0]];
    const frame = (q: [number, number], side: number): [number, number] => [
      (q[0] - at[0]) * dir[0] + (q[1] - at[1]) * dir[1],
      ((q[0] - at[0]) * nrm[0] + (q[1] - at[1]) * nrm[1]) * side,
    ];
    // The kits that hang on a pin; the cave hangs on its jamb rock (below).
    const cases = [
      ['Fieldstone', stone, 0.5],
      ['Palisade', wood, 0.5],
    ] as const;
    const shapes = [
      { style: 'single', hinge: 'start' },
      { style: 'single', hinge: 'end' },
      { style: 'double', hinge: undefined },
    ] as const;

    for (const [name, kit, wallWidth] of cases) {
      it(name, () => {
        const deep = wallHalfDepth(kit, wallWidth);
        for (const shape of shapes) {
          for (const swing of [1, -1] as const) {
            for (const a of [0, 15, 45, 90, 135, 170, 180]) {
              const width = 2;
              const poses = leafPoses(door({ ...shape, swing, width, openAngle: a }), at, wallAngle, kit, wallWidth);
              poses.forEach((p, i) => {
                const n: [number, number] = [-Math.sin(p.rotation), Math.cos(p.rotation)];
                const corners = [1, -1].map((k) =>
                  frame([p.origin[0] + n[0] * k * kit.thickness / 2, p.origin[1] + n[1] * k * kit.thickness / 2], swing),
                );
                // The jamb this leaf hangs on: the opening's start edge, or its end edge.
                const atEnd = shape.style === 'double' ? i === 1 : shape.hinge === 'end';
                const edgeU = atEnd ? width / 2 : -width / 2;
                const into = atEnd ? -1 : 1; // from the jamb into the opening
                // The pin corner sits on the jamb face, between the leaf's own face and the wall face.
                // (Shut or folded flat, both corners are on it; one of them is the pin.)
                const label = `${name} ${shape.style}/${shape.hinge} swing ${swing} at ${a}`;
                const lo = kit.thickness / 2 - 1e-9;
                const hi = Math.max(deep, kit.thickness / 2) + 1e-9;
                const onJamb = corners.filter((c) => Math.abs(c[0] - edgeU) < 1e-9 && c[1] >= lo && c[1] <= hi);
                expect(onJamb.length, label).toBeGreaterThan(0);
                // Up to square, the whole leaf stays on the opening's side of the jamb face.
                if (a <= 90) {
                  for (const c of corners) expect((c[0] - edgeU) * into).toBeGreaterThanOrEqual(-1e-9);
                  const tip = frame(along(p, p.length), swing);
                  expect((tip[0] - edgeU) * into).toBeGreaterThanOrEqual(-1e-9);
                }
              });
            }
          }
        }
      });
    }
  });

  describe('a cave leaf', () => {
    const w = 1;
    const rock = CAVE_ROCK * bandScale(w);
    const T = kitAt(cave, w).thickness;
    const jc = 0.17 * rock;

    it('is as deep as the rock it hangs in, its caps growing with it and its tiles not', () => {
      expect(T).toBeCloseTo(rock, 9);
      const thin = kitAt(cave, 0.5);
      expect(thin.thickness).toBeCloseTo(CAVE_ROCK * bandScale(0.5), 9);
      expect(thin.hingeLength / thin.thickness).toBeCloseTo(cave.hingeLength / cave.thickness, 9);
      expect(thin.sliceCells / thin.thickness).toBeCloseTo(cave.sliceCells / cave.thickness, 9);
      expect(thin.tileLength).toBe(cave.tileLength);
      expect(kitAt(stone, 0.5)).toBe(stone);
    });

    it('lies shut on the wall line across the opening', () => {
      const [p] = leafPoses(door({ state: 'closed' }), at, 0, cave, w);
      close(p.origin, [4, 3]);
      close(along(p, p.length), [4 + 2 - 0.02, 3]);
    });

    it('stands open square centred on its jamb rock, out of the doorway', () => {
      // The bug this replaced: the leaf stood on the jamb's face, so a rock-deep leaf
      // filled most of a cell of the doorway.
      const [p] = leafPoses(door({ openAngle: 90 }), at, 0, cave, w);
      close(p.origin, [4 - jc, 3 + rock / 2]); // its end at the wall face
      // It reaches a third of the rock's depth past the opening's edge.
      expect(p.origin[0] + T / 2 - 4).toBeCloseTo(0.33 * rock, 9);
      const [q] = leafPoses(door({ openAngle: 90, hinge: 'end' }), at, 0, cave, w);
      close(q.origin, [6 + jc, 3 + rock / 2]);
      expect(q.flip).toBe(true);
    });

    it('folds flat on the wall face at 180, on its swing side', () => {
      for (const swing of [1, -1] as const) {
        const [p] = leafPoses(door({ openAngle: 180, swing }), at, 0, cave, w);
        close(p.origin, [4 - jc - T / 2, 3 + swing * (rock / 2 + T / 2)]);
      }
    });

    it('moves from shut to folded without a jump', () => {
      let last = leafPoses(door({ openAngle: 0 }), at, 0, cave, w)[0].origin;
      for (let a = 5; a <= 180; a += 5) {
        const o = leafPoses(door({ openAngle: a }), at, 0, cave, w)[0].origin;
        expect(Math.hypot(o[0] - last[0], o[1] - last[1])).toBeLessThan(0.05);
        last = o;
      }
    });
  });

  it('eases the pin along the jamb from the leaf face to the wall face', () => {
    expect(hingeDepth(stone, 0.5, 0)).toBeCloseTo(stone.thickness / 2, 9);
    expect(hingeDepth(stone, 0.5, Math.PI)).toBeCloseTo(0.25, 9);
    expect(hingeDepth(stone, 1.2, Math.PI)).toBeCloseTo(wallHalfDepth(stone, 1.2), 9);
    let last = -Infinity;
    for (let a = 0; a <= 180; a += 5) {
      const d = hingeDepth(stone, 1.2, (a * Math.PI) / 180);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
    // A wall thinner than the leaf: the pin stays on the leaf's face.
    expect(hingeDepth(stone, 0.1, Math.PI)).toBeCloseTo(stone.thickness / 2, 9);
  });

  it('opens a double door as two mirrored leaves meeting in the middle', () => {
    const shut = leafPoses(door({ style: 'double', state: 'closed', width: 3 }), at, 0, stone, 0.5);
    expect(shut).toHaveLength(2);
    close(shut[0].origin, [3.5, 3]);
    close(shut[1].origin, [6.5, 3]);
    expect(along(shut[1], shut[1].length)[0] - along(shut[0], shut[0].length)[0]).toBeCloseTo(0.03, 9);

    const open = leafPoses(door({ style: 'double', width: 3, openAngle: 90 }), at, 0, stone, 0.5);
    const l = along(open[0], open[0].length);
    const r = along(open[1], open[1].length);
    expect(l[1]).toBeCloseTo(r[1], 9);
    expect(l[0] - 5).toBeCloseTo(-(r[0] - 5), 9);
  });

  it('follows the wall direction', () => {
    const [p] = leafPoses(door({ state: 'closed' }), at, Math.PI / 2, stone, 0.5);
    close(p.origin, [5, 2]);
    close(along(p, p.length), [5, 2 + 1.98]);
  });
});

describe("a door's own kit", () => {
  it('wins over the wall set, and Auto (absent) follows the wall', () => {
    expect(doorKitOf({ style: 'single', kit: 'wood' }, 'GG_Cave_Ink')).toBe(wood);
    expect(doorKitOf({ style: 'double', kit: 'cave' }, undefined)).toBe(cave);
    expect(doorKitOf({ style: 'single' }, 'GG_Fieldstone')).toBe(stone);
    expect(doorKitOf({ style: 'single' }, 'GG_Plain_Brick')).toBeNull();
  });

  it('builds only singles and doubles, and ignores a kit this build does not know', () => {
    expect(doorKitOf({ style: 'portcullis', kit: 'stone' }, 'GG_Fieldstone')).toBeNull();
    expect(doorKitOf({ style: 'archway' }, 'GG_Cave_Ink')).toBeNull();
    expect(doorKitById('marble')).toBeNull();
    expect(doorKitById('toString')).toBeNull();
    expect(doorKitOf({ style: 'single', kit: 'marble' as never }, 'GG_Palisade')).toBe(wood);
  });

  it('names the set each kit was drawn for, for every kit offered', () => {
    expect(DOOR_KIT_IDS.map((id) => kitWallSet(doorKitById(id)!))).toEqual(['GG_Fieldstone', 'GG_Palisade', 'GG_Cave_Ink']);
  });

  it("takes the wall's depth from the wall's kit, not the door's", () => {
    // Under its smallest width a cave's rock stops shrinking; a stone wall keeps thinning.
    expect(wallHalfDepth(stone, 0.05, cave)).toBeCloseTo(0.075);
    expect(wallHalfDepth(cave, 0.05, stone)).toBeCloseTo(0.025);
    expect(wallHalfDepth(cave, 0.05, null)).toBeCloseTo(0.025);
    // Defaults to the door's own kit, as before.
    expect(wallHalfDepth(cave, 0.05)).toBeCloseTo(0.075);
    // A stone leaf folded flat on a cave wall lies against the rock face.
    const [flat] = leafPoses(door({ openAngle: 180 }), [0, 0], 0, stone, 1, cave);
    expect(Math.abs(flat.origin[1])).toBeCloseTo(0.5 + stone.thickness / 2, 6);
  });

  it('makes a cave wall as deep as its width, like a stone one', () => {
    expect(wallHalfDepth(cave, 0.25)).toBeCloseTo(0.125);
    expect(wallHalfDepth(cave, 0.5)).toBeCloseTo(0.25);
    expect(wallHalfDepth(cave, 1)).toBeCloseTo(0.5);
  });
});
