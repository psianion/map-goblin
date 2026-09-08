import { describe, it, expect } from 'vitest';
import { filesFromList, findImageFile, scanFiles } from './importFolder';

const scene = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  width: 700,
  height: 420,
  padding: 0,
  grid: 70,
  gridDistance: 5,
  img: 'modules/pack/map-assets/Cellar%20v1.webp',
  thumb: 'data:image/png;base64,AAAA',
  walls: [
    { c: [0, 0, 70, 0], sight: 20, move: 20, door: 0 },
    { c: [70, 0, 140, 0], sight: 20, move: 20, door: 1, ds: 0 },
  ],
  lights: [{ x: 35, y: 35, config: { dim: 10, bright: 5 } }],
  ...extra,
});

function file(path: string, body: string): [string, File] {
  return [path, new File([body], path.slice(path.lastIndexOf('/') + 1), { type: 'text/plain' })];
}

describe('scanFiles', () => {
  it('lists every scene in a compendium with counts, thumb, image status and composite flag', async () => {
    const db = [
      JSON.stringify(scene('Cellar')),
      JSON.stringify(scene('Cellar (levels)', { flags: { levels: { sceneLevels: [[0, 9, 'a'], [10, 19, 'b']] } } })),
    ].join('\n');
    const files = new Map<string, File>([
      file('pack/packs/maps.db', db),
      ['pack/map-assets/Cellar v1.webp', new File(['x'], 'Cellar v1.webp', { type: 'image/webp' })],
    ]);
    const rows = await scanFiles(files);
    expect(rows.map((r) => [r.name, r.kind, r.composite, r.imageStatus])).toEqual([
      ['Cellar', 'foundry', false, 'found'],
      ['Cellar (levels)', 'foundry', true, 'found'],
    ]);
    expect(rows[0].size).toEqual({ width: 10, height: 6 });
    expect(rows[0].counts).toEqual({ walls: 1, doors: 1, lights: 1 });
    expect(rows[0].thumb).toBe('data:image/png;base64,AAAA');
    expect(rows[0].sourcePath).toBe('pack/packs/maps.db');
  });

  it('reads a per-scene JSON export and marks a missing image', async () => {
    const rows = await scanFiles(new Map([file('Cellar.json', JSON.stringify(scene('Solo')))]));
    expect(rows).toHaveLength(1);
    expect(rows[0].imageStatus).toBe('missing');
    expect(rows[0].warnings).toContain('no map image — walls only');
  });

  it('reads a UVTT file with its embedded image and names it after the file', async () => {
    const uvtt = {
      resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 4, y: 4 }, pixels_per_grid: 50 },
      line_of_sight: [[{ x: 0, y: 0 }, { x: 4, y: 0 }]],
      portals: [],
      lights: [],
      image: 'iVBORw0KGgo=',
    };
    const rows = await scanFiles(new Map([file('maps/Old Mill.dd2vtt', JSON.stringify(uvtt))]));
    expect(rows[0]).toMatchObject({ name: 'Old Mill', kind: 'uvtt', imageStatus: 'embedded', counts: { walls: 1, doors: 0, lights: 0 } });
    expect(rows[0].thumb).toBe('data:image/png;base64,iVBORw0KGgo=');
    const loaded = await rows[0].load();
    expect(loaded.image?.pxPerCell).toBe(50);
  });

  it('skips files that are not maps or not JSON', async () => {
    const rows = await scanFiles(
      new Map([file('a.json', '{"hello":1}'), file('b.json', 'nope'), file('readme.txt', '{}'), file('c.uvtt', '{"resolution":{}}')]),
    );
    expect(rows).toEqual([]);
  });
});

describe('findImageFile', () => {
  const files = new Map<string, File>([
    ['root/map-assets/A.webp', new File([], 'A.webp')],
    ['other/B.webp', new File([], 'B.webp')],
  ]);
  it('matches by exact path, then suffix, then bare name', () => {
    expect(findImageFile(files, 'root/map-assets/A.webp')?.name).toBe('A.webp');
    expect(findImageFile(files, 'map-assets/A.webp')?.name).toBe('A.webp');
    expect(findImageFile(files, 'assets/B.webp')?.name).toBe('B.webp');
    expect(findImageFile(files, 'C.webp')).toBeNull();
    expect(findImageFile(files, null)).toBeNull();
  });
});

describe('filesFromList', () => {
  it('keys files by their relative path with forward slashes', () => {
    const f = new File([], 'x.db') as File & { webkitRelativePath: string };
    Object.defineProperty(f, 'webkitRelativePath', { value: 'pack\\packs\\x.db' });
    const plain = new File([], 'y.json');
    expect([...filesFromList([f, plain]).keys()]).toEqual(['pack/packs/x.db', 'y.json']);
  });
});
