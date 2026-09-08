import { describe, it, expect } from 'vitest';
import { readUvtt, uvttColor } from './uvtt';

const FILE = {
  format: 0.3,
  resolution: { map_origin: { x: 1, y: 1 }, map_size: { x: 4, y: 3 }, pixels_per_grid: 100 },
  line_of_sight: [
    [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 4 }],
    [{ x: 1, y: 4 }],
  ],
  objects_line_of_sight: [[{ x: 2, y: 2 }, { x: 3, y: 2 }]],
  portals: [
    { position: { x: 3, y: 1 }, bounds: [{ x: 2.5, y: 1 }, { x: 3.5, y: 1 }], rotation: 0, closed: true, freestanding: false },
    { position: { x: 3, y: 4 }, bounds: [{ x: 2.5, y: 4 }, { x: 3.5, y: 4 }], rotation: 0, closed: false, freestanding: false },
    { position: { x: 2, y: 2 }, bounds: [{ x: 2, y: 2 }, { x: 2, y: 3 }], rotation: 0, closed: true, freestanding: true },
  ],
  lights: [
    { position: { x: 3, y: 2.5 }, range: 4, intensity: 1.5, color: 'ffaabbcc', shadows: true },
    { position: { x: 1, y: 1 }, range: 0, intensity: 1, color: 'ff000000', shadows: true },
  ],
  environment: { baked_lighting: true, ambient_light: 'ffffffff' },
  image: 'iVBORw0KGgo=',
};

describe('readUvtt', () => {
  const map = readUvtt(FILE, 'Cellar');

  it('subtracts the origin and keeps polylines with two or more points', () => {
    expect(map.size).toEqual({ width: 4, height: 3 });
    expect(map.walls.map((w) => w.points)).toEqual([
      [[0, 0], [4, 0], [4, 3]],
      [[1, 1], [2, 1]],
    ]);
    expect(map.walls.every((w) => w.wallType === 'normal' && w.direction === 'both')).toBe(true);
    expect(map.warnings).toContain('1 object outlines imported as walls');
  });

  it('turns portals into doors and skips freestanding ones', () => {
    expect(map.doors).toEqual([
      { a: [1.5, 0], b: [2.5, 0], state: 'closed', isSecret: false, archway: false },
      { a: [1.5, 3], b: [2.5, 3], state: 'open', isSecret: false, archway: false },
    ]);
    expect(map.warnings).toContain('1 freestanding portals skipped');
  });

  it('reads lights in squares, clamps intensity, strips the alpha byte off the colour', () => {
    expect(map.lights).toEqual([
      { x: 2, y: 1.5, radius: 4, featherRadius: 2, color: '#aabbcc', intensity: 1, hidden: false },
    ]);
  });

  it('wraps the embedded image as a data URL sized from the grid', () => {
    expect(map.image).toEqual({
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      width: 400,
      height: 300,
      pxPerCell: 100,
    });
    expect(map.warnings).toContain('lighting is baked into the image');
  });

  it('takes the ambient colour from the file and reads a missing one as lit', () => {
    expect(map.ambientLight).toBe('#ffffff');
    expect(readUvtt({ ...FILE, environment: { ambient_light: 'ff334455' } }, 'x').ambientLight).toBe('#334455');
    expect(readUvtt({ ...FILE, environment: undefined }, 'x').ambientLight).toBe('#ffffff');
  });

  it('refuses a file with no size', () => {
    expect(() => readUvtt({}, 'x')).toThrow(/map_size/);
  });
});

describe('uvttColor', () => {
  it('accepts 6 and 8 digit hex, with or without a hash', () => {
    expect(uvttColor('#AABBCC')).toBe('#aabbcc');
    expect(uvttColor('ff112233')).toBe('#112233');
    expect(uvttColor('nope')).toBe('#ffdd88');
    expect(uvttColor(undefined)).toBe('#ffdd88');
  });
});
