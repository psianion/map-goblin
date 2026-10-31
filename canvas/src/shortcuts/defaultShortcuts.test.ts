import { describe, it, expect, beforeEach, vi } from 'vitest';

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
import { createDefaultShortcuts, deletedMessage, handleShortcut, rotateSelection90 } from './defaultShortcuts';
import { TERRAIN_PANEL_ID } from '@/store/types';
import { setEditorDesk } from '@dnd/core/src/engine/editorDesk';
import { openNewMapRef } from '@/components/toolbar/toolConstants';
import type { AssetChild, DungeonLayer, LightChild, ShapeChild } from '@/store/types';

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

function makeShape(): ShapeChild {
  return {
    id: 'shape-1',
    name: 'Polygon 1',
    childType: 'shape',
    visible: true,
    shapeType: 'polygon',
    contours: [[[0, 0], [1, 0], [1, 1]]],
    roughnessEnabled: false,
    roughnessAmplitude: 0,
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
  };
}

// ctrl+v used to build an AddChildCommand straight off ui.activeLayerId with
// no checks at all — a locked or hidden active layer, or one that no longer
// resolves, silently took the paste anyway (F5).
describe('ctrl+v paste — active-layer validation (F5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().setClipboard({ children: [makeShape()] });
  });

  it('pastes onto an unlocked, visible active layer', () => {
    handleShortcut('ctrl+v');
    expect(layer().children).toHaveLength(1);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('blocks the paste and warns when the active layer is locked', () => {
    useStore.getState().updateLayer(layer().id, { locked: true });
    handleShortcut('ctrl+v');
    expect(layer().children).toHaveLength(0);
    expect(toast.warning).toHaveBeenCalledWith('Layer is locked', expect.anything());
  });

  it('blocks the paste and warns when the active layer is hidden', () => {
    useStore.getState().updateLayer(layer().id, { visible: false });
    handleShortcut('ctrl+v');
    expect(layer().children).toHaveLength(0);
    expect(toast.warning).toHaveBeenCalledWith('Layer is hidden', expect.anything());
  });

  it('blocks the paste and warns when the active layer no longer resolves', () => {
    useStore.getState().setActiveLayerId('not-a-real-layer-id');
    handleShortcut('ctrl+v');
    expect(layer().children).toHaveLength(0);
    expect(toast.warning).toHaveBeenCalledWith('Select a layer first', expect.anything());
  });

  // D5(a): the Terrain row resolves to no dungeon layer too, but the plain
  // "Select a layer first" reads as a bug when Terrain is visibly selected.
  it('warns with the terrain-aware message when the Terrain row is active', () => {
    useStore.getState().setActiveLayerId(TERRAIN_PANEL_ID);
    handleShortcut('ctrl+v');
    expect(layer().children).toHaveLength(0);
    expect(toast.warning).toHaveBeenCalledWith(
      'Terrain is selected — pick a layer to draw on',
      expect.anything(),
    );
  });
});

// delete/ctrl+x used to build RemoveChildCommands straight off
// selectLayerForChild with no lock/visible check on the OWNING layer — the
// real path for a child selected via the layers panel, since ChildRow sets
// activeTool 'select' + selection directly rather than going through the
// canvas SelectTool (which no-ops for objects) (X1).
describe('delete / ctrl+x — owning-layer validation (X1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().addChild(layer().id, makeShape());
    useStore.getState().setSelectedIds(['shape-1']);
  });

  it('blocks delete and warns when the owning layer is locked', () => {
    useStore.getState().updateLayer(layer().id, { locked: true });
    handleShortcut('delete');
    expect(layer().children).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledWith('Layer is locked', expect.anything());
  });

  it('blocks delete and warns when the owning layer is hidden', () => {
    useStore.getState().updateLayer(layer().id, { visible: false });
    handleShortcut('delete');
    expect(layer().children).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledWith('Layer is hidden', expect.anything());
  });

  it('blocks ctrl+x and warns when the owning layer is locked', () => {
    useStore.getState().setActiveTool('select');
    useStore.getState().updateLayer(layer().id, { locked: true });
    handleShortcut('ctrl+x');
    expect(layer().children).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledWith('Layer is locked', expect.anything());
  });

  it('deletes on an unlocked, visible owning layer', () => {
    handleShortcut('delete');
    expect(layer().children).toHaveLength(0);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('backspace delegates to the same owning-layer guard as delete', () => {
    useStore.getState().updateLayer(layer().id, { locked: true });
    handleShortcut('backspace');
    expect(layer().children).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledWith('Layer is locked', expect.anything());
  });
});

describe('help list', () => {
  it('lists the terrain and water tools with their keys', () => {
    const tools = createDefaultShortcuts().filter((s) => s.category === 'Tools');
    expect(tools).toContainEqual(expect.objectContaining({ keys: 't', label: 'Terrain' }));
    expect(tools).toContainEqual(expect.objectContaining({ keys: 'u', label: 'Water' }));
  });

  it('lists the Props tool on B', () => {
    const tools = createDefaultShortcuts().filter((s) => s.category === 'Tools');
    expect(tools).toContainEqual(
      expect.objectContaining({ id: 'tool.scatterBrush', keys: 'b', label: 'Props' }),
    );
  });

  it('lists the draw-order keys', () => {
    const keys = createDefaultShortcuts().map((s) => s.keys);
    expect(keys).toEqual(expect.arrayContaining(['ctrl+]', 'ctrl+[', 'ctrl+shift+]', 'ctrl+shift+[']));
  });
});

describe('b picks the scatter brush', () => {
  beforeEach(() => useStore.getState().resetToDefault());

  it('switches to the scatter brush', () => {
    expect(handleShortcut('b')).toBe(true);
    expect(useStore.getState().tools.activeTool).toBe('scatterBrush');
  });
});

const DESK = { desk: '#eeeeee', dot: '#cccccc', sheet: '#ffffff', ink: '#111111' };

describe('ctrl+shift+m (maps panel)', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    vi.mocked(toast).mockClear();
  });

  it('toggles the maps panel on v1', () => {
    const before = useStore.getState().ui.leftPanelOpen;
    expect(handleShortcut('ctrl+shift+m')).toBe(true);
    expect(useStore.getState().ui.leftPanelOpen).toBe(!before);
  });

  it('does nothing on v2, which has no maps panel', () => {
    setEditorDesk(DESK);
    try {
      const before = useStore.getState().ui.leftPanelOpen;
      expect(handleShortcut('ctrl+shift+m')).toBe(false);
      expect(useStore.getState().ui.leftPanelOpen).toBe(before);
      expect(toast).not.toHaveBeenCalled();
    } finally {
      setEditorDesk(null);
    }
  });
});

describe('ctrl+shift+n (new map)', () => {
  beforeEach(() => useStore.getState().resetToDefault());

  it('opens the v1 dialog when no v2 dialog is registered', () => {
    expect(handleShortcut('ctrl+shift+n')).toBe(true);
    expect(useStore.getState().ui.modalState?.type).toBe('newMap');
  });

  it('opens the v2 dialog instead when the v2 route registered one', () => {
    const open = vi.fn();
    openNewMapRef.current = open;
    try {
      expect(handleShortcut('ctrl+shift+n')).toBe(true);
      expect(open).toHaveBeenCalledTimes(1);
      expect(useStore.getState().ui.modalState).toBeNull();
    } finally {
      openNewMapRef.current = null;
    }
  });
});

describe('delete — drawn walls', () => {
  const addWall = (id: string, y: number) =>
    useStore.getState().addWall(layer().id, {
      id,
      points: [[0, y], [10, y]],
      wallType: 'normal',
      direction: 'both',
      color: '#000000',
      roughness: 0,
    });
  const addDoor = (id: string, wallId: string) =>
    useStore.getState().addChild(layer().id, {
      id,
      name: 'Door',
      childType: 'door',
      visible: true,
      wallId,
      position: [5, 1],
      angle: 0,
      width: 1,
      style: 'single',
      state: 'closed',
      isSecret: false,
    });
  const lastToast = () => (toast as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1);

  beforeEach(() => {
    vi.clearAllMocks();
    undoManager.clear();
    useStore.getState().resetToDefault();
  });

  it('removes the selected wall with the doors on it, one undo, and offers Undo', () => {
    addWall('w', 1);
    addDoor('d', 'w');
    useStore.getState().setSelectedIds(['w']);
    handleShortcut('delete');
    expect(layer().standaloneWalls).toHaveLength(0);
    expect(layer().children).toHaveLength(0);
    expect(useStore.getState().selection.selectedIds).toEqual([]);
    const [message, opts] = lastToast() ?? [];
    expect(message).toBe('Deleted 1 wall and 1 door');
    expect(opts.action.label).toBe('Undo');
    opts.action.onClick();
    expect(layer().standaloneWalls.map((w) => w.id)).toEqual(['w']);
    expect(layer().children.map((c) => c.id)).toEqual(['d']);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('backspace removes a selected wall too', () => {
    addWall('w', 1);
    useStore.getState().setSelectedIds(['w']);
    handleShortcut('backspace');
    expect(layer().standaloneWalls).toHaveLength(0);
    expect(lastToast()?.[0]).toBe('Deleted 1 wall');
  });

  it('a wall on a locked layer is refused with the reason', () => {
    addWall('w', 1);
    useStore.getState().setSelectedIds(['w']);
    useStore.getState().updateLayer(layer().id, { locked: true });
    handleShortcut('delete');
    expect(layer().standaloneWalls).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledWith('Layer is locked', expect.anything());
  });

  it('a wall on a hidden layer is refused with the reason', () => {
    addWall('w', 1);
    useStore.getState().setSelectedIds(['w']);
    useStore.getState().updateLayer(layer().id, { visible: false });
    handleShortcut('delete');
    expect(layer().standaloneWalls).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledWith('Layer is hidden', expect.anything());
  });

  it('ctrl+x cuts a wall like anything else: the clipboard carries it', () => {
    addWall('w', 1);
    useStore.getState().setActiveTool('select');
    useStore.getState().setSelectedIds(['w']);
    handleShortcut('ctrl+x');
    expect(layer().standaloneWalls).toHaveLength(0);
    expect(useStore.getState().selection.clipboard?.walls).toHaveLength(1);
  });
});

describe('deletedMessage', () => {
  it('names what went by its kind', () => {
    expect(deletedMessage({ shape: 1 })).toBe('Deleted 1 floor');
    expect(deletedMessage({ asset: 3 })).toBe('Deleted 3 props');
    expect(deletedMessage({ water: 1 })).toBe('Deleted 1 water body');
  });

  it('names the walls and the doors that went with them; a mix is objects', () => {
    expect(deletedMessage({ wall: 2 })).toBe('Deleted 2 walls');
    expect(deletedMessage({ wall: 1 }, 2)).toBe('Deleted 1 wall and 2 doors');
    expect(deletedMessage({ shape: 2, wall: 1 }, 1)).toBe('Deleted 3 objects and 1 door');
  });
});

describe('delete — rooms', () => {
  const lastToast = () => (toast as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1);
  const floor = (): ShapeChild => ({
    ...makeShape(),
    id: 'floor-1',
    contours: [[[0, 0], [100, 0], [100, 100], [0, 100]]],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().addChild(layer().id, floor());
    const id = layer().id;
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.id === id) as DungeonLayer;
      l.rooms = [{ id: 'hall', name: 'Hall', number: 1, anchor: [50, 50] }];
    });
  });

  it('removes the selected room, keeps its floor, one undo, and says so', () => {
    useStore.getState().setSelectedIds(['hall']);
    handleShortcut('delete');
    expect(layer().rooms ?? []).toHaveLength(0);
    expect(layer().children.map((c) => c.id)).toEqual(['floor-1']);
    expect(useStore.getState().selection.selectedIds).toEqual([]);
    const [message, opts] = lastToast() ?? [];
    expect(message).toBe('Deleted 1 room');
    opts.action.onClick();
    expect((layer().rooms ?? []).map((r) => r.id)).toEqual(['hall']);
    expect(layer().children.map((c) => c.id)).toEqual(['floor-1']);
  });

  it('a room on a locked layer is refused with the reason', () => {
    useStore.getState().setSelectedIds(['hall']);
    useStore.getState().updateLayer(layer().id, { locked: true });
    handleShortcut('delete');
    expect((layer().rooms ?? []).map((r) => r.id)).toEqual(['hall']);
    expect(toast.warning).toHaveBeenCalledWith('Layer is locked', expect.anything());
  });
});

// ─── Props: draw order, lock, attached lights ─────────────

function prop(id: string, patch: Partial<AssetChild> = {}): AssetChild {
  return {
    id,
    name: id,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'crate',
    position: { x: 5, y: 5 },
    rotation: 0,
    scale: 1,
    width: 2,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
    ...patch,
  };
}

function lamp(id: string, attachedTo: string, position: { x: number; y: number }): LightChild {
  return {
    id,
    name: id,
    childType: 'light',
    visible: true,
    color: '#ffcc66',
    radius: 4,
    featherRadius: 2,
    intensity: 0.8,
    falloff: 'linear',
    position,
    attachedTo,
  };
}

const childById = (id: string) => layer().children.find((c) => c.id === id);
const order = () => layer().children.map((c) => c.id);

describe('draw-order keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().setActiveTool('select');
    for (const id of ['a', 'b', 'c']) useStore.getState().addChild(layer().id, prop(id));
    window.history.pushState({}, '', '/v2');
  });

  it('moves the selection forward, to the front, backward and to the back, one undo each', () => {
    useStore.getState().setSelectedIds(['a']);
    expect(handleShortcut('ctrl+]')).toBe(true);
    expect(order()).toEqual(['b', 'a', 'c']);
    // Shift turns the brackets into braces on most layouts; both spellings work.
    handleShortcut('ctrl+shift+}');
    expect(order()).toEqual(['b', 'c', 'a']);
    handleShortcut('ctrl+[');
    expect(order()).toEqual(['b', 'a', 'c']);
    handleShortcut('ctrl+shift+[');
    expect(order()).toEqual(['a', 'b', 'c']);
    undoManager.undo();
    expect(order()).toEqual(['b', 'a', 'c']);
  });

  it('Ctrl+G on v2 makes props a merged group, as the Group board shows; v1 keeps a plain one', () => {
    useStore.getState().setSelectedIds(['a', 'b']);
    handleShortcut('ctrl+g');
    expect(layer().groups?.[0]).toMatchObject({ name: 'Group 1', merged: true });
    undoManager.undo();
    window.history.pushState({}, '', '/');
    useStore.getState().setSelectedIds(['a', 'b']);
    handleShortcut('ctrl+g');
    expect(layer().groups?.[0].merged).toBeFalsy();
  });

  it('is a v2 verb: v1 lets the key fall through', () => {
    window.history.pushState({}, '', '/');
    useStore.getState().setSelectedIds(['a']);
    expect(handleShortcut('ctrl+]')).toBe(false);
    expect(order()).toEqual(['a', 'b', 'c']);
  });
});

describe('F belongs to the Props tool', () => {
  it('is not a global shortcut, so it reaches the active tool', () => {
    expect(handleShortcut('f')).toBe(false);
  });
});

describe('locked props', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().setActiveTool('select');
    useStore.getState().addChild(layer().id, prop('rug', { locked: true }));
    useStore.getState().addChild(layer().id, prop('crate', { position: { x: 9, y: 9 } }));
  });

  it('sit out a nudge and a flip while the rest of the selection moves', () => {
    useStore.getState().setSelectedIds(['rug', 'crate']);
    handleShortcut('arrowright');
    handleShortcut('shift+h');
    expect((childById('rug') as AssetChild).position).toEqual({ x: 5, y: 5 });
    expect((childById('rug') as AssetChild).flipX).toBe(false);
    expect((childById('crate') as AssetChild).position).toEqual({ x: 10, y: 9 });
    expect((childById('crate') as AssetChild).flipX).toBe(true);
  });

  it('are kept by Delete, which says why when nothing else is selected', () => {
    useStore.getState().setSelectedIds(['rug']);
    handleShortcut('delete');
    expect(childById('rug')).toBeDefined();
    expect(toast.warning).toHaveBeenCalledWith('Locked: unlock to edit', expect.anything());

    useStore.getState().setSelectedIds(['rug', 'crate']);
    handleShortcut('delete');
    expect(childById('rug')).toBeDefined();
    expect(childById('crate')).toBeUndefined();
  });
});

describe('attached lights follow every selection verb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().setActiveTool('select');
    // A brazier 2 x 1 at (5, 5), its flame at its E end.
    useStore.getState().addChild(layer().id, prop('brazier'));
    useStore.getState().addChild(layer().id, lamp('flame', 'brazier', { x: 6, y: 5 }));
    useStore.getState().setSelectedIds(['brazier']);
  });

  const flame = () => (childById('flame') as LightChild).position;

  it('nudge', () => {
    handleShortcut('arrowdown');
    expect(flame()).toEqual({ x: 6, y: 6 });
    undoManager.undo();
    expect(flame()).toEqual({ x: 6, y: 5 });
  });

  it('rotate 90 degrees', () => {
    rotateSelection90();
    expect(flame().x).toBeCloseTo(5);
    expect(flame().y).toBeCloseTo(6);
  });

  it('flip', () => {
    handleShortcut('shift+h');
    expect(flame().x).toBeCloseTo(4);
    expect(flame().y).toBeCloseTo(5);
  });

  it('duplicate copies the light onto the copy', () => {
    handleShortcut('ctrl+d');
    const [copyId] = useStore.getState().selection.selectedIds;
    expect(copyId).not.toBe('brazier');
    const lights = layer().children.filter((c): c is LightChild => c.childType === 'light');
    const copied = lights.find((l) => l.attachedTo === copyId);
    expect(copied?.position).toEqual({ x: 7, y: 6 });
    expect(flame()).toEqual({ x: 6, y: 5 });
  });

  it('paste copies the light with its prop', () => {
    useStore.getState().setClipboard({
      children: [childById('brazier')!, childById('flame')!].map((c) => structuredClone(c)),
    });
    handleShortcut('ctrl+v');
    const props = layer().children.filter((c) => c.childType === 'asset');
    const lights = layer().children.filter((c): c is LightChild => c.childType === 'light');
    expect(props).toHaveLength(2);
    expect(lights).toHaveLength(2);
    const copy = props.find((p) => p.id !== 'brazier')!;
    expect(lights.find((l) => l.attachedTo === copy.id)?.position).toEqual({ x: 7, y: 6 });
  });
});
