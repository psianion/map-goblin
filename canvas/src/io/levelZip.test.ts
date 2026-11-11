import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import { buildLevelsZip, levelEntryNames, levelsZipName } from './levelZip';

describe('levelZip', () => {
  it('names the zip for the map and each entry for the map and its level', () => {
    expect(levelsZipName('Goblin Warren')).toBe('Goblin-Warren.zip');
    expect(levelsZipName('  ')).toBe('map.zip');
    expect(levelEntryNames('Goblin Warren', ['Ground', 'Lower caves'], 'png')).toEqual([
      'Goblin-Warren-Ground.png',
      'Goblin-Warren-Lower-caves.png',
    ]);
  });

  it('drops the characters a filesystem refuses and keeps every name unique', () => {
    expect(levelEntryNames('A/B', ['Floor: 1?', 'floor 1', 'Floor 1', ''], 'jpeg')).toEqual([
      'A-B-Floor-1.jpeg',
      'A-B-floor-1-2.jpeg',
      'A-B-Floor-1-3.jpeg',
      'A-B-level-4.jpeg',
    ]);
  });

  it('holds one stored entry per level, bytes as given', () => {
    const zip = buildLevelsZip('Warren', 'png', [
      { levelName: 'Ground', bytes: new Uint8Array([1, 2, 3]) },
      { levelName: 'Caves', bytes: new Uint8Array([4, 5]) },
    ]);
    const entries = unzipSync(zip);
    expect(Object.keys(entries)).toEqual(['Warren-Ground.png', 'Warren-Caves.png']);
    expect([...entries['Warren-Caves.png']!]).toEqual([4, 5]);
  });
});
