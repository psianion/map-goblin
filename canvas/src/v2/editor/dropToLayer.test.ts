import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import { undoManager } from '@/store/undoManager';
import type { AnyChild, DungeonLayer } from '@/store/types';
import { notify } from '@/lib/toast';
import { currentDropTarget, mountDropToLayer, tileLayerAt, type MoveHooks } from './dropToLayer';

vi.mock('@/lib/toast', () => ({
  notify: { action: vi.fn(), subtle: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

type Release = (screen: { x: number; y: number }, ids: string[]) => boolean;
type Hover = (screen: { x: number; y: number } | null, ids: string[]) => void;

const crate = (id: string): AnyChild =>
  ({ id, name: 'crate', childType: 'asset', visible: true, assetId: 't:c', position: { x: 1, y: 1 }, rotation: 0, scale: 1, width: 1, height: 1 }) as AnyChild;

function fakeTools() {
  const hooks: { release: Release | null; hover: Hover | null } = { release: null, hover: null };
  const tools: MoveHooks = {
    setMoveReleaseHook: (fn) => {
      hooks.release = fn;
    },
    setMoveHoverHook: (fn) => {
      hooks.hover = fn;
    },
  };
  return { hooks, tools };
}

function canvas(): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 10, top: 20, right: 0, bottom: 0, width: 0, height: 0, x: 10, y: 20, toJSON: () => ({}) });
  return el;
}

/** A tile in the page for `layerId`, answered by elementFromPoint at (100, 200). */
function tileAt(layerId: string | null) {
  document.body.innerHTML = '';
  const tile = document.createElement('div');
  if (layerId) tile.dataset.layerTile = layerId;
  const inner = document.createElement('span');
  tile.appendChild(inner);
  document.body.appendChild(tile);
  document.elementFromPoint = vi.fn((x: number, y: number) => (x === 100 && y === 200 ? inner : null)) as typeof document.elementFromPoint;
}

function seed() {
  const s = useStore.getState();
  const a = s.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
  const b = createDungeonLayer('Lights', s.ui.activeLevelId);
  s.addLayer(b);
  s.addChild(a.id, crate('c1'));
  s.setActiveLayerId(a.id);
  s.setSelectedIds(['c1']);
  return { a, b };
}

const on = (id: string) => useStore.getState().layers.find((l) => l.id === id) as DungeonLayer;
// The tile's pointer, in canvas px: (100, 200) in the page less the canvas offset.
const AT = { x: 90, y: 180 };

describe('drop to layer', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
    vi.mocked(notify.action).mockClear();
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('wires both move hooks and takes them off again', () => {
    const { hooks, tools } = fakeTools();
    const stop = mountDropToLayer(tools, canvas());
    expect(hooks.release).toBeTypeOf('function');
    expect(hooks.hover).toBeTypeOf('function');
    stop();
    expect(hooks.release).toBeNull();
    expect(hooks.hover).toBeNull();
  });

  it('finds the tile under a point by its data-layer-tile', () => {
    tileAt('layer-x');
    expect(tileLayerAt(100, 200)).toBe('layer-x');
    expect(tileLayerAt(5, 5)).toBeNull();
  });

  it('a release over another layer’s tile takes the drop and moves the selection there', async () => {
    const { a, b } = seed();
    tileAt(b.id);
    const { hooks, tools } = fakeTools();
    mountDropToLayer(tools, canvas());
    expect(hooks.release!(AT, ['c1'])).toBe(true);
    await Promise.resolve();
    expect(on(b.id).children.map((c) => c.id)).toEqual(['c1']);
    expect(on(a.id).children).toHaveLength(0);
  });

  it('refuses a locked layer', async () => {
    const { b } = seed();
    useStore.getState().updateLayer(b.id, { locked: true });
    tileAt(b.id);
    const { hooks, tools } = fakeTools();
    mountDropToLayer(tools, canvas());
    expect(hooks.release!(AT, ['c1'])).toBe(false);
    await Promise.resolve();
    expect(on(b.id).children).toHaveLength(0);
  });

  it('leaves a drop on the source layer’s own tile to the move', () => {
    const { a } = seed();
    tileAt(a.id);
    const { hooks, tools } = fakeTools();
    mountDropToLayer(tools, canvas());
    expect(hooks.release!(AT, ['c1'])).toBe(false);
  });

  it('leaves a release over no tile to the move', () => {
    seed();
    tileAt(null);
    const { hooks, tools } = fakeTools();
    mountDropToLayer(tools, canvas());
    expect(hooks.release!(AT, ['c1'])).toBe(false);
  });

  it('says what moved, with Undo, and one undo puts it back', async () => {
    const { a, b } = seed();
    tileAt(b.id);
    const { hooks, tools } = fakeTools();
    mountDropToLayer(tools, canvas());
    const size = undoManager.size();
    hooks.release!(AT, ['c1']);
    await Promise.resolve();
    expect(notify.action).toHaveBeenCalledWith('Moved 1 object to Lights', expect.objectContaining({ label: 'Undo' }));
    expect(undoManager.size()).toBe(size + 1);
    undoManager.undo();
    expect(on(a.id).children.map((c) => c.id)).toEqual(['c1']);
    expect(on(b.id).children).toHaveLength(0);
  });

  it('names the tile under a drag for the drop ring, and clears it', () => {
    const { b } = seed();
    tileAt(b.id);
    const { hooks, tools } = fakeTools();
    mountDropToLayer(tools, canvas());
    hooks.hover!(AT, ['c1']);
    expect(currentDropTarget()).toEqual({ layerId: b.id, name: 'Lights' });
    hooks.hover!(null, ['c1']);
    expect(currentDropTarget()).toBeNull();
  });
});
