import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectTool } from './ObjectTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setNotify } from '../../store/notify';
import { createDungeonLayer } from '../../store/factories';
import type { AssetChild, DungeonLayer } from '../../store/types';

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

function layerById(id: string): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.id === id);
  if (!l || l.type !== 'dungeon') throw new Error(`no dungeon layer ${id}`);
  return l;
}

function addAsset(id: string): void {
  const child: AssetChild = {
    id,
    name: 'Asset',
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'stub',
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
  };
  useStore.getState().addChild(layer().id, child);
}

describe('ObjectTool.deleteSelected — layer validation (F3)', () => {
  let tool: ObjectTool;
  let warning: ReturnType<typeof vi.fn<(msg: string) => void>>;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    addAsset('a1');
    useStore.getState().setSelectedIds(['a1']);
    tool = new ObjectTool();
    warning = vi.fn();
    setNotify({ warning, error: vi.fn(), success: vi.fn(), info: vi.fn() });
  });

  it('deletes the selection on an unlocked, visible layer', () => {
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(layer().children).toHaveLength(0);
    expect(warning).not.toHaveBeenCalled();
  });

  it('blocks deletion and warns when the layer is locked', () => {
    // The layers panel's ChildRow can select a child on a locked layer with
    // no lock check of its own — this is the only guard left standing.
    useStore.getState().updateLayer(layer().id, { locked: true });
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(layer().children).toHaveLength(1);
    expect(warning).toHaveBeenCalledWith('Layer is locked');
  });

  it('blocks deletion and warns when the layer is hidden', () => {
    useStore.getState().updateLayer(layer().id, { visible: false });
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(layer().children).toHaveLength(1);
    expect(warning).toHaveBeenCalledWith('Layer is hidden');
  });
});

describe('ObjectTool — move-commit layer capture (F2 sibling)', () => {
  let tool: ObjectTool;
  let warning: ReturnType<typeof vi.fn<(msg: string) => void>>;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    addAsset('a1');
    tool = new ObjectTool();
    warning = vi.fn();
    setNotify({ warning, error: vi.fn(), success: vi.fn(), info: vi.fn() });
  });

  function assetPosition(layerId: string): { x: number; y: number } {
    const a = layerById(layerId).children.find(
      (c): c is AssetChild => c.id === 'a1' && c.childType === 'asset',
    );
    if (!a) throw new Error('a1 missing');
    return a.position;
  }

  it('moves the asset on the layer active when the drag started', () => {
    const a = layer();
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerUp({ x: 3, y: 2 });

    expect(assetPosition(a.id)).toEqual({ x: 3, y: 2 });
    expect(warning).not.toHaveBeenCalled();
  });

  it('commits the move to the layer the drag started on, not one switched to mid-drag', () => {
    const a = layer();
    const b = createDungeonLayer('Layer B');
    useStore.getState().addLayer(b);
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    // Switching to an unlocked, visible layer mid-drag — the pointerDown guard
    // on B would happily pass if this ever went through it again.
    useStore.getState().setActiveLayerId(b.id);
    tool.onPointerUp({ x: 3, y: 2 });

    expect(assetPosition(a.id)).toEqual({ x: 3, y: 2 });
    expect(warning).not.toHaveBeenCalled();
  });

  it('refuses to commit and warns when the moving layer is locked before release', () => {
    const a = layer();
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    // Locked mid-drag — a real DM locking the layer while a drag is live.
    useStore.getState().updateLayer(a.id, { locked: true });
    tool.onPointerUp({ x: 3, y: 2 });

    expect(assetPosition(a.id)).toEqual({ x: 0, y: 0 });
    expect(warning).toHaveBeenCalledWith('Layer is locked');
  });
});
