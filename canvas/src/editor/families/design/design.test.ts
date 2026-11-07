import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { createDefaultState, createDungeonLayer } from '@/store/factories';
import type { AnyChild, DoorChild, DungeonLayer, PlateauChild, ShapeChild, WallSegment } from '@/store/types';
import { createRegistry } from '@/editor/registry';
import type { CardFieldDef, ObjectKind, ObjectOf } from '@/editor/registry/types';
import { RAIL_TOOLS } from '@/editor/registry/rail';
import { SHARED_SETTINGS } from '@/editor/registry/shared';
import { validateRegistry } from '@/editor/registry/validate';
import { createSettings } from '@/editor/registry/settings';
import { design, DESIGN_CARDS } from './index';
import { installedDoorKits } from './doorModel';

vi.mock('@dnd/core/src/assets/packCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd/core/src/assets/packCatalog')>();
  const entries = [
    { id: 'p:moss', type: 'floor', packId: 'p', label: 'Moss' },
    { id: 'p:doorkit-stone-tile-a', type: 'object', packId: 'p', label: 'Stone leaf' },
  ];
  return {
    ...actual,
    getCatalogEntry: (id: string) => entries.find((e) => e.id === id),
    hasLiveTexture: (id: string | undefined) => id === 'p:moss',
    isBandSet: (id: string | undefined) => !!id?.startsWith('GG_Cave'),
    getBandSetIds: () => ['GG_Cave_Ink', 'GG_Cave_Moss'],
  };
});

const input = () => ({ rail: RAIL_TOOLS, families: [design], shared: SHARED_SETTINGS, cards: DESIGN_CARDS });
const reg = createRegistry(input());
const settings = createSettings(reg, useStore);
const st = () => useStore.getState();
const layer = (id = 'l1') => st().layers.find((l) => l.id === id) as DungeonLayer;
const child = <T extends AnyChild>(id: string, layerId = 'l1') => layer(layerId).children.find((c) => c.id === id) as T;
const wallOf = (id: string) => layer().standaloneWalls.find((w) => w.id === id) as WallSegment;

function shape(id: string, over: Partial<ShapeChild> = {}): ShapeChild {
  return {
    id,
    name: id,
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[0, 0], [6, 0], [6, 6], [0, 6]]],
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    ...over,
  };
}

const wall: WallSegment = {
  id: 'w1',
  points: [[0, 0], [5, 0]],
  wallType: 'normal',
  direction: 'both',
  color: '#000000',
  roughness: 0,
};

const door = (over: Partial<DoorChild> = {}): DoorChild => ({
  id: 'd1',
  name: 'Door 1',
  childType: 'door',
  visible: true,
  wallId: 'w1',
  position: [2.5, 0],
  angle: 0,
  width: 1,
  style: 'single',
  state: 'closed',
  isSecret: false,
  ...over,
});

const plateau = (over: Partial<PlateauChild> = {}): PlateauChild => ({
  id: 'p1',
  name: 'p1',
  childType: 'plateau',
  visible: true,
  contours: [[[1, 1], [4, 1], [4, 4], [1, 4]]],
  height: 1,
  edge: 'cliff',
  ...over,
});

/** Two dungeon layers on the default level, `children` and the wall on the first, `ids` picked. */
function seed(children: AnyChild[], ids: string[]) {
  const levelId = st().ui.activeLevelId;
  const a = { ...createDungeonLayer('Stone floor', levelId), id: 'l1', children, standaloneWalls: [structuredClone(wall)] };
  const b = { ...createDungeonLayer('Water', levelId), id: 'l2' };
  useStore.setState((s) => {
    s.layers = [a, b];
    s.ui.activeLayerId = 'l1';
    s.selection.selectedIds = ids;
  });
}

function field<K extends ObjectKind>(kind: K, id: string): CardFieldDef<K> {
  const card = DESIGN_CARDS.find((c) => c.kind === kind);
  const f = card?.fields.find((x) => x.id === id);
  if (!f) throw new Error(`no field ${id}`);
  return f as unknown as CardFieldDef<K>;
}

/** Writes `value` for the picked `ids` through the card field, as the card does. */
function write<K extends ObjectKind>(kind: K, id: string, ids: string[], value: unknown) {
  field(kind, id).write(useStore, ids, value);
}
const read = <K extends ObjectKind>(kind: K, id: string, o: ObjectOf<K>) => field(kind, id).read(o);

beforeEach(() => {
  localStorage.clear();
  undoManager.clear();
  st().resetToDefault();
});

describe('the Design family', () => {
  it('passes every registry rule, bindings included, on a fresh store', () => {
    expect(validateRegistry(input(), createDefaultState())).toEqual([]);
  });

  // Door and Elevation are off D and E, the Design and Environment family keys (step 9).
  it('holds Floor, Wall, Door and Elevation under D, keys F W S L', () => {
    expect(design.key).toBe('D');
    expect(design.tools.map((t) => [t.label, t.key])).toEqual([
      ['Floor', 'F'],
      ['Wall', 'W'],
      ['Door', 'S'],
      ['Elevation', 'L'],
    ]);
  });

  it('parses every default, tool settings and card fields alike', () => {
    const defs = [...design.tools.flatMap((t) => t.settings), ...DESIGN_CARDS.flatMap((c) => c.fields)];
    for (const d of defs) expect(d.schema.safeParse(d.default).success, d.id).toBe(true);
  });

  it('gives every tool a hint with its name', () => {
    for (const t of design.tools) expect(t.hint(st()).label).toBe(t.label);
  });

  it('keeps the wall width off the floor tool and over or under off the wall', () => {
    const ids = (tool: string) => reg.toolById(tool)!.settings.map((s) => s.id);
    expect(ids('floor')).not.toContain('wall.width');
    expect(ids('wall')).toContain('wall.width');
    expect(DESIGN_CARDS.flatMap((c) => c.fields.map((f) => f.id)).some((id) => /order|sort|under/i.test(id))).toBe(false);
  });

  it('splits Floor into dock and panel as plan 6.1 has it', () => {
    const ids = (home: 'dock' | 'panel') => reg.settingsByHome('floor', home).map((s) => s.id);
    expect(ids('dock')).toEqual(['floor.shape', 'floor.sides', 'edit.curve', 'edit.nodeMode']);
    expect(ids('panel')).toEqual(['floor.mode', 'grid.snap', 'grid.snapStep', 'floor.edgeBand', 'floor.blend', 'floor.opacity']);
  });
});

describe('Floor shape and sides', () => {
  const get = (id: string) => settings.getSetting(id);
  const sidesShown = () => reg.settingById('floor.sides')!.visibleWhen!(get);

  it('puts the engine tool for each shape in hand', () => {
    expect(settings.setSetting('floor.shape', 'regular')).toBe(true);
    expect(st().tools.activeTool).toBe('regularPolygon');
    expect(settings.setSetting('floor.shape', 'polygon')).toBe(true);
    expect(st().tools.activeTool).toBe('polygon');
    expect(settings.setSetting('floor.shape', 'circle')).toBe(false);
  });

  it('follows the tool in hand, so the old keys and the row agree', () => {
    st().setActiveTool('regularPolygon');
    expect(get('floor.shape')).toBe('regular');
    st().setActiveTool('wall');
    expect(get('floor.shape')).toBe('rect');
  });

  it('shows Sides for Regular only', () => {
    settings.setSetting('floor.shape', 'rect');
    expect(sidesShown()).toBe(false);
    settings.setSetting('floor.shape', 'regular');
    expect(sidesShown()).toBe(true);
    expect(settings.setSetting('floor.sides', 8)).toBe(true);
    expect(st().tools.settings.regularPolygon.sides).toBe(8);
    expect(settings.setSetting('floor.sides', 2)).toBe(false);
  });
});

describe('tool settings', () => {
  beforeEach(() => seed([], []));

  it('Blend with neighbours writes the layer style, undoably', () => {
    settings.setSetting('floor.blend', false);
    expect(layer().style.showEdgeTransitions).toBe(false);
    undoManager.undo();
    expect(layer().style.showEdgeTransitions).toBe(true);
  });

  it('wall Width writes the layer and its walls, undoably', () => {
    settings.setSetting('wall.width', 0.75);
    expect(layer().style.wallWidth).toBe(0.75);
    expect(settings.getSetting('wall.width')).toBe(0.75);
    undoManager.undo();
    expect(layer().style.wallWidth).toBe(0.5);
  });

  it('Corner style writes the layer when nothing is picked, a picked wall when one is, undoably', () => {
    expect(settings.getSetting('wall.cornerStyle')).toBe('sharp');
    settings.setSetting('wall.cornerStyle', 'rounded');
    expect(layer().style.wallCornerStyle).toBe('rounded');
    expect(wallOf('w1').cornerStyle).toBeUndefined();
    useStore.setState((s) => {
      s.selection.selectedIds = ['w1'];
    });
    settings.setSetting('wall.cornerStyle', 'sharp');
    expect(wallOf('w1').cornerStyle).toBe('sharp');
    expect(layer().style.wallCornerStyle).toBe('rounded');
    undoManager.undo();
    expect(wallOf('w1').cornerStyle).toBeUndefined();
    undoManager.undo();
    expect(layer().style.wallCornerStyle).toBeUndefined();
  });

  it('wall Type writes the stored type, keeping one that already acts as the group', () => {
    settings.setSetting('wall.type', 'window');
    expect(st().tools.settings.wallType).toBe('window');
    settings.setSetting('wall.type', 'open');
    expect(st().tools.settings.wallType).toBe('invisible');
    settings.setSetting('wall.type', 'open');
    expect(st().tools.settings.wallType).toBe('invisible');
  });

  it('door Style takes the width up to what the style needs, and Width never goes under it', () => {
    settings.setSetting('door.style', 'double');
    expect(st().tools.settings.doorWidth).toBe(2);
    settings.setSetting('door.width', 1);
    expect(st().tools.settings.doorWidth).toBe(2);
    expect(settings.setSetting('door.angle', 22)).toBe(false);
    expect(settings.setSetting('door.angle', 35)).toBe(true);
    expect(st().tools.settings.doorAngle).toBe(35);
  });

  it('Elevation height is never flat, and edge lands beside it', () => {
    expect(settings.setSetting('elevation.height', 0)).toBe(false);
    settings.setSetting('elevation.height', -2);
    settings.setSetting('elevation.edge', 'slope');
    expect(st().tools.settings.plateau).toEqual({ height: -2, edge: 'slope' });
  });
});

describe('Carve out', () => {
  const hint = () => reg.toolById('floor')!.hint(st()).segments.map((s) => s.text).join('');

  it('is the floor tools\' own Mode, with Alt as the fast path in the hint', () => {
    expect(hint()).toBe('Drag a rectangle · Shift square · Alt carves · Esc cancel');
    expect(settings.setSetting('floor.mode', 'carve')).toBe(true);
    expect(st().tools.floorMode).toBe('carve');
    expect(hint()).toBe('Carve out · drag a rectangle · Alt carves while in Draw');
    settings.setSetting('floor.mode', 'draw');
    expect(st().tools.floorMode).toBe('draw');
  });

  it('never flips the erase switch the brushes share', () => {
    settings.setSetting('floor.mode', 'carve');
    expect(st().tools.eraseMode).toBe(false);
    st().setEraseMode(true);
    expect(settings.getSetting('floor.mode')).toBe('carve');
    st().setFloorMode('draw');
    expect(st().tools.eraseMode).toBe(true);
  });
});

describe('the Floor panel defaults for new floors', () => {
  it('shows the layer band while unset, and pins only a band picked there', () => {
    seed([], []);
    useStore.setState((s) => {
      (s.layers[0] as DungeonLayer).style.wallTextureSetId = 'GG_Cave_Ink';
    });
    expect(settings.getSetting('floor.edgeBand')).toBe('GG_Cave_Ink');
    settings.setSetting('floor.edgeBand', null);
    expect(st().tools.settings.floorEdgeBand).toBeNull();
    settings.setSetting('floor.edgeBand', 'GG_Cave_Ink');
    expect(st().tools.settings.floorEdgeBand).toBeUndefined();
  });

  it('keeps an opacity for new floors', () => {
    expect(settings.getSetting('floor.opacity')).toBe(1);
    expect(settings.setSetting('floor.opacity', 0.5)).toBe(true);
    expect(st().tools.settings.floorOpacity).toBe(0.5);
    expect(settings.setSetting('floor.opacity', 2)).toBe(false);
  });
});

describe('the floor card', () => {
  it('reads Size and moves the floor to another layer, undoably', () => {
    seed([shape('a')], ['a']);
    expect(read('shape', 'card.floor.size', child<ShapeChild>('a'))).toBe('6 × 6 sq');
    expect(read('shape', 'card.floor.layer', child<ShapeChild>('a'))).toBe('l1');
    write('shape', 'card.floor.layer', ['a'], 'l2');
    expect(child('a', 'l2')).toBeDefined();
    undoManager.undo();
    expect(child('a', 'l1')).toBeDefined();
  });

  it('pins a colour on a plain floor, a whole drag as one undo step', () => {
    seed([shape('a')], ['a']);
    const f = field('shape', 'card.floor.colour');
    expect(f.visibleWhen!(child<ShapeChild>('a'))).toBe(true);
    write('shape', 'card.floor.colour', ['a'], '#112233');
    write('shape', 'card.floor.colour', ['a'], '#445566');
    expect(read('shape', 'card.floor.colour', child<ShapeChild>('a'))).toBe('#445566');
    expect(undoManager.size()).toBe(1);
    undoManager.undo();
    expect(child<ShapeChild>('a').styleOverrides).toBeUndefined();
  });

  it('shows Tint and Fill for a textured floor and writes both, undoably', () => {
    seed([shape('a', { textureId: 'p:moss' })], ['a']);
    const a = () => child<ShapeChild>('a');
    expect(field('shape', 'card.floor.colour').visibleWhen!(a())).toBe(false);
    expect(field('shape', 'card.floor.tint').visibleWhen!(a())).toBe(true);
    write('shape', 'card.floor.tint', ['a'], '#ccbbaa');
    expect(a().textureTint).toBe('#ccbbaa');
    undoManager.undo();
    expect(a().textureTint).toBe('#ffffff');
    write('shape', 'card.floor.fill', ['a'], { scale: 2, rotate: 90, x: 0.5, y: 0 });
    expect(a()).toMatchObject({ textureScale: 2, textureOffsetX: 0.5, textureOffsetY: 0 });
    expect(a().textureFillRotation).toBeCloseTo(Math.PI / 2);
    undoManager.undo();
    expect(a()).toMatchObject({ textureScale: 1, textureFillRotation: 0, textureOffsetX: 0 });
  });

  it('sets the texture, undoably', () => {
    seed([shape('a')], ['a']);
    write('shape', 'card.floor.texture', ['a'], 'p:moss');
    expect(child<ShapeChild>('a').textureId).toBe('p:moss');
    undoManager.undo();
    expect(child<ShapeChild>('a').textureId).toBeUndefined();
  });

  it("sets a floor's opacity, a drag as one undo step, full stored as nothing", () => {
    seed([shape('a')], ['a']);
    expect(read('shape', 'card.floor.opacity', child<ShapeChild>('a'))).toBe(1);
    write('shape', 'card.floor.opacity', ['a'], 0.7);
    write('shape', 'card.floor.opacity', ['a'], 0.5);
    expect(child<ShapeChild>('a').opacity).toBe(0.5);
    expect(undoManager.size()).toBe(1);
    write('shape', 'card.floor.opacity', ['a'], 1);
    expect(child<ShapeChild>('a').opacity).toBeUndefined();
  });

  it("reads the layer's band until the floor picks its own; the layer's own unpins it", () => {
    seed([shape('a')], ['a']);
    useStore.setState((s) => {
      (s.layers[0] as DungeonLayer).style.wallTextureSetId = 'GG_Cave_Ink';
    });
    const a = () => child<ShapeChild>('a');
    expect(read('shape', 'card.floor.edgeBand', a())).toBe('GG_Cave_Ink');
    write('shape', 'card.floor.edgeBand', ['a'], null);
    expect(a().edgeBand).toBeNull();
    expect(read('shape', 'card.floor.edgeBand', a())).toBeNull();
    write('shape', 'card.floor.edgeBand', ['a'], 'GG_Cave_Moss');
    expect(a().edgeBand).toBe('GG_Cave_Moss');
    write('shape', 'card.floor.edgeBand', ['a'], 'GG_Cave_Ink');
    expect(a().edgeBand).toBeUndefined();
    undoManager.undo();
    expect(a().edgeBand).toBe('GG_Cave_Moss');
  });

  it('offers Node mode for one floor', () => {
    seed([shape('a')], ['a']);
    const card = DESIGN_CARDS.find((c) => c.kind === 'shape')!;
    const node = card.verbs.find((v) => v.id === 'nodeMode')!;
    expect(node.when!(st())).toBe(true);
    expect(node.active!(st())).toBe(false);
    node.run(useStore);
    expect(st().tools.shapeNodeEditId).toBe('a');
    // The card stays: the floor is still picked, alone, and Node mode reads on.
    expect(st().selection.selectedIds).toEqual(['a']);
    expect(node.active!(st())).toBe(true);
  });

  it('shows Nodes only in node mode, and disables Delete at three nodes', () => {
    const tri = shape('t', { contours: [[[20, 0], [26, 0], [23, 5]]] });
    seed([shape('a'), tri], ['a']);
    useStore.setState((s) => {
      (s.layers[0] as DungeonLayer).mergedFloor = [[[0, 0], [6, 0], [6, 6], [0, 6]], [[20, 0], [26, 0], [23, 5]]];
    });
    const card = DESIGN_CARDS.find((c) => c.kind === 'shape')!;
    const del = card.verbs.find((v) => v.id === 'delete')!;
    const nodes = field('shape', 'card.floor.nodes');
    expect(nodes.visibleWhen!(child<ShapeChild>('a'))).toBe(false);
    expect(del.disabled!(st())).toBe(false);
    st().setShapeNodeEdit('a');
    expect(nodes.visibleWhen!(child<ShapeChild>('a'))).toBe(true);
    expect(read('shape', 'card.floor.nodes', child<ShapeChild>('a'))).toBe('4');
    // No node picked: nothing for Delete to take.
    expect(del.disabled!(st())).toBe(true);
    st().selectVertex(0);
    expect(del.disabled!(st())).toBe(false);
    st().setShapeNodeEdit('t');
    st().selectVertex(0);
    expect(del.disabled!(st())).toBe(true);
  });
});

describe('the wall card', () => {
  beforeEach(() => seed([], ['w1']));

  it('reads the length and writes the type, undoably', () => {
    expect(read('wall', 'card.wall.length', wallOf('w1'))).toBe('5 sq');
    write('wall', 'card.wall.type', ['w1'], 'open');
    expect(wallOf('w1').wallType).toBe('invisible');
    undoManager.undo();
    expect(wallOf('w1').wallType).toBe('normal');
  });

  it("reads the layer's corner style until the wall picks its own, undoably", () => {
    expect(read('wall', 'card.wall.cornerStyle', wallOf('w1'))).toBe('sharp');
    write('wall', 'card.wall.cornerStyle', ['w1'], 'rounded');
    expect(wallOf('w1').cornerStyle).toBe('rounded');
    expect(read('wall', 'card.wall.cornerStyle', wallOf('w1'))).toBe('rounded');
    undoManager.undo();
    expect(wallOf('w1').cornerStyle).toBeUndefined();
  });

  it('makes the set editable: none, then the layer\'s again', () => {
    expect(read('wall', 'card.wall.set', wallOf('w1'))).toBe('layer');
    write('wall', 'card.wall.set', ['w1'], 'none');
    expect(wallOf('w1').textureSetId).toBe('');
    write('wall', 'card.wall.set', ['w1'], 'layer');
    expect(wallOf('w1').textureSetId).toBeUndefined();
    undoManager.undo();
    expect(wallOf('w1').textureSetId).toBe('');
  });
});

describe('the door card', () => {
  beforeEach(() => seed([door()], ['d1']));
  const d1 = () => child<DoorChild>('d1');

  it('writes state, secret and name, each undoably', () => {
    write('door', 'card.door.state', ['d1'], 'locked');
    write('door', 'card.door.secret', ['d1'], true);
    write('door', 'card.door.name', ['d1'], '  Cellar door ');
    expect(d1()).toMatchObject({ state: 'locked', isSecret: true, name: 'Cellar door' });
    undoManager.undo();
    undoManager.undo();
    undoManager.undo();
    expect(d1()).toMatchObject({ state: 'closed', isSecret: false, name: 'Door 1' });
  });

  it('stands a door free and anchors it back, each one undo step', () => {
    expect(read('door', 'card.door.freestanding', d1())).toBe(false);
    write('door', 'card.door.freestanding', ['d1'], true);
    expect(d1().freestanding).toBe(true);
    const piece = layer().standaloneWalls.find((w) => w.id === d1().wallId)!;
    expect(piece.id).not.toBe('w1');
    expect(piece.points[0][0]).toBeCloseTo(2);
    expect(piece.points[1][0]).toBeCloseTo(3);
    expect(read('door', 'card.door.freestanding', d1())).toBe(true);
    expect(undoManager.size()).toBe(1);

    // Off: onto the wall under it, within a cell; the piece goes with it.
    write('door', 'card.door.freestanding', ['d1'], false);
    expect(d1().wallId).toBe('w1');
    expect(d1().freestanding).toBeUndefined();
    expect(layer().standaloneWalls.map((w) => w.id)).toEqual(['w1']);
    undoManager.undo();
    expect(d1().wallId).toBe(piece.id);
    undoManager.undo();
    expect(d1().wallId).toBe('w1');
    expect(layer().standaloneWalls).toHaveLength(1);
  });

  it('refuses to anchor a freestanding door with no wall within one cell', () => {
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.id === 'l1') as DungeonLayer;
      l.standaloneWalls.push({ ...structuredClone(wall), id: 'p', points: [[19.5, 20], [20.5, 20]] });
      const d = l.children.find((c) => c.id === 'd1') as DoorChild;
      Object.assign(d, { wallId: 'p', position: [20, 20], freestanding: true });
    });
    write('door', 'card.door.freestanding', ['d1'], false);
    expect(d1()).toMatchObject({ wallId: 'p', freestanding: true });
    expect(undoManager.size()).toBe(0);
  });

  it('keeps the old name for an empty one', () => {
    write('door', 'card.door.name', ['d1'], '   ');
    expect(d1().name).toBe('Door 1');
    expect(undoManager.size()).toBe(0);
  });

  it('widens the door with its doorway, a drag as one step', () => {
    write('door', 'card.door.width', ['d1'], 1.5);
    write('door', 'card.door.width', ['d1'], 2);
    expect(d1().width).toBe(2);
    expect(undoManager.size()).toBe(1);
    undoManager.undo();
    expect(d1().width).toBe(1);
  });

  it('changes style, undoably', () => {
    write('door', 'card.door.style', ['d1'], 'portcullis');
    expect(d1().style).toBe('portcullis');
    undoManager.undo();
    expect(d1().style).toBe('single');
  });

  it('omits Material and the hanging rows while no pack ships a door kit', () => {
    expect(installedDoorKits()).toEqual([]);
    for (const id of ['card.door.material', 'card.door.hinge', 'card.door.swing', 'card.door.hinges', 'card.door.opensTo']) {
      expect(field('door', id).visibleWhen!(d1()), id).toBe(false);
    }
  });

  it('lists only the kits an installed pack ships, and writes them undoably', () => {
    useStore.setState((s) => {
      s.packs.installedPacks = [{ packId: 'p', name: 'P', version: '1', sizeBytes: 0, bundled: true, installedAt: 0 }];
    });
    expect(installedDoorKits()).toEqual(['stone']);
    expect(field('door', 'card.door.material').visibleWhen!(d1())).toBe(true);
    write('door', 'card.door.material', ['d1'], 'stone');
    expect(d1().kit).toBe('stone');
    expect(field('door', 'card.door.hinges').visibleWhen!(d1())).toBe(true);
    write('door', 'card.door.hinge', ['d1'], 'end');
    write('door', 'card.door.swing', ['d1'], 'reversed');
    write('door', 'card.door.hinges', ['d1'], false);
    expect(d1()).toMatchObject({ hinge: 'end', swing: -1, hinges: false });
    for (let i = 0; i < 4; i++) undoManager.undo();
    expect(d1().kit).toBeUndefined();
    expect(d1().hinge).toBeUndefined();
  });
});

describe('the plateau card', () => {
  beforeEach(() => seed([plateau()], ['p1']));
  const p1 = () => child<PlateauChild>('p1');

  it('steps the height and sets the edge, undoably', () => {
    write('plateau', 'card.plateau.height', ['p1'], -1);
    write('plateau', 'card.plateau.edge', ['p1'], 'slope');
    expect(p1()).toMatchObject({ height: -1, edge: 'slope' });
    expect(field('plateau', 'card.plateau.slopeWidth').visibleWhen!(p1())).toBe(true);
    expect(field('plateau', 'card.plateau.cliffArt').visibleWhen!(p1())).toBe(false);
    undoManager.undo();
    undoManager.undo();
    expect(p1()).toMatchObject({ height: 1, edge: 'cliff' });
  });

  it('Blocks sight is one switch: Auto stores nothing, the other answer pins, back again drops the pin', () => {
    const auto = read('plateau', 'card.plateau.blocksSight', p1()) as boolean;
    write('plateau', 'card.plateau.blocksSight', ['p1'], !auto);
    expect(p1().sightOverride).toBe(auto ? 'show' : 'hide');
    expect(read('plateau', 'card.plateau.blocksSight', p1())).toBe(!auto);
    write('plateau', 'card.plateau.blocksSight', ['p1'], auto);
    expect(p1().sightOverride).toBeUndefined();
    undoManager.undo();
    expect(p1().sightOverride).toBe(auto ? 'show' : 'hide');
  });

  it('sets slope width, contour lines and crossing, undoably', () => {
    write('plateau', 'card.plateau.slopeWidth', ['p1'], 1.5);
    write('plateau', 'card.plateau.contourLines', ['p1'], false);
    expect(p1()).toMatchObject({ slopeWidth: 1.5, contourLines: false });
    expect(read('plateau', 'card.plateau.crossing', p1())).toBe('edge');
    undoManager.undo();
    undoManager.undo();
    expect(p1().slopeWidth).toBeUndefined();
    expect(p1().contourLines).toBeUndefined();
  });
});
