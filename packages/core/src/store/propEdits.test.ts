import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { useStore } from './store';
import { undoManager } from './undoManager';
import { createDungeonLayer } from './factories';
import {
  createAlignCommand,
  createDistributeCommand,
  createDuplicateCommand,
  createMoveToLayerCommand,
  createPlacePropsCommand,
  createPropBoxCommand,
  createPropPatchCommand,
  createSetPropFieldsCommand,
  createSwapPropCommand,
  createZOrderCommand,
  zOrder,
} from './propEdits';
import { getAssetPackManager, resetAssetPackManager } from '../engine/assetPackInstance';
import type { ManifestEntry, PackManifest } from '../engine/assetPackManager';
import type {
  AnyChild,
  AssetChild,
  DoorChild,
  LightChild,
  ShapeChild,
  WaterChild,
  WallSegment,
  ZoneChild,
} from '../shared/types';
import type { Command, DungeonLayer } from './types';

// ─── Fixtures ────────────────────────────────────────────

const prop = (id: string, over: Partial<AssetChild> = {}): AssetChild => ({
  id,
  name: id,
  childType: 'asset',
  visible: true,
  objectType: 'asset',
  assetId: 'p:crate_1',
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: 1,
  width: 1,
  height: 1,
  tint: '#ffffff',
  flipX: false,
  flipY: false,
  ...over,
});

const light = (id: string, over: Partial<LightChild> = {}): LightChild => ({
  id,
  name: id,
  childType: 'light',
  visible: true,
  color: '#ffcc66',
  radius: 3,
  featherRadius: 0,
  intensity: 1,
  falloff: 'linear',
  position: { x: 0, y: 0 },
  ...over,
});

let main = '';
let other = '';

const layer = (id: string) => useStore.getState().layers.find((l) => l.id === id) as DungeonLayer;
const child = <C extends AnyChild = AssetChild>(id: string): C => {
  for (const l of useStore.getState().layers) {
    if (l.type !== 'dungeon') continue;
    const c = l.children.find((x) => x.id === id);
    if (c) return c as C;
  }
  throw new Error(`no child ${id}`);
};
const ids = (layerId: string) => layer(layerId).children.map((c) => c.id);
const add = (layerId: string, ...children: AnyChild[]) => {
  for (const c of children) useStore.getState().addChild(layerId, c);
};
const run = (cmd: Command | null) => {
  expect(cmd).not.toBeNull();
  undoManager.execute(cmd!);
};
const close = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
};

beforeAll(() => {
  // A tiny catalogue: crates in two grid sizes, all 200 px a cell.
  resetAssetPackManager();
  const manager = getAssetPackManager();
  const entry = (material: string, gridSize: string, w: number, h: number, family?: string): ManifestEntry => ({
    type: 'object',
    material,
    gridSize,
    pieceType: 'object',
    variant: 'A',
    set: 'demo-storage',
    family,
    tags: [],
    frame: { x: 0, y: 0, w, h },
  });
  const manifest: PackManifest = {
    name: 'p',
    description: '',
    version: '0.0.1',
    bundleSize: 0,
    atlases: {},
    files: {},
    entries: {
      crate_1: entry('crate_1', '1x1', 200, 200, 'crate'),
      crate_2: entry('crate_2', '1x1', 200, 200, 'crate'),
      crate_long: entry('crate_3', '2x1', 400, 200, 'crate'),
      bench: entry('bench', '2x1', 400, 200),
    },
  };
  (manager as unknown as { manifestCache: Map<string, PackManifest> }).manifestCache.set('p', manifest);
  manager.catalogVersion++;
});

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
  const first = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
  main = first.id;
  const second = createDungeonLayer('Upper', first.levelId);
  useStore.getState().addLayer(second);
  other = second.id;
});

// ─── Place and patch ─────────────────────────────────────

describe('createPlacePropsCommand', () => {
  it('appends on top, or inserts under the existing props in order, one undo', () => {
    add(main, light('l'), prop('a'), prop('b'));
    run(createPlacePropsCommand(main, [prop('top')], { under: false }));
    expect(ids(main)).toEqual(['l', 'a', 'b', 'top']);
    run(createPlacePropsCommand(main, [prop('u1'), prop('u2')], { under: true, label: 'Scatter props' }));
    expect(ids(main)).toEqual(['l', 'u1', 'u2', 'a', 'b', 'top']);
    undoManager.undo();
    expect(ids(main)).toEqual(['l', 'a', 'b', 'top']);
  });
});

describe('createPropPatchCommand', () => {
  it('carries attached lights on any layer, skips patched lights, one undo', () => {
    add(main, prop('lamp', { position: { x: 5, y: 5 } }));
    add(other, light('glow', { position: { x: 6, y: 5 }, attachedTo: 'lamp' }));
    add(main, light('picked', { position: { x: 5, y: 6 }, attachedTo: 'lamp' }));
    run(
      createPropPatchCommand('Nudge', [
        { layerId: main, id: 'lamp', before: { position: { x: 5, y: 5 } }, after: { position: { x: 7, y: 5 } } },
        { layerId: main, id: 'picked', before: { position: { x: 5, y: 6 } }, after: { position: { x: 7, y: 6 } } },
      ]),
    );
    close(child<LightChild>('glow').position, 8, 5);
    close(child<LightChild>('picked').position, 7, 6);
    undoManager.undo();
    close(child<LightChild>('glow').position, 6, 5);
    close(child('lamp').position, 5, 5);
  });

  it('reads the asset before state from the patch, so a live preview does not count twice', () => {
    add(main, prop('lamp', { position: { x: 9, y: 5 } }), light('glow', { position: { x: 6, y: 5 }, attachedTo: 'lamp' }));
    run(
      createPropPatchCommand('Transform object', [
        { layerId: main, id: 'lamp', before: { position: { x: 5, y: 5 } }, after: { position: { x: 9, y: 5 } } },
      ]),
    );
    close(child<LightChild>('glow').position, 10, 5);
  });
});

// ─── Fields ──────────────────────────────────────────────

describe('createSetPropFieldsCommand', () => {
  it('sets tint and behaviour fields on props only, and undo puts the absent keys back', () => {
    add(main, prop('a'), prop('b', { tint: '#ff0000' }), light('l'));
    run(createSetPropFieldsCommand(['a', 'b', 'l'], { tint: '#00ff00', overhead: true, opacity: 0.5 }));
    expect(child('a')).toMatchObject({ tint: '#00ff00', overhead: true, opacity: 0.5 });
    expect(child('b').tint).toBe('#00ff00');
    expect(child<LightChild>('l')).not.toHaveProperty('tint');
    undoManager.undo();
    expect(child('b').tint).toBe('#ff0000');
    expect(child('a').overhead).toBeUndefined();
  });

  it('locks and unlocks, the unlock reaching a locked prop', () => {
    add(main, prop('a'));
    const lock = createSetPropFieldsCommand(['a'], { locked: true })!;
    expect(lock.label).toBe('Lock');
    undoManager.execute(lock);
    expect(child('a').locked).toBe(true);
    run(createSetPropFieldsCommand(['a'], { locked: false }));
    expect(child('a').locked).toBe(false);
  });

  it('answers null when nothing is a prop', () => {
    add(main, light('l'));
    expect(createSetPropFieldsCommand(['l', 'ghost'], { locked: true })).toBeNull();
  });
});

// ─── Box ─────────────────────────────────────────────────

describe('createPropBoxCommand', () => {
  it('writes a single prop box onto its own axes and folds legacy scale', () => {
    add(main, prop('cot', { rotation: Math.PI / 2, width: 2, height: 1, scale: 1.5, position: { x: 4, y: 4 } }));
    run(createPropBoxCommand(['cot'], { x: 4, y: 4, w: 3, h: 1.5, angle: Math.PI / 2 }, { x: 5, y: 4, w: 4, h: 1.5 }));
    expect(child('cot')).toMatchObject({ width: 4, height: 1.5, scale: 1, rotation: Math.PI / 2, position: { x: 5, y: 4 } });
  });

  it('scales several props as one box, each on its own axes', () => {
    add(main, prop('a', { position: { x: 1, y: 1 } }), prop('b', { position: { x: 3, y: 1 }, rotation: Math.PI / 2, width: 2 }));
    // Union box: a spans 0.5..1.5, b (turned, 2 long) spans 2.5..3.5 by 0..2.
    run(createPropBoxCommand(['a', 'b'], { x: 2, y: 1, w: 3, h: 2 }, { x: 2, y: 1, w: 6, h: 2 }));
    close(child('a').position, 0, 1);
    close(child('b').position, 4, 1);
    expect(child('a').width).toBeCloseTo(2);
    expect(child('a').height).toBeCloseTo(1);
    // b is turned a quarter: the world x stretch lands on its local height.
    expect(child('b').width).toBeCloseTo(2);
    expect(child('b').height).toBeCloseTo(2);
  });

  it('turns several props about the box centre by the angle change', () => {
    add(main, prop('a', { position: { x: 0, y: 0 } }), prop('b', { position: { x: 2, y: 0 } }));
    run(createPropBoxCommand(['a', 'b'], { x: 1, y: 0, w: 3, h: 1, angle: 0 }, { x: 1, y: 0, w: 3, h: 1, angle: Math.PI / 2 }));
    close(child('a').position, 1, -1);
    close(child('b').position, 1, 1);
    expect(child('a').rotation).toBeCloseTo(Math.PI / 2);
  });

  it('leaves locked props alone', () => {
    add(main, prop('a', { locked: true }));
    expect(createPropBoxCommand(['a'], { x: 0, y: 0, w: 1, h: 1 }, { x: 3, y: 0, w: 1, h: 1 })).toBeNull();
  });
});

// ─── Z-order ─────────────────────────────────────────────

describe('zOrder', () => {
  const l = (children: AnyChild[]) => ({ children }) as DungeonLayer;
  const abcde = ['a', 'b', 'c', 'd', 'e'].map((id) => prop(id));

  it('front and back keep the selection in its own order', () => {
    expect(zOrder(l(abcde), ['d', 'b'], 'front')).toEqual(['a', 'c', 'e', 'b', 'd']);
    expect(zOrder(l(abcde), ['d', 'b'], 'back')).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('forward and backward move each one step, a run as one, a scattered selection each', () => {
    expect(zOrder(l(abcde), ['b', 'c'], 'forward')).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(zOrder(l(abcde), ['a', 'c'], 'forward')).toEqual(['b', 'a', 'd', 'c', 'e']);
    expect(zOrder(l(abcde), ['b', 'd'], 'backward')).toEqual(['b', 'a', 'd', 'c', 'e']);
    expect(zOrder(l(abcde), ['e'], 'forward')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(zOrder(l(abcde), ['a'], 'backward')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('steps past the next prop, not past a light it would not visibly cross', () => {
    const mixed = [prop('a'), light('l1'), light('l2'), prop('b')];
    expect(zOrder(l(mixed), ['a'], 'forward')).toEqual(['l1', 'l2', 'b', 'a']);
  });

  it('createZOrderCommand is one undo per gesture, null when nothing moves', () => {
    add(main, prop('a'), prop('b'), prop('c'));
    run(createZOrderCommand(['a'], 'front'));
    expect(ids(main)).toEqual(['b', 'c', 'a']);
    expect(createZOrderCommand(['a'], 'front')).toBeNull();
    undoManager.undo();
    expect(ids(main)).toEqual(['a', 'b', 'c']);
  });
});

// ─── Align and distribute ────────────────────────────────

describe('createAlignCommand', () => {
  beforeEach(() => {
    // a: 1x1 at (1,1). b: 2x1 turned a quarter at (5,3), so its world box is 1 wide, 2 tall.
    add(main, prop('a', { position: { x: 1, y: 1 } }), prop('b', { position: { x: 5, y: 3 }, width: 2, rotation: Math.PI / 2 }));
  });

  const cases: [Parameters<typeof createAlignCommand>[1], [number, number], [number, number]][] = [
    ['left', [1, 1], [1, 3]],
    ['right', [5, 1], [5, 3]],
    ['hcenter', [3, 1], [3, 3]],
    ['top', [1, 1], [5, 1.5]],
    ['bottom', [1, 3.5], [5, 3]],
    ['vcenter', [1, 2.25], [5, 2.25]],
  ];
  for (const [edge, a, b] of cases) {
    it(`aligns ${edge} by the turned boxes`, () => {
      run(createAlignCommand(['a', 'b'], edge));
      close(child('a').position, a[0], a[1]);
      close(child('b').position, b[0], b[1]);
    });
  }

  it('needs two props', () => {
    expect(createAlignCommand(['a'], 'left')).toBeNull();
  });
});

describe('createDistributeCommand', () => {
  it('spaces three props with equal gaps, the ends fixed', () => {
    add(
      main,
      prop('a', { position: { x: 0.5, y: 0 } }),
      prop('b', { position: { x: 2, y: 0 }, width: 2 }),
      prop('c', { position: { x: 9.5, y: 0 } }),
    );
    run(createDistributeCommand(['c', 'a', 'b'], 'h'));
    // Span 0..10, sizes 1 + 2 + 1, so two gaps of 3.
    close(child('a').position, 0.5, 0);
    close(child('b').position, 5, 0);
    close(child('c').position, 9.5, 0);
  });

  it('works vertically on turned boxes', () => {
    add(
      main,
      prop('a', { position: { x: 0, y: 0 } }),
      prop('b', { position: { x: 0, y: 1 }, width: 2, rotation: Math.PI / 2 }),
      prop('c', { position: { x: 0, y: 10 } }),
    );
    run(createDistributeCommand(['a', 'b', 'c'], 'v'));
    // Span -0.5..10.5, sizes 1 + 2 + 1, gaps of 3.5: b's top at 4, centre at 5.
    close(child('b').position, 0, 5);
  });

  it('refuses fewer than three', () => {
    add(main, prop('a'), prop('b'));
    expect(createDistributeCommand(['a', 'b'], 'h')).toBeNull();
  });
});

// ─── Swap ────────────────────────────────────────────────

describe('createSwapPropCommand', () => {
  it('a same-size sibling keeps the box and every field', () => {
    add(main, prop('a', { width: 1.4, height: 1.2, rotation: 1, tint: '#00ff00', flipX: true, overhead: true }));
    run(createSwapPropCommand(['a'], { step: 1 }, 'footprint'));
    expect(child('a')).toMatchObject({
      assetId: 'p:crate_2',
      width: 1.4,
      height: 1.2,
      rotation: 1,
      tint: '#00ff00',
      flipX: true,
      overhead: true,
    });
  });

  it('a different-size sibling fits inside the old box at its own aspect, centre kept', () => {
    add(main, prop('a', { assetId: 'p:crate_2', width: 2, height: 2, position: { x: 3, y: 3 } }));
    run(createSwapPropCommand(['a'], 'p:crate_long', 'footprint'));
    expect(child('a')).toMatchObject({ assetId: 'p:crate_long', width: 2, height: 1, position: { x: 3, y: 3 } });
  });

  it('a library pick draws at its natural size times the old size factor, and undo restores', () => {
    add(main, prop('a', { width: 1, height: 1, scale: 1.5 }));
    run(createSwapPropCommand(['a'], 'p:bench', 'natural'));
    expect(child('a')).toMatchObject({ assetId: 'p:bench', width: 3, height: 1.5, scale: 1 });
    undoManager.undo();
    expect(child('a')).toMatchObject({ assetId: 'p:crate_1', width: 1, height: 1, scale: 1.5 });
  });

  it('a pick from another family renames the prop as a placement would; a sibling keeps its name', () => {
    add(main, prop('a', { name: 'crate 1' }), prop('b', { name: 'bench' }));
    run(createSwapPropCommand(['a'], 'p:bench', 'natural'));
    expect(child('a').name).toBe('bench 2');
    undoManager.undo();
    expect(child('a').name).toBe('crate 1');
    run(createSwapPropCommand(['a'], 'p:crate_2', 'footprint'));
    expect(child('a').name).toBe('crate 1');
  });

  it('an imported image takes a library pick at natural size', () => {
    add(main, prop('img', { objectType: 'image', assetId: 'img-key', width: 3, height: 2 }));
    expect(createSwapPropCommand(['img'], { step: 1 }, 'footprint')).toBeNull();
    run(createSwapPropCommand(['img'], 'p:crate_1', 'natural'));
    expect(child('img')).toMatchObject({ objectType: 'asset', assetId: 'p:crate_1', width: 1, height: 1 });
  });
});

// ─── Duplicate ───────────────────────────────────────────

describe('createDuplicateCommand', () => {
  const dup = (childIds: string[], opts?: Parameters<typeof createDuplicateCommand>[2]) => {
    const out = createDuplicateCommand(useStore.getState().layers, childIds, opts);
    run(out.command);
    return out.newIds;
  };

  it('copies with new ids, copy names and a one-square offset, one undo', () => {
    add(main, prop('a', { position: { x: 2, y: 2 } }));
    const [copy] = dup(['a']);
    expect(copy).not.toBe('a');
    expect(child(copy)).toMatchObject({ name: 'a (copy)', position: { x: 3, y: 3 } });
    undoManager.undo();
    expect(ids(main)).toEqual(['a']);
  });

  it('offsets a door tuple without NaN, zones, and rings with their tangents', () => {
    const door: DoorChild = {
      id: 'door', name: 'door', childType: 'door', visible: true, wallId: '', position: [4, 4], angle: 0,
      width: 1, style: 'single', state: 'closed', isSecret: false,
    };
    const rect: ZoneChild = { id: 'zr', name: 'zr', childType: 'zone', visible: true, shape: { kind: 'rect', x: 0, y: 0, width: 2, height: 2 } };
    const circle: ZoneChild = { id: 'zc', name: 'zc', childType: 'zone', visible: true, shape: { kind: 'circle', position: { x: 1, y: 1 }, radius: 2 } };
    const shape = {
      id: 'sh', name: 'sh', childType: 'shape', visible: true, shapeType: 'polygon',
      contours: [[[0, 0], [2, 0], [2, 2]]], tangents: [[{ tout: [1, 0] }, null, null]],
      textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
    } as unknown as ShapeChild;
    const water = {
      id: 'wa', name: 'wa', childType: 'water', visible: true, waterType: 'lake', contours: [[[0, 0], [1, 0], [1, 1]]],
      textureId: '', tint: '#ffffff', opacity: 1, bankTextureId: '', bankWidth: 0,
    } as unknown as WaterChild;
    add(main, door, rect, circle, shape, water);
    const copies = dup(['door', 'zr', 'zc', 'sh', 'wa']);
    expect(child<DoorChild>(copies[0]).position).toEqual([5, 5]);
    expect(child<ZoneChild>(copies[1]).shape).toMatchObject({ x: 1, y: 1 });
    expect(child<ZoneChild>(copies[2]).shape).toMatchObject({ position: { x: 2, y: 2 } });
    expect(child<ShapeChild>(copies[3]).contours[0][1]).toEqual([3, 1]);
    expect(child<ShapeChild>(copies[3]).tangents![0][0]).toEqual({ tout: [2, 1] });
    expect(child<WaterChild>(copies[4]).contours[0][2]).toEqual([2, 2]);
  });

  it('a whole group copies into a new group; part of one stays in it on its own layer', () => {
    add(main, prop('a', { groupId: 'g' }), prop('b', { groupId: 'g' }));
    useStore.getState().updateLayer(main, { groups: [{ id: 'g', name: 'Camp', merged: true }] });
    const copies = dup(['a', 'b']);
    const record = layer(main).groups!.find((g) => g.id !== 'g')!;
    expect(record).toMatchObject({ name: 'Camp (copy)', merged: true });
    expect(copies.map((id) => child(id).groupId)).toEqual([record.id, record.id]);

    const [one] = dup(['a']);
    expect(child(one).groupId).toBe('g');
  });

  it('copies the lights glued to a copied asset, glued to the copy', () => {
    add(main, prop('lamp', { position: { x: 5, y: 5 } }));
    add(other, light('glow', { position: { x: 6, y: 5 }, attachedTo: 'lamp' }));
    const [copy] = dup(['lamp']);
    const glowCopy = layer(other).children.find((c) => c.id !== 'glow') as LightChild;
    expect(glowCopy.attachedTo).toBe(copy);
    close(glowCopy.position, 7, 6);
    expect(child<LightChild>('glow').attachedTo).toBe('lamp');
    undoManager.undo();
    expect(ids(other)).toEqual(['glow']);
  });

  it('a light copied with its asset is re-glued; one copied alone is free-standing', () => {
    add(main, prop('lamp'), light('glow', { attachedTo: 'lamp' }));
    const [lampCopy, glowCopy] = dup(['lamp', 'glow']);
    expect(child<LightChild>(glowCopy).attachedTo).toBe(lampCopy);
    expect(ids(main)).toHaveLength(4);

    const [lone] = dup(['glow']);
    expect(child<LightChild>(lone)).not.toHaveProperty('attachedTo');
  });

  it('pastes clipboard snapshots onto another layer, centred, dropping a partial group', () => {
    add(main, prop('a', { groupId: 'g', position: { x: 1, y: 1 } }), prop('b', { groupId: 'g', position: { x: 3, y: 1 } }));
    useStore.getState().updateLayer(main, { groups: [{ id: 'g', name: 'Camp' }] });
    const clipboard = [structuredClone(child('a'))];
    const [copy] = dup([], { children: clipboard, targetLayerId: other, centreAt: { x: 10, y: 10 }, label: 'Paste' });
    expect(layer(other).children.map((c) => c.id)).toEqual([copy]);
    expect(child(copy).position).toEqual({ x: 10, y: 10 });
    expect(child(copy)).not.toHaveProperty('groupId');
    expect(layer(other).groups).toBeUndefined();
  });
});

// ─── Move to layer ───────────────────────────────────────

describe('createMoveToLayerCommand', () => {
  it('moves children on top in their order, with their lights and whole group, one undo', () => {
    add(other, prop('x'));
    add(
      main,
      prop('a', { groupId: 'g' }),
      prop('loose'),
      prop('b', { groupId: 'g' }),
      light('glow', { attachedTo: 'b' }),
      prop('c', { groupId: 'h' }),
      prop('d', { groupId: 'h' }),
    );
    useStore.getState().updateLayer(main, { groups: [{ id: 'g', name: 'Camp' }, { id: 'h', name: 'Pile' }] });

    run(createMoveToLayerCommand(['b', 'a', 'c'], other));
    expect(ids(other)).toEqual(['x', 'a', 'b', 'glow', 'c']);
    expect(ids(main)).toEqual(['loose', 'd']);
    expect(child('a').groupId).toBe('g');
    expect(child('c')).not.toHaveProperty('groupId');
    expect(layer(other).groups).toEqual([{ id: 'g', name: 'Camp' }]);
    expect(layer(main).groups).toEqual([{ id: 'h', name: 'Pile' }]);

    undoManager.undo();
    expect(ids(main)).toEqual(['a', 'loose', 'b', 'glow', 'c', 'd']);
    expect(ids(other)).toEqual(['x']);
    expect(child('c').groupId).toBe('h');
    expect(layer(main).groups).toHaveLength(2);
  });

  it('a wall takes its doors along', () => {
    const wall: WallSegment = {
      id: 'w', points: [[0, 0], [4, 0]], wallType: 'normal', direction: 'both', color: '#000000', roughness: 0,
    };
    useStore.getState().addWall(main, wall);
    const door: DoorChild = {
      id: 'door', name: 'door', childType: 'door', visible: true, wallId: 'w', position: [2, 0], angle: 0,
      width: 1, style: 'single', state: 'closed', isSecret: false,
    };
    add(main, door);
    run(createMoveToLayerCommand(['w'], other));
    expect(layer(other).standaloneWalls.map((w) => w.id)).toEqual(['w']);
    expect(ids(other)).toEqual(['door']);
    expect(ids(main)).toEqual([]);
    undoManager.undo();
    expect(layer(main).standaloneWalls.map((w) => w.id)).toEqual(['w']);
    expect(ids(main)).toEqual(['door']);
  });

  it('answers null when nothing leaves its layer', () => {
    add(other, prop('x'));
    expect(createMoveToLayerCommand(['x'], other)).toBeNull();
  });
});
