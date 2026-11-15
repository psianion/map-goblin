// Daylight through an open edge: where the bands fall, where they stop, and that sight reads the
// same ground the grade mask draws (`darkTest`).
import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import type { DungeonLayer, MapSettings } from '../store/types';
import type { Room, ThresholdSegment } from './types';
import type { Environment } from './world';
import { skyFrame } from './sky';
import { roomPlace } from './regionGrade';
import { signedArea } from './roomUtils';
import { darkTest } from './visionGate';
import { SPILL_CELLS, SPILL_STEPS, daylightSpill, spillLitArea } from './daylightSpill';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

const room = (id: string, face: [number, number][], place?: Environment): Room => ({
  id,
  name: id,
  anchor: face[0]!,
  face,
  ...(place ? { look: { place } } : {}),
});

const threshold = (id: string, ...points: [number, number][]): ThresholdSegment => ({ id, points });

const layerOf = (rooms: Room[], thresholds: ThresholdSegment[]): DungeonLayer =>
  ({ id: 'd1', type: 'dungeon', children: [], rooms, thresholds }) as unknown as DungeonLayer;

const settings = (environment: Environment): MapSettings => ({ ambientLight: '#808080', environment }) as unknown as MapSettings;
const mapOf = (environment: Environment) => ({ mapSettings: settings(environment) });

/** A cave room on x 0..10, y 0..10 and a mouth on its east side; outdoor ground lies beyond. */
const CAVE = room('cave', rect(0, 0, 10, 10), 'underground');
const MOUTH = threshold('t1', [10, 3], [10, 7]);

const bounds = (rings: [number, number][][]) => {
  const pts = rings.flat();
  return {
    minX: Math.min(...pts.map((p) => p[0])),
    maxX: Math.max(...pts.map((p) => p[0])),
    minY: Math.min(...pts.map((p) => p[1])),
    maxY: Math.max(...pts.map((p) => p[1])),
  };
};
const area = (rings: [number, number][][]) => rings.reduce((s, r) => s + Math.abs(signedArea(r)), 0);

describe('daylightSpill', () => {
  it('puts bands on the cave side of a mouth onto outdoor ground, and nowhere else', () => {
    const spills = daylightSpill(mapOf('outdoor'), [layerOf([CAVE], [MOUTH])], '', { cave: 'underground' });
    expect(spills).toHaveLength(1);
    expect(spills[0]).toMatchObject({ roomId: 'cave', from: 'outdoor' });
    for (const band of spills[0]!.bands) {
      const b = bounds(band);
      expect(b.maxX).toBeLessThanOrEqual(10.01);
      expect(b.minX).toBeGreaterThanOrEqual(10 - SPILL_CELLS - 0.01);
      expect(b.minY).toBeGreaterThanOrEqual(3 - 0.01);
      expect(b.maxY).toBeLessThanOrEqual(7 + 0.01);
    }
  });

  it('reaches SPILL_CELLS into the room in SPILL_STEPS nested bands', () => {
    const [spill] = daylightSpill(mapOf('outdoor'), [layerOf([CAVE], [MOUTH])], '', { cave: 'underground' });
    expect(spill!.bands).toHaveLength(SPILL_STEPS);
    const widths = spill!.bands.map((b) => bounds(b).maxX - bounds(b).minX);
    for (let k = 0; k < SPILL_STEPS; k++) expect(widths[k]).toBeCloseTo((SPILL_CELLS * (k + 1)) / SPILL_STEPS, 1);
    for (let k = 1; k < SPILL_STEPS; k++) expect(area(spill!.bands[k]!)).toBeGreaterThan(area(spill!.bands[k - 1]!));
  });

  it('works the same whichever way the mouth is drawn', () => {
    const flipped = threshold('t1', [10, 7], [10, 3]);
    const [a] = daylightSpill(mapOf('outdoor'), [layerOf([CAVE], [flipped])], '', { cave: 'underground' });
    expect(a).toBeDefined();
    const b = bounds(a!.bands[SPILL_STEPS - 1]!);
    expect(b.maxX).toBeLessThanOrEqual(10.01);
    expect(b.minX).toBeCloseTo(10 - SPILL_CELLS, 1);
  });

  it('is clipped to the room face: a face narrower than the reach, or the mouth, ends the band', () => {
    const shallow = room('cave', rect(9, 4, 10, 6), 'underground');
    const [spill] = daylightSpill(mapOf('outdoor'), [layerOf([shallow], [MOUTH])], '', { cave: 'underground' });
    const b = bounds(spill!.bands[SPILL_STEPS - 1]!);
    expect(b.minX).toBeGreaterThanOrEqual(9 - 0.01);
    expect(b.minY).toBeGreaterThanOrEqual(4 - 0.01);
    expect(b.maxY).toBeLessThanOrEqual(6 + 0.01);
  });

  it('gives none where a wall stands across the opening', () => {
    // The wall cut the face short of the mouth: both sides of the threshold are open ground.
    const walled = room('cave', rect(0, 0, 8, 10), 'underground');
    expect(daylightSpill(mapOf('outdoor'), [layerOf([walled], [MOUTH])], '', { cave: 'underground' })).toEqual([]);
  });

  it('gives none past a wall behind the mouth: a second room beyond a wall gets nothing', () => {
    const beyond = room('beyond', rect(0, 0, 10, 10), 'underground');
    const near = room('near', rect(10, 0, 12, 10), 'underground');
    // The threshold lies between two Underground rooms: same place either side.
    const t = threshold('t', [10, 3], [10, 7]);
    expect(daylightSpill(mapOf('outdoor'), [layerOf([beyond, near], [t])], '', { beyond: 'underground', near: 'underground' })).toEqual([]);
  });

  it('gives none when both sides share a place', () => {
    expect(daylightSpill(mapOf('underground'), [layerOf([CAVE], [MOUTH])], '', { cave: 'underground' })).toEqual([]);
    const lit = room('cave', rect(0, 0, 10, 10), 'outdoor');
    expect(daylightSpill(mapOf('outdoor'), [layerOf([lit], [MOUTH])], '', { cave: 'outdoor' })).toEqual([]);
  });

  it('gives none with no thresholds, however the places differ', () => {
    expect(daylightSpill(mapOf('outdoor'), [layerOf([CAVE], [])], '', { cave: 'underground' })).toEqual([]);
  });

  it('spills only into a room: a lit room beside darker level ground gives none', () => {
    const lit = room('yard', rect(0, 0, 10, 10), 'outdoor');
    expect(daylightSpill(mapOf('underground'), [layerOf([lit], [MOUTH])], '', { yard: 'outdoor' })).toEqual([]);
  });

  it('takes the darker of two rooms across a threshold', () => {
    const bright = room('yard', rect(10, 0, 20, 10), 'outdoor');
    const spills = daylightSpill(mapOf('indoor'), [layerOf([CAVE, bright], [MOUTH])], '', { cave: 'underground', yard: 'outdoor' });
    expect(spills.map((s) => [s.roomId, s.from])).toEqual([['cave', 'outdoor']]);
  });

  it('reads the table’s live room places over the authored ones', () => {
    // Authored Underground; flipped live to Outdoor, it matches the ground and nothing spills.
    expect(daylightSpill(mapOf('outdoor'), [layerOf([CAVE], [MOUTH])], '', { cave: 'outdoor' })).toEqual([]);
  });
});

describe('sight at a mouth (darkTest)', () => {
  const DAY = skyFrame({ environment: 'outdoor', naturalLight: true, time: 'day' });
  const NIGHT = skyFrame({ environment: 'outdoor', naturalLight: true, time: 'night' });
  const map = mapOf('outdoor') as { mapSettings: MapSettings };
  const layers = [layerOf([CAVE], [MOUTH])];

  it('counts the first cell inside the mouth as lit, and deeper cells as dark', () => {
    const test = darkTest(map, layers, '', DAY);
    expect(test.dark(9.5, 5)).toBe(false);
    expect(test.dark(8.5, 5)).toBe(true);
    expect(test.dark(7, 5)).toBe(true);
    expect(test.dark(2, 5)).toBe(true);
    // Beside the mouth, same depth: still dark.
    expect(test.dark(9.5, 1)).toBe(true);
    expect(test.levelDark).toBe(false);
  });

  it('cuts the mouth out of the dark faces and adds it to the lit ones', () => {
    const plain = darkTest(map, [layerOf([CAVE], [])], '', DAY);
    const test = darkTest(map, layers, '', DAY);
    expect(area(test.darkFaces)).toBeLessThan(area(plain.darkFaces));
    expect(area(test.litFaces)).toBeGreaterThan(0);
    expect(area(test.darkFaces) + area(test.litFaces)).toBeCloseTo(area(plain.darkFaces), 0);
  });

  it('is not lit when the bright side is itself dark', () => {
    const night = darkTest(map, layers, '', NIGHT);
    expect(night.levelDark).toBe(true);
    expect(night.dark(9.5, 5)).toBe(true);
    expect(night.litFaces).toEqual([]);
  });

  it('gives the same answer with the spills passed in as computed', () => {
    const places = { cave: roomPlace({ mapSettings: map.mapSettings }, layers[0]!, CAVE) };
    expect(places.cave).toBe('underground');
    const spills = daylightSpill(map, layers, '', places);
    const computed = darkTest(map, layers, '', DAY);
    const given = darkTest(map, layers, '', DAY, {}, spills);
    expect(given.darkFaces).toEqual(computed.darkFaces);
    expect(given.litFaces).toEqual(computed.litFaces);
    for (let x = -1; x < 13; x += 0.5) {
      for (let y = -1; y < 11; y += 0.5) expect(given.dark(x, y), `${x},${y}`).toBe(computed.dark(x, y));
    }
  });

  it('lights exactly the first cell of the spill the grade mask draws', () => {
    const [spill] = daylightSpill(map, layers, '', { cave: 'underground' });
    const lit = bounds(spillLitArea(spill!));
    expect(lit.maxX - lit.minX).toBeCloseTo(SPILL_CELLS / 2, 1);
  });
});
