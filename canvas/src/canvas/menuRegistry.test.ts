import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import {
  buildChildMenu,
  buildMultiMenu,
  buildCanvasMenu,
  buildWallMenu,
  buildRoomMenu,
  buildAreaMenu,
  roomNamePromptRef,
  registerMenu,
  openPropBrowserRef,
} from './menuRegistry';
import { getAssetPackManager, resetAssetPackManager } from '@dnd/core/src/engine/assetPackInstance';
import type { ManifestEntry, PackManifest } from '@dnd/core/src/engine/assetPackManager';
import type { MenuSliderRow, MenuSubmenuRow, MenuSwatchesRow, MenuThumbStripRow, MenuToggleRow } from '@/components/ui/context-menu';
import { LIGHT_RADIUS_FT } from '@dnd/core/src/store/lightPresets';
import { groupSelection, mergeSelection } from './groupActions';
import { createDungeonLayer } from '@dnd/core/src/store/factories';
import type { MenuRow, ContextMenuItem } from '@/components/ui/context-menu';
import type { AssetChild, DungeonLayer, LightChild, DoorChild, WallSegment } from '@/store/types';

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

function makeLight(): LightChild {
  return {
    id: 'light-1',
    name: 'Light 1',
    childType: 'light',
    visible: true,
    color: '#ffdd88',
    radius: 6,
    featherRadius: 0,
    intensity: 0.4,
    falloff: 'quadratic',
    position: { x: 0, y: 0 },
  };
}

function makeDoor(): DoorChild {
  return {
    id: 'door-1',
    name: 'Single 1',
    childType: 'door',
    visible: true,
    wallId: '',
    position: [0, 0],
    angle: 0,
    width: 1,
    style: 'single',
    state: 'closed',
    isSecret: false,
  };
}

const labels = (rows: MenuRow[]): string[] =>
  rows.map((r) => ('label' in r ? r.label : '?'));

const ctx = (child: LightChild | DoorChild) => ({
  layer: layer(),
  child,
  selectedIds: [child.id],
  world: { x: 0, y: 0 },
});

beforeEach(() => {
  vi.clearAllMocks();
  undoManager.clear();
  useStore.getState().resetToDefault();
});

describe('buildChildMenu', () => {
  it('builds a light menu: header, sliders, swatches, shared verbs, danger last', () => {
    const light = makeLight();
    useStore.getState().addChild(layer().id, light);
    const rows = buildChildMenu(ctx(light));
    const types = rows.map((r) => ('type' in r && r.type ? r.type : 'action'));
    expect(types[0]).toBe('header');
    expect(types).toContain('slider');
    expect(types).toContain('swatches');
    const last = rows[rows.length - 1] as ContextMenuItem;
    expect(last.label).toBe('Delete');
    expect(last.danger).toBe(true);
  });

  it('slider commit writes one undo entry with the drag-start value as before', () => {
    const light = makeLight();
    useStore.getState().addChild(layer().id, light);
    const rows = buildChildMenu(ctx(light));
    const dim = rows.find((r) => 'type' in r && r.type === 'slider' && r.label === 'Dim (ft)');
    if (!dim || !('onCommit' in dim)) throw new Error('no dim slider');
    dim.onChange(40);
    dim.onCommit(45, 30);
    const now = layer().children.find((c) => c.id === 'light-1') as LightChild;
    expect(now.radius).toBe(9);
    undoManager.undo();
    const back = layer().children.find((c) => c.id === 'light-1') as LightChild;
    expect(back.radius).toBe(6);
  });

  it('light menu: Bright and Dim in feet on the card range, then intensity and the preset colours', () => {
    const light = makeLight();
    useStore.getState().addChild(layer().id, light);
    const rows = buildChildMenu(ctx(light));
    const sliders = rows.filter((r): r is MenuSliderRow => 'type' in r && r.type === 'slider');
    expect(sliders.map((s) => s.label)).toEqual(['Bright (ft)', 'Dim (ft)', 'Intensity']);
    expect(sliders.slice(0, 2).map((s) => [s.min, s.max, s.step])).toEqual([
      [LIGHT_RADIUS_FT.min, LIGHT_RADIUS_FT.max, LIGHT_RADIUS_FT.step],
      [LIGHT_RADIUS_FT.min, LIGHT_RADIUS_FT.max, LIGHT_RADIUS_FT.step],
    ]);
    expect(sliders[1].value).toBe(30);
    const swatches = rows.find((r): r is MenuSwatchesRow => 'type' in r && r.type === 'swatches');
    expect(swatches?.optionNames).toEqual(['Torch', 'Lantern', 'Candle', 'Brazier', 'Magical']);
    expect(swatches?.options[0]).toBe('#ffb561');
  });

  it('light menu: dragging bright past dim carries dim, and the drop is one undo step for both', () => {
    const light = makeLight();
    useStore.getState().addChild(layer().id, light);
    const rows = buildChildMenu(ctx(light));
    const bright = rows.find((r): r is MenuSliderRow => 'type' in r && r.type === 'slider' && r.label === 'Bright (ft)')!;
    bright.onChange(50);
    let now = layer().children.find((c) => c.id === 'light-1') as LightChild;
    expect([now.featherRadius, now.radius]).toEqual([10, 10]);
    bright.onCommit(50, 0);
    now = layer().children.find((c) => c.id === 'light-1') as LightChild;
    expect([now.featherRadius, now.radius]).toEqual([10, 10]);
    undoManager.undo();
    now = layer().children.find((c) => c.id === 'light-1') as LightChild;
    expect([now.featherRadius, now.radius]).toEqual([0, 6]);
  });

  it('a darkness source has no colour row in its menu', () => {
    useStore.getState().addChild(layer().id, { ...makeLight(), darkness: true });
    const rows = buildChildMenu(ctx(layer().children.find((c) => c.id === 'light-1') as LightChild));
    expect(rows.some((r) => 'type' in r && r.type === 'swatches')).toBe(false);
  });

  it('door menu offers open/lock/style and no duplicate — doors belong to their wall', () => {
    const door = makeDoor();
    useStore.getState().addChild(layer().id, door);
    const rows = buildChildMenu(ctx(door));
    expect(labels(rows)).toContain('Open');
    expect(labels(rows)).toContain('Lock');
    expect(labels(rows)).toContain('Style');
    expect(labels(rows)).not.toContain('Duplicate');
  });

  it('a style picked from the menu takes the width with it, one undo step', () => {
    const door = makeDoor();
    useStore.getState().addChild(layer().id, door);
    const style = buildChildMenu(ctx(door)).find((r) => 'type' in r && r.type === 'submenu' && r.label === 'Style');
    if (!style || !('rows' in style)) throw new Error('no Style submenu');
    const double = style.rows.find((r) => 'label' in r && r.label === 'Double') as { onSelect: () => void };
    double.onSelect();
    const now = layer().children.find((c) => c.id === 'door-1') as DoorChild;
    expect(now.style).toBe('double');
    expect(now.width).toBe(2);
    undoManager.undo();
    const back = layer().children.find((c) => c.id === 'door-1') as DoorChild;
    expect([back.style, back.width]).toEqual(['single', 1]);
  });

  it('a style picked from the menu keeps a wide door on a doorway piece the run has room for', () => {
    const piece = (id: string, a: number, b: number): WallSegment => ({
      id, points: [[a, 0], [b, 0]], wallType: 'normal', direction: 'both', color: '#000', roughness: 0,
    });
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.id === layer().id) as DungeonLayer;
      l.standaloneWalls = [piece('left', 0, 8), piece('gap', 8, 10), piece('right', 10, 16)];
    });
    const door = { ...makeDoor(), wallId: 'gap', position: [9, 0] as [number, number], width: 3, style: 'double' as const };
    useStore.getState().addChild(layer().id, door);
    const style = buildChildMenu(ctx(door)).find((r) => 'type' in r && r.type === 'submenu' && r.label === 'Style');
    if (!style || !('rows' in style)) throw new Error('no Style submenu');
    ;(style.rows.find((r) => 'label' in r && r.label === 'Single') as { onSelect: () => void }).onSelect();
    const now = layer().children.find((c) => c.id === 'door-1') as DoorChild;
    // Wider than its 2-cell piece, and still there: the walls either side carry on.
    expect([now.style, now.width]).toEqual(['single', 3]);
    // …and the walls either side are trimmed back to its edges, in the same undo step.
    const pts = (id: string) => layer().standaloneWalls.find((w) => w.id === id)!.points
    expect(pts('left')).toEqual([[0, 0], [7.5, 0]])
    expect(pts('right')).toEqual([[10.5, 0], [16, 0]])
    undoManager.undo()
    expect(pts('left')).toEqual([[0, 0], [8, 0]])
  });

  it('disables EVERY interactive row on a locked layer, sliders and swatches included', () => {
    const light = makeLight();
    useStore.getState().addChild(layer().id, light);
    useStore.getState().updateLayer(layer().id, { locked: true });
    const rows = buildChildMenu(ctx(light));
    // The gate walk proved 'onSelect' in r alone let sliders, swatches and
    // thumb strips write through the lock — assert every non-header row.
    const flat = (rs: MenuRow[]): MenuRow[] =>
      rs.flatMap((r) => ('type' in r && r.type === 'submenu' ? [r, ...flat(r.rows)] : [r]));
    for (const r of flat(rows)) {
      if ('type' in r && r.type === 'header') continue;
      expect((r as { disabled?: boolean }).disabled, JSON.stringify(r).slice(0, 80)).toBe(true);
    }
    // The header explains the grey instead of leaving it silent.
    const header = rows[0];
    expect('sublabel' in header && header.sublabel).toBe('Layer is locked');
  });

  it('locked-layer callbacks refuse instead of writing — the seam backstop', () => {
    const light = makeLight();
    useStore.getState().addChild(layer().id, light);
    useStore.getState().updateLayer(layer().id, { locked: true });
    const rows = buildChildMenu(ctx(light));
    const slider = rows.find((r) => 'type' in r && r.type === 'slider');
    const swatches = rows.find((r) => 'type' in r && r.type === 'swatches');
    if (!slider || !('onCommit' in slider) || !swatches || !('onPick' in swatches)) {
      throw new Error('light menu missing slider/swatches');
    }
    slider.onChange(11.5);
    slider.onCommit(11.5, 6);
    swatches.onPick('#ff7a5e');
    const after = layer().children.find((c) => c.id === 'light-1') as LightChild;
    expect(after.radius).toBe(6);
    expect(after.color).toBe('#ffdd88');
    expect(undoManager.canUndo()).toBe(false);
  });

  it('falls back to header + shared verbs for an unregistered kind', () => {
    const odd = { ...makeLight(), childType: 'mystery' } as unknown as LightChild;
    useStore.getState().addChild(layer().id, odd);
    const rows = buildChildMenu(ctx(odd));
    expect(labels(rows)).toContain('Duplicate');
    expect(labels(rows)).toContain('Delete');
  });

  it('a later registerMenu call replaces the builder for that kind', () => {
    registerMenu('light', () => [{ label: 'Custom', onSelect: () => {} }]);
    const light = makeLight();
    useStore.getState().addChild(layer().id, light);
    expect(labels(buildChildMenu(ctx(light)))).toEqual(['Custom']);
  });
});

describe('buildMultiMenu', () => {
  it('offers flips only when something in the selection can flip', () => {
    // Lights alone: flips would silently no-op, so they must not appear.
    const a = makeLight();
    const b = { ...makeLight(), id: 'light-2', name: 'Light 2' };
    useStore.getState().addChild(layer().id, a);
    useStore.getState().addChild(layer().id, b);
    useStore.getState().setSelectedIds([a.id, b.id]);
    expect(labels(buildMultiMenu(2))).toEqual([
      '2 selected',
      'Duplicate',
      'Move to layer',
      'Group selection',
      'Merge selection',
      'Delete',
    ]);
  });

  it('offers the full shared-verb intersection for a flippable selection', () => {
    const light = makeLight();
    const shape = {
      id: 'shape-1',
      name: 'Room',
      childType: 'shape',
      visible: true,
      shapeType: 'rectangle',
      contours: [[[0, 0], [4, 0], [4, 4], [0, 4]]],
      roughnessEnabled: false,
      textureScale: 1,
      textureOffsetX: 0,
      textureOffsetY: 0,
      textureFillRotation: 0,
      textureTint: '#ffffff',
    };
    useStore.getState().addChild(layer().id, light);
    useStore.getState().addChild(layer().id, shape as unknown as LightChild);
    useStore.getState().setSelectedIds([light.id, 'shape-1']);
    expect(labels(buildMultiMenu(2))).toEqual([
      '2 selected',
      'Duplicate',
      'Flip horizontal',
      'Flip vertical',
      'Rotate 90°',
      'Move to layer',
      'Group selection',
      'Merge selection',
      'Delete',
    ]);
  });

  it('swaps the group verbs for Ungroup once the selection is one group', () => {
    const a = makeLight();
    const b = { ...makeLight(), id: 'light-2', name: 'Light 2' };
    useStore.getState().addChild(layer().id, a);
    useStore.getState().addChild(layer().id, b);
    useStore.getState().setSelectedIds([a.id, b.id]);
    groupSelection();
    const rows = labels(buildMultiMenu(2));
    expect(rows).toContain('Ungroup');
    expect(rows).toContain('Duplicate group');
    expect(rows).toContain('Delete group');
    expect(rows).not.toContain('Group selection');
  });

  it('labels a merged group Unmerge', () => {
    const a = makeLight();
    const b = { ...makeLight(), id: 'light-2', name: 'Light 2' };
    useStore.getState().addChild(layer().id, a);
    useStore.getState().addChild(layer().id, b);
    useStore.getState().setSelectedIds([a.id, b.id]);
    mergeSelection();
    expect(labels(buildMultiMenu(2))).toContain('Unmerge');
  });
});

describe('group verbs on a single child', () => {
  it('offers Remove from group and Select group for a plain-group member', () => {
    const a = makeLight();
    const b = { ...makeLight(), id: 'light-2', name: 'Light 2' };
    useStore.getState().addChild(layer().id, a);
    useStore.getState().addChild(layer().id, b);
    useStore.getState().setSelectedIds([a.id, b.id]);
    groupSelection();
    useStore.getState().setSelectedIds([a.id]);
    const member = layer().children.find((c) => c.id === a.id) as LightChild;
    const rows = buildChildMenu({ ...ctx(member), child: member });
    expect(labels(rows)).toContain('Remove from group');
    expect(labels(rows)).toContain('Select group');
    // One member of a two-member group is not the whole group.
    expect(labels(rows)).not.toContain('Delete group');
  });
});

describe('buildCanvasMenu', () => {
  it('disables paste with an empty clipboard and pastes centred on the point with one', () => {
    const empty = buildCanvasMenu({ x: 5, y: 5 });
    const pasteRow = empty.find((r) => 'label' in r && r.label === 'Paste here') as ContextMenuItem;
    expect(pasteRow.disabled).toBe(true);

    const light = makeLight();
    useStore.getState().setClipboard({ children: [light] });
    const rows = buildCanvasMenu({ x: 5, y: 7 });
    const paste = rows.find((r) => 'label' in r && r.label === 'Paste here') as ContextMenuItem;
    expect(paste.disabled).toBeFalsy();
    paste.onSelect();
    const pasted = layer().children.find((c) => c.childType === 'light') as LightChild;
    expect(pasted.position).toEqual({ x: 5, y: 7 });
  });
});

describe('buildWallMenu', () => {
  const wall = (): WallSegment => ({
    id: 'wall-1',
    points: [[0, 1], [10, 1]],
    wallType: 'normal',
    direction: 'both',
    color: '#000000',
    roughness: 0,
  });
  const boundDoor = (): DoorChild => ({ ...makeDoor(), wallId: 'wall-1', position: [5, 1] });
  const wallCtx = () => ({ layer: layer(), wall: layer().standaloneWalls[0] });

  it('names the wall and its set, and ends with Delete', () => {
    useStore.getState().addWall(layer().id, wall());
    const rows = buildWallMenu(wallCtx());
    const header = rows[0] as { type: string; label: string; sublabel?: string };
    expect(header).toMatchObject({ type: 'header', label: 'Wall', sublabel: 'Fieldstone' });
    const last = rows[rows.length - 1] as ContextMenuItem;
    expect([last.label, last.danger]).toEqual(['Delete', true]);
    // A wall moves, turns and copies whole like anything else (Selection & editing).
    expect(labels(rows)).toContain('Duplicate');
  });

  it('Delete removes the wall and the door on it, one undo', () => {
    useStore.getState().addWall(layer().id, wall());
    useStore.getState().addChild(layer().id, boundDoor());
    useStore.getState().setSelectedIds(['wall-1']);
    const del = buildWallMenu(wallCtx()).at(-1) as { onSelect: () => void };
    del.onSelect();
    expect(layer().standaloneWalls).toHaveLength(0);
    expect(layer().children).toHaveLength(0);
    undoManager.undo();
    expect(layer().standaloneWalls).toHaveLength(1);
    expect(layer().children).toHaveLength(1);
  });

  it('Move to layer carries the wall and its doors, one undo', () => {
    useStore.getState().addWall(layer().id, wall());
    useStore.getState().addChild(layer().id, boundDoor());
    const other = { ...layer(), id: 'other', name: 'Upper', children: [], standaloneWalls: [] } as DungeonLayer;
    useStore.getState().addLayer(other);
    useStore.getState().setSelectedIds(['wall-1']);
    const move = buildWallMenu(wallCtx()).find((r) => 'type' in r && r.type === 'submenu' && r.label === 'Move to layer');
    if (!move || !('rows' in move)) throw new Error('no Move to layer');
    (move.rows.find((r) => 'label' in r && r.label === 'Upper') as { onSelect: () => void }).onSelect();
    const upper = useStore.getState().layers.find((l) => l.id === 'other') as DungeonLayer;
    expect(upper.standaloneWalls.map((w) => w.id)).toEqual(['wall-1']);
    expect(upper.children.map((c) => c.id)).toEqual(['door-1']);
    expect(layer().standaloneWalls).toHaveLength(0);
    expect(layer().children).toHaveLength(0);
    undoManager.undo();
    expect(layer().standaloneWalls).toHaveLength(1);
    expect(layer().children).toHaveLength(1);
  });

  it('on a locked layer every row is disabled and says why', () => {
    useStore.getState().addWall(layer().id, wall());
    useStore.getState().updateLayer(layer().id, { locked: true });
    const rows = buildWallMenu(wallCtx());
    expect((rows[0] as { sublabel?: string }).sublabel).toBe('Layer is locked');
    const del = rows.at(-1) as ContextMenuItem & { onSelect: () => void };
    expect(del.disabled).toBe(true);
    del.onSelect();
    expect(layer().standaloneWalls).toHaveLength(1);
  });
});

describe('buildRoomMenu / buildAreaMenu', () => {
  const sq = (x0: number, x1: number): [number, number][] => [[x0, 0], [x1, 0], [x1, 4], [x0, 4]];
  const rooms = () => [
    { id: 'r1', name: 'Hall', number: 1, anchor: [2, 2] as [number, number], face: sq(0, 4) },
    { id: 'r2', name: 'Store', number: 2, anchor: [6, 2] as [number, number], face: sq(4, 8) },
  ];
  const room = (id: string) => layer().rooms!.find((r) => r.id === id)!;
  const roomCtx = (id: string, selectedIds = [id]) => ({ layer: layer(), room: room(id), selectedIds, world: { x: 3, y: 1 } });
  const row = (rows: MenuRow[], label: string) => rows.find((r) => 'label' in r && r.label === label) as (ContextMenuItem & { onSelect: () => void }) | undefined;

  beforeEach(() => {
    useStore.getState().setRooms(layer().id, rooms());
  });

  it('a room menu: header, Rename, Open key, Split here, Add to area, Delete room last', () => {
    const rows = buildRoomMenu(roomCtx('r1'));
    expect(labels(rows)).toEqual(['1 · Hall', 'Rename', 'Open key', 'Split here', 'Add to area', 'Delete room']);
    expect((rows.at(-1) as { danger?: boolean }).danger).toBe(true);
  });

  it('Rename asks for a name and renames, one undo', async () => {
    roomNamePromptRef.current = () => 'Great Hall';
    row(buildRoomMenu(roomCtx('r1')), 'Rename')!.onSelect();
    await Promise.resolve();
    await Promise.resolve();
    expect(room('r1').name).toBe('Great Hall');
    undoManager.undo();
    expect(room('r1').name).toBe('Hall');
    roomNamePromptRef.current = null;
  });

  it('Open key opens the sheet on that room', () => {
    row(buildRoomMenu(roomCtx('r2')), 'Open key')!.onSelect();
    expect(useStore.getState().ui.roomsSheetOpen).toBe(true);
    expect(useStore.getState().ui.roomsSheetRoomId).toBe('r2');
  });

  it('Split here hands Divide a threshold line starting at the click', () => {
    useStore.getState().setDividerMode('wall');
    row(buildRoomMenu(roomCtx('r1')), 'Split here')!.onSelect();
    const s = useStore.getState();
    expect(s.tools.activeTool).toBe('divide');
    expect(s.ui.dividerMode).toBe('threshold');
  });

  it('with two rooms selected: Merge with the other, keeping the right-clicked one', () => {
    const rows = buildRoomMenu(roomCtx('r1', ['r1', 'r2']));
    expect(rows[0]).toMatchObject({ label: '2 rooms' });
    row(rows, 'Merge with Store')!.onSelect();
    expect(layer().rooms!.map((r) => r.id)).toEqual(['r1']);
    expect(useStore.getState().selection.selectedIds).toEqual(['r1']);
    undoManager.undo();
    expect(layer().rooms!.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('Add to area ▸ New area groups the selected rooms; the area menu renames and removes it', async () => {
    const add = buildRoomMenu(roomCtx('r1', ['r1', 'r2'])).find((r) => 'type' in r && r.type === 'submenu') as { rows: MenuRow[] };
    row(add.rows, 'New area')!.onSelect();
    const area = layer().areas![0];
    expect(area.name).toBe('Area 1');
    expect(layer().rooms!.every((r) => r.areaId === area.id)).toBe(true);

    const areaRows = buildAreaMenu({ layer: layer(), area });
    expect(labels(areaRows)).toEqual(['Area 1', 'Rename', 'Remove area']);
    roomNamePromptRef.current = () => 'East wing';
    row(areaRows, 'Rename')!.onSelect();
    await Promise.resolve();
    await Promise.resolve();
    expect(layer().areas![0].name).toBe('East wing');
    roomNamePromptRef.current = null;

    row(buildAreaMenu({ layer: layer(), area: layer().areas![0] }), 'Remove area')!.onSelect();
    expect(layer().areas ?? []).toHaveLength(0);
    expect(layer().rooms!.every((r) => !r.areaId)).toBe(true);
  });

  it('Delete room removes the room and keeps the floor', () => {
    row(buildRoomMenu(roomCtx('r2')), 'Delete room')!.onSelect();
    expect(layer().rooms!.map((r) => r.id)).toEqual(['r1']);
  });

  it('on a locked layer every row is disabled', () => {
    useStore.getState().updateLayer(layer().id, { locked: true });
    const rows = buildRoomMenu(roomCtx('r1'));
    expect((rows[0] as { sublabel?: string }).sublabel).toBe('Layer is locked');
    const del = rows.at(-1) as ContextMenuItem & { onSelect: () => void };
    del.onSelect();
    expect(layer().rooms).toHaveLength(2);
  });
});

// ─── Props ────────────────────────────────────────────────

const catalogEntry = (material: string, over: Partial<ManifestEntry> = {}): ManifestEntry => ({
  type: 'object',
  material,
  gridSize: '1x1',
  pieceType: 'object',
  variant: 'A',
  set: 'demo-furniture',
  tags: [],
  ...over,
});

function prop(id: string, assetId: string, patch: Partial<AssetChild> = {}): AssetChild {
  return {
    id,
    name: id,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId,
    position: { x: 5, y: 5 },
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
    ...patch,
  };
}

const propCtx = (child: AssetChild) => ({ layer: layer(), child, selectedIds: [child.id], world: { x: 0, y: 0 } });
const row = <T extends MenuRow>(rows: MenuRow[], label: string): T =>
  rows.find((r) => 'label' in r && r.label.startsWith(label)) as T;
const childById = (id: string) => layer().children.find((c) => c.id === id) as AssetChild | undefined;

describe('prop menus', () => {
  beforeAll(() => {
    resetAssetPackManager();
    const manager = getAssetPackManager();
    const cache = (manager as unknown as { manifestCache: Map<string, PackManifest> }).manifestCache;
    cache.set('p', {
      name: 'test',
      description: '',
      version: '0.0.1',
      bundleSize: 0,
      atlases: {},
      files: {},
      entries: {
        crate_1: catalogEntry('crate_1', { family: 'crate', set: 'demo-storage' }),
        crate_2: catalogEntry('crate_2', { family: 'crate', set: 'demo-storage' }),
        crate_big: catalogEntry('crate_3', { family: 'crate', set: 'demo-storage', gridSize: '2x2' }),
        barrel: catalogEntry('barrel', { set: 'demo-storage' }),
        stool: catalogEntry('stool'),
        table: catalogEntry('table', { gridSize: '2x2' }),
        bench: catalogEntry('bench', { gridSize: '2x1' }),
        chair: catalogEntry('chair'),
      },
    } as PackManifest);
    manager.catalogVersion++;
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
    openPropBrowserRef.current = null;
  });

  it('offers the family in the Swap strip and swaps keeping the footprint', () => {
    const crate = prop('c', 'p:crate_1', { width: 1.5, height: 1.5 });
    useStore.getState().addChild(layer().id, crate);
    const strip = row<MenuThumbStripRow>(buildChildMenu(propCtx(crate)), 'Swap');
    expect(strip.label).toBe('Swap · same family, same footprint');
    expect(strip.items.map((i) => i.id)).toEqual(['p:crate_1', 'p:crate_2', 'p:crate_big']);
    expect(strip.items.find((i) => i.active)?.id).toBe('p:crate_1');

    strip.onPick('p:crate_2');
    expect(childById('c')?.assetId).toBe('p:crate_2');
    expect(childById('c')?.width).toBe(1.5);
    undoManager.undo();
    expect(childById('c')?.assetId).toBe('p:crate_1');
  });

  it('falls back to the set, nearest size first, for a prop alone in its family', () => {
    const stool = prop('s', 'p:stool');
    useStore.getState().addChild(layer().id, stool);
    const strip = row<MenuThumbStripRow>(buildChildMenu(propCtx(stool)), 'Swap');
    expect(strip.label).toBe('Swap · same set, same footprint');
    expect(strip.items.map((i) => i.id)).toEqual(['p:stool', 'p:chair', 'p:bench', 'p:table']);
  });

  it('keeps the v1 menu free of the v2 verbs', () => {
    const crate = prop('c', 'p:crate_1');
    useStore.getState().addChild(layer().id, crate);
    openPropBrowserRef.current = vi.fn();
    const rows = labels(buildChildMenu(propCtx(crate)));
    for (const verb of ['Replace from library…', 'Order', 'Overhead', 'Lock']) expect(rows).not.toContain(verb);
  });

  it('on v2 adds Replace from library, Order, Overhead and Lock', () => {
    window.history.pushState({}, '', '/v2');
    const open = vi.fn();
    openPropBrowserRef.current = open;
    useStore.getState().addChild(layer().id, prop('under', 'p:barrel'));
    const crate = prop('c', 'p:crate_1');
    useStore.getState().addChild(layer().id, crate);
    const rows = buildChildMenu(propCtx(crate));
    expect(labels(rows)).toEqual([
      'c',
      'Swap · same family, same footprint',
      'Replace from library…',
      'Flip horizontal',
      'Flip vertical',
      'Rotate 90°',
      'Order',
      'Overhead',
      'Glows',
      'Blocks light',
      'Lock',
      'Duplicate',
      'Hide',
      'Move to layer',
      'Delete',
    ]);

    row<ContextMenuItem>(rows, 'Replace from library').onSelect();
    expect(open).toHaveBeenCalledWith(['c']);

    const order = row<MenuSubmenuRow>(rows, 'Order');
    expect(labels(order.rows)).toEqual(['Bring to front', 'Bring forward', 'Send backward', 'Send to back']);
    row<ContextMenuItem>(order.rows, 'Send to back').onSelect();
    expect(layer().children.map((c) => c.id)).toEqual(['c', 'under']);

    row<MenuToggleRow>(rows, 'Overhead').onToggle(true);
    expect(childById('c')?.overhead).toBe(true);

    row<MenuToggleRow>(rows, 'Glows').onToggle(true);
    expect(childById('c')?.glows).toBe(true);
    row<MenuToggleRow>(rows, 'Blocks light').onToggle(true);
    expect(childById('c')?.blocksLight).toBe(true);
    undoManager.undo();
    expect(childById('c')?.blocksLight).toBeFalsy();

    row<ContextMenuItem>(rows, 'Lock').onSelect();
    expect(childById('c')?.locked).toBe(true);
  });

  it('closes the menu once a swap is picked', () => {
    const crate = prop('c', 'p:crate_1');
    useStore.getState().addChild(layer().id, crate);
    expect(row<MenuThumbStripRow>(buildChildMenu(propCtx(crate)), 'Swap').closeOnPick).toBe(true);
  });

  it('draws Overhead as a check that reads the prop: empty when it is not overhead', () => {
    window.history.pushState({}, '', '/v2');
    const crate = prop('c', 'p:crate_1');
    const web = prop('w', 'p:barrel', { overhead: true });
    useStore.getState().addChild(layer().id, crate);
    useStore.getState().addChild(layer().id, web);
    const off = row<MenuToggleRow>(buildChildMenu(propCtx(crate)), 'Overhead');
    expect(off.checked).toBe(false);
    expect(off.look).toBe('check');
    expect(row<MenuToggleRow>(buildChildMenu(propCtx(web)), 'Overhead').checked).toBe(true);
  });

  it('Move to layer lists the active level only, the prop’s own layer greyed, and leaves the level alone', () => {
    const st = useStore.getState();
    const home = layer();
    st.addLevel({ id: 'lv2', name: 'Level 2' });
    st.addLayer(createDungeonLayer('Upper', home.levelId));
    st.addLayer(createDungeonLayer('Cellar', 'lv2'));
    st.setActiveLayerId(home.id);
    const crate = prop('c', 'p:crate_1');
    st.addChild(home.id, crate);
    st.setSelectedIds(['c']);
    const move = row<MenuSubmenuRow>(buildChildMenu(propCtx(crate)), 'Move to layer');
    expect(labels(move.rows)).toEqual([home.name, 'Upper']);
    expect((move.rows[0] as ContextMenuItem).disabled).toBe(true);
    expect((move.rows[1] as ContextMenuItem).disabled).toBeFalsy();
    row<ContextMenuItem>(move.rows, 'Upper').onSelect();
    const upper = useStore.getState().layers.find((l) => l.name === 'Upper') as DungeonLayer;
    expect(upper.children.map((c) => c.id)).toEqual(['c']);
    expect(useStore.getState().ui.activeLevelId).toBe(home.levelId);
  });

  it('Move to layer says so when the level has no other layer', () => {
    const st = useStore.getState();
    st.addLevel({ id: 'lv2', name: 'Level 2' });
    st.addLayer(createDungeonLayer('Cellar', 'lv2'));
    st.setActiveLayerId(layer().id);
    const crate = prop('c', 'p:crate_1');
    st.addChild(layer().id, crate);
    const move = row<MenuSubmenuRow>(buildChildMenu(propCtx(crate)), 'Move to layer');
    expect(labels(move.rows)).toEqual(['No other layer on this level']);
    expect((move.rows[0] as ContextMenuItem).disabled).toBe(true);
  });

  it('gives a locked prop only its header and Unlock', () => {
    const crate = prop('c', 'p:crate_1', { locked: true });
    useStore.getState().addChild(layer().id, crate);
    const rows = buildChildMenu(propCtx(crate));
    expect(labels(rows)).toEqual(['c', 'Unlock']);
    expect((rows[0] as { sublabel?: string }).sublabel).toBe('Prop · locked');
    row<ContextMenuItem>(rows, 'Unlock').onSelect();
    expect(childById('c')?.locked).toBe(false);
  });

  it('adds Align, Distribute, Order and Lock all to a v2 multi menu of props', () => {
    window.history.pushState({}, '', '/v2');
    useStore.getState().addChild(layer().id, prop('a', 'p:crate_1', { position: { x: 2, y: 2 } }));
    useStore.getState().addChild(layer().id, prop('b', 'p:crate_1', { position: { x: 6, y: 4 } }));
    useStore.getState().setSelectedIds(['a', 'b']);
    let rows = buildMultiMenu(2);
    expect(labels(rows)).toEqual(expect.arrayContaining(['Align', 'Distribute', 'Order', 'Lock all']));
    // Distributing needs three.
    expect(row<MenuSubmenuRow>(rows, 'Distribute').disabled).toBe(true);

    row<ContextMenuItem>(row<MenuSubmenuRow>(rows, 'Align').rows, 'Left edges').onSelect();
    expect(childById('b')?.position.x).toBeCloseTo(2);

    useStore.getState().addChild(layer().id, prop('c', 'p:crate_1', { position: { x: 9, y: 9 } }));
    useStore.getState().setSelectedIds(['a', 'b', 'c']);
    rows = buildMultiMenu(3);
    expect(row<MenuSubmenuRow>(rows, 'Distribute').disabled).toBe(false);
    row<ContextMenuItem>(rows, 'Lock all').onSelect();
    expect(['a', 'b', 'c'].every((id) => childById(id)?.locked)).toBe(true);
  });

  it('takes locked props into Select all in layer, as Ctrl+A does (their card unlocks them)', () => {
    useStore.getState().addChild(layer().id, prop('rug', 'p:crate_1', { locked: true }));
    useStore.getState().addChild(layer().id, prop('crate', 'p:crate_1'));
    row<ContextMenuItem>(buildCanvasMenu({ x: 0, y: 0 }), 'Select all in layer').onSelect();
    expect(useStore.getState().selection.selectedIds).toEqual(['rug', 'crate']);
  });
});
