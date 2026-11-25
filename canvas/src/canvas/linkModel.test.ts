// What the group outlines, the status hint and Select group read: who is in a group, as the DM
// sees it (a fixed light by its prop), split by the level on show.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getAssetPackManager, resetAssetPackManager } from '@dnd/core/src/engine/assetPackInstance';
import type { ManifestEntry, PackManifest } from '@dnd/core/src/engine/assetPackManager';
import type { MapBuilderStore } from '@/store/types';
import { elsewhereLabel, groupOfChild, groupSelectIds, linkModel, linkSource } from './linkModel';
import { lightPropHover } from '@/editor/families/select/hint';

const prop = (id: string, x: number, assetId = 'gg-demo:candle_lit', extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  childType: 'asset',
  visible: true,
  objectType: 'asset',
  assetId,
  position: { x, y: 0 },
  rotation: 0,
  scale: 1,
  width: 2,
  height: 1,
  tint: '#ffffff',
  flipX: false,
  flipY: false,
  ...extra,
});
const light = (id: string, x: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  childType: 'light',
  visible: true,
  color: '#ffffff',
  radius: 4,
  featherRadius: 2,
  intensity: 1,
  falloff: 'quadratic',
  position: { x, y: 0 },
  ...extra,
});

/** East hall: a chandelier (prop + light), a lantern prop, a free light, and one more on the cellar. */
function map(extraGround: unknown[] = []): MapBuilderStore {
  return {
    levels: [
      { id: 'ground', name: 'Ground' },
      { id: 'cellar', name: 'Cellar' },
    ],
    ui: { activeLevelId: 'ground' },
    selection: { selectedIds: [], hoveredId: null },
    tools: { activeTool: 'select' },
    layers: [
      {
        id: 'g',
        type: 'dungeon',
        levelId: 'ground',
        locked: false,
        children: [
          prop('chandelier', 0),
          light('chandelier-light', 0, { attachedTo: 'chandelier', group: 'East hall' }),
          prop('lantern', 10),
          light('lantern-light', 10, { attachedTo: 'lantern', group: 'East hall' }),
          light('sconce', 20, { group: 'East hall' }),
          prop('crate', 30),
          ...extraGround,
        ],
      },
      { id: 'c', type: 'dungeon', levelId: 'cellar', locked: false, children: [light('down', 5, { group: 'East hall' })] },
    ],
  } as unknown as MapBuilderStore;
}

beforeAll(() => {
  resetAssetPackManager();
  const manager = getAssetPackManager();
  const entry = (material: string, light?: ManifestEntry['light']): ManifestEntry => ({
    type: 'object',
    material,
    gridSize: '1x1',
    pieceType: 'object',
    variant: 'A',
    tags: [],
    ...(light ? { light } : {}),
  });
  const manifest: PackManifest = {
    name: 'gg-demo',
    description: '',
    version: '0.0.1',
    bundleSize: 0,
    atlases: {},
    files: {},
    entries: {
      candle_lit: entry('light_candle_large_lit', { preset: 'candle', states: { on: 'candle_lit', off: 'candle_unlit' } }),
      brazier_c: entry('light_brazier_1_c', { preset: 'brazier', states: { off: 'brazier_a', embers: 'brazier_b', on: 'brazier_c' } }),
    },
  };
  (manager as unknown as { manifestCache: Map<string, PackManifest> }).manifestCache.set('gg-demo', manifest);
  manager.catalogVersion++;
});

describe('linkModel', () => {
  it('from a selected prop: the other members, a fixed light by its prop, other levels counted', () => {
    const m = linkModel(map(), 'chandelier')!;
    expect(m.group).toBe('East hall');
    expect(m.lights).toBe(4);
    expect(m.shown.map((o) => [o.kind, o.id])).toEqual([
      ['prop', 'lantern'],
      ['light', 'sconce'],
    ]);
    expect(m.elsewhere).toBe(1);
    expect(elsewhereLabel(m.elsewhere)).toBe('+1 on other level');
  });

  it('from a fixed light: its own prop is not outlined', () => {
    expect(linkModel(map(), 'chandelier-light')!.shown.map((o) => o.id)).toEqual(['lantern', 'sconce']);
  });

  it('from a free light: every prop of the group outlined', () => {
    expect(linkModel(map(), 'sconce')!.shown.map((o) => o.id)).toEqual(['chandelier', 'lantern']);
  });

  it('nothing for a prop or light in no group', () => {
    expect(linkModel(map(), 'crate')).toBeNull();
    expect(groupOfChild(map().layers, 'crate')).toBeUndefined();
  });

  it('Select group picks the group\'s lights, every member: fixed ones too, on any level', () => {
    expect(groupSelectIds(map().layers, 'East hall')).toEqual(['chandelier-light', 'lantern-light', 'sconce', 'down']);
  });

  it('speaks for the one selected thing, else the one hovered with Select', () => {
    const s = map();
    expect(linkSource({ ...s, selection: { selectedIds: ['a'], hoveredId: 'b' } } as unknown as MapBuilderStore)).toEqual({ id: 'a', hover: false });
    expect(linkSource({ ...s, selection: { selectedIds: [], hoveredId: 'b' } } as unknown as MapBuilderStore)).toEqual({ id: 'b', hover: true });
    expect(linkSource({ ...s, selection: { selectedIds: [], hoveredId: 'b' }, tools: { activeTool: 'light' } } as unknown as MapBuilderStore)).toBeNull();
  });
});

describe('the double-click hint over a light or a prop with lights', () => {
  let s: MapBuilderStore;
  beforeEach(() => {
    s = map([prop('brazier', 40, 'gg-demo:brazier_c'), light('brazier-light', 40, { attachedTo: 'brazier' })]);
  });
  const hover = (id: string, st = s) => lightPropHover({ ...st, selection: { selectedIds: [], hoveredId: id } } as unknown as MapBuilderStore)?.segments[0]?.text;

  it('names the group and how many lights it switches', () => {
    expect(hover('chandelier')).toBe('Double-click to switch East hall, 4 lights');
    expect(hover('sconce')).toBe('Double-click to switch East hall, 4 lights');
  });

  it('says its light for one in no group, with Embers for a brazier', () => {
    expect(hover('brazier')).toBe('Double-click to switch, Embers on the card');
  });

  it('says Locked over a locked prop, and nothing over a prop with no light', () => {
    const locked = map([prop('held', 50, 'gg-demo:candle_lit', { locked: true }), light('held-light', 50, { attachedTo: 'held' })]);
    expect(hover('held', locked)).toBe('Locked');
    expect(hover('crate')).toBeUndefined();
  });
});
