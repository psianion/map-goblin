import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { toast } from 'sonner';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { handleShortcut } from './defaultShortcuts';
import type { AnyChild, AssetChild, DungeonLayer } from '@/store/types';
import type { DoorChild, WallSegment } from '@/shared/types';

const layer = (): DungeonLayer => useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon')!;
const sel = () => useStore.getState().selection.selectedIds;
const find = (id: string) => layer().children.find((c) => c.id === id);

const asset = (id: string, x: number, extra: Partial<AssetChild> = {}): AssetChild => {
  const a = {
    id, name: id, childType: 'asset', visible: true, objectType: 'asset', assetId: 'a', position: { x, y: 0 }, rotation: 0,
    scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false, ...extra,
  } as AssetChild;
  useStore.getState().addChild(layer().id, a);
  return a;
};
const wall = (id: string, extra: Partial<WallSegment> = {}): WallSegment => {
  const w = { id, points: [[0, 5], [4, 5]], wallType: 'normal', direction: 'both', color: '#000', roughness: 0, width: 0.3, ...extra } as WallSegment;
  useStore.getState().addWall(layer().id, w);
  return w;
};
const door = (id: string, wallId: string): DoorChild => {
  const d = {
    id, name: id, childType: 'door', visible: true, wallId, position: [2, 5], angle: 0, width: 1, style: 'single',
    state: 'closed', isSecret: false,
  } as DoorChild;
  useStore.getState().addChild(layer().id, d as AnyChild);
  return d;
};

let now = 10_000;
// Ctrl+A remembers its last press across tests; every test starts well past it.
let base = 10_000;

describe('selection shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().setActiveTool('select');
    base += 100_000;
    now = base;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  it('Ctrl+A selects every shown child and wall on the active layer', () => {
    asset('a', 0);
    asset('h', 2, { visible: false });
    wall('w');
    expect(handleShortcut('ctrl+a')).toBe(true);
    expect([...sel()].sort()).toEqual(['a', 'w']);
  });

  it('Ctrl+A twice within a second reaches every shown layer', () => {
    asset('a', 0);
    const other = { ...structuredClone(layer()), id: 'l2', name: 'L2', children: [], standaloneWalls: [] };
    useStore.getState().addLayer(other as DungeonLayer);
    useStore.getState().addChild('l2', { ...(find('a') as AssetChild), id: 'b' });
    handleShortcut('ctrl+a');
    expect(sel()).toEqual(['a']);
    now += 500;
    handleShortcut('ctrl+a');
    expect([...sel()].sort()).toEqual(['a', 'b']);
  });

  it('Ctrl+A after a pause stays on the active layer', () => {
    asset('a', 0);
    const other = { ...structuredClone(layer()), id: 'l2', name: 'L2', children: [], standaloneWalls: [] };
    useStore.getState().addLayer(other as DungeonLayer);
    useStore.getState().addChild('l2', { ...(find('a') as AssetChild), id: 'b' });
    handleShortcut('ctrl+a');
    now += 1500;
    handleShortcut('ctrl+a');
    expect(sel()).toEqual(['a']);
  });

  it('Shift+R turns the selection a quarter', () => {
    asset('a', 0);
    useStore.getState().setSelectedIds(['a']);
    expect(handleShortcut('shift+r')).toBe(true);
    expect((find('a') as AssetChild).rotation).toBeCloseTo(Math.PI / 2);
  });

  it('Ctrl+Shift+L locks the selection, and again unlocks it', () => {
    asset('a', 0);
    wall('w');
    useStore.getState().setSelectedIds(['a', 'w']);
    handleShortcut('ctrl+shift+l');
    expect(find('a')!.locked).toBe(true);
    expect(layer().standaloneWalls[0].locked).toBe(true);
    handleShortcut('ctrl+shift+l');
    expect(find('a')!.locked).toBeFalsy();
  });

  it('Ctrl+Shift+H hides the selection and lets go of it', () => {
    asset('a', 0);
    wall('w');
    useStore.getState().setSelectedIds(['a', 'w']);
    handleShortcut('ctrl+shift+h');
    expect(find('a')!.visible).toBe(false);
    expect(layer().standaloneWalls[0].visible).toBe(false);
    expect(sel()).toEqual([]);
    undoManager.undo();
    expect(find('a')!.visible).toBe(true);
    expect([...sel()].sort()).toEqual(['a', 'w']);
  });

  it('ten fast arrow presses are one undo step', () => {
    asset('a', 0);
    useStore.getState().setSelectedIds(['a']);
    for (let i = 0; i < 10; i++) {
      handleShortcut('arrowright');
      now += 100;
    }
    expect((find('a') as AssetChild).position.x).toBe(10);
    console.log(`[metric] undo entries: 10 fast nudges -> ${undoManager.size()}`);
    undoManager.undo();
    expect((find('a') as AssetChild).position.x).toBe(0);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('ten slow arrow presses are ten steps', () => {
    asset('a', 0);
    useStore.getState().setSelectedIds(['a']);
    for (let i = 0; i < 10; i++) {
      handleShortcut('arrowright');
      now += 700;
    }
    let steps = 0;
    while (undoManager.canUndo()) {
      undoManager.undo();
      steps++;
    }
    console.log(`[metric] undo entries: 10 slow nudges -> ${steps}`);
    expect(steps).toBe(10);
  });

  it('Ctrl+D on a door alone does nothing and says why', () => {
    wall('w');
    door('d', 'w');
    useStore.getState().setSelectedIds(['d']);
    handleShortcut('ctrl+d');
    expect(layer().children.filter((c) => c.childType === 'door')).toHaveLength(1);
    expect(vi.mocked(toast.warning).mock.calls.flat().join(' ') + vi.mocked(toast).mock.calls.flat().join(' ')).toContain('Doors stay on their wall');
  });

  it('Ctrl+D on a wall copies it and the door on it, re-bound to the copy', () => {
    wall('w');
    door('d', 'w');
    useStore.getState().setSelectedIds(['w']);
    handleShortcut('ctrl+d');
    const walls = layer().standaloneWalls;
    expect(walls).toHaveLength(2);
    const copy = walls.find((w) => w.id !== 'w')!;
    expect(copy.points).toEqual([[1, 6], [5, 6]]);
    const doors = layer().children.filter((c): c is DoorChild => c.childType === 'door');
    expect(doors.map((d) => d.wallId).sort()).toEqual([copy.id, 'w'].sort());
    expect(sel()).toEqual([copy.id]);
  });

  it('Ctrl+C then Ctrl+V pastes a wall onto the active layer', () => {
    wall('w');
    useStore.getState().setSelectedIds(['w']);
    handleShortcut('ctrl+c');
    handleShortcut('ctrl+v');
    expect(layer().standaloneWalls).toHaveLength(2);
  });

  it('Ctrl+V selects what it pasted, and redo hands that selection back', () => {
    asset('a', 0);
    wall('w');
    useStore.getState().setSelectedIds(['a', 'w']);
    handleShortcut('ctrl+c');
    handleShortcut('ctrl+v');
    const pasted = [...sel()];
    expect(pasted).toHaveLength(2);
    // The copies, not the originals: one prop, one wall.
    expect(pasted.filter((id) => id !== 'a' && layer().children.some((c) => c.id === id))).toHaveLength(1);
    expect(pasted.filter((id) => id !== 'w' && layer().standaloneWalls.some((x) => x.id === id))).toHaveLength(1);
    undoManager.undo();
    undoManager.redo();
    expect([...sel()].sort()).toEqual([...pasted].sort());
  });

  it('a wall cut says “Cut 1 wall”', () => {
    wall('w');
    door('d', 'w');
    useStore.getState().setSelectedIds(['w']);
    handleShortcut('ctrl+x');
    expect(vi.mocked(toast).mock.calls.at(-1)?.[0]).toBe('Cut 1 wall');
  });

  it('a mixed delete counts objects', () => {
    asset('a', 0);
    asset('b', 2);
    wall('w');
    useStore.getState().setSelectedIds(['a', 'b', 'w']);
    handleShortcut('delete');
    expect(vi.mocked(toast).mock.calls.at(-1)?.[0]).toBe('Deleted 3 objects');
  });

  it('Delete skips locked members and says how many', () => {
    asset('a', 0, { locked: true });
    asset('b', 2);
    useStore.getState().setSelectedIds(['a', 'b']);
    handleShortcut('delete');
    expect(find('a')).toBeTruthy();
    expect(find('b')).toBeUndefined();
    expect(vi.mocked(toast.warning).mock.calls.flat().join(' ')).toContain('1 locked object skipped');
  });
});
