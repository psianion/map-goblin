import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { useStore } from './store';
import { undoManager } from './undoManager';
import { createPlacePropsCommand, lightForProp } from './propEdits';
import { toggleLightsOnPropCommand } from './lightCommands';
import { getAssetPackManager, resetAssetPackManager } from '../engine/assetPackInstance';
import { shownAssetOf } from '../engine/subscribeToAssets';
import { familyVariants } from '../assets/packCatalog';
import type { ManifestEntry, PackManifest } from '../engine/assetPackManager';
import type { AssetChild, LightChild } from '../shared/types';
import type { DungeonLayer } from './types';

const entry = (material: string, light?: ManifestEntry['light']): ManifestEntry => ({
  type: 'object',
  material,
  gridSize: '1x1',
  pieceType: 'object',
  variant: 'A',
  set: 'demo-lights',
  tags: ['light'],
  frame: { x: 0, y: 0, w: 200, h: 200 },
  ...(light ? { light } : {}),
});

const CANDLE = { preset: 'candle' as const, states: { on: 'candle_lit', off: 'candle_unlit' } };
const BRAZIER = { preset: 'brazier' as const, states: { off: 'brazier_a', embers: 'brazier_b', on: 'brazier_c' } };

beforeAll(() => {
  resetAssetPackManager();
  const manager = getAssetPackManager();
  const manifest: PackManifest = {
    name: 'gg-demo',
    description: '',
    version: '0.0.1',
    bundleSize: 0,
    atlases: {},
    files: {},
    entries: {
      candle_lit: entry('light_candle_large_lit', CANDLE),
      candle_unlit: entry('light_candle_large_unlit', CANDLE),
      brazier_a: entry('light_brazier_1_a', BRAZIER),
      brazier_b: entry('light_brazier_1_b', BRAZIER),
      brazier_c: entry('light_brazier_1_c', BRAZIER),
      campfire: entry('campfire', { preset: 'brazier' }),
      crate: entry('crate'),
    },
  };
  (manager as unknown as { manifestCache: Map<string, PackManifest> }).manifestCache.set('gg-demo', manifest);
  manager.catalogVersion++;
});

let layerId = '';
beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
  layerId = useStore.getState().layers.find((l) => l.type === 'dungeon')!.id;
});

const prop = (id: string, assetId: string): AssetChild => ({
  id,
  name: id,
  childType: 'asset',
  visible: true,
  objectType: 'asset',
  assetId: `gg-demo:${assetId}`,
  position: { x: 4, y: 6 },
  rotation: 0,
  scale: 1,
  width: 1,
  height: 1,
  tint: '#ffffff',
  flipX: false,
  flipY: false,
});

const children = () => (useStore.getState().layers.find((l) => l.id === layerId) as DungeonLayer).children;
const lightOf = (propId: string) => children().find((c) => c.childType === 'light' && c.attachedTo === propId) as LightChild | undefined;

describe('lightForProp', () => {
  it('makes the preset`s light at the prop`s centre, attached, named after it, in the picture`s state', () => {
    const lit = lightForProp(prop('candle', 'candle_lit'))!;
    expect(lit).toMatchObject({
      childType: 'light',
      name: 'candle',
      attachedTo: 'candle',
      position: { x: 4, y: 6 },
      visible: true,
      color: '#ffc98a',
      radius: 2,
      featherRadius: 1,
      animation: { kind: 'flicker', speed: 1.6 },
    });
    expect(lightForProp(prop('candle', 'candle_unlit'))!.visible).toBe(false);
  });

  it('starts a brazier Off, Embers or On by its picture, and a fixed picture On', () => {
    expect(lightForProp(prop('b', 'brazier_a'))).toMatchObject({ visible: false });
    expect(lightForProp(prop('b', 'brazier_b'))).toMatchObject({ visible: true, embers: true });
    const on = lightForProp(prop('b', 'brazier_c'))!;
    expect(on.visible).toBe(true);
    expect(on.embers).toBeUndefined();
    expect(lightForProp(prop('fire', 'campfire'))).toMatchObject({ visible: true, color: '#ff8e3c' });
  });

  it('brings nothing for a prop that is not a light prop', () => {
    expect(lightForProp(prop('crate', 'crate'))).toBeNull();
  });
});

describe('placing a light prop', () => {
  it('adds prop and light in one undo step, and undo removes both', () => {
    const cmd = createPlacePropsCommand(layerId, [prop('candle', 'candle_lit'), prop('crate', 'crate')], {
      under: false,
      label: 'Place prop and light',
      lights: true,
    });
    undoManager.execute(cmd);
    expect(cmd.label).toBe('Place prop and light');
    expect(children().map((c) => c.childType)).toEqual(['asset', 'asset', 'light']);
    expect(lightOf('candle')?.attachedTo).toBe('candle');
    undoManager.undo();
    expect(children()).toEqual([]);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('adds no light with Add its light off', () => {
    undoManager.execute(createPlacePropsCommand(layerId, [prop('candle', 'candle_lit')], { under: false }));
    expect(lightOf('candle')).toBeUndefined();
  });
});

describe('the picture follows the light', () => {
  it('shows the unlit picture when its light is switched off, and the lit one back on', () => {
    undoManager.execute(createPlacePropsCommand(layerId, [prop('candle', 'candle_lit')], { under: false, lights: true }));
    const placed = () => children().find((c) => c.id === 'candle') as AssetChild;
    expect(shownAssetOf(placed(), useStore.getState().layers)).toBe('gg-demo:candle_lit');
    undoManager.execute(toggleLightsOnPropCommand('candle')!);
    expect(shownAssetOf(placed(), useStore.getState().layers)).toBe('gg-demo:candle_unlit');
    // Nothing is written on the prop itself.
    expect(placed().assetId).toBe('gg-demo:candle_lit');
    undoManager.undo();
    expect(shownAssetOf(placed(), useStore.getState().layers)).toBe('gg-demo:candle_lit');
  });

  it('leaves a prop without states, or without a light, on its own picture', () => {
    const layers = useStore.getState().layers;
    expect(shownAssetOf(prop('crate', 'crate'), layers)).toBe('gg-demo:crate');
    expect(shownAssetOf(prop('candle', 'candle_unlit'), layers)).toBe('gg-demo:candle_unlit');
  });
});

describe('familyVariants: random picks keep a light prop`s state', () => {
  beforeAll(() => {
    const manager = getAssetPackManager();
    const brazier = (n: number, s: string): ManifestEntry => ({
      ...entry(`light_brazier_${n}_${s}`, { preset: 'brazier', states: { off: `b${n}a`, embers: `b${n}b`, on: `b${n}c` } }),
      family: 'light_brazier',
    });
    const entries: Record<string, ManifestEntry> = { crate_1: { ...entry('crate_1'), family: 'crate' }, crate_2: { ...entry('crate_2'), family: 'crate' } };
    for (const n of [1, 2, 3]) for (const s of ['a', 'b', 'c']) entries[`b${n}${s}`] = brazier(n, s);
    const manifest: PackManifest = { name: 'fam', description: '', version: '0.0.1', bundleSize: 0, atlases: {}, files: {}, entries };
    (manager as unknown as { manifestCache: Map<string, PackManifest> }).manifestCache.set('fam', manifest);
    manager.catalogVersion++;
  });

  it('gives a brazier`s three models in the state picked, and a plain family as it is', () => {
    expect(familyVariants('fam:b1b').map((e) => e.id)).toEqual(['fam:b1b', 'fam:b2b', 'fam:b3b']);
    expect(familyVariants('fam:b3a').map((e) => e.id)).toEqual(['fam:b1a', 'fam:b2a', 'fam:b3a']);
    expect(familyVariants('fam:crate_1').map((e) => e.id).sort()).toEqual(['fam:crate_1', 'fam:crate_2']);
  });
});
