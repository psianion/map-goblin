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
import { doorKitSwatches, installedDoorKits, kitTileLabels, pickDoorKit } from './doorModel';
import { directionAt, directionWords, snapDirection } from './plateauModel';

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
// One dirt floor, for a floor's painted border to take by default.
vi.mock('@dnd/core/src/engine/plateauKit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@dnd/core/src/engine/plateauKit')>()),
  defaultBorderTexture: () => 'p:dirt',
}));

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
    expect(ids('dock')).toEqual(['floor.shape', 'floor.sides', 'floor.walls', 'edit.curve', 'edit.nodeMode', 'floor.height']);
    expect(ids('panel')).toEqual(['floor.mode', 'floor.rockOnCut', 'grid.snap', 'grid.snapStep', 'floor.edgeBand', 'floor.blend', 'floor.opacity']);
  });

  it('gives new floors the dock’s Height, in half steps, 0 stored as nothing', () => {
    expect(settings.getSetting('floor.height')).toBe(0);
    expect(settings.setSetting('floor.height', 1.5)).toBe(true);
    expect(st().tools.settings.floorHeight).toBe(1.5);
    expect(settings.setSetting('floor.height', 11)).toBe(false);
    settings.setSetting('floor.height', 0);
    expect(st().tools.settings.floorHeight).toBeUndefined();
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

describe('the Elevation dock', () => {
  const get = (id: string) => settings.getSetting(id);
  const shown = (id: string) => reg.settingById(id)!.visibleWhen!(get);

  it('offers Cliff art on a cliff, and a painted border its texture and width', () => {
    settings.setSetting('elevation.edge', 'cliff');
    expect(get('elevation.cliffArt')).toBe('default');
    expect(shown('elevation.cliffArt')).toBe(true);
    expect(shown('elevation.paintTexture')).toBe(false);
    expect(settings.setSetting('elevation.cliffArt', 'paint')).toBe(true);
    expect(st().tools.settings.plateau?.edgeArt).toBe('paint');
    expect(shown('elevation.paintTexture')).toBe(true);
    expect(shown('elevation.paintWidth')).toBe(true);
    expect(get('elevation.paintWidth')).toBe(0.75);
    settings.setSetting('elevation.paintTexture', 'gg-forge:wild_dirt_8x8_floor_A');
    expect(settings.setSetting('elevation.paintWidth', 1.5)).toBe(true);
    expect(settings.setSetting('elevation.paintWidth', 5)).toBe(false);
    expect(st().tools.settings.plateau).toMatchObject({ edgeArt: 'paint:gg-forge:wild_dirt_8x8_floor_A', borderWidth: 1.5 });
    settings.setSetting('elevation.edge', 'slope');
    expect(shown('elevation.cliffArt')).toBe(false);
    expect(shown('elevation.paintWidth')).toBe(false);
    settings.setSetting('elevation.edge', 'cliff');
    settings.setSetting('elevation.cliffArt', 'default');
    expect(st().tools.settings.plateau?.edgeArt).toBeUndefined();
  });

  it('offers a slope its Slope face and Slope direction, and neither to a cliff', () => {
    settings.setSetting('elevation.edge', 'cliff');
    expect(shown('elevation.faceArt')).toBe(false);
    expect(shown('elevation.slopeDirection')).toBe(false);
    settings.setSetting('elevation.edge', 'slope');
    expect(shown('elevation.faceArt')).toBe(true);
    expect(shown('elevation.slopeDirection')).toBe(true);
    expect(get('elevation.faceArt')).toBe('ground');
    expect(settings.setSetting('elevation.faceArt', 'gg-forge:face_stone_4x4_floor_A')).toBe(true);
    expect(st().tools.settings.plateau?.faceArt).toBe('gg-forge:face_stone_4x4_floor_A');
    settings.setSetting('elevation.faceArt', 'ground');
    expect(st().tools.settings.plateau?.faceArt).toBeUndefined();
  });

  it('sets the next plateau’s slope direction, never the map’s, from the map’s stored one', () => {
    expect(get('elevation.slopeDirection')).toBe(60);
    useStore.setState((s) => {
      s.mapSettings.faceDirection = 30;
    });
    expect(get('elevation.slopeDirection')).toBe(30);
    expect(settings.setSetting('elevation.slopeDirection', 135)).toBe(true);
    expect(st().tools.settings.plateau?.faceDir).toBe(135);
    expect(st().mapSettings.faceDirection).toBe(30);
    expect(get('elevation.slopeDirection')).toBe(135);
    expect(settings.setSetting('elevation.slopeDirection', 400)).toBe(false);
  });

  it('offers the Top on every edge, Ground first, and Brush with its Size', () => {
    for (const edge of ['none', 'slope', 'cliff']) {
      settings.setSetting('elevation.edge', edge);
      expect(reg.settingById('elevation.topArt')!.visibleWhen).toBeUndefined();
    }
    expect(get('elevation.topArt')).toBe('ground');
    settings.setSetting('elevation.topArt', 'p:moss');
    expect(st().tools.settings.plateau?.topArt).toBe('p:moss');
    settings.setSetting('elevation.topArt', 'ground');
    expect(st().tools.settings.plateau?.topArt).toBeUndefined();
    expect(get('elevation.input')).toBe('pen');
    expect(shown('elevation.brushSize')).toBe(false);
    settings.setSetting('elevation.input', 'brush');
    expect(shown('elevation.brushSize')).toBe(true);
    expect(get('elevation.brushSize')).toBe(1);
    expect(settings.setSetting('elevation.brushSize', 2.5)).toBe(true);
    expect(st().tools.settings.plateau).toMatchObject({ input: 'brush', brushRadius: 2.5 });
    expect(settings.setSetting('elevation.brushSize', 40)).toBe(false);
    expect(reg.toolById('elevation')!.settings.some((s) => s.id === 'edit.curve')).toBe(true);
    // The hint says the brush's keys.
    expect(JSON.stringify(reg.toolById('elevation')!.hint(st()))).toContain('size');
  });

  describe('with plateaus picked', () => {
    beforeEach(() => {
      seed([plateau({ edge: 'slope', height: 2, faceDir: 90 }), plateau({ id: 'p2', name: 'p2', edge: 'slope' })], ['p1', 'p2']);
      st().setActiveTool('plateau');
      undoManager.clear();
    });
    const p = (id: string) => child<PlateauChild>(id);

    it('shows the first picked plateau’s values, its direction the map’s when it has none', () => {
      expect(get('elevation.height')).toBe(2);
      expect(get('elevation.edge')).toBe('slope');
      expect(get('elevation.slopeDirection')).toBe(90);
      useStore.setState((s) => {
        s.selection.selectedIds = ['p2'];
      });
      expect(get('elevation.height')).toBe(1);
      expect(get('elevation.slopeDirection')).toBe(60);
    });

    it('writes every control to every picked plateau as one undo step, and to the tool', () => {
      const writes: [string, unknown, Partial<PlateauChild>][] = [
        ['elevation.height', -3, { height: -3 }],
        ['elevation.faceArt', 'p:face', { faceArt: 'p:face' }],
        ['elevation.slopeDirection', 45, { faceDir: 45 }],
        ['elevation.topArt', 'p:moss', { topArt: 'p:moss' }],
        ['elevation.edge', 'cliff', { edge: 'cliff' }],
        ['elevation.cliffArt', 'paint', { edgeArt: 'paint' }],
        ['elevation.paintTexture', 'p:dirt', { edgeArt: 'paint:p:dirt' }],
        ['elevation.paintWidth', 1.5, { borderWidth: 1.5 }],
      ];
      for (const [id, value, stored] of writes) {
        const before = [structuredClone(p('p1')), structuredClone(p('p2'))];
        expect(settings.setSetting(id, value), id).toBe(true);
        expect(p('p1'), id).toMatchObject(stored);
        expect(p('p2'), id).toMatchObject(stored);
        expect(st().tools.settings.plateau, id).toMatchObject(id === 'elevation.slopeDirection' ? { faceDir: 45 } : stored);
        undoManager.undo();
        expect([p('p1'), p('p2')], id).toEqual(before);
        undoManager.redo();
      }
    });

    it('sets only the tool with nothing picked, or with another tool in hand', () => {
      st().setActiveTool('select');
      settings.setSetting('elevation.height', 4);
      expect(p('p1').height).toBe(2);
      expect(st().tools.settings.plateau?.height).toBe(4);
      st().setActiveTool('plateau');
      useStore.setState((s) => {
        s.selection.selectedIds = [];
      });
      settings.setSetting('elevation.height', 5);
      expect(p('p1').height).toBe(2);
      expect(st().tools.settings.plateau?.height).toBe(5);
    });
  });
});

describe('the direction dial', () => {
  it('snaps to 15 degrees, 0 right and 90 down, and says the way in words', () => {
    expect(directionAt(1, 0)).toBe(0);
    expect(directionAt(0, 1)).toBe(90);
    expect(directionAt(-1, -0.01)).toBe(180);
    expect(directionAt(0, -1)).toBe(270);
    expect(directionAt(Math.cos(1.1), Math.sin(1.1))).toBe(60);
    expect(snapDirection(-7)).toBe(0);
    expect(snapDirection(-8)).toBe(345);
    expect(snapDirection(352)).toBe(345);
    expect(directionWords(60)).toBe('lower right');
    expect(directionWords(90)).toBe('down');
    expect(directionWords(350)).toBe('right');
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

  it('wall Draw comes first in the dock, writes Points or Freehand, and the hint follows it', () => {
    expect(reg.settingsByHome('wall', 'dock')[0].id).toBe('wall.draw');
    const hint = () => reg.toolById('wall')!.hint(st()).segments.map((s) => s.text).join('');
    expect(settings.getSetting('wall.draw')).toBe('points');
    expect(hint()).toContain('Click points');
    settings.setSetting('wall.draw', 'freehand');
    expect(st().tools.settings.wallDraw).toBe('freehand');
    expect(hint()).toBe('Drag to draw · release finishes · ending at the start closes the loop · Esc cancel');
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

  it('door Style offers Opening, an archway of which nothing is drawn, and any other style clears it', () => {
    settings.setSetting('door.style', 'opening');
    expect(st().tools.settings).toMatchObject({ doorStyle: 'archway', doorBare: true });
    expect(settings.getSetting('door.style')).toBe('opening');
    settings.setSetting('door.style', 'single');
    expect(st().tools.settings).toMatchObject({ doorStyle: 'single', doorBare: false });
    expect(settings.getSetting('door.style')).toBe('single');
  });

  it('door Style offers Stairs, which keeps the door style for later and any door style clears', () => {
    settings.setSetting('door.style', 'double');
    settings.setSetting('door.style', 'stairs');
    expect(st().tools.settings).toMatchObject({ doorStyle: 'double', doorStairs: true });
    expect(settings.getSetting('door.style')).toBe('stairs');
    settings.setSetting('door.style', 'opening');
    expect(st().tools.settings).toMatchObject({ doorStyle: 'archway', doorBare: true, doorStairs: false });
  });

  it('the stairs card resizes and deletes the picked stairs, each one undo step', () => {
    useStore.setState((s) => {
      (s.layers.find((l) => l.type === 'dungeon') as DungeonLayer).children.push({
        id: 'p1', name: 'p1', childType: 'plateau', visible: true, contours: [[[10, 10], [14, 10], [14, 14], [10, 14]]], height: 1, edge: 'cliff',
        stairs: [{ id: 's1', ring: 0, from: 1, to: 2 }],
      } as PlateauChild);
    });
    const plateau = () => st().layers.flatMap((l) => (l.type === 'dungeon' ? (l as DungeonLayer).children : [])).find((c) => c.id === 'p1') as PlateauChild;
    expect(read('stairs', 'card.stairs.width', plateau().stairs![0])).toBe(1);
    write('stairs', 'card.stairs.width', ['stairs:p1:s1'], 3);
    expect(plateau().stairs).toEqual([{ id: 's1', ring: 0, from: 1, to: 4 }]);
    undoManager.undo();
    expect(plateau().stairs).toEqual([{ id: 's1', ring: 0, from: 1, to: 2 }]);
    st().setSelectedIds(['stairs:p1:s1']);
    DESIGN_CARDS.find((c) => c.kind === 'stairs')!.verbs[0].run(useStore);
    expect(plateau().stairs).toBeUndefined();
    expect(st().selection.selectedIds).toEqual([]);
  });

  it('door Width steps by whole cells for every style, an Opening from 1 to 2', () => {
    expect(reg.settingById('door.width')!.range?.step).toBe(1);
    settings.setSetting('door.style', 'opening');
    settings.setSetting('door.width', 1);
    const { step } = reg.settingById('door.width')!.range!;
    settings.setSetting('door.width', st().tools.settings.doorWidth + step);
    expect(st().tools.settings.doorWidth).toBe(2);
  });

  it('door Width lets an Opening down to one cell, and Archway takes it back to two', () => {
    settings.setSetting('door.style', 'opening');
    settings.setSetting('door.width', 1);
    expect(st().tools.settings.doorWidth).toBe(1);
    settings.setSetting('door.style', 'archway');
    expect(st().tools.settings.doorWidth).toBe(2);
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

  it('says what a carve does to the rock on a layer with a cave-edged room, as the brush does', () => {
    const room: ShapeChild = {
      id: 'cave-room',
      name: 'Cave room',
      childType: 'shape',
      visible: true,
      shapeType: 'rectangle',
      contours: [[[0, 0], [10, 0], [10, 8], [0, 8]]],
      textureScale: 1,
      textureOffsetX: 0,
      textureOffsetY: 0,
      textureFillRotation: 0,
      textureTint: '#ffffff',
      styleOverrides: { wallTextureSetId: 'GG_Cave_Ink' },
    };
    seed([room], []);
    settings.setSetting('floor.mode', 'carve');
    expect(hint()).toBe('Erase across the rock to open the cave · drag a rectangle · Alt carves while in Draw');
    useStore.setState((s) => {
      s.tools.settings.material.rockOnCut = true;
    });
    expect(hint()).toBe('Carve the floor · drag a rectangle · Alt carves while in Draw');
    useStore.setState((s) => {
      s.tools.settings.material.rockOnCut = undefined;
      (s.layers[0] as DungeonLayer).children = [];
    });
    expect(hint()).toBe('Carve out · drag a rectangle · Alt carves while in Draw');
    settings.setSetting('floor.mode', 'draw');
  });

  it('shows the brush’s Rock on cut edge only in Carve out on a layer with a cave, one value with the brush’s', () => {
    const def = reg.settingById('floor.rockOnCut')!;
    const shown = () => def.visibleWhen!((k) => settings.getSetting(k));
    expect(def).toMatchObject({ label: 'Rock on cut edge', control: 'switch', section: 'Mode', default: false, persist: false });
    const cave: ShapeChild = {
      id: 'cave',
      name: 'Cave 1',
      childType: 'shape',
      visible: true,
      shapeType: 'polygon',
      contours: [[[0, 0], [6, 0], [6, 6], [0, 6]]],
      textureScale: 1,
      textureOffsetX: 0,
      textureOffsetY: 0,
      textureFillRotation: 0,
      textureTint: '#ffffff',
      edgeMaterial: 'GG_Cave_Ink',
    };
    seed([cave], []);
    expect(shown()).toBe(false);
    settings.setSetting('floor.mode', 'carve');
    expect(shown()).toBe(true);
    expect(settings.setSetting('floor.rockOnCut', true)).toBe(true);
    expect(st().tools.settings.material.rockOnCut).toBe(true);
    settings.setSetting('floor.rockOnCut', false);
    expect(st().tools.settings.material.rockOnCut).toBeUndefined();
    seed([], []);
    expect(shown()).toBe(false);
    settings.setSetting('floor.mode', 'draw');
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

  it('turns a floor into ground with Walls on None, and back into a walled floor with a set', () => {
    seed([shape('a')], ['a']);
    write('shape', 'card.floor.walls', ['a'], null);
    expect(child<ShapeChild>('a').ground).toBe(true);
    expect(read('shape', 'card.floor.walls', child<ShapeChild>('a'))).toBeNull();
    write('shape', 'card.floor.walls', ['a'], 'GG_Brick');
    expect(child<ShapeChild>('a').ground).toBeUndefined();
    expect(child<ShapeChild>('a').styleOverrides?.wallTextureSetId).toBe('GG_Brick');
    expect(read('shape', 'card.floor.walls', child<ShapeChild>('a'))).toBe('GG_Brick');
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

  it('picks Painted border as paint only: the band goes for it, stone walls stay, its texture and width set undoably', () => {
    seed([shape('a'), shape('b')], ['a', 'b']);
    useStore.setState((s) => {
      (s.layers[0] as DungeonLayer).style.wallTextureSetId = 'GG_Cave_Ink';
    });
    const a = () => child<ShapeChild>('a');
    expect(field('shape', 'card.floor.edgePaint').visibleWhen!(a())).toBe(false);
    write('shape', 'card.floor.edgeBand', ['a'], '__paint__');
    expect(a()).toMatchObject({ edgePaint: 'p:dirt', edgeBand: null });
    expect(read('shape', 'card.floor.edgeBand', a())).toBe('__paint__');
    for (const id of ['card.floor.edgePaint', 'card.floor.edgePaintWidth']) expect(field('shape', id).visibleWhen!(a()), id).toBe(true);
    expect(read('shape', 'card.floor.edgePaintWidth', a())).toBe(0.75);
    write('shape', 'card.floor.edgePaintWidth', ['a'], 1.25);
    expect(a().edgePaintWidth).toBe(1.25);
    // Back to a band: the paint goes.
    write('shape', 'card.floor.edgeBand', ['a'], 'GG_Cave_Moss');
    expect(a().edgePaint).toBeUndefined();
    expect(a().edgeBand).toBe('GG_Cave_Moss');
    undoManager.undo();
    expect(a().edgePaint).toBe('p:dirt');
    // A floor on a stone-walled layer keeps its walls: no band pin is written.
    useStore.setState((s) => {
      (s.layers[0] as DungeonLayer).style.wallTextureSetId = 'stone';
    });
    write('shape', 'card.floor.edgeBand', ['b'], '__paint__');
    expect(child<ShapeChild>('b').edgePaint).toBe('p:dirt');
    expect(child<ShapeChild>('b')).not.toHaveProperty('edgeBand', null);
  });

  it('sets a floor’s Height in half steps, undoably, 0 stored as nothing', () => {
    seed([shape('a')], ['a']);
    const a = () => child<ShapeChild>('a');
    expect(read('shape', 'card.floor.height', a())).toBe(0);
    write('shape', 'card.floor.height', ['a'], -2.5);
    expect(a().height).toBe(-2.5);
    write('shape', 'card.floor.height', ['a'], 0);
    expect(a().height).toBeUndefined();
    undoManager.undo();
    expect(a().height).toBe(-2.5);
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

  it('shows the kits as pictures and picks one in the dock: the picked doors’ kit, or the next doors’ with none picked', () => {
    useStore.setState((s) => {
      s.packs.installedPacks = [{ packId: 'p', name: 'P', version: '1', sizeBytes: 0, bundled: true, installedAt: 0 }];
    });
    const [auto, stone] = doorKitSwatches(st(), undefined);
    expect(auto).toEqual({ value: 'auto', label: 'Auto (plain)' });
    expect(stone).toMatchObject({ value: 'stone', art: 'p:doorkit-stone-tile-a' });
    // The slices are grey masters: the kit's own tint tells stone from wood.
    expect(stone.tint).toMatch(/^#/);
    pickDoorKit('stone');
    expect(d1().kit).toBe('stone');
    expect(st().tools.settings.doorKit).toBeUndefined();
    undoManager.undo();
    expect(d1().kit).toBeUndefined();
    st().setSelectedIds([]);
    pickDoorKit('stone');
    expect(st().tools.settings.doorKit).toBe('stone');
    expect(d1().kit).toBeUndefined();
    pickDoorKit('auto');
    expect(st().tools.settings.doorKit).toBeUndefined();
    useStore.setState((s) => {
      s.packs.installedPacks = [];
    });
  });

  it('names each kit tile without the start every kit shares, the full name in its tip', () => {
    expect(kitTileLabels(['FA Earthy stone', 'FA Slate stone', 'FA Light wood'])).toEqual(['Earthy stone', 'Slate stone', 'Light wood']);
    expect(kitTileLabels(['Earthy stone', 'Sandstone stone', 'Gray metal'])).toEqual(['Earthy stone', 'Sandstone stone', 'Gray metal']);
    // A name that is all shared start keeps itself; one kit alone is named in full.
    expect(kitTileLabels(['Stone', 'Stone cave'])).toEqual(['Stone', 'Stone cave']);
    expect(kitTileLabels(['FA Earthy stone'])).toEqual(['FA Earthy stone']);
    useStore.setState((s) => {
      s.packs.installedPacks = [{ packId: 'p', name: 'P', version: '1', sizeBytes: 0, bundled: true, installedAt: 0 }];
    });
    const [, stone] = doorKitSwatches(st(), undefined);
    expect(stone).toMatchObject({ value: 'stone', label: 'Stone', title: 'Stone' });
    useStore.setState((s) => {
      s.packs.installedPacks = [];
    });
  });

  it('makes a door a plain opening and back: Opening is an archway flagged bare, any other style clears the flag', () => {
    write('door', 'card.door.style', ['d1'], 'opening');
    expect(d1()).toMatchObject({ style: 'archway', bare: true });
    expect(field('door', 'card.door.style').read(d1())).toBe('opening');
    write('door', 'card.door.style', ['d1'], 'single');
    expect(d1().style).toBe('single');
    expect(d1().bare).toBeUndefined();
    undoManager.undo();
    expect(d1()).toMatchObject({ style: 'archway', bare: true });
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
    for (const id of ['card.plateau.faceArt', 'card.plateau.faceDir', 'card.plateau.ledgeLines']) expect(field('plateau', id).visibleWhen!(p1()), id).toBe(true);
    expect(field('plateau', 'card.plateau.cliffArt').visibleWhen!(p1())).toBe(false);
    // A slope's Ledge lines stand in for Contour lines, which a slope no longer shows.
    expect(field('plateau', 'card.plateau.contourLines').visibleWhen!(p1())).toBe(false);
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

  it('sets contour lines and crossing, undoably', () => {
    write('plateau', 'card.plateau.contourLines', ['p1'], false);
    expect(p1()).toMatchObject({ contourLines: false });
    expect(read('plateau', 'card.plateau.crossing', p1())).toBe('edge');
    undoManager.undo();
    expect(p1().contourLines).toBeUndefined();
  });

  it('sets a slope’s Face, Ground storing nothing, on every picked plateau as one step', () => {
    seed([plateau({ edge: 'slope' }), plateau({ id: 'p2', name: 'p2', edge: 'slope' })], ['p1', 'p2']);
    const stone = 'gg-forge:face_stone_4x4_floor_A';
    expect(read('plateau', 'card.plateau.faceArt', p1())).toBe('ground');
    write('plateau', 'card.plateau.faceArt', ['p1', 'p2'], stone);
    expect(p1().faceArt).toBe(stone);
    expect(child<PlateauChild>('p2').faceArt).toBe(stone);
    expect(read('plateau', 'card.plateau.faceArt', p1())).toBe(stone);
    write('plateau', 'card.plateau.faceArt', ['p1'], 'ground');
    expect(p1().faceArt).toBeUndefined();
    undoManager.undo();
    undoManager.undo();
    expect(p1().faceArt).toBeUndefined();
    expect(child<PlateauChild>('p2').faceArt).toBeUndefined();
  });

  it('shows the plateau’s own direction, the map’s stored one for a plateau saved without, and writes a number', () => {
    seed([plateau({ edge: 'slope' })], ['p1']);
    expect(read('plateau', 'card.plateau.faceDir', p1())).toBe(60);
    useStore.setState((s) => {
      s.mapSettings.faceDirection = 30;
    });
    expect(read('plateau', 'card.plateau.faceDir', p1())).toBe(30);
    write('plateau', 'card.plateau.faceDir', ['p1'], 135);
    expect(p1().faceDir).toBe(135);
    expect(read('plateau', 'card.plateau.faceDir', p1())).toBe(135);
    undoManager.undo();
    expect(p1().faceDir).toBeUndefined();
    expect(field('plateau', 'card.plateau.faceDir').schema.safeParse(null).success).toBe(false);
  });

  it('sets the Top on any edge, Ground storing nothing, on every picked plateau as one step', () => {
    seed([plateau(), plateau({ id: 'p2', name: 'p2', edge: 'slope' })], ['p1', 'p2']);
    expect(field('plateau', 'card.plateau.topArt').visibleWhen).toBeUndefined();
    expect(read('plateau', 'card.plateau.topArt', p1())).toBe('ground');
    write('plateau', 'card.plateau.topArt', ['p1', 'p2'], 'p:moss');
    expect(p1().topArt).toBe('p:moss');
    expect(child<PlateauChild>('p2').topArt).toBe('p:moss');
    undoManager.undo();
    expect(p1().topArt).toBeUndefined();
    expect(child<PlateauChild>('p2').topArt).toBeUndefined();
  });

  it('reads Smooth corners on only when every node of the picked plateaus is smooth', () => {
    const smooth = [[{ tin: [0, 1], tout: [2, 1] }, { tin: [4, 0], tout: [4, 2] }, { tin: [5, 4], tout: [3, 4] }, { tin: [1, 5], tout: [1, 3] }]] as PlateauChild['tangents'];
    seed([plateau({ tangents: smooth }), plateau({ id: 'p2', name: 'p2' })], ['p1', 'p2']);
    expect(read('plateau', 'card.plateau.smoothCorners', p1())).toBe(false);
    useStore.setState((s) => {
      s.selection.selectedIds = ['p1'];
    });
    expect(read('plateau', 'card.plateau.smoothCorners', p1())).toBe(true);
  });

  it('writes Ledge lines to the stored contour switch, on by default', () => {
    seed([plateau({ edge: 'slope' })], ['p1']);
    expect(read('plateau', 'card.plateau.ledgeLines', p1())).toBe(true);
    write('plateau', 'card.plateau.ledgeLines', ['p1'], false);
    expect(p1().contourLines).toBe(false);
    undoManager.undo();
    expect(p1().contourLines).toBeUndefined();
  });

  it('picks Painted border, its texture and width, and keeps the texture when picked again', () => {
    const dirt = 'gg-forge:wild_dirt_8x8_floor_A';
    expect(field('plateau', 'card.plateau.paintTexture').visibleWhen!(p1())).toBe(false);
    write('plateau', 'card.plateau.cliffArt', ['p1'], 'paint');
    expect(p1().edgeArt).toBe('paint');
    expect(read('plateau', 'card.plateau.cliffArt', p1())).toBe('paint');
    for (const id of ['card.plateau.paintTexture', 'card.plateau.paintWidth']) expect(field('plateau', id).visibleWhen!(p1()), id).toBe(true);
    expect(field('plateau', 'card.plateau.contourLines').visibleWhen!(p1())).toBe(false);
    expect(read('plateau', 'card.plateau.paintWidth', p1())).toBe(0.75);
    write('plateau', 'card.plateau.paintTexture', ['p1'], dirt);
    write('plateau', 'card.plateau.paintWidth', ['p1'], 1.25);
    expect(p1()).toMatchObject({ edgeArt: `paint:${dirt}`, borderWidth: 1.25 });
    expect(read('plateau', 'card.plateau.paintTexture', p1())).toBe(dirt);
    write('plateau', 'card.plateau.cliffArt', ['p1'], 'paint');
    expect(p1().edgeArt).toBe(`paint:${dirt}`);
    write('plateau', 'card.plateau.cliffArt', ['p1'], 'default');
    expect(p1().edgeArt).toBeUndefined();
    expect(read('plateau', 'card.plateau.cliffArt', p1())).toBe('default');
    undoManager.undo();
    expect(p1().edgeArt).toBe(`paint:${dirt}`);
  });

  it('shows Edge line on a painted border only, on by default, switched off undoably', () => {
    expect(field('plateau', 'card.plateau.edgeLine').visibleWhen!(p1())).toBe(false);
    write('plateau', 'card.plateau.cliffArt', ['p1'], 'paint');
    expect(field('plateau', 'card.plateau.edgeLine').visibleWhen!(p1())).toBe(true);
    expect(read('plateau', 'card.plateau.edgeLine', p1())).toBe(true);
    write('plateau', 'card.plateau.edgeLine', ['p1'], false);
    expect(p1().contourLines).toBe(false);
    expect(read('plateau', 'card.plateau.edgeLine', p1())).toBe(false);
    undoManager.undo();
    expect(p1().contourLines).toBeUndefined();
  });
});
