import { describe, it, expect } from 'vitest';
import {
  lookSource,
  mapDefaults,
  patchLook,
  resolveLookKey,
  resolveRoomLook,
  roomChain,
  roomLooks,
  type LookChain,
} from './lookScope';
import { edgeStyles, levelFloorTextureId, levelStyle, ringLook, ringStyles, styleValueOrDefault } from './wallLook';
import type { DungeonLayer, MapSettings } from '../store/types';
import type { Level, Room, RoomArea } from './types';

const MAP: MapSettings = { name: 'Map', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#223344' };

function layer(style: Partial<DungeonLayer['style']> = {}, patch: Partial<DungeonLayer> = {}): DungeonLayer {
  return {
    id: 'layer',
    name: 'Layer',
    type: 'dungeon',
    levelId: 'lvl',
    visible: true,
    locked: false,
    opacity: 1,
    children: [],
    standaloneWalls: [],
    mergedFloor: null,
    // Only the keys a test names: everything else is "the layer leaves it unset".
    style: style as DungeonLayer['style'],
    sublayerVisibility: { floor: true, grid: true, walls: true },
    ...patch,
  };
}

const LEVEL: Level = { id: 'lvl', name: 'Ground', look: { wallTextureTint: '#level0', floorTint: '#level1' } };
const AREA: RoomArea = { id: 'crypt', name: 'Crypt', look: { wallTextureTint: '#area00' } };
const ROOM: Room = { id: 'r', name: 'Vault', anchor: [0, 0], areaId: 'crypt', look: { wallTextureTint: '#room00' } };

describe('resolveRoomLook / lookSource — five scopes', () => {
  const chain = (over: Partial<LookChain>): LookChain => ({ map: MAP, level: LEVEL, layer: layer(), ...over });

  it('room pins win over everything', () => {
    const c = chain({ area: AREA, room: ROOM, layer: layer({ wallTextureTint: '#layer0' }) });
    expect(resolveLookKey(c, 'wallTextureTint')).toBe('#room00');
    expect(lookSource(c, 'wallTextureTint')).toBe('room');
  });

  it('an area pin wins when the room leaves the key unset', () => {
    const c = chain({ area: AREA, room: { ...ROOM, look: undefined }, layer: layer({ wallTextureTint: '#layer0' }) });
    expect(resolveLookKey(c, 'wallTextureTint')).toBe('#area00');
    expect(lookSource(c, 'wallTextureTint')).toBe('area');
  });

  it('the layer style answers next', () => {
    const c = chain({ layer: layer({ wallTextureSetId: 'LayerSet', wallTextureTint: '#layer0' }), level: { ...LEVEL, look: { wallTextureSetId: 'LevelSet' } } });
    expect(resolveLookKey(c, 'wallTextureSetId')).toBe('LayerSet');
    expect(lookSource(c, 'wallTextureSetId')).toBe('layer');
    expect(resolveLookKey(c, 'wallTextureTint')).toBe('#layer0');
    expect(lookSource(c, 'wallTextureTint')).toBe('layer');
  });

  it('a key the layer leaves unset falls through to its level', () => {
    const c = chain({});
    expect(resolveLookKey(c, 'floorTint')).toBe('#level1');
    expect(lookSource(c, 'floorTint')).toBe('level');
  });

  it('and to the map defaults when nobody pins it', () => {
    const c = chain({ level: { id: 'lvl', name: 'Bare' } });
    expect(lookSource(c, 'floorTint')).toBe('map');
    expect(resolveRoomLook(c)).toEqual({
      floorTextureId: '',
      floorTint: '#ffffff',
      wallTextureSetId: '',
      wallTextureTint: '#ffffff',
      wallWidth: 0.5,
      // The map's mood is its environment: absent reads as indoor, which is Dim.
      mood: 'dim',
      moodTint: '#223344',
      moodVision: 'darkness',
    });
  });

  it('takes the map mood from the environment: outdoor Lit, indoor Dim, underground Dark', () => {
    expect(mapDefaults({ ambientLight: '#000000', environment: 'outdoor' }).mood).toBe('lit');
    expect(mapDefaults({ ambientLight: '#000000', environment: 'indoor' }).mood).toBe('dim');
    expect(mapDefaults({ ambientLight: '#000000', environment: 'underground' }).mood).toBe('dark');
    expect(mapDefaults({ ambientLight: '#000000' }).mood).toBe('dim');
  });

  it('inherits moodVision like mood, and a scope pins it', () => {
    const c = chain({ level: { id: 'lvl', name: 'L', look: { moodVision: 'visible' } } });
    expect(resolveLookKey(c, 'moodVision')).toBe('visible');
    expect(lookSource(c, 'moodVision')).toBe('level');
    const pinned = chain({ room: { ...ROOM, look: { moodVision: 'darkness' } }, level: { id: 'lvl', name: 'L', look: { moodVision: 'visible' } } });
    expect(resolveLookKey(pinned, 'moodVision')).toBe('darkness');
    expect(lookSource(pinned, 'moodVision')).toBe('room');
  });

  it('defaults moodVision to darkness at the map', () => {
    expect(resolveLookKey(chain({ level: { id: 'lvl', name: 'Bare' } }), 'moodVision')).toBe('darkness');
  });

  it('resolves mood through the chain though nothing draws it yet (layers carry none)', () => {
    const c = chain({ area: { ...AREA, look: { mood: 'dim' } }, room: { ...ROOM, look: undefined } });
    expect(resolveLookKey(c, 'mood')).toBe('dim');
    expect(lookSource(c, 'mood')).toBe('area');
    expect(lookSource(chain({ layer: layer({ wallTextureTint: '#x' }) }), 'mood')).toBe('map');
  });
});

describe('roomChain / roomLooks', () => {
  const state = { mapSettings: MAP, levels: [LEVEL] };

  it('finds the room\'s level and area off the store state', () => {
    const l = layer({}, { areas: [AREA], rooms: [ROOM] });
    const c = roomChain(state, l, ROOM);
    expect(c.level).toBe(LEVEL);
    expect(c.area).toBe(AREA);
    expect(c.room).toBe(ROOM);
  });

  it('falls back to the first level for a layer naming none', () => {
    expect(roomChain(state, layer({}, { levelId: 'gone' })).level).toBe(LEVEL);
  });

  it('memoises per layer until rooms, areas, style, level look or ambient move', () => {
    const l = layer({}, { areas: [AREA], rooms: [ROOM] });
    const first = roomLooks(state, l);
    expect(first.get('r')?.wallTextureTint).toBe('#room00');
    expect(roomLooks(state, l)).toBe(first);
    expect(roomLooks(state, { ...l, rooms: [{ ...ROOM, look: undefined }] }).get('r')?.wallTextureTint).toBe('#area00');
  });
});

describe('patchLook', () => {
  it('pins, resets to inherit, and leaves nothing behind when empty', () => {
    expect(patchLook(undefined, { floorTint: '#fff' })).toEqual({ floorTint: '#fff' });
    expect(patchLook({ floorTint: '#fff', wallWidth: 1 }, { floorTint: undefined })).toEqual({ wallWidth: 1 });
    expect(patchLook({ floorTint: '#fff' }, { floorTint: undefined })).toBeUndefined();
  });
});

describe('styleValueOrDefault — the level under the layer', () => {
  it('keeps answering the old two-argument call', () => {
    expect(styleValueOrDefault(layer().style, 'wallTextureSetId')).toBe('');
    expect(styleValueOrDefault(layer({ wallTextureSetId: 'GG' }).style, 'wallTextureSetId')).toBe('GG');
  });

  it('takes the level look for a key the layer leaves unset', () => {
    expect(styleValueOrDefault(layer().style, 'wallTextureSetId', { wallTextureSetId: 'LevelSet' })).toBe('LevelSet');
    expect(styleValueOrDefault(layer().style, 'defaultTextureTint', { floorTint: '#abc' })).toBe('#abc');
    // The layer's own value still wins.
    expect(styleValueOrDefault(layer({ wallTextureSetId: 'GG' }).style, 'wallTextureSetId', { wallTextureSetId: 'LevelSet' })).toBe('GG');
  });
});

describe('level against layer — the rule', () => {
  const chain = (over: Partial<LookChain>): LookChain => ({ map: MAP, level: LEVEL, layer: layer(), ...over });
  // A layer as the dock leaves it: tint and width are always there.
  const full = () => layer({ wallTextureTint: '#layer0', wallWidth: 0.5, wallTextureSetId: 'LayerSet', defaultTextureId: 'layer:floor' });

  it('a level wall tint or width pin wins over the layer value that is always there', () => {
    const c = chain({ layer: full(), level: { id: 'lvl', name: 'Ground', look: { wallTextureTint: '#level0', wallWidth: 0.8 } } });
    expect(resolveLookKey(c, 'wallTextureTint')).toBe('#level0');
    expect(lookSource(c, 'wallTextureTint')).toBe('level');
    expect(resolveLookKey(c, 'wallWidth')).toBe(0.8);
    expect(lookSource(c, 'wallWidth')).toBe('level');
  });

  it('without a level pin the layer value answers for tint and width', () => {
    const c = chain({ layer: full(), level: { id: 'lvl', name: 'Ground' } });
    expect(lookSource(c, 'wallTextureTint')).toBe('layer');
    expect(lookSource(c, 'wallWidth')).toBe('layer');
  });

  it('room and area pins win over the level for tint and width', () => {
    const lvl: Level = { id: 'lvl', name: 'Ground', look: { wallTextureTint: '#level0', wallWidth: 0.8 } };
    const room: Room = { ...ROOM, look: { wallWidth: 0.2 } };
    const c = chain({ layer: full(), level: lvl, area: AREA, room });
    expect(lookSource(c, 'wallWidth')).toBe('room');
    expect(lookSource(c, 'wallTextureTint')).toBe('area');
  });

  it('the wall set and floor texture stay layer-first: the level is the fallback', () => {
    const lvl: Level = { id: 'lvl', name: 'Ground', look: { wallTextureSetId: 'LevelSet', floorTextureId: 'level:floor' } };
    expect(lookSource(chain({ layer: full(), level: lvl }), 'wallTextureSetId')).toBe('layer');
    expect(lookSource(chain({ layer: full(), level: lvl }), 'floorTextureId')).toBe('layer');
    const bare = layer({ wallTextureTint: '#layer0', wallWidth: 0.5 });
    expect(lookSource(chain({ layer: bare, level: lvl }), 'wallTextureSetId')).toBe('level');
    expect(lookSource(chain({ layer: bare, level: lvl }), 'floorTextureId')).toBe('level');
    // An empty id on the layer is a pin of "none", not unset.
    expect(lookSource(chain({ layer: layer({ wallTextureSetId: '' }), level: lvl }), 'wallTextureSetId')).toBe('layer');
  });

  it('levelStyle folds the same rule into the style the walls draw with', () => {
    const style = full().style;
    expect(levelStyle(style, undefined)).toBe(style);
    expect(levelStyle(style, { floorTint: '#abc' })).toBe(style);
    const look = { wallTextureTint: '#level0', wallWidth: 0.8, wallTextureSetId: 'LevelSet' };
    const drawn = levelStyle(style, look);
    expect(drawn).toMatchObject({ wallTextureTint: '#level0', wallWidth: 0.8, wallTextureSetId: 'LayerSet' });
    expect(levelStyle(style, look)).toBe(drawn);
    expect(levelStyle(layer({ wallTextureTint: '#l', wallWidth: 0.5 }).style, look).wallTextureSetId).toBe('LevelSet');
  });

  it('a level floor texture paints untextured floors only on layers that name no default', () => {
    expect(levelFloorTextureId(full().style, { floorTextureId: 'level:floor' })).toBeUndefined();
    expect(levelFloorTextureId(layer().style, { floorTextureId: 'level:floor' })).toBe('level:floor');
    expect(levelFloorTextureId(layer().style, undefined)).toBeUndefined();
  });

  it('rings and edges draw with the level over the layer, rooms over the level', () => {
    const ring: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const room: Room = { id: 'r', name: 'R', anchor: [5, 5], face: ring, look: { wallTextureTint: '#room00' } };
    const l = layer({ wallTextureTint: '#layer0', wallWidth: 0.5, wallTextureSetId: 'LayerSet' }, { id: 'edge-layer', mergedFloor: [ring] });
    const look = { wallTextureTint: '#level0', wallWidth: 0.8 };
    expect(ringLook(l, 0)).toMatchObject({ tint: '#layer0', width: 0.5 });
    expect(ringLook(l, 0, look)).toMatchObject({ setId: 'LayerSet', tint: '#level0', width: 0.8 });
    expect(ringStyles(l, look)[0].wallTextureTint).toBe('#level0');
    const withRoom = { ...l, rooms: [room] };
    const edges = edgeStyles(withRoom, look)[0];
    expect(edges?.every((s) => s.wallTextureTint === '#room00' && s.wallWidth === 0.8)).toBe(true);
  });

  it('a level tint beats a floor outline pin (the layer value a preset froze), the set does not', () => {
    const ring: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const shape = {
      id: 's', name: 'Floor', childType: 'shape' as const, visible: true, shapeType: 'polygon' as const,
      contours: [ring], roughnessEnabled: false, roughnessAmplitude: 0, textureScale: 1, textureOffsetX: 0,
      textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
      styleOverrides: { wallTextureTint: '#frozen', wallTextureSetId: 'FrozenSet' },
    };
    const l = layer({ wallTextureTint: '#layer0', wallWidth: 0.5 }, { id: 'pinned-layer', mergedFloor: [ring], children: [shape] });
    expect(ringLook(l, 0)).toMatchObject({ tint: '#frozen', setId: 'FrozenSet' });
    expect(ringLook(l, 0, { wallTextureTint: '#level0', wallTextureSetId: 'LevelSet' })).toMatchObject({ tint: '#level0', setId: 'FrozenSet' });
  });
});
