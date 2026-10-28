import type { DungeonLayer, DungeonStyle, Layer, MapSettings } from '../store/types';
import type { Level, Mood, Room, RoomArea, RoomLook } from './types';
import { environmentOf, type Environment } from './world';
import { STYLE_TO_LOOK_KEY } from './wallLook';

/*
 * Look scopes: Map → Level → Layer → Area → Room.
 *
 * Each scope may pin any key of a `RoomLook`; a key it leaves unset is inherited
 * from the scope below. This is the one resolver for that chain — the renderers,
 * the dock and the cards all ask it, so "Inherits <level>" on a card and what the
 * map actually draws can never disagree. Lighting later adds its keys to the same
 * chain; Props later reads the area and room off it.
 *
 * The layer's scope is its existing `style` (the per-layer dungeon style the dock
 * edits), read through `STYLE_TO_LOOK_KEY`. The level and the layer meet by one rule,
 * the same one the renderers draw by (`levelStyle` / `levelFloorTextureId` in
 * wallLook.ts):
 *
 * - Floor texture, floor tint, wall set — keys a layer style can leave unset
 *   (`undefined`; `''` is a pin of "none"): room ?? area ?? layer ?? level ?? map.
 *   The level is the layer's fallback. Its floor texture paints the floors that have
 *   no texture of their own.
 * - Wall tint, wall width — always present on a layer style, so the level could never
 *   be reached through them: room ?? area ?? level ?? layer ?? map. An explicit level
 *   pin wins over the layer's value; a room or area pin wins over both.
 * - Mood keys have no layer value: room ?? area ?? level ?? map.
 */

/** Every look key, in the order cards list them. */
export const LOOK_KEYS = [
  'floorTextureId',
  'floorTint',
  'wallTextureSetId',
  'wallTextureTint',
  'wallWidth',
  'mood',
  'moodTint',
  'moodVision',
] as const satisfies readonly (keyof RoomLook)[];

export type LookKey = (typeof LOOK_KEYS)[number];

/** Where a resolved key came from — what the "Inherits …" / "Pinned" labels read. */
export type LookSource = 'room' | 'area' | 'layer' | 'level' | 'map';

/** A look with every key answered. Empty ids mean "none" (no texture, no stones). */
export interface ResolvedLook {
  floorTextureId: string;
  floorTint: string;
  wallTextureSetId: string;
  wallTextureTint: string;
  wallWidth: number;
  mood: Mood;
  moodTint: string;
  moodVision: 'darkness' | 'visible';
}

/** The scopes one room's look is resolved through. `room`/`area` absent resolves the layer itself. */
export interface LookChain {
  map: MapSettings;
  level: Level;
  layer: DungeonLayer;
  area?: RoomArea;
  room?: Room;
}

/**
 * The map's mood IS its environment: outdoor is Lit (all the sky reaches it), indoor Dim
 * (40 %), underground Dark (none) — the same three steps as `DAMPING` in world.ts.
 */
export const ENVIRONMENT_MOOD: Record<Environment, Mood> = { outdoor: 'lit', indoor: 'dim', underground: 'dark' };

/** The map's own answer for every key: what a map with nothing pinned anywhere draws. */
export function mapDefaults(map: Pick<MapSettings, 'ambientLight' | 'environment'>): ResolvedLook {
  return {
    floorTextureId: '',
    floorTint: '#ffffff',
    wallTextureSetId: '',
    wallTextureTint: '#ffffff',
    wallWidth: 0.5,
    mood: ENVIRONMENT_MOOD[environmentOf(map)],
    // The map's mood tint is its ambient colour, the base the grade starts from.
    moodTint: map.ambientLight,
    moodVision: 'darkness',
  };
}

const LOOK_TO_STYLE_KEY: Partial<Record<LookKey, keyof DungeonStyle>> = Object.fromEntries(
  Object.entries(STYLE_TO_LOOK_KEY).map(([style, look]) => [look, style]),
);

/** The layer scope's value for a look key: its style's, or undefined when the style leaves it unset. */
function layerValue(layer: DungeonLayer, key: LookKey): unknown {
  const styleKey = LOOK_TO_STYLE_KEY[key];
  return styleKey ? layer.style[styleKey] : undefined;
}

/** Keys where an explicit level pin wins over the layer's (always-present) value. */
const LEVEL_OVER_LAYER: ReadonlySet<LookKey> = new Set<LookKey>(['wallTextureTint', 'wallWidth']);

/** The scopes that may answer `key`, nearest first, ending at the map. */
function scopeOrder(key: LookKey): readonly LookSource[] {
  return LEVEL_OVER_LAYER.has(key)
    ? (['room', 'area', 'level', 'layer', 'map'] as const)
    : (['room', 'area', 'layer', 'level', 'map'] as const);
}

function scopeValue(chain: LookChain, scope: LookSource, key: LookKey): unknown {
  switch (scope) {
    case 'room':
      return chain.room?.look?.[key];
    case 'area':
      return chain.area?.look?.[key];
    case 'layer':
      return layerValue(chain.layer, key);
    case 'level':
      return chain.level.look?.[key];
    default:
      return mapDefaults(chain.map)[key];
  }
}

/** Which scope answers `key` for this chain. */
export function lookSource(chain: LookChain, key: LookKey): LookSource {
  for (const scope of scopeOrder(key)) if (scope === 'map' || scopeValue(chain, scope, key) !== undefined) return scope;
  return 'map';
}

/** The value `key` resolves to: the first scope, nearest first, that pins it. */
export function resolveLookKey<K extends LookKey>(chain: LookChain, key: K): ResolvedLook[K] {
  return scopeValue(chain, lookSource(chain, key), key) as ResolvedLook[K];
}

/** Every key of the chain's look, resolved by the rule at the top of this file. */
export function resolveRoomLook(chain: LookChain): ResolvedLook {
  const out = {} as Record<LookKey, unknown>;
  for (const key of LOOK_KEYS) out[key] = resolveLookKey(chain, key);
  return out as unknown as ResolvedLook;
}

/** A synthetic level for a layer that names none, so the chain always has one. */
const NO_LEVEL: Level = { id: '', name: '' };

/** The level a layer belongs to: its own, else the map's first, else an empty stand-in. */
export function levelOf(levels: readonly Level[], layer: Pick<Layer, 'levelId'>): Level {
  return levels.find((l) => l.id === layer.levelId) ?? levels[0] ?? NO_LEVEL;
}

/**
 * The chain for one room (or, with no room, for the layer itself), read off the
 * store's state — or anything shaped like it, such as a map document on the server.
 */
export function roomChain(
  state: { mapSettings: MapSettings; levels?: readonly Level[] },
  layer: DungeonLayer,
  room?: Room | null,
): LookChain {
  const area = room?.areaId ? layer.areas?.find((a) => a.id === room.areaId) : undefined;
  return {
    map: state.mapSettings,
    level: levelOf(state.levels ?? [], layer),
    layer,
    ...(area ? { area } : {}),
    ...(room ? { room } : {}),
  };
}

/** The chain for an area (no room): what an area card's labels read. */
export function areaChain(
  state: { mapSettings: MapSettings; levels?: readonly Level[] },
  layer: DungeonLayer,
  area: RoomArea,
): LookChain {
  return { map: state.mapSettings, level: levelOf(state.levels ?? [], layer), layer, area };
}

const memo = new Map<string, { keys: readonly unknown[]; out: ReadonlyMap<string, ResolvedLook> }>();

/**
 * Every room's resolved look on one layer, by room id. Memoised per layer like
 * `ringStyles`: recomputed only when the rooms, the areas, the layer style, the
 * level's look or the map's ambient light or environment move.
 */
export function roomLooks(
  state: { mapSettings: MapSettings; levels?: readonly Level[] },
  layer: DungeonLayer,
): ReadonlyMap<string, ResolvedLook> {
  const level = levelOf(state.levels ?? [], layer);
  const keys = [
    layer.rooms,
    layer.areas,
    layer.style,
    level.look,
    state.mapSettings.ambientLight,
    state.mapSettings.environment,
  ] as const;
  const hit = memo.get(layer.id);
  if (hit && hit.keys.every((k, i) => k === keys[i])) return hit.out;
  const out = new Map<string, ResolvedLook>();
  for (const room of layer.rooms ?? []) out.set(room.id, resolveRoomLook(roomChain(state, layer, room)));
  memo.set(layer.id, { keys, out });
  return out;
}

/** Whether a room pins anything at all, or sits in an area that does. Cheap pre-check for renderers. */
export function roomHasLook(layer: DungeonLayer, room: Room): boolean {
  if (room.look && Object.keys(room.look).length > 0) return true;
  const area = room.areaId ? layer.areas?.find((a) => a.id === room.areaId) : undefined;
  return !!area?.look && Object.keys(area.look).length > 0;
}

/**
 * A look with `patch` applied: a key set to a value pins it, a key present but
 * undefined resets it to inherit. Undefined when nothing is left pinned, so an
 * all-inherit look leaves no empty object behind in the file.
 */
export function patchLook(look: RoomLook | undefined, patch: Partial<RoomLook>): RoomLook | undefined {
  const next: Record<string, unknown> = { ...(look ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return Object.keys(next).length > 0 ? (next as RoomLook) : undefined;
}
