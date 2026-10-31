import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { undoManager } from './undoManager';
import { createDungeonLayer } from './factories';
import { AddLayerCommand, CompositeCommand, MoveLayerToLevelCommand, PropertyCommand, RemoveLayerCommand, ReorderLayerCommand } from './commands';
import { RemoveLevelCascadeCommand } from './layerCommands';
import { AddLevelCommand } from './roomCommands';
import type { AnyChild, DungeonLayer } from './types';

const ui = () => {
  const { activeLayerId, activeLevelId } = useStore.getState().ui;
  return { activeLayerId, activeLevelId };
};
const firstDungeon = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;

describe('undo restores the active layer and the level on show', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
    useStore.getState().setActiveLayerId(firstDungeon().id);
  });

  it('undoing an added layer goes back to the layer that was active', () => {
    const before = ui();
    const layer = createDungeonLayer('New');
    undoManager.execute(new AddLayerCommand('Add layer', layer));
    useStore.getState().setActiveLayerId(layer.id);
    undoManager.undo();
    expect(ui()).toEqual(before);
  });

  it('undoing a delete makes the deleted layer active again', () => {
    const second = createDungeonLayer('Second', useStore.getState().ui.activeLevelId);
    useStore.getState().addLayer(second);
    useStore.getState().setActiveLayerId(second.id);
    undoManager.execute(new RemoveLayerCommand('Delete layer', second.id));
    expect(useStore.getState().ui.activeLayerId).not.toBe(second.id);
    undoManager.undo();
    expect(useStore.getState().ui.activeLayerId).toBe(second.id);
  });

  it('undoing a move to another level brings back the level on show', () => {
    const ground = useStore.getState().ui.activeLevelId;
    useStore.getState().addLevel({ id: 'lv-2', name: 'Cellar' });
    const second = createDungeonLayer('Second', ground);
    useStore.getState().addLayer(second);
    useStore.getState().setActiveLayerId(second.id);
    undoManager.execute(new MoveLayerToLevelCommand(second.id, 'lv-2'));
    useStore.getState().setActiveLevelId('lv-2');
    undoManager.undo();
    expect(ui()).toEqual({ activeLayerId: second.id, activeLevelId: ground });
  });

  it('redo hands back what was active when the step was undone', () => {
    const layer = createDungeonLayer('New');
    undoManager.execute(new AddLayerCommand('Add layer', layer));
    useStore.getState().setActiveLayerId(layer.id);
    const after = ui();
    undoManager.undo();
    undoManager.redo();
    expect(ui()).toEqual(after);
  });

  it('a command without the flag leaves the active layer where it is', () => {
    const second = createDungeonLayer('Second', useStore.getState().ui.activeLevelId);
    useStore.getState().addLayer(second);
    const first = firstDungeon();
    undoManager.execute(new PropertyCommand('Rename layer', { type: 'layer', layerId: first.id }, { name: first.name }, { name: 'X' }));
    useStore.getState().setActiveLayerId(second.id);
    undoManager.undo();
    expect(useStore.getState().ui.activeLayerId).toBe(second.id);
  });

  it('a reorder is one step whose undo restores the active layer', () => {
    const second = createDungeonLayer('Second', useStore.getState().ui.activeLevelId);
    useStore.getState().addLayer(second);
    const before = ui();
    const size = undoManager.size();
    undoManager.execute(new ReorderLayerCommand('Reorder layer', 2, 1));
    expect(undoManager.size()).toBe(size + 1);
    useStore.getState().setActiveLayerId(second.id);
    undoManager.undo();
    expect(ui()).toEqual(before);
  });

  it('undoing a level delete shows that level again', () => {
    useStore.getState().addLevel({ id: 'lv-2', name: 'Cellar' });
    const cellar = createDungeonLayer('Cellar', 'lv-2');
    useStore.getState().addLayer(cellar);
    useStore.getState().setActiveLayerId(cellar.id);
    undoManager.execute(new RemoveLevelCascadeCommand('lv-2', null));
    expect(useStore.getState().ui.activeLevelId).not.toBe('lv-2');
    undoManager.undo();
    expect(ui()).toEqual({ activeLayerId: cellar.id, activeLevelId: 'lv-2' });
  });
});

describe('a level switch leaves no selection the map does not show', () => {
  const prop = (id: string) =>
    ({ id, name: id, childType: 'asset', visible: true, assetId: 't:c', position: { x: 1, y: 1 }, rotation: 0, scale: 1, width: 1, height: 1 }) as AnyChild;
  const selected = () => useStore.getState().selection.selectedIds;

  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
    useStore.getState().setActiveLayerId(firstDungeon().id);
    useStore.getState().addChild(firstDungeon().id, prop('p1'));
  });

  it('drops objects of the level left behind, and keeps a selected level', () => {
    const ground = useStore.getState().ui.activeLevelId;
    useStore.getState().addLevel({ id: 'lv-2', name: 'Cellar' });
    useStore.getState().addLayer(createDungeonLayer('Cellar', 'lv-2'));
    useStore.getState().setSelectedIds(['p1', ground]);
    useStore.getState().setActiveLevelId('lv-2');
    expect(selected()).toEqual([ground]);
    useStore.getState().setSelectedIds(['p1']);
    useStore.getState().setActiveLevelId(ground);
    expect(selected()).toEqual(['p1']);
  });

  it('undoing New level brings the selection back through the step’s own record', () => {
    const ground = useStore.getState().ui.activeLevelId;
    useStore.getState().setSelectedIds(['p1']);
    const layer = createDungeonLayer('Level 2 layer', 'lv-2');
    undoManager.execute(
      new CompositeCommand('New level', [new AddLevelCommand({ id: 'lv-2', name: 'Level 2' }), new AddLayerCommand('New level', layer)]),
    );
    useStore.getState().setActiveLevelId('lv-2');
    useStore.getState().setActiveLayerId(layer.id);
    expect(selected()).toEqual([]);
    undoManager.undo();
    expect(useStore.getState().ui.activeLevelId).toBe(ground);
    expect(selected()).toEqual(['p1']);
  });
});
