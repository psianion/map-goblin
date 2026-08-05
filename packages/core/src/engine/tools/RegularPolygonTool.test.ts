import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RegularPolygonTool } from './RegularPolygonTool';
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

function polygonsOf(layer: DungeonLayer): number {
  return layer.children.filter((c) => c.childType === 'shape' && c.shapeType === 'regularPolygon').length;
}

describe('RegularPolygonTool — commit-layer capture (F2 sibling)', () => {
  let tool: RegularPolygonTool;
  let warning: ReturnType<typeof vi.fn<(msg: string) => void>>;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    warning = vi.fn();
    setNotify({ warning, error: vi.fn(), success: vi.fn(), info: vi.fn() });
    tool = new RegularPolygonTool();
  });

  it('commits the polygon to the layer active when the drag started', () => {
    const a = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerUp({ x: 2, y: 0 });

    expect(polygonsOf(layerById(a.id))).toBe(1);
    expect(warning).not.toHaveBeenCalled();
  });

  it('lands the polygon on the layer active at press, not one switched to mid-drag', () => {
    const a = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    const b = createDungeonLayer('Layer B');
    useStore.getState().addLayer(b);
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    useStore.getState().setActiveLayerId(b.id);
    tool.onPointerUp({ x: 2, y: 0 });

    expect(polygonsOf(layerById(a.id))).toBe(1);
    expect(polygonsOf(layerById(b.id))).toBe(0);
    expect(warning).not.toHaveBeenCalled();
  });

  it('refuses to commit and warns when the drawing layer is locked before release', () => {
    const a = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    useStore.getState().setActiveLayerId(a.id);

    tool.onPointerDown({ x: 0, y: 0 });
    useStore.getState().updateLayer(a.id, { locked: true });
    tool.onPointerUp({ x: 2, y: 0 });

    expect(polygonsOf(layerById(a.id))).toBe(0);
    expect(warning).toHaveBeenCalledWith('Layer is locked');
  });
});
