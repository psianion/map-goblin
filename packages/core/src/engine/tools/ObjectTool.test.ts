import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectTool } from './ObjectTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setNotify } from '../../store/notify';
import type { AssetChild, DungeonLayer } from '../../store/types';

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
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
