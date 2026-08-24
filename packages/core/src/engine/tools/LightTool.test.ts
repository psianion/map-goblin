import { describe, it, expect, beforeEach } from 'vitest';
import { LightTool } from './LightTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import type { DungeonLayer } from '../../store/types';
import type { AssetChild, LightChild } from '../../shared/types';

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
