import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { undoManager } from './undoManager';
import { createDungeonLayer } from './factories';
import { followAsset, followCommands, lightsOn } from './attachedLights';
import { createChildRemovalCommand } from './commands';
import type { AssetChild, LightChild } from '../shared/types';
import type { DungeonLayer } from './types';

const table = (over: Partial<AssetChild> = {}): AssetChild => ({
  id: 'table',
  name: 'table',
  childType: 'asset',
  visible: true,
  objectType: 'asset',
  assetId: 'table',
  position: { x: 10, y: 10 },
  rotation: 0,
  scale: 1,
  width: 4,
  height: 2,
  tint: '#ffffff',
  flipX: false,
  flipY: false,
  ...over,
});

const lamp = (over: Partial<LightChild> = {}): LightChild => ({
  id: 'lamp',
  name: 'lamp',
  childType: 'light',
  visible: true,
  color: '#ffcc66',
  radius: 3,
  featherRadius: 0,
  intensity: 1,
  falloff: 'linear',
  // On the table's right-hand end, a little below its middle.
  position: { x: 11.5, y: 10.5 },
  attachedTo: 'table',
  ...over,
});

const close = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
};

describe('followAsset', () => {
  const p = { x: 11.5, y: 10.5 };

  it('translates with the asset', () => {
    close(followAsset(table(), table({ position: { x: 13, y: 7 } }), p), 14.5, 7.5);
  });

  it('turns a quarter with the asset about its centre', () => {
    // Offset (1.5, 0.5) turned 90° clockwise on screen (y down) is (-0.5, 1.5).
    close(followAsset(table(), table({ rotation: Math.PI / 2 }), p), 9.5, 11.5);
  });

  it('mirrors on a flip toggle, and back on the second', () => {
    close(followAsset(table(), table({ flipX: true }), p), 8.5, 10.5);
    close(followAsset(table(), table({ flipY: true }), p), 11.5, 9.5);
    close(followAsset(table({ flipX: true }), table(), p), 8.5, 10.5);
  });

  it('scales per local axis with a resize, legacy scale included', () => {
    close(followAsset(table(), table({ width: 8 }), p), 13, 10.5);
    close(followAsset(table(), table({ height: 4 }), p), 11.5, 11);
    close(followAsset(table(), table({ scale: 2 }), p), 13, 11);
  });

  it('combines move, turn, flip and resize in the asset frame', () => {
    const before = table({ rotation: Math.PI / 2 });
    // Local offset of p in the turned table: (0.5, -1.5).
    const after = table({ rotation: Math.PI, flipX: true, width: 8, position: { x: 0, y: 0 } });
    // Flip X: (-0.5, -1.5); double width: (-1, -1.5); turn 180°: (1, 1.5).
    close(followAsset(before, after, p), 1, 1.5);
  });
});

describe('lightsOn and followCommands', () => {
  let props = '';
  let lights = '';

  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
    const first = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    props = first.id;
    const second = createDungeonLayer('Lights', first.levelId);
    useStore.getState().addLayer(second);
    lights = second.id;
    useStore.getState().addChild(props, table());
    useStore.getState().addChild(lights, lamp());
    useStore.getState().addChild(lights, lamp({ id: 'free', attachedTo: undefined }));
  });

  it('finds a light glued from another layer, and only glued ones', () => {
    const found = lightsOn(useStore.getState().layers, ['table']);
    expect(found.map((f) => [f.layerId, f.light.id])).toEqual([[lights, 'lamp']]);
    expect(lightsOn(useStore.getState().layers, [])).toEqual([]);
  });

  it('moves glued lights unless they are skipped, one undo with the edit', () => {
    const before = new Map([['table', table()]]);
    const after = new Map([['table', table({ position: { x: 12, y: 10 } })]]);
    const layers = useStore.getState().layers;
    expect(followCommands(layers, before, after, new Set(['lamp']))).toHaveLength(0);
    const cmds = followCommands(layers, before, after);
    expect(cmds).toHaveLength(1);
    cmds[0].execute();
    const light = (useStore.getState().layers.find((l) => l.id === lights) as DungeonLayer).children.find(
      (c) => c.id === 'lamp',
    ) as LightChild;
    close(light.position, 13.5, 10.5);
    cmds[0].undo();
  });

  it('a delete cascades across layers', () => {
    undoManager.execute(createChildRemovalCommand(props, 'table'));
    const ids = () =>
      (useStore.getState().layers.find((l) => l.id === lights) as DungeonLayer).children.map((c) => c.id);
    expect(ids()).toEqual(['free']);
    undoManager.undo();
    expect(ids()).toEqual(['lamp', 'free']);
  });
});
