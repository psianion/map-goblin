import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RectangleTool } from './RectangleTool';
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

function rectanglesOf(layer: DungeonLayer): number {
  return layer.children.filter((c) => c.childType === 'shape' && c.shapeType === 'rectangle').length;
}

describe('RectangleTool — commit-layer capture (F2)', () => {
  let tool: RectangleTool;
  let warning: ReturnType<typeof vi.fn<(msg: string) => void>>;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    warning = vi.fn();
    setNotify({ warning, error: vi.fn(), success: vi.fn(), info: vi.fn() });
    tool = new RectangleTool();
  });

  it('commits the rectangle to the layer active when the drag started', () => {
    const a = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerUp({ x: 5, y: 5 });

    expect(rectanglesOf(layerById(a.id))).toBe(1);
    expect(warning).not.toHaveBeenCalled();
  });

  it('lands the rectangle on the layer active at press, not one switched to mid-drag', () => {
    const a = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    const b = createDungeonLayer('Layer B');
    useStore.getState().addLayer(b);
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    // Switching to an unlocked, visible layer mid-drag — the pointerDown guard
    // on B would happily pass if this ever went through it again.
    useStore.getState().setActiveLayerId(b.id);
    tool.onPointerUp({ x: 5, y: 5 });

    expect(rectanglesOf(layerById(a.id))).toBe(1);
    expect(rectanglesOf(layerById(b.id))).toBe(0);
    expect(warning).not.toHaveBeenCalled();
  });

  it('refuses to commit and warns when the drawing layer is locked before release', () => {
    const a = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    // Locked mid-drag — a real DM locking the layer while a drag is live.
    useStore.getState().updateLayer(a.id, { locked: true });
    tool.onPointerUp({ x: 5, y: 5 });

    expect(rectanglesOf(layerById(a.id))).toBe(0);
    expect(warning).toHaveBeenCalledWith('Layer is locked');
  });
});
