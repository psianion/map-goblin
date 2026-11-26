// The editor's prop-light rows as data: the dock's Add its light line, the prop card's Light
// section, lit before unlit in the library, the room's Lights row, a new motion, the sweep
// handles, and the Select hover hint.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getAssetPackManager, resetAssetPackManager } from '@dnd/core/src/engine/assetPackInstance';
import type { ManifestEntry, PackManifest } from '@dnd/core/src/engine/assetPackManager';
import { useStore } from '@/store/store';
import type { AssetChild, DungeonLayer, LightChild, MapBuilderStore } from '@/store/types';
import { addLightNote, propLightView, showsLight, variantTiles } from './propLightModel';
import { formatValue } from '@/editor/surfaces/model';
import { RANDOM, variantPosition, variantStep } from './variant';
import { litBeforeUnlit } from '@/editor/surfaces/assetModel';
import { roomLightsSummary } from '@/editor/models/roomModel';
import { motionFor, motionKindOf } from '@/editor/families/environment/lightModel';
import { dragPatch, handleAt, handlePoints, lightOverlayModel } from '@/canvas/lightOverlay';
import { lightPropHover } from '@/editor/families/select/hint';

const CANDLE = { preset: 'candle' as const, states: { on: 'candle_lit', off: 'candle_unlit' } };
const BRAZIER = { preset: 'brazier' as const, states: { off: 'brazier_a', embers: 'brazier_b', on: 'brazier_c' } };

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

const prop = (id: string, assetId: string): AssetChild => ({
  id,
  name: id,
  childType: 'asset',
  visible: true,
  objectType: 'asset',
  assetId: `gg-demo:${assetId}`,
  position: { x: 5, y: 5 },
  rotation: 0,
  scale: 1,
  width: 1,
  height: 1,
  tint: '#ffffff',
  flipX: false,
  flipY: false,
});

const light = (id: string, over: Partial<LightChild> = {}): LightChild => ({
  id,
  name: id,
  childType: 'light',
  visible: true,
  color: '#ffffff',
  radius: 4,
  featherRadius: 2,
  intensity: 1,
  falloff: 'quadratic',
  position: { x: 5, y: 5 },
  ...over,
});

const layersWith = (children: unknown[]) => [{ id: 'l', type: 'dungeon', levelId: '', locked: false, children }] as unknown as DungeonLayer[];

describe('Add its light', () => {
  it('names the light and how it starts, from the first light prop in hand', () => {
    expect(addLightNote(['gg-demo:candle_lit'])).toBe('Candle light, starts on');
    expect(addLightNote(['gg-demo:crate', 'gg-demo:brazier_a'])).toBe('Brazier light, starts off');
    expect(addLightNote(['gg-demo:brazier_b'])).toBe('Brazier light, starts as embers');
    expect(addLightNote(['gg-demo:campfire'])).toBe('Brazier light, starts on');
  });

  it('is hidden when nothing in hand brings a light', () => {
    expect(addLightNote(['gg-demo:crate'])).toBeNull();
    expect(addLightNote([])).toBeNull();
  });

  it('has no em or en dash in what it says', () => {
    for (const id of ['candle_lit', 'brazier_a', 'brazier_b', 'campfire']) expect(addLightNote([`gg-demo:${id}`])).not.toMatch(/[–—]/);
  });
});

describe('the prop card`s Light section', () => {
  it('shows for a light prop or a prop with a light attached, not for a plain prop', () => {
    const layers = layersWith([prop('c', 'candle_lit'), prop('crate', 'crate'), prop('boxed', 'crate'), light('x', { attachedTo: 'boxed' })]);
    expect(showsLight(layers, prop('c', 'candle_lit'))).toBe(true);
    expect(showsLight(layers, prop('crate', 'crate'))).toBe(false);
    expect(showsLight(layers, prop('boxed', 'crate'))).toBe(true);
  });

  it('reads the shared state, mixed across props, and the props that still need a light', () => {
    const layers = layersWith([
      prop('a', 'brazier_c'),
      prop('b', 'brazier_c'),
      prop('bare', 'candle_lit'),
      light('la', { attachedTo: 'a', embers: true }),
      light('lb', { attachedTo: 'b' }),
    ]);
    const one = propLightView(layers, [prop('a', 'brazier_c')]);
    expect(one.state).toBe('embers');
    expect(one.states?.embers).toBe('gg-demo:brazier_b');
    const both = propLightView(layers, [prop('a', 'brazier_c'), prop('b', 'brazier_c')]);
    expect(both.state).toBe('mixed');
    expect(propLightView(layers, [prop('bare', 'candle_lit')]).bare.map((p) => p.id)).toEqual(['bare']);
  });
});

describe('library order', () => {
  it('puts each unlit tile right after its lit one', () => {
    const tiles = [{ id: 'gg-demo:candle_unlit' }, { id: 'gg-demo:crate' }, { id: 'gg-demo:candle_lit' }];
    expect(litBeforeUnlit(tiles).map((t) => t.id)).toEqual(['gg-demo:crate', 'gg-demo:candle_lit', 'gg-demo:candle_unlit']);
    // An unlit tile whose lit one is not listed stays where it is.
    expect(litBeforeUnlit([{ id: 'gg-demo:candle_unlit' }]).map((t) => t.id)).toEqual(['gg-demo:candle_unlit']);
  });
});

describe('the room`s Lights row', () => {
  it('counts the lights and the ones on, and says when it is mixed', () => {
    expect(roomLightsSummary([{ visible: true }, { visible: false }, { visible: true }])).toEqual({ label: '3 lights, 2 on', state: 'mixed' });
    expect(roomLightsSummary([{ visible: true }])).toEqual({ label: '1 light, 1 on', state: 'on' });
    expect(roomLightsSummary([{ visible: false }, { visible: false }]).state).toBe('off');
  });
});

describe('motion on the light card', () => {
  it('starts a spin clockwise at 6 rpm and a sweep 45 degrees either side of the direction', () => {
    const l = { cone: { angle: 60, direction: 90 } };
    expect(motionFor('spin', l)).toEqual({ kind: 'spin', rpm: 6, clockwise: true });
    expect(motionFor('sweep', l)).toEqual({ kind: 'sweep', from: 45, to: 135, degPerSec: 45 });
    expect(motionFor('still', l)).toBeUndefined();
    expect(motionKindOf({})).toBe('still');
  });

  it('keeps a motion of the same kind as it is', () => {
    const motion = { kind: 'spin' as const, rpm: 20, clockwise: false };
    expect(motionFor('spin', { cone: { angle: 60, direction: 0 }, motion })).toBe(motion);
  });
});

describe('sweep handles on the map', () => {
  const sweeping = light('s', {
    position: { x: 0, y: 0 },
    radius: 10,
    cone: { angle: 60, direction: 0 },
    motion: { kind: 'sweep', from: 0, to: 90, degPerSec: 45 },
  });

  it('puts the two edges on the dim ring and hides the direction knob', () => {
    useStore.getState().resetToDefault();
    const layerId = useStore.getState().layers.find((l) => l.type === 'dungeon')!.id;
    useStore.getState().addChild(layerId, sweeping);
    useStore.getState().setSelectedIds(['s']);
    const sel = lightOverlayModel(useStore.getState() as MapBuilderStore).selected!;
    expect(sel.sweep).toEqual({ from: 0, to: 90 });
    const h = handlePoints(sel, 20);
    expect(h.knob).toBeNull();
    expect(h.from!.x).toBeCloseTo(10);
    expect(h.to!.y).toBeCloseTo(10);
    expect(handleAt(sel, { x: 0, y: 10 }, 20)).toBe('to');
  });

  it('drags an edge in whole degrees, and Shift snaps it to 15', () => {
    const p = { x: Math.cos((37 * Math.PI) / 180), y: Math.sin((37 * Math.PI) / 180) };
    expect(dragPatch(sweeping, 'to', p, 5).motion).toMatchObject({ to: 37, from: 0 });
    expect(dragPatch(sweeping, 'to', p, 5, true).motion).toMatchObject({ to: 30 });
  });
});

describe('the Select hint over a light prop', () => {
  beforeEach(() => useStore.getState().resetToDefault());

  const withHover = (children: unknown[], id: string) =>
    ({ layers: layersWith(children), selection: { hoveredId: id, selectedIds: [] } }) as unknown as MapBuilderStore;

  it('says what double-click does, and names Embers for a brazier', () => {
    expect(lightPropHover(withHover([prop('c', 'candle_lit'), light('x', { attachedTo: 'c' })], 'c'))?.segments[0]!.text).toBe(
      'Double-click to switch its light',
    );
    expect(lightPropHover(withHover([prop('b', 'brazier_c'), light('x', { attachedTo: 'b' })], 'b'))?.segments[0]!.text).toBe(
      'Double-click to switch, Embers on the card',
    );
  });

  it('says nothing over a prop with no light', () => {
    expect(lightPropHover(withHover([prop('c', 'candle_lit')], 'c'))).toBeNull();
  });
});

describe('Variant tiles on a light prop', () => {
  beforeAll(() => {
    const manager = getAssetPackManager();
    const brazier = (n: number, s: string): ManifestEntry => ({
      type: 'object',
      material: `light_brazier_${n}_${s}`,
      gridSize: '1x1',
      pieceType: 'object',
      variant: 'A',
      tags: [],
      family: 'light_brazier',
      light: { preset: 'brazier', states: { off: `b${n}a`, embers: `b${n}b`, on: `b${n}c` } },
    });
    const entries: Record<string, ManifestEntry> = {};
    for (const n of [1, 2, 3]) for (const s of ['a', 'b', 'c']) entries[`b${n}${s}`] = brazier(n, s);
    const manifest: PackManifest = { name: 'fam', description: '', version: '0.0.1', bundleSize: 0, atlases: {}, files: {}, entries };
    (manager as unknown as { manifestCache: Map<string, PackManifest> }).manifestCache.set('fam', manifest);
    manager.catalogVersion++;
  });

  it('offers one tile per brazier, each in the state the prop shows now', () => {
    expect(variantTiles('fam:b1c').map((e) => e.id)).toEqual(['fam:b1c', 'fam:b2c', 'fam:b3c']);
    expect(variantTiles('fam:b2a').map((e) => e.id)).toEqual(['fam:b1a', 'fam:b2a', 'fam:b3a']);
  });

  it('leaves a family of plain props as it is', () => {
    expect(variantTiles('gg-demo:crate').map((e) => e.id)).toEqual(['gg-demo:crate']);
  });
});

describe('readouts', () => {
  it('puts degrees on the number and other units after a space', () => {
    const meta = (unit: string) => ({ range: { min: 0, max: 360, step: 1, unit } }) as never;
    expect(formatValue(meta('°/s'), 45)).toBe('45°/s');
    expect(formatValue(meta('°'), 60)).toBe('60°');
    expect(formatValue(meta('rpm'), 30)).toBe('30 rpm');
  });
});

describe('the dock Variant stepper on a light prop', () => {
  it('counts models, not pictures, and keeps the picked state', () => {
    expect(variantPosition('fam:b2b')).toEqual({ index: 2, count: 3 });
    expect(variantStep('fam:b2b', 'fam:b2b', 1)).toBe('fam:b3b');
    expect(variantStep('fam:b2b', 'fam:b2b', -1)).toBe('fam:b1b');
    expect(variantStep('fam:b3b', 'fam:b3b', 1)).toBe(RANDOM);
    expect(variantStep('fam:b1b', RANDOM, 1)).toBe('fam:b1b');
  });
});
