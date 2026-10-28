import { describe, it, expect } from 'vitest';
import { DEFAULT_TEXTURE_SCALE } from '@dnd/core/src/shared/types';
import type { AnyChild, AssetChild, DungeonLayer, DungeonStyle, Room, ShapeChild, WaterChild } from '@/store/types';
import { createDungeonLayer } from '@dnd/core/src/store/factories';
import type { ConnectorChild, DoorChild, WallSegment } from '@/shared/types';
import {
  MIXED,
  TEXTURE_SCALE_RANGE,
  cleanDoorName,
  doorKitField,
  doorKitModel,
  doorMaterialOptions,
  doorModel,
  doorWidthValue,
  swingChoice,
  swingValue,
  doorStyleChange,
  cleanRoomName,
  degToRad,
  fieldsForFloor,
  fieldsGroup,
  hasFillOverrides,
  radToDeg,
  roomInfo,
  sameOrMixed,
  shapeFillModel,
  shortTextureName,
  waterModel,
  WALL_TYPE_CHOICES,
  wallModel,
  wallTypeChange,
  propBoxModel,
  propFieldCount,
  propFieldsModel,
  resolvePropTarget,
} from './selectionModel';

const style = { floorColor: '#aabbcc' } as DungeonStyle;

function shape(id: string, over: Partial<ShapeChild> = {}): ShapeChild {
  return {
    id,
    name: id,
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[0, 0], [2, 0], [2, 2], [0, 2]]],
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    ...over,
  };
}

function water(id: string, over: Partial<WaterChild> = {}): WaterChild {
  return {
    id,
    name: id,
    childType: 'water',
    visible: true,
    waterType: 'river',
    contours: [],
    textureId: 'w',
    tint: '#336699',
    opacity: 0.8,
    bankTextureId: '',
    bankWidth: 0.5,
    ...over,
  };
}

describe('sameOrMixed', () => {
  it('returns the shared value, mixed, or undefined for nothing', () => {
    expect(sameOrMixed([1, 1])).toBe(1);
    expect(sameOrMixed([1, 2])).toBe(MIXED);
    expect(sameOrMixed([])).toBeUndefined();
  });
});

describe('shapeFillModel', () => {
  it('agrees when every shape is the same', () => {
    const m = shapeFillModel([shape('a'), shape('b')], style);
    expect(m.floorColor).toBe('#aabbcc');
    expect(m.hasOverrides).toBe(false);
    expect(m.textureId).toBeUndefined();
    expect(m.textureScale).toBe(1);
    expect(m.textureTint).toBe('#ffffff');
  });

  it('resolves colour through the layer style and flags overrides', () => {
    const a = shape('a', { styleOverrides: { floorColor: '#112233' } });
    expect(shapeFillModel([a], style).floorColor).toBe('#112233');
    expect(shapeFillModel([a], style).hasOverrides).toBe(true);
    expect(shapeFillModel([a, shape('b')], style).floorColor).toBe(MIXED);
    // The same colour spelled in another case is not a mix.
    const b = shape('b', { styleOverrides: { floorColor: '#AABBCC' } });
    expect(shapeFillModel([shape('c'), b], style).floorColor).toBe('#aabbcc');
    expect(shapeFillModel([shape('c'), b], style).hasOverrides).toBe(true);
  });

  it('an empty override object is not an override', () => {
    expect(shapeFillModel([shape('a', { styleOverrides: {} })], style).hasOverrides).toBe(false);
  });

  it.each([
    ['textureId', { textureId: 'p:stone' }],
    ['textureScale', { textureScale: 2 }],
    ['textureOffsetX', { textureOffsetX: 0.5 }],
    ['textureOffsetY', { textureOffsetY: -1 }],
    ['textureFillRotation', { textureFillRotation: Math.PI }],
    ['textureTint', { textureTint: '#ff0000' }],
  ] as const)('detects a mixed %s', (key, over) => {
    const m = shapeFillModel([shape('a'), shape('b', over as Partial<ShapeChild>)], style);
    expect(m[key]).toBe(MIXED);
    for (const other of ['textureId', 'textureScale', 'textureOffsetX', 'textureOffsetY', 'textureFillRotation', 'textureTint'] as const) {
      if (other !== key) expect(m[other]).not.toBe(MIXED);
    }
  });

  it('a texture no installed pack lists counts as untextured, so Colour shows', () => {
    const live = (id: string | undefined) => !!id && !id.startsWith('dungeon-classic:');
    const old = shape('a', { textureId: 'dungeon-classic:floor_stone_01' });
    const art = shape('b', { textureId: 'gg-demo:floor_A' });
    expect(shapeFillModel([old], style, live).textured).toBe('none');
    expect(fieldsForFloor(shapeFillModel([old], style, live).textured).colour).toBe(true);
    expect(shapeFillModel([old, art], style, live).textured).toBe('some');
    expect(shapeFillModel([art], style, live).textured).toBe('all');
  });

  it('reads missing texture fields as the renderer defaults', () => {
    const bare = shape('a');
    delete (bare as Partial<ShapeChild>).textureScale;
    (bare as Partial<ShapeChild>).textureTint = '';
    const m = shapeFillModel([bare, shape('b')], style);
    expect(m.textureScale).toBe(1);
    expect(m.textureTint).toBe('#ffffff');
  });
});

describe('texture scale', () => {
  it('a freshly drawn shape starts at the art size, well inside the slider', () => {
    expect(DEFAULT_TEXTURE_SCALE).toBe(1);
    expect(DEFAULT_TEXTURE_SCALE).toBeGreaterThan(TEXTURE_SCALE_RANGE.min);
    expect(DEFAULT_TEXTURE_SCALE).toBeLessThan(TEXTURE_SCALE_RANGE.max);
    const m = shapeFillModel([shape('a', { textureId: 'p:stone', textureScale: DEFAULT_TEXTURE_SCALE })], style);
    expect(m.textureScale).toBe(1);
  });
});

describe('fieldsForFloor', () => {
  it('counts textured shapes', () => {
    expect(shapeFillModel([shape('a', { textureId: 'p:x' })], style).textured).toBe('all');
    expect(shapeFillModel([shape('a')], style).textured).toBe('none');
    expect(shapeFillModel([shape('a', { textureId: 'p:x' }), shape('b')], style).textured).toBe('some');
  });

  it('shows Colour where it paints, and Tint and Fill only where a texture is', () => {
    expect(fieldsForFloor('all')).toEqual({ colour: false, tint: true, fill: true, pinned: false });
    expect(fieldsForFloor('none')).toEqual({ colour: true, tint: false, fill: false, pinned: false });
    expect(fieldsForFloor('some')).toEqual({ colour: true, tint: true, fill: true, pinned: false });
  });

  it('keeps a Reset row for a colour pinned under a texture, and only there', () => {
    expect(fieldsForFloor('all', true).pinned).toBe(true);
    // Where the Colour row shows, its own Reset covers the pin.
    expect(fieldsForFloor('some', true).pinned).toBe(false);
    expect(fieldsForFloor('none', true).pinned).toBe(false);
  });
});

describe('shapeFillModel per row', () => {
  const tex = { textureId: 'p:stone' } as const;

  it('reads Colour off the plain floors only, so a pin under a texture is not "Mixed"', () => {
    const chapel = shape('chapel', { ...tex, styleOverrides: { floorColor: '#ff0000' } });
    const court = shape('court');
    const m = shapeFillModel([chapel, court], style);
    expect(m.textured).toBe('some');
    expect(m.floorColor).toBe('#aabbcc');
    expect(m.plainIds).toEqual(['court']);
    expect(m.texturedIds).toEqual(['chapel']);
    expect(m.hasOverrides).toBe(true);
  });

  it('reads Tint off the textured floors only', () => {
    const hall = shape('hall', { ...tex, textureTint: '#4080ff' });
    const court = shape('court', { textureTint: '#ffffff' });
    expect(shapeFillModel([hall, court], style).textureTint).toBe('#4080ff');
    expect(shapeFillModel([hall, shape('b', { ...tex })], style).textureTint).toBe(MIXED);
  });

  it('falls back to every shape when a row has no shape of its own kind', () => {
    const m = shapeFillModel([shape('a', { ...tex, styleOverrides: { floorColor: '#ff0000' } })], style);
    expect(m.plainIds).toEqual([]);
    expect(m.floorColor).toBe('#ff0000');
    expect(fieldsForFloor(m.textured, m.hasOverrides)).toEqual({ colour: false, tint: true, fill: true, pinned: true });
  });
});

describe('degrees and radians', () => {
  it('round-trips and wraps into 0..360', () => {
    expect(radToDeg(Math.PI)).toBeCloseTo(180);
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2);
    expect(radToDeg(degToRad(270))).toBeCloseTo(270);
    expect(radToDeg(-Math.PI / 2)).toBeCloseTo(270);
    expect(radToDeg(2 * Math.PI)).toBeCloseTo(0);
  });
});

describe('shortTextureName', () => {
  it('prefers the catalogue label and tidies a bare id', () => {
    expect(shortTextureName('gg:floor_stone', 'Stone')).toBe('Stone');
    expect(shortTextureName('gg-forge:cobble-wet_01')).toBe('Cobble wet 01');
  });
});

describe('waterModel', () => {
  it('reads banks and mixes', () => {
    const m = waterModel([water('a'), water('b', { bankTextureId: 'bank-grassy-01-a1', opacity: 0.5 })]);
    expect(m.banks).toBe(MIXED);
    expect(m.opacity).toBe(MIXED);
    expect(m.tint).toBe('#336699');
  });

  it('has no flow: rivers and lakes share the same fields', () => {
    const m = waterModel([water('a', { flowSpeed: 0.6 }), water('l', { waterType: 'lake' })]);
    expect(Object.keys(m).sort()).toEqual(['banks', 'opacity', 'tint']);
  });
});

describe('rooms', () => {
  it('finds the measured room by the child id', () => {
    const rooms = [{ id: 'r1', area: 23.6, isPathway: true }] as Room[];
    expect(roomInfo(rooms, 'r1')).toEqual({ area: 24, isPathway: true });
    expect(roomInfo(rooms, 'nope')).toEqual({ area: null, isPathway: false });
  });

  it('rejects a blank name', () => {
    expect(cleanRoomName('  Den ')).toBe('Den');
    expect(cleanRoomName('   ')).toBeNull();
  });
});

describe('fieldsGroup', () => {
  it('groups same-kind floors or water on one layer only', () => {
    const a = shape('a');
    const b = shape('b');
    const w = water('w');
    expect(fieldsGroup([a, b], ['l1', 'l1'])).toEqual({ kind: 'shape', layerId: 'l1', ids: ['a', 'b'] });
    expect(fieldsGroup([w], ['l1'])).toEqual({ kind: 'water', layerId: 'l1', ids: ['w'] });
    expect(fieldsGroup([a, w], ['l1', 'l1'])).toBeNull();
    expect(fieldsGroup([a, b], ['l1', 'l2'])).toBeNull();
    expect(fieldsGroup([{ ...a, childType: 'zone' } as unknown as AnyChild], ['l1'])).toBeNull();
    expect(fieldsGroup([], [])).toBeNull();
  });
});

describe('hasFillOverrides', () => {
  it('is false when every shape sits on the defaults, missing fields included', () => {
    const bare = shape('b');
    delete (bare as Partial<ShapeChild>).textureScale;
    (bare as Partial<ShapeChild>).textureTint = '';
    expect(hasFillOverrides([shape('a'), bare])).toBe(false);
    expect(hasFillOverrides([shape('a', { textureTint: '#FFFFFF' })])).toBe(false);
  });

  it.each([
    ['scale', { textureScale: 2 }],
    ['offset x', { textureOffsetX: 0.5 }],
    ['offset y', { textureOffsetY: -1 }],
    ['rotation', { textureFillRotation: Math.PI / 2 }],
    ['tint', { textureTint: '#884422' }],
  ] as const)('is true when any shape has a non-default %s', (_name, over) => {
    expect(hasFillOverrides([shape('a'), shape('b', over as Partial<ShapeChild>)])).toBe(true);
  });

  it('ignores the floor colour, which has its own reset', () => {
    expect(hasFillOverrides([shape('a', { styleOverrides: { floorColor: '#ff0000' } })])).toBe(false);
  });
});

describe('door fields', () => {
  const door = (over: Partial<DoorChild> = {}): DoorChild => ({
    id: 'd1',
    name: 'Door 1',
    childType: 'door',
    visible: true,
    wallId: 'w1',
    position: [0, 0],
    angle: 0,
    width: 1,
    style: 'single',
    state: 'closed',
    isSecret: false,
    ...over,
  });
  const joint = (over: Partial<ConnectorChild> = {}): ConnectorChild =>
    ({
      id: 'c1',
      name: 'Connector 1',
      childType: 'connector',
      visible: true,
      contours: [[[0, 0], [1, 0], [1, 1]]],
      kind: 'door',
      state: 'closed',
      isSecret: false,
      ...over,
    }) as ConnectorChild;

  it('offers the placeable styles plus Portal on a wall door, and caps the width at the wall', () => {
    const m = doorModel(door(), 3);
    expect(m.styles.map((s) => s.label)).toEqual(['Single', 'Double', 'Portcullis', 'Archway', 'Portal']);
    expect(m.width).toEqual({ value: 1, min: 1, max: 3 });
    expect(doorModel(door(), 10).width?.max).toBe(4);
    expect(doorModel(door({ style: 'double', width: 2 }), 10).width?.min).toBe(2);
  });

  it('gives a double on a 2-cell doorway piece its full range once the run allows it', () => {
    // fieldstone-keep: the room is the run of walls, not the doorway piece alone.
    expect(doorModel(door({ style: 'double', width: 2 }), 2).width).toEqual({ value: 2, min: 2, max: 2 });
    expect(doorModel(door({ style: 'double', width: 2 }), 18).width).toEqual({ value: 2, min: 2, max: 4 });
  });

  it('holds a typed or dragged width to the span, in hundredths', () => {
    const span = { min: 2, max: 4 };
    expect(doorWidthValue(3.333, span)).toBe(3.33);
    expect(doorWidthValue(9, span)).toBe(4);
    expect(doorWidthValue(0, span)).toBe(2);
  });

  it('shows no state for an archway and no width for a joint', () => {
    expect(doorModel(door({ style: 'archway', width: 2 }), 5).showState).toBe(false);
    expect(doorModel(door(), 5).showState).toBe(true);
    const j = doorModel(joint(), Infinity);
    expect(j.width).toBeNull();
    expect(j.styles.map((s) => s.value)).not.toContain('portal');
    expect(doorModel(joint({ kind: 'arch' }), Infinity).style).toBe('archway');
  });

  it('resizes a wall door with its style, both ways, within its wall', () => {
    expect(doorStyleChange(door(), 'double', 5)).toEqual({
      before: { style: 'single', width: 1 },
      after: { style: 'double', width: 2 },
    });
    expect(doorStyleChange(door({ style: 'double', width: 2.5 }), 'single', 2).after).toEqual({ style: 'single', width: 2 });
  });

  it('turns a joint into an open arch and back into a shut door', () => {
    expect(doorStyleChange(joint(), 'archway', Infinity).after).toEqual({ style: 'archway', kind: 'arch', state: 'open' });
    expect(doorStyleChange(joint({ kind: 'arch', state: 'open' }), 'single', Infinity).after).toEqual({
      style: 'single',
      kind: 'door',
      state: 'closed',
    });
  });

  it('keeps the old name for an empty or unchanged one', () => {
    expect(cleanDoorName('  ', 'Door 1')).toBeNull();
    expect(cleanDoorName('Door 1 ', 'Door 1')).toBeNull();
    expect(cleanDoorName(' Vault door ', 'Door 1')).toBe('Vault door');
  });
});

describe('door kit fields', () => {
  const door = (over: Partial<DoorChild> = {}): DoorChild => ({
    id: 'd1',
    name: 'Door 1',
    childType: 'door',
    visible: true,
    wallId: 'w1',
    position: [0, 0],
    angle: 0,
    width: 1,
    style: 'single',
    state: 'closed',
    isSecret: false,
    ...over,
  });

  it('a single door in a kit wall hangs from its start edge, swings the usual way, hinges on, 90° when open', () => {
    expect(doorKitModel(door(), 'GG_Fieldstone')).toEqual({
      openAngle: 90,
      opensLater: true,
      hinge: 'start',
      swing: 1,
      hinges: true,
    });
    // Shut or locked, the angle is the one it will open to.
    expect(doorKitModel(door({ state: 'open' }), 'GG_Cave_Ink')?.opensLater).toBe(false);
    expect(doorKitModel(door({ state: 'locked' }), 'GG_Palisade')?.opensLater).toBe(true);
  });

  it('reads the stored hanging, and clamps an angle saved out of range', () => {
    const m = doorKitModel(door({ openAngle: 135, hinge: 'end', swing: -1, hinges: false }), 'GG_Palisade');
    expect(m).toEqual({ openAngle: 135, opensLater: true, hinge: 'end', swing: -1, hinges: false });
    expect(doorKitModel(door({ openAngle: 270 }), 'GG_Palisade')?.openAngle).toBe(180);
    expect(doorKitModel(door({ openAngle: -10 }), 'GG_Palisade')?.openAngle).toBe(0);
  });

  it('a double door has no hinge edge to choose', () => {
    expect(doorKitModel(door({ style: 'double', width: 2 }), 'GG_Fieldstone')?.hinge).toBeNull();
  });

  it('is absent off a kit: other styles, sets without a kit, no set, joints', () => {
    for (const style of ['portcullis', 'archway', 'portal'] as const) {
      expect(doorKitModel(door({ style }), 'GG_Fieldstone')).toBeNull();
    }
    expect(doorKitModel(door(), 'GG_Plain_Brick')).toBeNull();
    expect(doorKitModel(door(), undefined)).toBeNull();
    const joint = {
      id: 'c1',
      name: 'Connector 1',
      childType: 'connector',
      visible: true,
      contours: [[[0, 0], [1, 0], [1, 1]]],
      kind: 'door',
      state: 'open',
      isSecret: false,
    } as ConnectorChild;
    expect(doorKitModel(joint, 'GG_Fieldstone')).toBeNull();
  });

  it('rides on the door model, which takes the wall set', () => {
    expect(doorModel(door(), 5, 'GG_Fieldstone').kit?.hinge).toBe('start');
    expect(doorModel(door(), 5).kit).toBeNull();
  });

  it("a door's own kit hangs it on any wall, and Auto leaves it to the wall", () => {
    expect(doorKitModel(door({ kit: 'cave' }), undefined)?.hinge).toBe('start');
    expect(doorKitModel(door({ kit: 'wood', style: 'double', width: 2 }), 'GG_Plain_Brick')?.hinge).toBeNull();
    // A kit builds only singles and doubles, whatever the pick.
    expect(doorKitModel(door({ kit: 'stone', style: 'portcullis' }), 'GG_Fieldstone')).toBeNull();
  });

  it('offers Material on single and double wall doors, Auto naming what the wall gives', () => {
    const m = doorModel(door(), 5, 'GG_Cave_Ink').material!;
    expect(m.value).toBe('auto');
    expect(m.options.map((o) => o.label)).toEqual(['Auto (Cave)', 'Stone', 'Wood', 'Cave']);
    expect(doorModel(door({ kit: 'wood' }), 5, 'GG_Cave_Ink').material?.value).toBe('wood');
    expect(doorMaterialOptions(undefined)[0].label).toBe('Auto (plain)');
    expect(doorMaterialOptions('GG_Fieldstone')[0].label).toBe('Auto (Stone)');
    // A kit id from a newer save reads as Auto rather than a value the picker lacks.
    expect(doorModel(door({ kit: 'marble' as never }), 5, 'GG_Palisade').material?.value).toBe('auto');
    expect(doorModel(door({ style: 'archway' }), 5, 'GG_Cave_Ink').material).toBeNull();
    expect(doorKitField('auto')).toBeUndefined();
    expect(doorKitField('cave')).toBe('cave');
  });

  it('swing maps both ways between the stored number and the control', () => {
    expect(swingChoice(1)).toBe('normal');
    expect(swingChoice(-1)).toBe('reversed');
    expect(swingValue('normal')).toBe(1);
    expect(swingValue('reversed')).toBe(-1);
  });
});

describe('drawn wall fields', () => {
  const wall = (over: Partial<WallSegment> = {}): WallSegment => ({
    id: 'w',
    points: [[0, 0], [4, 0]],
    wallType: 'normal',
    direction: 'both',
    color: '#000000',
    roughness: 0,
    ...over,
  });
  const style = { wallTextureSetId: 'GG_Fieldstone', wallTextureTint: '#ffffff', wallWidth: 0.5 } as DungeonStyle;
  const label = (id: string) => id.replace(/^GG_/, '');

  it('offers the dock’s three types', () => {
    expect(WALL_TYPE_CHOICES.map((c) => c.label)).toEqual(['Solid', 'Window', 'Open']);
  });

  it('reads the type group and the set the wall resolves to', () => {
    expect(wallModel(wall(), style, label)).toEqual({ type: 'solid', setName: 'Fieldstone' });
    expect(wallModel(wall({ wallType: 'window', textureSetId: 'GG_Palisade' }), style, label)).toEqual({
      type: 'window',
      setName: 'Palisade',
    });
    // Terrain acts like an open wall: it blocks nothing.
    expect(wallModel(wall({ wallType: 'invisible' }), style, label).type).toBe('open');
  });

  it('a wall pinned to no set, on a layer without one, has none', () => {
    expect(wallModel(wall({ textureSetId: '' }), style, label).setName).toBeNull();
    expect(wallModel(wall(), { ...style, wallTextureSetId: '' }, label).setName).toBeNull();
  });

  it('a type pick writes the group’s type, and nothing when the wall already acts that way', () => {
    expect(wallTypeChange(wall(), 'window')).toEqual({ before: { wallType: 'normal' }, after: { wallType: 'window' } });
    expect(wallTypeChange(wall({ wallType: 'ethereal' }), 'solid')).toBeNull();
  });
});

/* ── Props ──────────────────────────────────────────────── */

function prop(id: string, over: Partial<AssetChild> = {}): AssetChild {
  return {
    id,
    name: id,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'p:crate',
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: 1,
    width: 2,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
    ...over,
  };
}

function propLayers(): DungeonLayer[] {
  const a = createDungeonLayer('A');
  const b = createDungeonLayer('B');
  a.children.push(
    prop('p1', { groupId: 'g1' }),
    prop('p2', { groupId: 'g1' }),
    prop('p3'),
    shape('f1'),
  );
  a.groups = [{ id: 'g1', name: 'Supply corner' }];
  b.children.push(prop('p4'));
  return [a, b];
}

describe('resolvePropTarget', () => {
  it('reads one prop as a prop with its layer', () => {
    const layers = propLayers();
    const t = resolvePropTarget({ layers }, ['p3']);
    expect(t?.kind).toBe('prop');
    if (t?.kind === 'prop') expect(t.layer.id).toBe(layers[0].id);
  });

  it('reads several props, over layers, as props with the layer of each', () => {
    const layers = propLayers();
    const t = resolvePropTarget({ layers }, ['p3', 'p4']);
    expect(t?.kind).toBe('props');
    if (t?.kind === 'props') expect(t.layerIds).toEqual([layers[0].id, layers[1].id]);
  });

  it('reads every member of one group as the group, and part of it as props', () => {
    const layers = propLayers();
    const whole = resolvePropTarget({ layers }, ['p2', 'p1']);
    expect(whole?.kind).toBe('prop-group');
    if (whole?.kind === 'prop-group') {
      expect(whole.group.name).toBe('Supply corner');
      expect(whole.members.map((m) => m.id)).toEqual(['p1', 'p2']);
    }
    expect(resolvePropTarget({ layers }, ['p1', 'p3'])?.kind).toBe('props');
    expect(resolvePropTarget({ layers }, ['p1'])?.kind).toBe('prop');
  });

  it('reads the members of a group just ungrouped, still selected, as plain props', () => {
    const layers = propLayers();
    const ungrouped = layers.map((l) => ({
      ...l,
      groups: [],
      children: l.children.map((c) => ({ ...c, groupId: undefined })),
    })) as DungeonLayer[];
    expect(resolvePropTarget({ layers: ungrouped }, ['p1', 'p2'])?.kind).toBe('props');
  });

  it('is null for a selection holding anything but props, or nothing', () => {
    const layers = propLayers();
    expect(resolvePropTarget({ layers }, ['p3', 'f1'])).toBeNull();
    expect(resolvePropTarget({ layers }, ['wall-1'])).toBeNull();
    expect(resolvePropTarget({ layers }, [])).toBeNull();
  });
});

describe('propBoxModel', () => {
  it('gives one prop its own oriented box: centre, drawn size and rotation', () => {
    const b = propBoxModel([prop('a', { position: { x: 3, y: 4 }, rotation: Math.PI / 2, width: 2, height: 1, scale: 1.5 })]);
    expect(b).toEqual({ x: 3, y: 4, w: 3, h: 1.5, angle: Math.PI / 2 });
  });

  it('gives several the world box around them as drawn, a turned one by its turned extent', () => {
    const b = propBoxModel([
      prop('a', { position: { x: 1, y: 1 }, width: 2, height: 2 }),
      prop('b', { position: { x: 6, y: 2 }, width: 4, height: 2, rotation: Math.PI / 2 }),
    ]);
    expect(b.x).toBeCloseTo(3.5);
    expect(b.y).toBeCloseTo(2);
    expect(b.w).toBeCloseTo(7);
    expect(b.h).toBeCloseTo(4);
    expect(b.angle).toBe(MIXED);
  });

  it('keeps an angle every prop shares', () => {
    const b = propBoxModel([prop('a', { rotation: 0.5 }), prop('b', { rotation: 0.5, position: { x: 4, y: 0 } })]);
    expect(b.angle).toBe(0.5);
  });
});

describe('propFieldsModel', () => {
  it('reads absent fields as their defaults and disagreement as mixed', () => {
    const m = propFieldsModel([prop('a'), prop('b', { overhead: true, opacity: 1, tint: '#FFFFFF' })]);
    expect(m.opacity).toBe(1);
    expect(m.overhead).toBe(MIXED);
    expect(m.locked).toBe(false);
    expect(m.castsShadow).toBe(true);
    expect(m.tint).toBe('#ffffff');
  });

  it('counts the props with a switch on', () => {
    const list = [prop('a', { locked: true }), prop('b'), prop('c', { overhead: true })];
    expect(propFieldCount(list, 'locked')).toBe(1);
    expect(propFieldCount(list, 'overhead')).toBe(1);
  });
});
