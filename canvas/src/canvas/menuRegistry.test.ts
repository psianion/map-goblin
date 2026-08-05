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

import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import {
  buildChildMenu,
  buildMultiMenu,
  buildCanvasMenu,
  registerMenu,
} from './menuRegistry';
import type { MenuRow, ContextMenuItem } from '@/components/ui/context-menu';
import type { DungeonLayer, LightChild, DoorChild } from '@/store/types';

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
  it('builds a light menu: header, sliders, swatches, flicker, shared verbs, danger last', () => {
    const light = makeLight();
    useStore.getState().addChild(layer().id, light);
    const rows = buildChildMenu(ctx(light));
    const types = rows.map((r) => ('type' in r && r.type ? r.type : 'action'));
    expect(types[0]).toBe('header');
    expect(types).toContain('slider');
    expect(types).toContain('swatches');
    expect(types).toContain('toggle');
    const last = rows[rows.length - 1] as ContextMenuItem;
    expect(last.label).toBe('Delete');
    expect(last.danger).toBe(true);
  });

  it('slider commit writes one undo entry with the drag-start value as before', () => {
    const light = makeLight();
    useStore.getState().addChild(layer().id, light);
    const rows = buildChildMenu(ctx(light));
    const radius = rows.find((r) => 'type' in r && r.type === 'slider' && r.label === 'Radius');
    if (!radius || !('onCommit' in radius)) throw new Error('no radius slider');
    radius.onCommit(9, 6);
    const now = layer().children.find((c) => c.id === 'light-1') as LightChild;
    expect(now.radius).toBe(9);
    undoManager.undo();
    const back = layer().children.find((c) => c.id === 'light-1') as LightChild;
    expect(back.radius).toBe(6);
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

  it('disables interactive rows on a locked layer, mirroring the panel', () => {
    const light = makeLight();
    useStore.getState().addChild(layer().id, light);
    useStore.getState().updateLayer(layer().id, { locked: true });
    const rows = buildChildMenu(ctx(light));
    for (const r of rows) {
      if ('onSelect' in r) expect(r.disabled).toBe(true);
    }
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
  it('offers only the shared-verb intersection', () => {
    const rows = buildMultiMenu(3);
    expect(labels(rows)).toEqual([
      '3 selected',
      'Duplicate',
      'Flip horizontal',
      'Flip vertical',
      'Delete',
    ]);
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
