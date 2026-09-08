import { describe, it, expect } from 'vitest';
import {
  foundryImagePath,
  foundryPadding,
  isFoundryComposite,
  parseFoundryDb,
  readFoundryScene,
  type FoundryScene,
} from './foundry';

// Trimmed from a real Dungeondraft-made Foundry pack: one wall per code combination
// the pack uses, across three elevation bands, plus two round lights and a cone.
const AXEHOLM: FoundryScene = {
  name: 'Axeholm (fixture)',
  img: 'modules/uchideshi34-doip-maps/map-assets/Axeholm%20v1.01%20(lower)%2047x42%20%40140pps.webp',
  width: 6580,
  height: 5880,
  padding: 0.25,
  grid: 140,
  gridDistance: 5,
  walls: [
    { c: [4620, 5250, 4690, 5250], light: 20, move: 20, sight: 20, dir: 0, door: 0, ds: 0 },
    { c: [3920, 2520, 3920, 2660], light: 20, move: 20, sight: 20, dir: 0, door: 1, ds: 0 },
    { c: [3595, 6048, 3770, 6050], light: 20, move: 20, sight: 20, dir: 0, door: 0, ds: 0, flags: { 'wall-height': { top: 9, bottom: 0 } } },
    { c: [5038, 5180, 5039, 4989], light: 20, move: 20, sight: 20, dir: 0, door: 2, ds: 0, flags: { 'wall-height': { top: 9, bottom: 0 } } },
    { c: [7280, 4585, 7428, 4585], light: 20, move: 20, sight: 20, dir: 0, door: 1, ds: 2, flags: { 'wall-height': { top: 9, bottom: 0 } } },
    { c: [3640, 3920, 3920, 3920], light: 0, move: 0, sight: 0, dir: 0, door: 0, ds: 0, flags: { 'wall-height': { bottom: 10, top: 19 } } },
    { c: [3220, 4803, 2948, 4795], light: 20, move: 20, sight: 20, dir: 0, door: 0, ds: 0, flags: { 'wall-height': { bottom: 10, top: 19 } } },
    { c: [5503, 4585, 5432, 4585], light: 20, move: 20, sight: 20, dir: 1, door: 0, ds: 0, flags: { 'wall-height': { bottom: 0, top: 9 } } },
    { c: [4200, 4480, 4200, 4760], light: 20, move: 20, sight: 20, dir: 0, door: 0, ds: 0, flags: { 'wall-height': { bottom: -10, top: -1 } } },
    { c: [4488, 6623, 4331, 6615], light: 20, move: 20, sight: 20, dir: 0, door: 2, ds: 0, flags: { 'wall-height': { bottom: -10, top: -1 } } },
    { c: [4182, 5022, 4182, 5206], light: 20, move: 20, sight: 20, dir: 0, door: 1, ds: 0, flags: { 'wall-height': { bottom: -10, top: -1 } } },
  ],
  lights: [
    { x: 1960, y: 1680, config: { dim: 40, bright: 20, angle: 0, color: '#eaefca', alpha: 0.025 }, hidden: false },
    { x: 2800, y: 1540, config: { dim: 40, bright: 20, angle: 0, color: null, alpha: 0.025 }, hidden: true },
    { x: 700, y: 700, config: { dim: 10, bright: 5, angle: 90, color: '#ff0000', alpha: 0.5 }, hidden: false },
  ],
  tiles: [{}],
  drawings: [{}],
  tokens: [],
  notes: [],
  flags: {},
};

describe('readFoundryScene', () => {
  const map = readFoundryScene(AXEHOLM, null);

  it('shifts the padding off and divides by the grid', () => {
    expect(foundryPadding(AXEHOLM)).toEqual({ x: 1680, y: 1540 });
    expect(map.size).toEqual({ width: 47, height: 42 });
    expect(map.walls[0]).toEqual({ points: [[21, 26.5], [21.5, 26.5]], wallType: 'normal', direction: 'both' });
  });

  it('keeps the ground band of a multi-floor scene and says how many it skipped', () => {
    expect(map.walls).toHaveLength(3);
    expect(map.walls[2].direction).toBe('left');
    expect(map.warnings).toContain('5 walls on other floors skipped (multi-floor scene)');
  });

  it('turns door walls into doors with state and secrecy', () => {
    expect(map.doors.map((d) => [d.state, d.isSecret, d.archway])).toEqual([
      ['closed', false, false],
      ['closed', true, false],
      ['locked', false, false],
    ]);
    expect(map.doors[0].a).toEqual([16, 7]);
    expect(map.doors[0].b).toEqual([16, 8]);
  });

  it('reads lights in feet, keeps hidden ones hidden, flags cones', () => {
    expect(map.lights).toEqual([
      { x: 2, y: 1, radius: 8, featherRadius: 4, color: '#eaefca', intensity: 0.9, hidden: false },
      { x: 8, y: 0, radius: 8, featherRadius: 4, color: '#ffdd88', intensity: 0.9, hidden: true },
      { x: -7, y: -6, radius: 2, featherRadius: 1, color: '#ff0000', intensity: 0.9, hidden: false },
    ]);
    expect(map.warnings).toContain('1 cone lights imported as full circles');
  });

  it('names what it dropped', () => {
    expect(map.warnings).toContain('not imported: 1 tiles, 1 drawings');
    expect(map.warnings).toContain('no map image — walls only');
  });

  it('maps restriction codes to wall types and drops inert walls on a single floor', () => {
    const scene: FoundryScene = {
      name: ' ',
      width: 200,
      height: 200,
      padding: 0,
      grid: { size: 100, distance: 10 },
      walls: [
        { c: [0, 0, 100, 0], sight: 0, move: 20 },
        { c: [0, 0, 100, 0], sight: 20, move: 0 },
        { c: [0, 0, 100, 0], sight: 10, move: 20 },
        { c: [0, 0, 100, 0], sense: 20, move: 20, flags: { 'wall-height': { top: 9, bottom: 0 } } },
        { c: [0, 0, 100, 0], sight: 0, move: 0 },
        { c: [0, 0, 100, 0], sight: 0, move: 20, door: 1, ds: 1 },
      ],
      lights: [{ x: 100, y: 100, dim: 20, bright: 0, tintColor: '#123456' }],
    };
    const m = readFoundryScene(scene, null);
    expect(m.name).toBe('Imported scene');
    expect(m.walls.map((w) => w.wallType)).toEqual(['invisible', 'ethereal', 'terrain', 'normal']);
    expect(m.warnings).toContain('1 walls that block nothing skipped');
    expect(m.warnings.some((w) => w.includes('other floors'))).toBe(false);
    expect(m.doors[0]).toMatchObject({ archway: true, state: 'open' });
    expect(m.lights[0]).toMatchObject({ x: 1, y: 1, radius: 2, featherRadius: 2, color: '#123456' });
  });
});

describe('compendium helpers', () => {
  it('parses one scene per line and ignores NeDB bookkeeping', () => {
    const text = [
      JSON.stringify({ name: 'A', width: 100, height: 100, walls: [] }),
      '{"$$indexCreated":{"fieldName":"_id"}}',
      'not json',
      JSON.stringify({ name: 'gone', width: 1, height: 1, walls: [], $$deleted: true }),
      JSON.stringify({ name: 'B', width: 100, height: 100, walls: [] }),
    ].join('\n');
    expect(parseFoundryDb(text).map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('resolves the image path relative to the module and decodes it', () => {
    expect(foundryImagePath(AXEHOLM)).toBe('map-assets/Axeholm v1.01 (lower) 47x42 @140pps.webp');
    expect(foundryImagePath({ background: { src: 'worlds/w/maps/a%20b.png' } })).toBe('maps/a b.png');
    expect(foundryImagePath({})).toBeNull();
  });

  it('recognises Levels composites', () => {
    expect(isFoundryComposite(AXEHOLM)).toBe(false);
    expect(isFoundryComposite({ flags: { levels: { sceneLevels: [[0, 9, 'Ground'], [10, 19, 'Upper']] } } })).toBe(true);
  });
});
