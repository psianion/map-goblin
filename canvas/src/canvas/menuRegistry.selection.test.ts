import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() }),
}));

import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { MenuPickListRow, MenuRow } from '@/editor/RowMenu';
import type { AnyChild, DungeonLayer, SerializedMapData } from '@/store/types';
import type { WallSegment } from '@/shared/types';
import { buildCanvasMenu, buildChildMenu, buildMultiMenu, buildWallMenu, pickHereRow } from './menuRegistry';
import { setClipperModule } from '@/geometry/Clipper2Engine';
import { setLightPicking, setRoomPicking } from '@dnd/core/src/engine/hitTest';
import { setMarqueeKinds } from '@dnd/core/src/engine/marqueeFilter';
import { getPickHighlight, setPickHighlight } from './pickHighlight';
import { refreshRooms } from '@dnd/core/src/store/roomRefresh';
import { migrateToLatest } from '@dnd/core/src/store/migration';
import goblinWarren from '../../../session/testdata/goblin-warren.mapbuilder?raw';

const layer = (): DungeonLayer => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const labels = (rows: MenuRow[]) => rows.map((r) => ('label' in r ? r.label : ''));
const row = (rows: MenuRow[], label: string) => rows.find((r) => 'label' in r && r.label === label) as MenuRow & { onSelect?: () => void; rows?: MenuRow[] };

const asset = (id: string, x: number, extra: Record<string, unknown> = {}): AnyChild => {
  const a = {
    id, name: id, childType: 'asset', visible: true, objectType: 'asset', assetId: 'a', position: { x, y: 0 }, rotation: 0,
    scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false, ...extra,
  } as unknown as AnyChild;
  useStore.getState().addChild(layer().id, a);
  return a;
};
const floor = (id: string): AnyChild => {
  const f = { id, name: id, childType: 'shape', visible: true, shapeType: 'polygon', contours: [[[-5, -5], [5, -5], [5, 5], [-5, 5]]] } as unknown as AnyChild;
  useStore.getState().addChild(layer().id, f);
  return f;
};
const wall = (id: string): WallSegment => {
  const w = { id, points: [[-2, 0], [2, 0]], wallType: 'normal', direction: 'both', color: '#000', roughness: 0, width: 0.3 } as WallSegment;
  useStore.getState().addWall(layer().id, w);
  return w;
};
const door = (id: string, wallId: string): AnyChild => {
  const d = { id, name: id, childType: 'door', visible: true, wallId, position: [0, 0], angle: 0, width: 1, style: 'single', state: 'closed', isSecret: false } as unknown as AnyChild;
  useStore.getState().addChild(layer().id, d);
  return d;
};

describe('menus for the one selection path', () => {
  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().setActiveTool('select');
  });

  it('the wall menu offers Duplicate, flips, Rotate 90°, Lock and Hide', () => {
    const w = wall('w');
    const rows = buildWallMenu({ layer: layer(), wall: w, world: { x: 0, y: 0 } });
    for (const l of ['Duplicate', 'Flip horizontal', 'Flip vertical', 'Rotate 90°', 'Lock', 'Hide', 'Delete']) {
      expect(labels(rows)).toContain(l);
    }
  });

  it('a locked wall’s menu offers Unlock', () => {
    const w = wall('w');
    useStore.getState().updateWall(layer().id, 'w', { locked: true });
    const rows = buildWallMenu({ layer: layer(), wall: { ...w, locked: true }, world: { x: 0, y: 0 } });
    expect(labels(rows)).toContain('Unlock');
    expect(labels(rows)).not.toContain('Delete');
  });

  it('Duplicate in the wall menu copies the wall', () => {
    const w = wall('w');
    useStore.getState().setSelectedIds(['w']);
    row(buildWallMenu({ layer: layer(), wall: w, world: { x: 0, y: 0 } }), 'Duplicate').onSelect!();
    expect(layer().standaloneWalls).toHaveLength(2);
  });

  it('a door menu has no Duplicate', () => {
    wall('w');
    const d = door('d', 'w');
    const rows = buildChildMenu({ layer: layer(), child: d, selectedIds: ['d'], world: { x: 0, y: 0 } });
    expect(labels(rows)).not.toContain('Duplicate');
  });

  const lamp = (id: string, x: number): AnyChild => {
    const l = { id, name: id, childType: 'light', visible: true, color: '#fff', radius: 4, featherRadius: 2, intensity: 1, falloff: 'linear', position: { x, y: 0 } } as unknown as AnyChild;
    useStore.getState().addChild(layer().id, l);
    return l;
  };
  const items = (r: MenuPickListRow | null) => r?.items ?? [];

  it('Pick from here lists everything under the point, top first, each with its kind and layer', () => {
    floor('f');
    wall('w');
    asset('p', 0);
    const list = pickHereRow({ x: 0, y: 0 })!;
    expect(list.type).toBe('pickList');
    expect(list.label).toBe('Pick from here');
    expect(items(list).map((i) => [i.label, i.kind])).toEqual([
      ['p', 'Prop'],
      ['Wall', 'Wall'],
      ['f', 'Floor'],
    ]);
    expect(items(list)[0].layer).toBe(layer().name || 'Unnamed layer');
    // A prop shows its own picture; the rest their kind's glyph.
    expect(items(list)[0].thumb?.id).toBe('a');
    expect(items(list)[2].thumb).toBeUndefined();
  });

  it('a click selects that object, Shift-click adds it', () => {
    floor('f');
    asset('p', 0);
    useStore.getState().setSelectedIds(['p']);
    const [p, f] = items(pickHereRow({ x: 0, y: 0 }));
    expect(p.selected).toBe(true);
    f.onPick(false);
    expect(useStore.getState().selection.selectedIds).toEqual(['f']);
    p.onPick(true);
    expect(useStore.getState().selection.selectedIds).toEqual(['f', 'p']);
  });

  it('pointing at a row outlines that object, leaving it lets go', () => {
    floor('f');
    asset('p', 0);
    const [, f] = items(pickHereRow({ x: 0, y: 0 }));
    f.onHover(true);
    expect(getPickHighlight()).toBe('f');
    f.onHover(false);
    expect(getPickHighlight()).toBeNull();
  });

  it('is absent with one object or none under the point', () => {
    asset('p', 0);
    expect(pickHereRow({ x: 0, y: 0 })).toBeNull();
    expect(pickHereRow({ x: 50, y: 50 })).toBeNull();
  });

  it('lists every object, however deep the stack', () => {
    floor('f');
    for (let i = 0; i < 12; i++) asset(`p${i}`, 0);
    expect(items(pickHereRow({ x: 0, y: 0 }))).toHaveLength(13);
  });

  describe('hidden lights and Pick only', () => {
    afterEach(() => {
      setLightPicking(null);
      setMarqueeKinds(null);
      setPickHighlight(null);
    });

    it('lists lights whose icons are hidden, marked, even one alone, and the empty-ground menu offers them', () => {
      lamp('L1', 0);
      setLightPicking(() => false);
      const list = pickHereRow({ x: 0, y: 0 })!;
      expect(items(list).map((i) => [i.label, i.hidden])).toEqual([['L1', true]]);
      expect(buildCanvasMenu({ x: 0, y: 0 }).some((r) => 'type' in r && r.type === 'pickList')).toBe(true);
    });

    it('keeps to the Pick only kinds; Lights takes hidden lights too', () => {
      floor('f');
      asset('p', 0);
      lamp('L1', 0);
      lamp('L2', 0);
      setLightPicking((l) => l.id !== 'L2');
      setMarqueeKinds(() => ['light']);
      useStore.getState().setMarqueeFilter('tab');
      // Topmost first: the light added last.
      expect(items(pickHereRow({ x: 0, y: 0 })).map((i) => i.label)).toEqual(['L2', 'L1']);
      useStore.getState().setMarqueeFilter('all');
      expect(items(pickHereRow({ x: 0, y: 0 })).map((i) => i.label)).toEqual(['L2', 'L1', 'p', 'f']);
    });
  });

  it('the multi menu offers Lock, Hide, Align and Distribute for a light and a wall', () => {
    wall('w');
    const l = { id: 'l', name: 'l', childType: 'light', visible: true, color: '#fff', radius: 1, featherRadius: 1, intensity: 1, falloff: 'linear', position: { x: 5, y: 5 } } as unknown as AnyChild;
    useStore.getState().addChild(layer().id, l);
    useStore.getState().setSelectedIds(['w', 'l']);
    const rows = buildMultiMenu(2);
    for (const name of ['Lock all', 'Hide', 'Align', 'Distribute']) expect(labels(rows)).toContain(name);
  });

  it('the multi menu hides Duplicate when only doors are selected', () => {
    wall('w');
    door('d1', 'w');
    door('d2', 'w');
    useStore.getState().setSelectedIds(['d1', 'd2']);
    expect(labels(buildMultiMenu(2))).not.toContain('Duplicate');
  });
});

describe('the wall menu on the goblin warren', () => {
  beforeAll(async () => {
    const { readFileSync } = await import('node:fs' as string);
    const { createRequire } = await import('node:module' as string);
    const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
    const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
    setClipperModule(await mod.default({ wasmBinary }));
  }, 30_000);
  afterEach(() => setRoomPicking(false));

  it('the Chief Door wall’s menu has Pick from here with the rooms and the floor under it', () => {
    undoManager.clear();
    useStore.getState().loadFromFile(migrateToLatest(JSON.parse(goblinWarren)) as SerializedMapData);
    refreshRooms();
    setRoomPicking(true);
    const l = layer();
    const w = l.standaloneWalls.find((x) => x.id === 'wall-005')!;
    const [a, b] = w.points;
    // Near its end, past the doorway: the part of the wall a right-click lands on.
    const world = { x: a[0] + (b[0] - a[0]) * 0.1, y: a[1] + (b[1] - a[1]) * 0.1 };
    const here = row(buildWallMenu({ layer: l, wall: w, world }), 'Pick from here') as unknown as MenuPickListRow;
    expect(here).toBeTruthy();
    expect(here.items.length).toBeGreaterThanOrEqual(2);
    expect(here.items[0].label).toBe('Wall');
  });
});
