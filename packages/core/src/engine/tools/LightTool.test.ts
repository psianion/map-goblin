import { describe, it, expect, beforeEach } from 'vitest';
import { LightTool, onLightPlaced } from './LightTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import type { DungeonLayer } from '../../store/types';
import type { AssetChild, LightChild } from '../../shared/types';
import { lightPreset, presetDefaults } from '../../store/lightPresets';

function addAsset(position: { x: number; y: number }): AssetChild {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  const asset: AssetChild = {
    id: crypto.randomUUID(),
    name: 'Lamp',
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'lamp',
    position,
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
  };
  useStore.getState().addChild(l.id, asset);
  return asset;
}

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

function lights(): LightChild[] {
  return layer().children.filter((c): c is LightChild => c.childType === 'light');
}

describe('LightTool', () => {
  let tool: LightTool;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    tool = new LightTool();
  });

  it('places a light at the clicked point on pointer down', () => {
    tool.onPointerDown({ x: 5, y: 8 });
    expect(lights()).toHaveLength(1);
    expect(lights()[0].position).toEqual({ x: 5, y: 8 });
  });

  it('does nothing on pointer up — placement commits on down, not release', () => {
    tool.onPointerDown({ x: 5, y: 8 });
    tool.onPointerUp({ x: 9, y: 9 });
    expect(lights()).toHaveLength(1);
    expect(lights()[0].position).toEqual({ x: 5, y: 8 });
  });

  it('names lights in placement order', () => {
    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerDown({ x: 1, y: 1 });
    const names = lights().map((l) => l.name).sort();
    expect(names).toEqual(['Light 1', 'Light 2']);
  });

  it('places nothing when there is no active dungeon layer', () => {
    useStore.getState().setActiveLayerId('not-a-real-layer-id');
    tool.onPointerDown({ x: 5, y: 8 });
    expect(lights()).toHaveLength(0);
  });

  it('tells onLightPlaced listeners after each light it places, never when it places nothing', () => {
    let calls = 0;
    const stop = onLightPlaced(() => {
      calls++;
      expect(lights()).toHaveLength(calls);
    });
    tool.onPointerDown({ x: 5, y: 8 });
    expect(calls).toBe(1);
    useStore.getState().setActiveLayerId('not-a-real-layer-id');
    tool.onPointerDown({ x: 6, y: 8 });
    expect(calls).toBe(1);
    stop();
  });

  it('picks up the tool defaults from the store', () => {
    useStore.getState().updateLightDefaults({
      color: '#00ff00',
      radius: 12,
      featherRadius: 3,
      intensity: 0.7,
      falloff: 'linear',
    });
    tool.onPointerDown({ x: 5, y: 8 });
    const placed = lights()[0];
    expect(placed.color).toBe('#00ff00');
    expect(placed.radius).toBe(12);
    expect(placed.featherRadius).toBe(3);
    expect(placed.intensity).toBe(0.7);
    expect(placed.falloff).toBe('linear');
  });

  it('is visible and undoable in a single step', () => {
    tool.onPointerDown({ x: 5, y: 8 });
    expect(lights()).toHaveLength(1);

    undoManager.undo();
    expect(lights()).toHaveLength(0);

    undoManager.redo();
    expect(lights()).toHaveLength(1);
  });

  it('offers a circle preview once the cursor has moved, and none before', () => {
    expect(tool.getPreview()).toBeNull();
    tool.onPointerMove({ x: 3, y: 4 });
    expect(tool.getPreview()).toEqual({ type: 'circle', points: [{ x: 3, y: 4 }] });
  });

  it('drops the preview on cancel', () => {
    tool.onPointerMove({ x: 3, y: 4 });
    tool.cancel();
    expect(tool.getPreview()).toBeNull();
  });

  it('clears the preview on Escape', () => {
    tool.onPointerMove({ x: 3, y: 4 });
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tool.getPreview()).toBeNull();
  });

  it('attaches to an asset placed within 0.5 cells of the click', () => {
    const asset = addAsset({ x: 5, y: 5 });
    tool.onPointerDown({ x: 5.3, y: 5 });
    expect(lights()[0].attachedTo).toBe(asset.id);
  });

  it('leaves attachedTo unset when placed away from any asset', () => {
    addAsset({ x: 5, y: 5 });
    tool.onPointerDown({ x: 8, y: 8 });
    expect(lights()[0].attachedTo).toBeUndefined();
  });
});

describe('LightTool: presets (the Lighting pass)', () => {
  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
  });

  it('places a light with every field the picked preset set, and none it did not', () => {
    const settings = useStore.getState().tools.settings;
    useStore.getState().updateToolSettings({
      lightDefaults: { ...settings.lightDefaults, ...presetDefaults(lightPreset('torch')) },
    });
    new LightTool().onPointerDown({ x: 2, y: 2 });
    const placed = lights()[0]!;
    expect(placed).toMatchObject({ radius: 8, featherRadius: 4, color: '#ffb561', animation: { kind: 'flicker', speed: 1 } });
    expect(placed.darkness).toBeUndefined();
    expect('cone' in placed).toBe(false);
  });

  it('places a darkness source from the Darkness preset, in one undo step', () => {
    const settings = useStore.getState().tools.settings;
    useStore.getState().updateToolSettings({
      lightDefaults: { ...settings.lightDefaults, ...presetDefaults(lightPreset('darkness')) },
    });
    new LightTool().onPointerDown({ x: 2, y: 2 });
    expect(lights()[0]).toMatchObject({ darkness: true, radius: 3 });
    undoManager.undo();
    expect(lights()).toHaveLength(0);
  });
});

describe('LightTool: wheel and R size and turn the next light', () => {
  const wheel = (deltaY: number, shiftKey = false) => ({ deltaY, deltaX: 0, shiftKey }) as WheelEvent;
  const key = (k: string, shiftKey = false) => ({ key: k, shiftKey, ctrlKey: false, metaKey: false, altKey: false }) as KeyboardEvent;
  const defaults = () => useStore.getState().tools.settings.lightDefaults;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().updateLightDefaults(presetDefaults(lightPreset('torch'))); // bright 20 ft, dim 40 ft
    useStore.setState((s) => {
      s.mapSettings.cellScale.value = 5;
    });
  });

  it('Wheel up grows bright by 5 ft, Shift+Wheel down shrinks dim by 5 ft, and takes the wheel from the zoom', () => {
    const tool = new LightTool();
    expect(tool.onWheel(wheel(-100))).toBe(true);
    expect(defaults().featherRadius).toBe(5);
    expect(tool.onWheel(wheel(100, true))).toBe(true);
    expect(defaults().radius).toBe(7);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('bright carries dim with it past dim, and both stay inside 5..300 ft', () => {
    const tool = new LightTool();
    useStore.getState().updateLightDefaults({ featherRadius: 8, radius: 8 });
    tool.onWheel(wheel(-100));
    expect([defaults().featherRadius, defaults().radius]).toEqual([9, 9]);
    useStore.getState().updateLightDefaults({ featherRadius: 1, radius: 1 });
    tool.onWheel(wheel(100, true));
    expect([defaults().featherRadius, defaults().radius]).toEqual([1, 1]);
  });

  it('R turns a cone 45° (Shift+R back), owns R over the Rectangle shortcut, and leaves a full circle alone', () => {
    const tool = new LightTool();
    expect(tool.ownsKey(key('r'))).toBe(true);
    expect(tool.ownsKey({ ...key('r'), ctrlKey: true } as KeyboardEvent)).toBe(false);
    tool.onKeyDown(key('r'));
    expect(defaults().cone).toBeUndefined();
    useStore.getState().updateLightDefaults({ cone: { angle: 90, direction: 0 } });
    tool.onKeyDown(key('r'));
    expect(defaults().cone).toEqual({ angle: 90, direction: 45 });
    tool.onKeyDown(key('R', true));
    tool.onKeyDown(key('R', true));
    expect(defaults().cone).toEqual({ angle: 90, direction: 315 });
  });
});
