import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import { undoManager } from '@/store/undoManager';
import type { AnyChild, DungeonLayer, WallSegment } from '@/store/types';
import { notify } from '@/lib/toast';
import { LayersSheet } from './LayersSheet';
import { buildSheetRows, type RowState, type SheetRow } from './layerRows';
import { moveLayerOnto } from './layerActions';
import type { DragEndEvent } from '@dnd-kit/core';
import { CompositeCommand, MoveLayerToLevelCommand } from '@/store/commands';

vi.mock('./layerThumbRender', () => ({
  renderLayerThumb: vi.fn(() => undefined),
  disposeLayerThumbRenderer: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  notify: { action: vi.fn(), subtle: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
// The sheet's own drop handler, kept from its DndContext, so a test can hand it an `over`
// the way dnd-kit's collision detection would (jsdom lays nothing out to collide).
const dnd = vi.hoisted(() => ({ onDragEnd: null as null | ((e: DragEndEvent) => void) }));
vi.mock('@dnd-kit/core', async (orig) => {
  const real = await orig<typeof import('@dnd-kit/core')>();
  const { createElement } = await import('react');
  return {
    ...real,
    DndContext: (props: Parameters<typeof real.DndContext>[0]) => {
      dnd.onDragEnd = props.onDragEnd ?? null;
      return createElement(real.DndContext, props);
    },
  };
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function () {};
});

const crate = (id: string, name = id, extra: Partial<AnyChild> = {}): AnyChild =>
  ({ id, name, childType: 'asset', visible: true, assetId: 't:c', position: { x: 1, y: 1 }, rotation: 0, scale: 1, width: 1, height: 1, ...extra }) as AnyChild;
const wall = (id: string, extra: Partial<WallSegment> = {}): WallSegment =>
  ({ id, points: [[0, 0], [3, 0]], wallType: 'normal', direction: 'both', color: '#000000', roughness: 0, ...extra }) as WallSegment;

/** Ground floor (Warren with walls, rooms and props; Props on top) and a Cellar level with one layer. */
function seed() {
  const ground = useStore.getState().levels[0].id;
  useStore.getState().addLevel({ id: 'lv-cellar', name: 'Cellar' });
  const warren = {
    ...createDungeonLayer('Warren', ground),
    standaloneWalls: [wall('w1'), wall('w2', { locked: true }), wall('w3', { visible: false })],
    rooms: [{ id: 'r1', name: 'Hall', number: 1, anchor: [1, 1] as [number, number] }],
    children: [crate('p-hidden', 'barrel', { visible: false })],
  } as DungeonLayer;
  const props = { ...createDungeonLayer('Props', ground), children: [crate('p1', 'storage crate'), crate('p2', 'wall sconce')] } as DungeonLayer;
  const cellar = createDungeonLayer('Cellar floor', 'lv-cellar');
  useStore.setState((s) => {
    s.layers = [s.layers[0], warren, props, cellar];
    s.ui.expandedLayerIds = [];
    s.ui.childGroupOverrides = [];
  });
  useStore.getState().setActiveLayerId(warren.id);
  return { ground, warren, props, cellar };
}

const state = (over: Partial<RowState> = {}): RowState => {
  const s = useStore.getState();
  return {
    layers: s.layers,
    levels: s.levels,
    activeLevelId: s.ui.activeLevelId,
    expandedLayerIds: s.ui.expandedLayerIds,
    childGroupOverrides: s.ui.childGroupOverrides,
    levelOverrides: new Set(),
    filter: '',
    ...over,
  };
};
const keys = (rows: SheetRow[]) => rows.map((r) => r.key);
const live = (id: string) => useStore.getState().layers.find((l) => l.id === id) as DungeonLayer;
const open = () => render(<LayersSheet open onClose={() => {}} onOpenLayerSettings={() => {}} />);
const layerRow = (name: string) =>
  screen.getAllByTestId('v2-layers-layer').find((r) => r.textContent?.includes(name)) as HTMLElement;
const objectRow = (id: string) => document.querySelector(`[data-object-id="${id}"]`) as HTMLElement;

describe('Layers sheet rows (model)', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('lists no level rows on a one-level map, top of the stack first', () => {
    const level = useStore.getState().levels[0].id;
    const a = createDungeonLayer('A', level);
    const b = createDungeonLayer('B', level);
    useStore.setState((s) => {
      s.layers = [s.layers[0], a, b];
    });
    const rows = buildSheetRows(state());
    expect(rows.map((r) => r.kind)).toEqual(['layer', 'layer']);
    expect(keys(rows)).toEqual([`layer:${b.id}`, `layer:${a.id}`]);
  });

  it('groups by level in store order, the level on show open and the others folded', () => {
    const { ground, props, warren } = seed();
    const rows = buildSheetRows(state());
    expect(rows.filter((r) => r.kind === 'level').map((r) => (r as Extract<SheetRow, { kind: 'level' }>).level.id)).toEqual([ground, 'lv-cellar']);
    expect(keys(rows)).toEqual([`level:${ground}`, `layer:${props.id}`, `layer:${warren.id}`, 'level:lv-cellar']);
    const cellar = rows.at(-1) as Extract<SheetRow, { kind: 'level' }>;
    expect(cellar.layerCount).toBe(1);
    expect(cellar.open).toBe(false);
  });

  it('a level fold the DM changed stays changed', () => {
    const { cellar } = seed();
    const rows = buildSheetRows(state({ levelOverrides: new Set(['lv-cellar']) }));
    expect(keys(rows)).toContain(`layer:${cellar.id}`);
  });

  it('an open layer shows its kinds in the fixed order: rooms, walls, then the children', () => {
    const { warren } = seed();
    const rows = buildSheetRows(state({ expandedLayerIds: [warren.id] }));
    const groups = rows.filter((r) => r.kind === 'group').map((r) => (r as Extract<SheetRow, { kind: 'group' }>).type);
    expect(groups).toEqual(['room', 'wall', 'asset']);
  });

  it('folds Props by default; the override opens it', () => {
    const { warren } = seed();
    const closed = buildSheetRows(state({ expandedLayerIds: [warren.id] }));
    expect(closed.some((r) => r.kind === 'object' && r.id === 'p-hidden')).toBe(false);
    const opened = buildSheetRows(state({ expandedLayerIds: [warren.id], childGroupOverrides: [`${warren.id}:asset`] }));
    expect(opened.some((r) => r.kind === 'object' && r.id === 'p-hidden')).toBe(true);
  });

  it('gives drawn walls rows with their own eye and lock, and rooms rows with neither', () => {
    const { warren } = seed();
    const rows = buildSheetRows(state({ expandedLayerIds: [warren.id] })).filter((r) => r.kind === 'object') as Extract<SheetRow, { kind: 'object' }>[];
    const w2 = rows.find((r) => r.id === 'w2')!;
    const w3 = rows.find((r) => r.id === 'w3')!;
    expect(rows.find((r) => r.id === 'w1')!.name).toBe('Wall 1');
    expect(w2.locked).toBe(true);
    expect(w3.visible).toBe(false);
    const room = rows.find((r) => r.id === 'r1')!;
    expect(room.name).toBe('1 Hall');
    expect(room.visible).toBeUndefined();
  });

  it('matches layer names: the layer stays, tagged, folded', () => {
    const { warren } = seed();
    const rows = buildSheetRows(state({ filter: 'warr' }));
    const row = rows.find((r) => r.key === `layer:${warren.id}`) as Extract<SheetRow, { kind: 'layer' }>;
    expect(row.nameMatch).toBe(true);
    expect(row.open).toBe(false);
  });

  it('matches object names across layers, opens them, and counts the matching layers per level', () => {
    const { ground, warren, props } = seed();
    const rows = buildSheetRows(state({ filter: 'wall' }));
    const ids = rows.filter((r) => r.kind === 'object').map((r) => (r as Extract<SheetRow, { kind: 'object' }>).id);
    expect(ids).toEqual(expect.arrayContaining(['w1', 'w2', 'w3', 'p2']));
    expect(ids).not.toContain('p1');
    const level = rows.find((r) => r.key === `level:${ground}`) as Extract<SheetRow, { kind: 'level' }>;
    expect(level.matchCount).toBe(2);
    expect(rows.some((r) => r.key === `layer:${warren.id}`)).toBe(true);
    expect(rows.some((r) => r.key === `layer:${props.id}`)).toBe(true);
    expect(rows.some((r) => r.key === 'level:lv-cellar')).toBe(false);
  });

  it('shows nothing for a filter nothing matches', () => {
    seed();
    expect(buildSheetRows(state({ filter: 'zzz' }))).toEqual([]);
  });
});

describe('Layers sheet', () => {
  beforeEach(() => {
    cleanup();
    useStore.getState().resetToDefault();
    undoManager.clear();
    localStorage.clear();
    vi.mocked(notify.warning).mockClear();
  });

  it('shows the level groups with their layer counts', () => {
    seed();
    open();
    const levels = screen.getAllByTestId('v2-layers-level');
    expect(levels.map((l) => l.textContent)).toEqual([expect.stringContaining('Level 1'), expect.stringContaining('Cellar')]);
    expect(levels[1].textContent).toContain('1 layer');
  });

  it('a layer row click makes it the draw target', () => {
    const { props } = seed();
    open();
    fireEvent.click(layerRow('Props'));
    expect(useStore.getState().ui.activeLayerId).toBe(props.id);
  });

  it('the row eye hides, Alt+click solos, and the lock locks', () => {
    const { props } = seed();
    open();
    fireEvent.click(within(layerRow('Props')).getByTestId('v2-layers-eye'));
    expect(live(props.id).visible).toBe(false);
    fireEvent.click(within(layerRow('Props')).getByTestId('v2-layers-eye'), { altKey: true });
    expect(useStore.getState().ui.solo).toEqual({ layerId: props.id });
    fireEvent.click(within(layerRow('Props')).getByTestId('v2-layers-lock'));
    expect(live(props.id).locked).toBe(true);
  });

  it('a wall row click selects the wall; Shift adds and Ctrl toggles', () => {
    const { warren } = seed();
    useStore.getState().toggleExpandedLayerId(warren.id);
    open();
    fireEvent.click(objectRow('w1'));
    expect(useStore.getState().selection.selectedIds).toEqual(['w1']);
    fireEvent.click(objectRow('w2'), { shiftKey: true });
    expect(useStore.getState().selection.selectedIds).toEqual(['w1', 'w2']);
    fireEvent.click(objectRow('w1'), { ctrlKey: true });
    expect(useStore.getState().selection.selectedIds).toEqual(['w2']);
  });

  it('a hidden object row is dimmed, and its eye shows it again in one undo step', () => {
    const { warren } = seed();
    useStore.setState((s) => {
      s.ui.expandedLayerIds = [warren.id];
      s.ui.childGroupOverrides = [`${warren.id}:asset`];
    });
    open();
    const row = objectRow('p-hidden');
    expect(row.className).toContain('v2-lrow--dim');
    fireEvent.click(within(row).getByTestId('v2-layers-obj-eye'));
    expect(live(warren.id).children[0].visible).toBe(true);
    act(() => undoManager.undo());
    expect(live(warren.id).children[0].visible).toBe(false);
  });

  it('a wall row lock locks that wall alone', () => {
    const { warren } = seed();
    useStore.getState().toggleExpandedLayerId(warren.id);
    open();
    fireEvent.click(within(objectRow('w1')).getByTestId('v2-layers-obj-lock'));
    expect(live(warren.id).standaloneWalls[0].locked).toBe(true);
    expect(live(warren.id).locked).toBe(false);
  });

  it('room rows carry neither eye nor lock', () => {
    const { warren } = seed();
    useStore.getState().toggleExpandedLayerId(warren.id);
    open();
    expect(within(objectRow('r1')).queryByTestId('v2-layers-obj-eye')).toBeNull();
  });

  it('a canvas selection opens its layer and kind group and marks the row', () => {
    const { props } = seed();
    open();
    act(() => useStore.getState().setSelectedIds(['p1']));
    const s = useStore.getState();
    expect(s.ui.expandedLayerIds).toContain(props.id);
    expect(s.ui.childGroupOverrides).toContain(`${props.id}:asset`);
    expect(objectRow('p1').className).toContain('v2-lrow--sel');
  });

  it('arrow keys walk the tree; Right opens a layer', () => {
    const { props } = seed();
    open();
    const first = screen.getAllByTestId('v2-layers-level')[0];
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    fireEvent.keyDown(layerRow('Props'), { key: 'ArrowRight' });
    expect(useStore.getState().ui.expandedLayerIds).toContain(props.id);
    fireEvent.keyDown(layerRow('Props'), { key: 'ArrowLeft' });
    expect(useStore.getState().ui.expandedLayerIds).not.toContain(props.id);
  });

  it('F2 renames a layer row in place', () => {
    const { props } = seed();
    open();
    fireEvent.keyDown(layerRow('Props'), { key: 'F2' });
    const input = screen.getByRole('textbox', { name: 'Layer name' });
    fireEvent.change(input, { target: { value: 'Crates' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(live(props.id).name).toBe('Crates');
  });

  it('Delete on the last layer of a level is refused', () => {
    const { cellar } = seed();
    useStore.getState().setActiveLevelId('lv-cellar');
    open();
    fireEvent.keyDown(layerRow('Cellar floor'), { key: 'Delete' });
    expect(notify.warning).toHaveBeenCalledWith('A level needs one layer. Delete the level instead.');
    expect(live(cellar.id)).toBeTruthy();
  });

  it('the filter matches layer names and clears on Escape', () => {
    seed();
    open();
    const input = screen.getByTestId('v2-layers-filter');
    fireEvent.change(input, { target: { value: 'warren' } });
    expect(screen.getAllByTestId('v2-layers-layer')).toHaveLength(1);
    expect(screen.getByText('layer name')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('pins Terrain and Background under the tree', () => {
    seed();
    open();
    expect(screen.getByTestId('v2-layers-terrain').textContent).toContain('Terrain');
    expect(screen.getByTestId('v2-layers-background').textContent).toContain('Background');
  });

  it('a layer dragged onto another level’s layer changes level and place in one undo step', () => {
    const { props, cellar, warren } = seed();
    useStore.getState().setActiveLayerId(props.id);
    const size = undoManager.size();
    expect(moveLayerOnto(props.id, cellar.id)).toBe(true);
    expect(undoManager.size()).toBe(size + 1);
    const s = useStore.getState();
    expect(live(props.id).levelId).toBe('lv-cellar');
    const idx = (id: string) => s.layers.findIndex((l) => l.id === id);
    expect(Math.abs(idx(props.id) - idx(cellar.id))).toBe(1);
    useStore.getState().setActiveLayerId(warren.id);
    undoManager.undo();
    expect(live(props.id).levelId).toBe(useStore.getState().levels[0].id);
    expect(useStore.getState().ui.activeLayerId).toBe(props.id);
  });

  it('the sheet’s drop handler: a layer row over another level’s layer row is one move-to-level Composite', () => {
    const { props, cellar } = seed();
    // The Cellar group open, so its layer row is in the sortable list.
    useStore.getState().setActiveLevelId('lv-cellar');
    open();
    expect(dnd.onDragEnd).toBeTypeOf('function');
    const spy = vi.spyOn(undoManager, 'execute');
    try {
      act(() =>
        dnd.onDragEnd!({
          active: { id: props.id, data: { current: { type: 'layer', levelId: props.levelId } } },
          over: { id: cellar.id, data: { current: { type: 'layer', levelId: 'lv-cellar' } } },
        } as unknown as DragEndEvent),
      );
      expect(spy).toHaveBeenCalledTimes(1);
      const cmd = spy.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(CompositeCommand);
      expect((cmd as unknown as { commands: unknown[] }).commands[0]).toBeInstanceOf(MoveLayerToLevelCommand);
    } finally {
      spy.mockRestore();
    }
    expect(live(props.id).levelId).toBe('lv-cellar');
  });

  it('renders at most a window of rows for a layer with 1,500 objects', () => {
    const level = useStore.getState().levels[0].id;
    const big = { ...createDungeonLayer('Big', level), children: Array.from({ length: 1500 }, (_, i) => crate(`c${i}`)) } as DungeonLayer;
    useStore.setState((s) => {
      s.layers = [s.layers[0], big];
      s.ui.expandedLayerIds = [big.id];
      s.ui.childGroupOverrides = [`${big.id}:asset`];
    });
    // jsdom lays nothing out: give the sheet's scroller a 600 px window.
    const h = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('v2-lsheets__scroll') ? 600 : 0;
    });
    const w = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => 320);
    open();
    h.mockRestore();
    w.mockRestore();
    const rendered = screen.getAllByTestId('v2-layers-object').length;
    console.log(`[metric] layers sheet with 1500 object rows: ${rendered} object rows rendered`);
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThanOrEqual(60);
  });
});
