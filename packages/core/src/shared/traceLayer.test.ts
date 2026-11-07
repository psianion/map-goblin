import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store/store';
import { undoManager } from '../store/undoManager';
import { createDungeonLayer, createImageLayer } from '../store/factories';
import { AddTraceLayerCommand, CloneLevelCommand, layerDeleteBlock, traceToggleCommand } from '../store/layerCommands';
import type { AssetChild, DungeonLayer, ImageLayer, SerializedMapData } from '../store/types';
import { traceLayerIds, withoutTraceLayers } from './traceLayer';
import { BATTLEMAP_PX_PER_CELL, traceBox } from '../engine/trace/traceRenderer';

const level = () => useStore.getState().levels[0].id;
const traces = () => useStore.getState().layers.filter((l): l is ImageLayer => l.type === 'image');

/** A trace of picture `key` on the first level, added through its command. */
function addTrace(key = 'sketch'): ImageLayer {
  useStore.getState().addCustomImage(key, `data:image/png;base64,${key}`);
  const layer = createImageLayer(level(), key, `${key}.png`);
  undoManager.execute(new AddTraceLayerCommand(layer));
  return traces().find((l) => l.id === layer.id)!;
}

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
});

describe('a trace layer', () => {
  it('lands at the bottom of its level at 40%, Fit Map, and undo takes it away', () => {
    const top = createDungeonLayer('Top', level());
    useStore.getState().addLayer(top);
    const trace = addTrace();
    expect(trace).toMatchObject({ opacity: 0.4, fit: 'map', fileName: 'sketch.png', visible: true, locked: false });
    const order = useStore.getState().layers.filter((l) => l.levelId === level() && l.type !== 'background').map((l) => l.type);
    expect(order).toEqual(['image', 'dungeon', 'dungeon']);
    undoManager.undo();
    expect(traces()).toHaveLength(0);
  });

  it('never counts as the layer a level keeps', () => {
    addTrace();
    const dungeon = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    expect(layerDeleteBlock(useStore.getState(), dungeon.id)).toMatch(/A level needs one layer/);
    expect(layerDeleteBlock(useStore.getState(), traces()[0].id)).toBeNull();
  });

  it('is copied by a level clone, sharing its picture', () => {
    addTrace();
    const cmd = new CloneLevelCommand(level());
    undoManager.execute(cmd);
    const copy = traces().find((l) => l.levelId === cmd.newId)!;
    expect(copy.id).not.toBe(traces()[0].id);
    expect(copy.imageKey).toBe('sketch');
  });
});

describe('the trace toggle', () => {
  it('hides every trace on the level on show, then shows them, each one undo step', () => {
    addTrace('a');
    addTrace('b');
    const hide = traceToggleCommand(useStore.getState())!;
    expect(hide.label).toBe('Hide trace');
    undoManager.execute(hide);
    expect(traces().map((l) => l.visible)).toEqual([false, false]);
    undoManager.execute(traceToggleCommand(useStore.getState())!);
    expect(traces().map((l) => l.visible)).toEqual([true, true]);
    undoManager.undo();
    expect(traces().map((l) => l.visible)).toEqual([false, false]);
  });

  it('hides them all while any one shows', () => {
    addTrace('a');
    addTrace('b');
    useStore.getState().updateLayer(traces()[0].id, { visible: false });
    undoManager.execute(traceToggleCommand(useStore.getState())!);
    expect(traces().map((l) => l.visible)).toEqual([false, false]);
  });

  it('does nothing on a level without one, or for another level', () => {
    expect(traceToggleCommand(useStore.getState())).toBeNull();
    addTrace();
    useStore.getState().addLevel({ id: 'up', name: 'Up' }, 0);
    useStore.getState().addLayer(createDungeonLayer('Up layer', 'up'));
    useStore.getState().setActiveLevelId('up');
    expect(traceToggleCommand(useStore.getState())).toBeNull();
  });
});

describe('where a trace sits', () => {
  const frame = { minX: 0, minY: 0, maxX: 20, maxY: 10 };
  it('Fit Map stretches it to the map frame', () => {
    expect(traceBox('map', frame, 999, 333)).toEqual({ x: 0, y: 0, width: 20, height: 10 });
  });
  it('Fit Original lays it at the battlemap scale, centred on the frame', () => {
    const b = traceBox('original', frame, 7 * BATTLEMAP_PX_PER_CELL, 4 * BATTLEMAP_PX_PER_CELL);
    expect(b).toEqual({ x: 6.5, y: 3, width: 7, height: 4 });
  });
});

describe('a publish', () => {
  /** The map as saved, with a trace and a placed image of its own. */
  function saved(): SerializedMapData {
    addTrace('sketch');
    useStore.getState().addCustomImage('crate', 'data:image/png;base64,crate');
    const dungeon = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    const prop = { id: 'p', name: 'Crate', childType: 'asset', visible: true, objectType: 'image', assetId: 'crate', position: { x: 0, y: 0 }, rotation: 0, scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false } as AssetChild;
    useStore.getState().addChild(dungeon.id, prop);
    return useStore.getState().getSerializableState();
  }

  it('sends the map without its traces or the pictures only they show', () => {
    const data = saved();
    expect(traceLayerIds(data.layers)).toHaveLength(1);
    const out = withoutTraceLayers(data);
    expect(traceLayerIds(out.layers)).toEqual([]);
    expect(out.layers).toHaveLength(data.layers.length - 1);
    expect(Object.keys(out.customImages)).toEqual(['crate']);
    expect(JSON.stringify(out)).not.toContain('sketch');
  });

  it('keeps a picture a placed image also shows', () => {
    const data = saved();
    const trace = data.layers.find((l): l is ImageLayer => l.type === 'image')!;
    const shared = { ...data, layers: data.layers.map((l) => (l.id === trace.id ? { ...trace, imageKey: 'crate' } : l)) };
    expect(Object.keys(withoutTraceLayers(shared).customImages)).toContain('crate');
  });

  it('leaves a map without traces as it is', () => {
    const data = useStore.getState().getSerializableState();
    expect(withoutTraceLayers(data)).toBe(data);
  });
});
