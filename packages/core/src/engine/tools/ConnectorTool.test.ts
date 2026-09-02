import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from 'pixi.js';
import { ConnectorTool } from './ConnectorTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setNotify } from '../../store/notify';
import type { ConnectorChild, DungeonLayer } from '../../store/types';

function layerById(id: string): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.id === id);
  if (!l || l.type !== 'dungeon') throw new Error(`no dungeon layer ${id}`);
  return l;
}

function connectorsOf(id: string): ConnectorChild[] {
  return layerById(id).children.filter((c): c is ConnectorChild => c.childType === 'connector');
}

function bounds(ring: [number, number][]) {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe('ConnectorTool', () => {
  let tool: ConnectorTool;
  let layerId: string;
  let warning: ReturnType<typeof vi.fn<(msg: string) => void>>;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    warning = vi.fn();
    setNotify({ warning, error: vi.fn(), success: vi.fn(), info: vi.fn() });
    tool = new ConnectorTool(new Container());
    layerId = useStore.getState().layers.find((l) => l.type === 'dungeon')!.id;
    useStore.getState().setActiveLayerId(layerId);
  });

  function place(from: [number, number], to: [number, number]): ConnectorChild {
    tool.onPointerDown({ x: from[0], y: from[1] });
    tool.onPointerMove({ x: to[0], y: to[1] });
    tool.onPointerUp({ x: to[0], y: to[1] });
    const all = connectorsOf(layerId);
    return all[all.length - 1];
  }

  it('commits a blob straddling the drag, defaulting to an open arch', () => {
    const c = place([0, 0], [3, 0]);

    expect(connectorsOf(layerId)).toHaveLength(1);
    expect(c.kind).toBe('arch');
    // An arch is always open — the archway machinery forces it downstream anyway.
    expect(c.state).toBe('open');
    expect(c.isSecret).toBe(false);
    expect(c.name).toBe('Connector 1');
    expect(useStore.getState().selection.selectedIds).toEqual([c.id]);

    // The drag is the blob's long axis, and it is thinner across the seam.
    const b = bounds(c.contours[0]);
    expect(b.maxX - b.minX).toBeCloseTo(3, 5);
    expect(b.maxY - b.minY).toBeLessThan(b.maxX - b.minX);
  });

  it('places a door-kind connector closed when the popover says door', () => {
    useStore.getState().updateToolSettings({ connector: { kind: 'door' } });

    const c = place([0, 0], [3, 0]);
    expect(c.kind).toBe('door');
    expect(c.state).toBe('closed');
  });

  it('still places a blob for a click with no drag', () => {
    const c = place([5, 5], [5, 5]);
    const b = bounds(c.contours[0]);
    expect(b.maxX - b.minX).toBeGreaterThan(0);
    expect(b.maxY - b.minY).toBeGreaterThan(0);
  });

  it('undoes the placement as one entry', () => {
    place([0, 0], [3, 0]);
    undoManager.undo();
    expect(connectorsOf(layerId)).toHaveLength(0);
  });

  it('selects an existing connector on a click, without moving it', () => {
    const c = place([0, 0], [3, 0]);
    const before = c.contours;
    useStore.getState().setSelectedIds([]);

    tool.onPointerDown({ x: 1.5, y: 0 });
    tool.onPointerUp({ x: 1.5, y: 0 });

    expect(useStore.getState().selection.selectedIds).toEqual([c.id]);
    expect(connectorsOf(layerId)[0].contours).toEqual(before);
    // A plain click is not an undo entry of its own.
    expect(undoManager.canUndo()).toBe(true);
    undoManager.undo();
    expect(connectorsOf(layerId)).toHaveLength(0);
  });

  it('drags an existing connector past the slop and records one move entry', () => {
    const c = place([0, 0], [3, 0]);
    const before = bounds(c.contours[0]);

    tool.onPointerDown({ x: 1.5, y: 0 });
    tool.onPointerMove({ x: 3.5, y: 0 });
    tool.onPointerUp({ x: 3.5, y: 0 });

    const after = bounds(connectorsOf(layerId)[0].contours[0]);
    expect(after.minX - before.minX).toBeCloseTo(2, 5);

    undoManager.undo();
    expect(bounds(connectorsOf(layerId)[0].contours[0]).minX).toBeCloseTo(before.minX, 5);
  });

  it('restores the dragged connector on Escape', () => {
    const c = place([0, 0], [3, 0]);
    const before = bounds(c.contours[0]);

    tool.onPointerDown({ x: 1.5, y: 0 });
    tool.onPointerMove({ x: 3.5, y: 0 });
    tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);

    expect(bounds(connectorsOf(layerId)[0].contours[0]).minX).toBeCloseTo(before.minX, 5);
    expect(tool.isActive()).toBe(false);
  });

  it('deletes the selected connector on Delete', () => {
    place([0, 0], [3, 0]);
    tool.onKeyDown({ key: 'Delete' } as KeyboardEvent);

    expect(connectorsOf(layerId)).toHaveLength(0);
    expect(useStore.getState().selection.selectedIds).toEqual([]);
  });

  // Counting what exists reuses a name the moment one is deleted, and two joints
  // called "Connector 2" is a DM's prep notes pointing at the wrong door.
  it('never hands out a name a deleted connector already used', () => {
    const first = place([0, 0], [3, 0]);
    const second = place([0, 5], [3, 5]);
    expect([first.name, second.name]).toEqual(['Connector 1', 'Connector 2']);

    useStore.getState().setSelectedIds([first.id]);
    tool.onKeyDown({ key: 'Delete' } as KeyboardEvent);

    expect(place([0, 10], [3, 10]).name).toBe('Connector 3');
  });

  it('refuses to place on a locked layer', () => {
    useStore.getState().updateLayer(layerId, { locked: true } as never);

    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerUp({ x: 3, y: 0 });

    expect(connectorsOf(layerId)).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith('Layer is locked');
  });
});
