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
import {
  activeToolKeyRef,
  boundCombos,
  deletedMessage,
  editorShellKeysRef,
  handleShortcut,
  rotateSelection90,
  shortcutById,
  SHORTCUTS,
} from './defaultShortcuts';
import { formatCombo } from './formatCombo';
import { TERRAIN_PANEL_ID } from '@/store/types';
import { openNewMapRef } from '@/editor/toolConstants';
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
  it('lists the terrain tool with its key', () => {
    const tools = SHORTCUTS.filter((s) => s.group === 'Tools');
    expect(tools).toContainEqual(expect.objectContaining({ combo: 't', label: 'Terrain' }));
  });

  it('lists the Props tool on B', () => {
    const tools = SHORTCUTS.filter((s) => s.group === 'Tools');
    expect(tools).toContainEqual(
      expect.objectContaining({ id: 'tool.scatterBrush', combo: 'b', label: 'Props' }),
    );
  });

  it('lists the draw-order keys', () => {
    const keys = SHORTCUTS.map((s) => s.combo);
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

describe('e picks the Plateau tool, shift+e toggles erase', () => {
  beforeEach(() => useStore.getState().resetToDefault());

  it('switches to the Plateau tool from any tool', () => {
    for (const tool of ['select', 'rectangle'] as const) {
      useStore.getState().setActiveTool(tool);
      expect(handleShortcut('e')).toBe(true);
      expect(useStore.getState().tools.activeTool).toBe('plateau');
      expect(useStore.getState().tools.eraseMode).toBe(false);
    }
  });

  it('toggles erase mode on shift+e, the tool in hand kept', () => {
    useStore.getState().setActiveTool('scatterBrush');
    expect(handleShortcut('shift+e')).toBe(true);
    expect(useStore.getState().tools.activeTool).toBe('scatterBrush');
    expect(useStore.getState().tools.eraseMode).toBe(true);
  });
});

describe('ctrl+shift+n (new map)', () => {
  beforeEach(() => useStore.getState().resetToDefault());

  it('opens the dialog the app registered', () => {
    const open = vi.fn();
    openNewMapRef.current = open;
    try {
      expect(handleShortcut('ctrl+shift+n')).toBe(true);
      expect(open).toHaveBeenCalledTimes(1);
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

  it('Ctrl+G makes props a merged group, as the Group board shows', () => {
    useStore.getState().setSelectedIds(['a', 'b']);
    handleShortcut('ctrl+g');
    expect(layer().groups?.[0]).toMatchObject({ name: 'Group 1', merged: true });
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

// The one table: what the map answers and what the help lists are the same list.
describe('the shortcut table', () => {
  it('binds every combo it lists, and lists every combo it binds', () => {
    const bound = new Set(boundCombos());
    for (const s of SHORTCUTS) expect(bound.has(s.combo)).toBe(true);
    expect([...bound].sort()).toEqual([...new Set(SHORTCUTS.map((s) => s.combo))].sort());
  });

  it('has no duplicate, and nothing a binding before it on the same key always takes', () => {
    const seen = new Set<string>();
    for (const s of SHORTCUTS) {
      const key = `${s.combo}|${s.id}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
    // A binding with no `when` in the same scope ahead of another on the same combo would
    // leave the later one unreachable, except where the earlier can decline (run → false):
    // only the selection verbs do that, and none sits ahead of another in its own scope.
    SHORTCUTS.forEach((s, i) => {
      const shadow = SHORTCUTS.slice(0, i).find((p) => p.combo === s.combo && p.scope === s.scope && !p.when && p.id !== s.id);
      expect(shadow?.id, `${s.combo} → ${s.id}`).toBeUndefined();
    });
  });

  it('carries no maps panel, no O and no old room tool', () => {
    expect(boundCombos()).not.toContain('ctrl+shift+m');
    expect(boundCombos()).not.toContain('o');
    expect(SHORTCUTS.some((s) => s.id === 'tool.room' || s.id === 'view.toggleMaps')).toBe(false);
  });

  it('lists what the v2 editor answers: X, R and P in Rooms, levels, the dock, Enter and Escape, I, the light’s R, node edits', () => {
    const at = (id: string) => SHORTCUTS.filter((s) => s.id === id).map((s) => s.combo);
    expect(at('tool.divide')).toEqual(['x']);
    expect(SHORTCUTS.filter((s) => s.scope === 'tab:rooms').map((s) => s.combo)).toEqual(['r', 'p']);
    expect(at('level.up')).toEqual(['pageup']);
    expect(at('level.down')).toEqual(['pagedown']);
    expect(at('dock.toggle')).toEqual(['tab']);
    expect(at('edit.finish')).toEqual(['enter']);
    expect(at('edit.cancel')).toEqual(['escape']);
    expect(at('view.litPreview')).toEqual(['i']);
    expect(at('tool.lightTurn')).toEqual(['r', 'shift+r']);
    expect(SHORTCUTS.filter((s) => s.group === 'Node editing').map((s) => s.combo)).toEqual(
      expect.arrayContaining(['[', ']', '-', '=', ',', '.', '{', '}', 'tab', 'delete', 'escape']),
    );
  });

  it('keeps the chords the title menu and the status bar show', () => {
    for (const id of ['tool.select', 'tool.pan', 'tool.ruler', 'mode.erase', 'mode.curve', 'edit.undo', 'edit.redo', 'file.export', 'file.import', 'view.fitToContent', 'view.litPreview', 'view.focusMode', 'view.shortcuts']) {
      expect(shortcutById(id), id).toBeDefined();
    }
  });
});

describe('scopes and the v2 shell', () => {
  const shell = (tab = 'floors') => ({
    tab: () => tab,
    toggleDock: vi.fn(),
    stepLevel: vi.fn(),
    openShortcuts: vi.fn(),
  });
  const key = (k: string, init: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key: k, ...init });

  beforeEach(() => useStore.getState().resetToDefault());
  afterEach(() => {
    editorShellKeysRef.current = null;
    activeToolKeyRef.current = null;
  });

  it('R and P pick the room tools with the Rooms tab up, and plain floors from any other', () => {
    editorShellKeysRef.current = shell('rooms');
    handleShortcut('r', key('r'));
    expect(useStore.getState().tools.activeTool).toBe('roomRect');
    handleShortcut('p', key('p'));
    expect(useStore.getState().tools.activeTool).toBe('roomPolygon');
    editorShellKeysRef.current = shell('floors');
    handleShortcut('r', key('r'));
    expect(useStore.getState().tools.activeTool).toBe('rectangle');
  });

  it('X picks Divide on v2 only', () => {
    expect(handleShortcut('x', key('x'))).toBe(false);
    editorShellKeysRef.current = shell();
    expect(handleShortcut('x', key('x'))).toBe(true);
    expect(useStore.getState().tools.activeTool).toBe('divide');
  });

  it('R with the Light tool in hand is the tool’s, not Rectangle', () => {
    const toTool = vi.fn(() => false);
    activeToolKeyRef.current = toTool;
    useStore.getState().setActiveTool('light');
    expect(handleShortcut('r', key('r'))).toBe(true);
    expect(toTool).toHaveBeenCalledTimes(1);
    expect(useStore.getState().tools.activeTool).toBe('light');
  });

  it('Page Up and Page Down step the levels, Tab folds the dock, ? opens the sheet; none of them without the shell', () => {
    expect(handleShortcut('pageup', key('PageUp'))).toBe(false);
    expect(handleShortcut('tab', key('Tab'))).toBe(false);
    const s = shell();
    editorShellKeysRef.current = s;
    handleShortcut('pageup', key('PageUp'));
    handleShortcut('pagedown', key('PageDown'));
    expect(s.stepLevel.mock.calls).toEqual([[-1], [1]]);
    handleShortcut('tab', key('Tab'));
    expect(s.toggleDock).toHaveBeenCalledTimes(1);
    handleShortcut('shift+?', key('?', { shiftKey: true }));
    expect(s.openShortcuts).toHaveBeenCalledTimes(1);
  });

  it('Enter goes to the tool in hand (a wall chain ends there)', () => {
    const toTool = vi.fn(() => true);
    activeToolKeyRef.current = toTool;
    expect(handleShortcut('enter', key('Enter'))).toBe(true);
    expect(toTool).toHaveBeenCalledTimes(1);
  });
});

describe('formatCombo', () => {
  it('reads Windows keys as words, in Ctrl Shift Alt order', () => {
    expect(formatCombo('ctrl+shift+z', false)).toBe('Ctrl Shift Z');
    expect(formatCombo('ctrl+0', false)).toBe('Ctrl 0');
    expect(formatCombo('alt+click', false)).toBe('Alt Click');
    expect(formatCombo('arrowleft', false)).toBe('←');
    expect(formatCombo('pageup', false)).toBe('Page Up');
    expect(formatCombo('delete', false)).toBe('Del');
    expect(formatCombo('+', false)).toBe('+');
  });

  it('reads Mac keys as marks: ⌘ for Ctrl, ⌥ for Alt', () => {
    expect(formatCombo('ctrl+shift+z', true)).toBe('⇧⌘Z');
    expect(formatCombo('ctrl+e', true)).toBe('⌘E');
    expect(formatCombo('alt+drag', true)).toBe('⌥ Drag');
    expect(formatCombo('v', true)).toBe('V');
  });
});
