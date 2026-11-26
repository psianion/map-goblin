// Which lights one switch reaches: a light's group, a prop's attached lights, a room's lights.
// Pure reads of a map's layers, shared by the editor's commands and the table's switches, so
// both work out the same ids for the same click.

import type { Layer } from '../store/types';
import type { Level, LightChild } from './types';
import { levelOf } from './lookScope';
import { pointInRing, roomFace } from './roomUtils';

/** Anything shaped like a map: its layers and, for rooms, its levels. */
export interface LightMap {
  layers: readonly Layer[];
  levels?: readonly Level[];
}

/** Every light on the map, layer by layer. */
export function allLights(layers: readonly Layer[]): LightChild[] {
  const out: LightChild[] = [];
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const c of layer.children) if (c.childType === 'light') out.push(c);
  }
  return out;
}

/** A group name as it is stored: trimmed, and absent when empty. */
export function groupName(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  return trimmed ? trimmed : undefined;
}

/** The light groups on the map, by name (sorted), each with its lights. */
export function lightGroups(layers: readonly Layer[]): { name: string; lights: LightChild[] }[] {
  const groups = new Map<string, LightChild[]>();
  for (const light of allLights(layers)) {
    const name = groupName(light.group);
    if (!name) continue;
    const list = groups.get(name);
    if (list) list.push(light);
    else groups.set(name, [light]);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, lights]) => ({ name, lights }));
}

/** `ids` with every light that shares a group with one of them added. Order: as found on the map. */
export function withGroupMates(layers: readonly Layer[], ids: Iterable<string>): string[] {
  const wanted = new Set(ids);
  const lights = allLights(layers);
  const groups = new Set<string>();
  for (const l of lights) {
    const name = groupName(l.group);
    if (wanted.has(l.id) && name) groups.add(name);
  }
  const out: string[] = [];
  for (const l of lights) {
    const name = groupName(l.group);
    if (wanted.has(l.id) || (name && groups.has(name))) out.push(l.id);
  }
  return out;
}

/** The lights attached to prop `propId`, on any layer. */
export function lightsOnProp(layers: readonly Layer[], propId: string): LightChild[] {
  return allLights(layers).filter((l) => l.attachedTo === propId);
}

/**
 * The lights in room `roomId`: those whose position lies inside the room's face, on layers of
 * the room's level. None for an unknown room or one without a face.
 */
export function lightsInRoom(map: LightMap, roomId: string): LightChild[] {
  const levels = map.levels ?? [];
  for (const layer of map.layers) {
    if (layer.type !== 'dungeon') continue;
    const room = layer.rooms?.find((r) => r.id === roomId);
    if (!room) continue;
    const face = roomFace(room);
    if (face.length < 3) return [];
    const levelId = levelOf(levels, layer).id;
    const out: LightChild[] = [];
    for (const other of map.layers) {
      if (other.type !== 'dungeon' || levelOf(levels, other).id !== levelId) continue;
      for (const c of other.children) {
        if (c.childType === 'light' && pointInRing(c.position.x, c.position.y, face)) out.push(c);
      }
    }
    return out;
  }
  return [];
}

/** The rooms on the map that hold at least one light, in layer order, each with its lights. */
export function roomsWithLights(map: LightMap): { id: string; name: string; lights: LightChild[] }[] {
  const out: { id: string; name: string; lights: LightChild[] }[] = [];
  for (const layer of map.layers) {
    if (layer.type !== 'dungeon') continue;
    for (const room of layer.rooms ?? []) {
      const lights = lightsInRoom(map, room.id);
      if (lights.length > 0) out.push({ id: room.id, name: room.name, lights });
    }
  }
  return out;
}
