import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { undoManager } from './undoManager';
import { attachLight, clampLightPatch, detachLight, setLightFields, toggleDarkness } from './lightCommands';
import { LIGHT_PRESETS, LIGHT_RADIUS_FT, lightPreset, presetDefaults } from './lightPresets';
import { migrateToLatest } from './migration';
import { isLayerShown, isOnShownLevel, shownLevelId } from './selectors';
import { createDungeonLayer } from './factories';
import type { LightChild } from '../shared/types';
import type { DungeonLayer } from './types';

const torch = (over: Partial<LightChild> = {}): LightChild => ({
  id: 'torch',
  name: 'Torch',
  childType: 'light',
  visible: true,
  color: '#ffb561',
  radius: 8,
  featherRadius: 4,
  intensity: 0.9,
  falloff: 'quadratic',
  position: { x: 5, y: 5 },
  ...over,
});

let layerId = '';
const now = (): LightChild =>
  (useStore.getState().layers.find((l) => l.id === layerId) as DungeonLayer).children.find(
    (c) => c.id === 'torch',
  ) as LightChild;
const exec = (cmd: ReturnType<typeof setLightFields>) => {
  expect(cmd).not.toBeNull();
  undoManager.execute(cmd!);
};

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
  layerId = useStore.getState().layers.find((l) => l.type === 'dungeon')!.id;
  useStore.getState().addChild(layerId, torch());
});

describe('setLightFields: clamps', () => {
  it('keeps the bright edge inside the dim edge when the dim edge comes in', () => {
    exec(setLightFields('torch', { radius: 2 }));
    expect(now()).toMatchObject({ radius: 2, featherRadius: 2 });
  });

  it('stops the bright edge at the dim edge when it is pushed out', () => {
    exec(setLightFields('torch', { featherRadius: 20 }));
    expect(now().featherRadius).toBe(8);
  });

  it('keeps the cone in 10..360 and wraps the direction', () => {
    expect(clampLightPatch(torch(), { cone: { angle: 2, direction: -90 } }).cone).toEqual({ angle: 10, direction: 270 });
    expect(clampLightPatch(torch(), { cone: { angle: 500, direction: 720 } }).cone).toEqual({ angle: 360, direction: 0 });
  });

  it('keeps the animation speed in 0.25..4', () => {
    expect(clampLightPatch(torch(), { animation: { kind: 'flicker', speed: 9 } }).animation?.speed).toBe(4);
    expect(clampLightPatch(torch(), { animation: { kind: 'pulse', speed: 0 } }).animation?.speed).toBe(0.25);
  });

  it('orders a night-only window and keeps it in 0..1, intensity too', () => {
    expect(clampLightPatch(torch(), { nightOnly: { min: 0.9, max: 0.2 } }).nightOnly).toEqual({ min: 0.2, max: 0.9 });
    expect(clampLightPatch(torch(), { intensity: 3 }).intensity).toBe(1);
  });

  it('is null for a light that does not exist, or an empty patch', () => {
    expect(setLightFields('nope', { radius: 1 })).toBeNull();
    expect(setLightFields('torch', {})).toBeNull();
  });
});

describe('setLightFields: one undo entry per gesture', () => {
  it('undoes the whole edit in one step', () => {
    exec(setLightFields('torch', { radius: 12, color: '#ffffff', cone: { angle: 90, direction: 0 } }));
    expect(now()).toMatchObject({ radius: 12, color: '#ffffff' });
    undoManager.undo();
    expect(now()).toMatchObject({ radius: 8, color: '#ffb561' });
    expect(now().cone).toBeUndefined();
  });

  it('a drag previewed onto the store undoes to where it started, given the start values', () => {
    useStore.getState().updateChild(layerId, 'torch', { radius: 10 });
    useStore.getState().updateChild(layerId, 'torch', { radius: 11 });
    exec(setLightFields('torch', { radius: 12 }, { radius: 8 }));
    expect(now().radius).toBe(12);
    undoManager.undo();
    expect(now().radius).toBe(8);
  });
});

describe('toggleDarkness, attach and detach', () => {
  it('makes a darkness source keeping the radii, and keeps the colour stored but out of play', () => {
    exec(toggleDarkness('torch'));
    expect(now()).toMatchObject({ darkness: true, radius: 8, featherRadius: 4, color: '#ffb561' });
  });

  it('turning it back clears darkvisionSees too, and undo restores in one step', () => {
    exec(toggleDarkness('torch'));
    exec(setLightFields('torch', { darkvisionSees: true }));
    exec(toggleDarkness('torch'));
    expect(now().darkness).toBeUndefined();
    expect(now().darkvisionSees).toBeUndefined();
    undoManager.undo();
    expect(now()).toMatchObject({ darkness: true, darkvisionSees: true });
  });

  it('attaches and detaches, detach being null when nothing is attached', () => {
    expect(detachLight('torch')).toBeNull();
    exec(attachLight('torch', 'brazier'));
    expect(now().attachedTo).toBe('brazier');
    exec(detachLight('torch'));
    expect(now().attachedTo).toBeUndefined();
    undoManager.undo();
    expect(now().attachedTo).toBe('brazier');
  });
});

describe('light presets', () => {
  it('are the six of the plan, in order, the old Daylight dropped', () => {
    expect(LIGHT_PRESETS.map((p) => p.id)).toEqual(['torch', 'lantern', 'candle', 'brazier', 'magical', 'darkness']);
  });

  it('torch is 20/40 ft at 5 ft a cell and flickers', () => {
    expect(lightPreset('torch')).toMatchObject({ bright: 4, dim: 8, color: '#ffb561', intensity: 0.9 });
    expect(lightPreset('torch').animation).toEqual({ kind: 'flicker', speed: 1 });
  });

  it('every preset keeps its bright edge inside its dim edge', () => {
    for (const p of LIGHT_PRESETS) expect(p.bright).toBeLessThanOrEqual(p.dim);
  });

  it('the darkness preset places a darkness source', () => {
    expect(presetDefaults(lightPreset('darkness'))).toMatchObject({ darkness: true, radius: 3, featherRadius: 3 });
  });

  it('a preset shape drops the previous preset’s animation', () => {
    const lantern = presetDefaults(lightPreset('lantern'));
    expect('animation' in lantern).toBe(true);
    expect(lantern.animation).toBeUndefined();
    expect(lantern.presetId).toBe('lantern');
  });

  it('one radius range in feet for every control', () => {
    expect(LIGHT_RADIUS_FT).toEqual({ min: 5, max: 300, step: 5 });
  });
});

describe('migration: maskTextureId retired', () => {
  const withLight = (light: object) => ({
    version: '3.1',
    mapSettings: { name: 'M', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#000000' },
    grid: { visible: true, snapEnabled: true, snapDivision: 2 },
    layers: [{ id: 'l', type: 'dungeon', children: [light] }],
    customImages: {},
  });

  it('drops a light’s mask texture on load', () => {
    const out = migrateToLatest(withLight({ ...torch(), maskTextureId: 'pack:mask' }));
    const light = (out.layers[0] as unknown as { children: Record<string, unknown>[] }).children[0]!;
    expect(light).not.toHaveProperty('maskTextureId');
    expect(light.radius).toBe(8);
  });

  it('leaves a light without one byte-identical', () => {
    const saved = withLight(torch());
    expect(migrateToLatest(saved).layers).toBe(saved.layers);
  });

  it('keeps the new optional light fields through a load, no version bump', () => {
    const saved = withLight({ ...torch(), cone: { angle: 90, direction: 0 }, darkness: true });
    const out = migrateToLatest(saved);
    expect(out.version).toBe('3.1');
    expect((out.layers[0] as unknown as { children: LightChild[] }).children[0]).toMatchObject({ cone: { angle: 90, direction: 0 }, darkness: true });
  });
});

describe('the shown level (scene-graph level filter)', () => {
  it('shows the active level’s layers only', () => {
    const state = useStore.getState();
    const first = state.levels[0]!.id;
    state.addLevel({ id: 'L2', name: 'Two' });
    const upstairs = createDungeonLayer('Upstairs', 'L2');
    useStore.getState().addLayer(upstairs);
    const s = useStore.getState();
    s.setActiveLevelId(first);
    const ground = useStore.getState().layers.find((l) => l.id === layerId)!;
    expect(isLayerShown(useStore.getState(), ground)).toBe(true);
    expect(isLayerShown(useStore.getState(), upstairs)).toBe(false);
    useStore.getState().setActiveLevelId('L2');
    expect(isLayerShown(useStore.getState(), upstairs)).toBe(true);
    expect(isLayerShown(useStore.getState(), ground)).toBe(false);
  });

  it('a layer naming no known level sits on the first; the background is on every level', () => {
    useStore.setState((s) => {
      s.levels.push({ id: 'L2', name: 'Two' });
      s.ui.activeLevelId = 'L2';
    });
    const st = useStore.getState();
    const orphan = { ...createDungeonLayer('Orphan', 'gone') };
    expect(isOnShownLevel(st, orphan)).toBe(false);
    const bg = st.layers.find((l) => l.type === 'background')!;
    expect(isOnShownLevel(st, bg)).toBe(true);
  });

  it('reads an unknown active level as the first, and a one-level map shows everything', () => {
    useStore.setState((s) => {
      s.ui.activeLevelId = 'missing';
    });
    const st = useStore.getState();
    expect(shownLevelId(st)).toBe(st.levels[0]!.id);
    expect(isOnShownLevel(st, createDungeonLayer('Any', 'whatever'))).toBe(true);
  });
});
