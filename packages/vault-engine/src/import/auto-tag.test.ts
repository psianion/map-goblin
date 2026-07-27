import { describe, it, expect } from 'vitest';
import { autoTag, parseFilename } from './auto-tag.js';

describe('parseFilename', () => {
  it('extracts material and variant from "stone-cobble-A.png"', () => {
    const result = parseFilename('stone-cobble-A.png');
    expect(result.material).toBe('stone-cobble');
    expect(result.variant).toBe('A');
  });

  it('extracts material from "wood-oak.png" with no variant', () => {
    const result = parseFilename('wood-oak.png');
    expect(result.material).toBe('wood-oak');
    expect(result.variant).toBe('A');
  });

  it('handles nested paths', () => {
    const result = parseFilename('floors/stone-cobble-B.png');
    expect(result.material).toBe('stone-cobble');
    expect(result.variant).toBe('B');
    expect(result.folder).toBe('floors');
  });
});

describe('autoTag', () => {
  it('generates full metadata from filename + dimensions', () => {
    const result = autoTag({
      filename: 'floors/stone-cobble-A.png',
      width: 200,
      height: 200,
      hasAlpha: false,
      dominantColor: '#7a7a6e',
    });
    expect(result.type).toBe('floor');
    expect(result.material).toBe('stone-cobble');
    expect(result.gridSize).toBe('1x1');
    expect(result.variant).toBe('A');
    expect(result.tint).toBe('#7a7a6e');
  });

  it('computes grid size from dimensions (600x200 = 3x1)', () => {
    const result = autoTag({
      filename: 'walls/stone-brick-A.png',
      width: 600,
      height: 200,
      hasAlpha: false,
      dominantColor: '#888888',
    });
    expect(result.gridSize).toBe('3x1');
  });

  it('assigns tool types based on asset type', () => {
    const floor = autoTag({
      filename: 'f.png',
      width: 200,
      height: 200,
      hasAlpha: false,
      dominantColor: '#000',
    });
    expect(floor.tool).toContain('floor-fill');

    const wall = autoTag({
      filename: 'walls/w.png',
      width: 600,
      height: 200,
      hasAlpha: false,
      dominantColor: '#000',
    });
    expect(wall.tool).toContain('wall');
  });
});
