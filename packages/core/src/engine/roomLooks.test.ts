// Floors that follow rooms (rooms plan §11.2), on the owner's seven-room cave: which rooms get a
// fill of their own and with what floor, which of a fill's edges blend, the ramp it blends
// through, and where the flat wash between differently textured floors still goes.
import { describe, it, expect, beforeAll } from 'vitest';
import { Container } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { computeMergedFloor } from './mergedFloor';
import { syncRooms } from '../store/roomSync';
import { drawRoomFills, roomCover, roomFillPlan, roomFillsBuilt, seamRamp, faceReach, type RoomFill } from './roomFillRenderer';
import { washStrips } from './edgeTransitions';
import { edgeStyles, roomsOverridingFloor } from '../shared/wallLook';
import { insideRings, rampAlphaAt } from './rampMask';
import { seedPack } from '../testing/seedCatalog';
import { SEVEN_IDS, sevenRoomLayer, type SevenRoomOptions } from '../testing/sevenRooms';
import type { DungeonLayer, MapSettings, ShapeChild } from '../store/types';
import type { Room } from '../shared/types';

beforeAll(async () => {
  const fs = (await import('node:fs' as string)) as { readFileSync(p: string): Uint8Array };
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = fs.readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule((await mod.default({ wasmBinary })) as MainModule);
  const floor = (material: string) => ({ type: 'floor', material, gridSize: '1x1', tags: [] }) as never;
  seedPack('pack', { floor_cave: floor('floor_cave'), floor_stone: floor('floor_stone'), floor_moss: floor('floor_moss'), grass: floor('grass'), dirt: floor('dirt') });
}, 30_000);

const MOSS = 'pack:floor_moss';
const state = { mapSettings: { name: 'M' } as MapSettings, levels: [{ id: 'lvl', name: 'Level 1' }] };

/** The seven-room cave with its union and its rooms' faces, as the editor holds it after a sync. */
function cave(opts: SevenRoomOptions = {}): DungeonLayer {
  const l = sevenRoomLayer(opts);
  const withFloor = { ...l, mergedFloor: computeMergedFloor(l) };
  return { ...withFloor, rooms: syncRooms(withFloor).rooms };
}

/** The cave after the owner changed the first chamber's floor. */
const changed = (opts: SevenRoomOptions = {}) => cave({ textures: [SEVEN_IDS.other], ...opts });

const fillOf = (plan: RoomFill[], id: string) => plan.find((f) => f.room.id === id);
const pinRoom = (i: number, look: Room['look']): Partial<Room>[] => Object.assign([], { [i]: { look } });

describe("a room's floor", () => {
  it('builds no fill on the cave as drawn: every room lies on one texture', () => {
    expect(roomFillPlan(state, cave())).toEqual([]);
    expect(roomFillPlan(state, cave({ blend: false }))).toEqual([]);
    // Drawing them builds nothing either.
    const before = roomFillsBuilt();
    drawRoomFills(new Container(), cave());
    expect(roomFillsBuilt() - before).toBe(0);
  });

  it('with no pin, is the floor its pin stands on: a changed chamber paints its own floor over the passage poking in', () => {
    const plan = roomFillPlan(state, changed());
    // Only the first chamber: the passages and the other chambers each lie on one texture.
    expect(plan.map((f) => f.room.id)).toEqual(['room-1']);
    const f = plan[0];
    expect(f.fill).toEqual({ kind: 'texture', textureId: SEVEN_IDS.other, tint: '#ffffff' });
    // Laid as the first rectangle lays it, so the fill and the floor under it line up.
    expect(f.look).toEqual({ scale: 1, rotation: 0, offsetX: 0, offsetY: 0 });
    expect(f.ground).toBe(false);
    // The passage's overhang cell lies in the face the fill covers.
    expect(insideRings([f.face], [10.5, 7])).toBe(true);
  });

  it('in Sharp, keeps every floor to its own outline: no fill for a room that pins nothing', () => {
    expect(roomFillPlan(state, changed({ blend: false }))).toEqual([]);
  });

  it('with a pin, is the pinned floor, in both modes', () => {
    const look = { floorTextureId: MOSS, floorTint: '#ffffff' };
    for (const blend of [true, false]) {
      const f = fillOf(roomFillPlan(state, cave({ blend, rooms: pinRoom(1, look) })), 'room-2');
      expect(f?.fill).toEqual({ kind: 'texture', textureId: MOSS, tint: '#ffffff' });
      expect(f?.look).toBeNull();
      expect(f?.seams === null).toBe(!blend);
    }
  });

  it('a tint pinned on one floor multiplies over it; over a face of several floors the room takes the tint on its own floor', () => {
    const tint = { floorTint: '#ff0000' };
    expect(fillOf(roomFillPlan(state, cave({ rooms: pinRoom(1, tint) })), 'room-2')?.fill).toEqual({ kind: 'tint', color: 0xff0000 });
    expect(fillOf(roomFillPlan(state, changed({ rooms: pinRoom(0, tint) })), 'room-1')?.fill).toEqual({ kind: 'texture', textureId: SEVEN_IDS.other, tint: '#ff0000' });
  });

  it('a floor of another tint running into the face asks for a fill too', () => {
    const l = cave();
    const tinted = { ...l, children: l.children.map((c) => (c.id === 'floor-2' ? ({ ...c, textureTint: '#80ff80' } as ShapeChild) : c)) };
    expect(roomFillPlan(state, tinted).map((f) => f.room.id)).toEqual(['room-1', 'room-3']);
  });
});

describe('a room on painted ground', () => {
  const ground = (id: string, ring: [number, number][], textureId: string): ShapeChild =>
    ({ id, name: id, childType: 'shape', shapeType: 'rectangle', visible: true, ground: true, contours: [ring], textureId, textureTint: '#ffffff', textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0 }) as unknown as ShapeChild;
  const face: [number, number][] = [[0, 0], [6, 0], [6, 6], [0, 6]];
  const painted = (room: Partial<Room>, children: ShapeChild[] = [ground('g1', face, 'pack:grass'), ground('g2', [[6, 0], [12, 0], [12, 6], [6, 6]], 'pack:dirt')]): DungeonLayer => {
    const l = sevenRoomLayer();
    return { ...l, children, standaloneWalls: [], mergedFloor: [], rooms: [{ id: 'r', name: 'Glade', anchor: [3, 3], face, ...room }] };
  };

  it('paints its pinned floor over the ground, in both modes', () => {
    for (const blend of [true, false]) {
      const l = painted({ look: { floorTextureId: MOSS } });
      const plan = roomFillPlan(state, { ...l, style: { ...l.style, showEdgeTransitions: blend } });
      expect(plan).toHaveLength(1);
      expect(plan[0]).toMatchObject({ ground: true, fill: { kind: 'texture', textureId: MOSS } });
    }
  });

  it('pins nothing, draws nothing; and never paints over bare ground or a picture', () => {
    expect(roomFillPlan(state, painted({}))).toEqual([]);
    expect(roomFillPlan(state, painted({ look: { floorTextureId: MOSS } }, []))).toEqual([]);
  });
});

describe('the seams a fill blends across', () => {
  it("the changed chamber blends where the passages meet it, and stays hard along the cave's outline", () => {
    const f = roomFillPlan(state, changed())[0];
    const xs = (e: [number, number][]) => e.map(([x]) => x);
    const ys = (e: [number, number][]) => e.map(([, y]) => y);
    // Its edges by the door into the first passage and by the mouth of the passage south.
    expect(f.seams!.length).toBeGreaterThan(0);
    for (const s of f.seams!) {
      const byDoor = xs(s).every((x) => x > 10.5 && x <= 11.01) && ys(s).every((y) => y > 5.5 && y < 8.5);
      const bySouth = ys(s).every((y) => y > 12 && y < 12.2);
      expect(byDoor || bySouth, JSON.stringify(s)).toBe(true);
    }
    // Its outer walls are hard edges.
    expect(f.hard.some((e) => xs(e).every((x) => x === 2))).toBe(true);
    expect(f.hard.some((e) => ys(e).every((y) => y === 3))).toBe(true);
    expect(f.under).toEqual([]);
  });

  it('runs on full beneath a later room fading in over it, and that one fades', () => {
    const plan = roomFillPlan(state, changed({ rooms: pinRoom(1, { floorTextureId: MOSS }) }));
    const first = fillOf(plan, 'room-1')!;
    const passage = fillOf(plan, 'room-2')!;
    expect(first.under.length).toBeGreaterThan(0);
    expect(passage.seams!.some((e) => e.every(([x]) => Math.abs(x - 11.41) < 0.01))).toBe(true);
    const reach = faceReach(changed());
    const below = seamRamp(first.face, first, 0.5, reach)!;
    const above = seamRamp(passage.face, passage, 0.5, reach)!;
    // Wherever the passage's fill is not yet full, the chamber's is: a clean cross-fade, nothing of the floor under both.
    for (let x = 10; x <= 12; x += 0.02) {
      const a = rampAlphaAt(above, [x, 7]);
      if (a < 0.999) expect(rampAlphaAt(below, [x, 7]), `x ${x.toFixed(2)}`).toBeCloseTo(1, 3);
    }
  });
});

describe('the ramp at the door', () => {
  it('rises steadily across one blend width from the passage into the chamber, with no steps', () => {
    for (const width of [0.5, 1.1]) {
      const l = changed({ style: { edgeTransitionWidth: width } });
      const f = roomFillPlan(state, l)[0];
      const ramp = seamRamp(f.face, f, width, faceReach(l))!;
      const samples: number[] = [];
      for (let x = 12; x >= 9.5; x -= 0.01) samples.push(rampAlphaAt(ramp, [x, 7]));
      // From nothing in the passage to full in the chamber.
      expect(samples[0]).toBe(0);
      expect(samples[samples.length - 1]).toBe(1);
      let biggest = 0;
      let partial = 0;
      for (let i = 1; i < samples.length; i++) {
        expect(samples[i], `step ${i}`).toBeGreaterThanOrEqual(samples[i - 1] - 1e-6);
        biggest = Math.max(biggest, samples[i] - samples[i - 1]);
        if (samples[i] > 0.02 && samples[i] < 0.98) partial++;
      }
      // A smooth ease: no sample jumps more than a smoothstep this wide can between two hundredths.
      expect(biggest).toBeLessThan((1.6 * 0.01) / width);
      // About one blend width of it is part way.
      expect(partial * 0.01).toBeGreaterThan(width * 0.7);
      expect(partial * 0.01).toBeLessThan(width * 1.05);
      // The passage's overhang cell, clear of the seam, is the chamber's floor.
      expect(rampAlphaAt(ramp, [10.3, 7])).toBe(1);
    }
  });
});

describe("the passage's walls on the cave's own union", () => {
  it("lays the passage's band along its two long sides and the cave set everywhere else", () => {
    const l = cave();
    const styles = edgeStyles(l);
    const ring = l.mergedFloor!.findIndex((r) => r.length > 4);
    const sets = styles[ring]!.map((s, e) => [s.wallTextureSetId, l.mergedFloor![ring][e], l.mergedFloor![ring][(e + 1) % l.mergedFloor![ring].length]] as const);
    const banded = sets.filter(([set]) => set === SEVEN_IDS.band);
    expect(banded).toHaveLength(2);
    for (const [, a, b] of banded) {
      expect(a[1]).toBeCloseTo(b[1], 5);
      expect([6, 8]).toContain(Math.round(a[1]));
      expect(Math.min(a[0], b[0])).toBeCloseTo(11, 5);
      expect(Math.max(a[0], b[0])).toBeCloseTo(15, 5);
    }
    expect(sets.filter(([set]) => set !== SEVEN_IDS.band).every(([set]) => set === SEVEN_IDS.cave)).toBe(true);
  });
});

describe('which rooms override a floor’s walls', () => {
  // As the owner's map holds it: the passage carries its own band and set, and its room pins another set.
  const pinned = (extra: Partial<Room>[] = []) =>
    cave({ rooms: Object.assign([], { 1: { look: { wallTextureSetId: 'Other_Set' } } }, extra) });
  const longSides = (l: DungeonLayer) => {
    const i = l.mergedFloor!.findIndex((r) => r.length > 4);
    const ring = l.mergedFloor![i];
    return edgeStyles(l)[i]!.filter((_, e) => {
      const [a, b] = [ring[e], ring[(e + 1) % ring.length]];
      return Math.abs(a[1] - b[1]) < 1e-6 && [6, 8].includes(Math.round(a[1])) && Math.min(a[0], b[0]) > 10.9 && Math.max(a[0], b[0]) < 15.1;
    }).map((s) => s.wallTextureSetId);
  };

  it("names the passage's room for a pick on the passage floor, and nothing else", () => {
    // Rooms pinned elsewhere: the far chamber, and the chamber the passage opens into.
    const l = pinned(Object.assign([], { 2: { look: { wallTextureSetId: 'Far_Set' } }, 4: { look: { wallTextureSetId: 'Far_Set', wallWidth: 0.8 } } }));
    expect(roomsOverridingFloor(l, 'floor-2', 'wallTextureSetId')).toEqual(['room-2']);
    // The room pins no width: none for a width pick.
    expect(roomsOverridingFloor(l, 'floor-2', 'wallWidth')).toEqual([]);
    // A floor whose own edges no pinned room draws over.
    expect(roomsOverridingFloor(l, 'floor-1', 'wallTextureSetId')).toEqual([]);
    expect(roomsOverridingFloor(cave(), 'floor-2', 'wallTextureSetId')).toEqual([]);
  });

  it("does not name a room whose pin comes from its area", () => {
    const l = cave({ rooms: Object.assign([], { 1: { areaId: 'wing' } }) });
    const withArea = { ...l, areas: [{ id: 'wing', name: 'Wing', look: { wallTextureSetId: 'Other_Set' } }] };
    expect(longSides(withArea)).toEqual(['Other_Set', 'Other_Set']);
    expect(roomsOverridingFloor(withArea, 'floor-2', 'wallTextureSetId')).toEqual([]);
  });

  it("draws the floor's pick on the passage's long sides once the room's pin is gone", () => {
    const l = pinned();
    expect(longSides(l)).toEqual(['Other_Set', 'Other_Set']);
    // The card's pick: a new band on the floor, and the room's own set cleared in the same step.
    const picked = {
      ...l,
      children: l.children.map((c) => (c.id === 'floor-2' ? { ...c, edgeBand: 'Band_C' } : c)),
      rooms: l.rooms!.map((r) => (r.id === 'room-2' ? { ...r, look: undefined } : r)),
    } as DungeonLayer;
    expect(longSides(picked)).toEqual(['Band_C', 'Band_C']);
  });
});

describe('the flat wash', () => {
  const at = (strips: ReturnType<typeof washStrips>, p: [number, number]) => strips.some((s) => insideRings(s.polygons, p));

  it('goes only where no room lies', () => {
    const l = changed();
    // Between the changed chamber and the passages poking into it, with the rooms gone.
    expect(at(washStrips({ ...l, rooms: [] }), [10.5, 7])).toBe(true);
    // With the rooms: none of it inside a room, the door's cut included.
    const cut = washStrips(l, () => roomCover(l));
    for (const p of [[10.5, 7], [10.95, 7], [11.2, 7], [6, 12.1], [6, 12.4]] as [number, number][]) expect(at(cut, p), JSON.stringify(p)).toBe(false);
  });

  it('is never drawn in Sharp', () => {
    expect(washStrips(changed({ blend: false, rooms: [] }))).toEqual([]);
  });
});
