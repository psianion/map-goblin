import { describe, expect, it } from 'vitest';
import { useStore } from '@/store/store';
import { decodeAnyMapFile, encodeMapFile } from '@/io/mapFormat';
import type { SerializedMapData } from '@/store/types';
import { isMapFile } from './mapFile';
import fieldstoneKeep from '../../../session/testdata/fieldstone-keep.mapbuilder?raw';
import demoDungeon from '../../../session/testdata/demo-dungeon.mapbuilder?raw';
import goblinWarren from '../../../session/testdata/goblin-warren.mapbuilder?raw';

/** The smallest 3.1 document saved the old way: plain JSON, no container. */
const PLAIN_31 = {
  version: '3.1',
  mapSettings: { name: 'Plain Keep', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#000000' },
  grid: { visible: true, snapDivision: 2 },
  layers: [
    {
      id: 'bg',
      name: 'Background',
      type: 'background',
      visible: true,
      locked: false,
      opacity: 1,
      backgroundColor: '#ffffff',
      backgroundTexture: null,
      textureScale: 1,
      textureTint: '#ffffff',
      presetLock: false,
    },
  ],
  customImages: {},
};

/** A Universal VTT export: JSON too, but not one of ours. */
const UVTT = {
  format: 0.3,
  resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 10, y: 8 }, pixels_per_grid: 70 },
  line_of_sight: [],
  portals: [],
  lights: [],
  environment: { baked_lighting: false, ambient_light: 'ffffffff' },
  image: '',
};

const json = (doc: unknown, pretty = true) =>
  new Blob([pretty ? JSON.stringify(doc, null, 1) : JSON.stringify(doc)], { type: 'application/json' });

describe('isMapFile', () => {
  it('accepts the container format', async () => {
    const bytes = encodeMapFile(PLAIN_31 as unknown as SerializedMapData);
    expect(await isMapFile(new Blob([bytes as BlobPart]))).toBe(true);
  });

  it('accepts a plain JSON .mapbuilder (format 3.1)', async () => {
    expect(await isMapFile(json(PLAIN_31))).toBe(true);
    expect(await isMapFile(json({ ...PLAIN_31, version: '3.0' }, false))).toBe(true);
  });

  it('rejects a Universal VTT file', async () => {
    expect(await isMapFile(json(UVTT))).toBe(false);
  });

  it('rejects text and broken JSON', async () => {
    expect(await isMapFile(new Blob(['hello']))).toBe(false);
    expect(await isMapFile(new Blob(['{"version": "3.1", "layers": ['] ))).toBe(false);
    expect(await isMapFile(new Blob([]))).toBe(false);
  });
});

describe('opening a plain JSON map', () => {
  it('decodes and loads through the migration', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(PLAIN_31));
    const data = decodeAnyMapFile(bytes);
    useStore.getState().loadFromFile(data);
    const s = useStore.getState();
    expect(s.mapSettings.name).toBe('Plain Keep');
    expect(s.layers.map((l) => l.id)).toEqual(['bg']);
  });

  it('refuses a Universal VTT body and an unsupported version', () => {
    expect(() => decodeAnyMapFile(new TextEncoder().encode(JSON.stringify(UVTT)))).toThrow(/not a Good Goblin map file/);
    expect(() =>
      decodeAnyMapFile(new TextEncoder().encode(JSON.stringify({ ...PLAIN_31, version: '1.0' }))),
    ).toThrow(/Incompatible file version/);
  });
});

describe('the session test maps', () => {
  it.each([
    ['fieldstone-keep.mapbuilder (3.1)', fieldstoneKeep],
    ['demo-dungeon.mapbuilder (3.0)', demoDungeon],
    ['goblin-warren.mapbuilder', goblinWarren],
  ])('%s is a map file', async (_name, text) => {
    const bytes = new TextEncoder().encode(text);
    expect(await isMapFile(new Blob([bytes]))).toBe(true);
    expect(decodeAnyMapFile(bytes).layers.length).toBeGreaterThan(0);
  });

  it('the goblin warren opens through the loader with its seven rooms named, numbered and on one level', () => {
    useStore.getState().loadFromFile(decodeAnyMapFile(new TextEncoder().encode(goblinWarren)));
    const s = useStore.getState();
    const rooms = s.layers.flatMap((l) => (l.type === 'dungeon' ? (l.rooms ?? []) : []));
    expect(rooms).toHaveLength(7);
    expect(rooms.map((r) => r.number).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(rooms.every((r) => r.name && r.anchor)).toBe(true);
    expect(rooms.map((r) => r.name)).toContain('Warren Hall');
    expect(s.levels).toHaveLength(1);
    expect(s.layers.every((l) => l.levelId === s.levels[0].id)).toBe(true);
    expect(s.mapSettings.roomsVersion).toBe(2);
  });
});

describe('levels in the map file', () => {
  it('gives a file without levels one, named after the map, holding every layer', () => {
    useStore.getState().loadFromFile(decodeAnyMapFile(new TextEncoder().encode(JSON.stringify(PLAIN_31))));
    const s = useStore.getState();
    expect(s.levels).toHaveLength(1);
    expect(s.levels[0].name).toBe('Plain Keep');
    expect(s.layers.every((l) => l.levelId === s.levels[0].id)).toBe(true);
    expect(s.ui.activeLevelId).toBe(s.levels[0].id);
  });

  it('round-trips levels, their looks and the level of each layer through save and open', () => {
    useStore.getState().loadFromFile(decodeAnyMapFile(new TextEncoder().encode(fieldstoneKeep)));
    useStore.getState().addLevel({ id: 'upper', name: 'Upper floor', look: { floorTint: '#aabbcc' } });
    const dungeon = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    useStore.getState().setLayerLevel(dungeon.id, 'upper');
    const saved = useStore.getState().getSerializableState();

    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(decodeAnyMapFile(encodeMapFile(saved)));
    const s = useStore.getState();
    expect(s.levels).toEqual(saved.levels);
    expect(s.levels[1]).toEqual({ id: 'upper', name: 'Upper floor', look: { floorTint: '#aabbcc' } });
    expect(s.layers.find((l) => l.id === dungeon.id)?.levelId).toBe('upper');
    // Rooms come back by their frozen ids and names, with no derived fields in the file.
    const rooms = (s.layers.find((l) => l.id === dungeon.id) as { rooms?: { id: string; face?: unknown }[] }).rooms ?? [];
    expect(rooms).toHaveLength(12);
    expect(rooms.every((r) => r.face === undefined)).toBe(true);
  });
});
