import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import { undoManager } from '@/store/undoManager';
import type { MenuRow } from '@/components/ui/context-menu';
import type { DungeonLayer } from '@/store/types';
import { buildLayerTileMenu } from './menuRegistry';

vi.mock('@/lib/toast', () => ({
  notify: { action: vi.fn(), subtle: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

const labels = (rows: MenuRow[]) => rows.map((r) => ('label' in r ? r.label : ''));
type AnyRow = { label: string; onSelect: () => void; disabled?: boolean; rows: MenuRow[] };
const row = (rows: MenuRow[], label: string) => rows.find((r) => 'label' in r && r.label === label) as unknown as AnyRow;
const first = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const live = (id: string) => useStore.getState().layers.find((l) => l.id === id)!;

describe('the layer tile menu', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('lists the layer verbs in board order', () => {
    expect(labels(buildLayerTileMenu(first(), { onRename: () => {} }))).toEqual([
      'Rename',
      'Duplicate',
      'Lock',
      'Hide',
      'Solo',
      'Zoom to layer',
      'Move to level',
      'Delete layer',
    ]);
  });

  it('flips Lock, Hide and Solo to their way back', () => {
    const l = first();
    useStore.getState().updateLayer(l.id, { locked: true, visible: false });
    useStore.getState().toggleSoloLayer(l.id);
    const names = labels(buildLayerTileMenu(live(l.id), { onRename: () => {} }));
    expect(names).toContain('Unlock');
    expect(names).toContain('Show');
    expect(names).toContain('Unsolo');
  });

  it('locks through one undo step', () => {
    const l = first();
    row(buildLayerTileMenu(l, { onRename: () => {} }), 'Lock').onSelect();
    expect(live(l.id).locked).toBe(true);
    undoManager.undo();
    expect(live(l.id).locked).toBe(false);
  });

  it('greys Delete on the last layer of a level and on a locked layer', () => {
    const l = first();
    expect(row(buildLayerTileMenu(l, { onRename: () => {} }), 'Delete layer').disabled).toBe(true);
    const other = createDungeonLayer('Other', l.levelId);
    useStore.getState().addLayer(other);
    expect(row(buildLayerTileMenu(live(l.id), { onRename: () => {} }), 'Delete layer').disabled).toBe(false);
    useStore.getState().updateLayer(l.id, { locked: true });
    expect(row(buildLayerTileMenu(live(l.id), { onRename: () => {} }), 'Delete layer').disabled).toBe(true);
  });

  it('greys Move to level with one level, and lists the other levels with two', () => {
    const l = first();
    expect(row(buildLayerTileMenu(l, { onRename: () => {} }), 'Move to level').disabled).toBe(true);
    useStore.getState().addLevel({ id: 'lv-2', name: 'Cellar' });
    useStore.getState().addLayer(createDungeonLayer('Other', l.levelId));
    const sub = row(buildLayerTileMenu(live(l.id), { onRename: () => {} }), 'Move to level');
    expect(sub.disabled).toBeFalsy();
    expect(labels(sub.rows)).toContain('Cellar');
    row(sub.rows, 'Cellar').onSelect();
    expect(live(l.id).levelId).toBe('lv-2');
  });

  it('Duplicate adds the copy above and Rename asks for the field', () => {
    const l = first();
    const onRename = vi.fn();
    const rows = buildLayerTileMenu(l, { onRename });
    row(rows, 'Rename').onSelect();
    expect(onRename).toHaveBeenCalled();
    row(rows, 'Duplicate').onSelect();
    const ids = useStore.getState().layers.map((x) => x.id);
    expect(useStore.getState().layers[ids.indexOf(l.id) + 1].name).toBe(`${l.name} copy`);
  });
});
