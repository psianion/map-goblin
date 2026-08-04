import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WallTool } from './WallTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setNotify } from '../../store/notify';
import { createDungeonLayer } from '../../store/factories';
import type { DungeonLayer } from '../../store/types';

function layerById(id: string): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.id === id);
  if (!l || l.type !== 'dungeon') throw new Error(`no dungeon layer ${id}`);
  return l;
}

describe('WallTool — chain-finalize layer validation (F1)', () => {
  let tool: WallTool;
  let warning: ReturnType<typeof vi.fn<(msg: string) => void>>;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    warning = vi.fn();
    setNotify({ warning, error: vi.fn(), success: vi.fn(), info: vi.fn() });
    tool = new WallTool();
  });

  it('commits the chain to the layer active when it was drawn', () => {
    const a = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerDown({ x: 5, y: 0 });
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(layerById(a.id).standaloneWalls).toHaveLength(1);
    expect(warning).not.toHaveBeenCalled();
  });

  it('refuses to commit and warns when the drawing layer is locked before Enter', () => {
    const a = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerDown({ x: 5, y: 0 });
    // Locked mid-chain — a real DM locking the layer while a chain is live.
    useStore.getState().updateLayer(a.id, { locked: true });
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(layerById(a.id).standaloneWalls).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith('Layer is locked');
  });

  it('refuses to commit and warns when the drawing layer is hidden before Enter', () => {
    const a = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerDown({ x: 5, y: 0 });
    useStore.getState().updateLayer(a.id, { visible: false });
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(layerById(a.id).standaloneWalls).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith('Layer is hidden');
  });

  it('warns "Layer was removed" when the drawing layer is deleted before Enter', () => {
    const b = createDungeonLayer('Layer B');
    useStore.getState().addLayer(b);
    useStore.getState().setActiveLayerId(b.id);

    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerDown({ x: 5, y: 0 });
    useStore.getState().removeLayer(b.id);
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(warning).toHaveBeenCalledWith('Layer was removed');
  });

  it('commits to the layer the chain started on, not one switched to mid-chain', () => {
    const a = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    const b = createDungeonLayer('Layer B');
    useStore.getState().addLayer(b);
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerDown({ x: 5, y: 0 });
    // Switching to an unlocked, visible layer mid-chain — the pointerDown
    // guard on B would happily pass if this ever went through it again.
    useStore.getState().setActiveLayerId(b.id);
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(layerById(a.id).standaloneWalls).toHaveLength(1);
    expect(layerById(b.id).standaloneWalls).toHaveLength(0);
    expect(warning).not.toHaveBeenCalled();
  });

  it('double-click commit inherits the same captured-layer validation', () => {
    const a = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerDown({ x: 5, y: 0 });
    useStore.getState().updateLayer(a.id, { locked: true });
    // Double-click at the same spot finalizes via the same finalize() path.
    tool.onPointerDown({ x: 5, y: 0 });

    expect(layerById(a.id).standaloneWalls).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith('Layer is locked');
  });
});
