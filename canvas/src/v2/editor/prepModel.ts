// The prep overview's model: every trigger and note on the open map, grouped by the zone or
// the room it is anchored to, each with a one-line summary and, where the table would never fire it, the
// reason. No React and no engine here, so the v1 Prep tab and the v2 slide-over share it.
import { isValidFormula } from '@dnd/core/src/shared/dice-format';
import { roomIndexOf } from '@dnd/core/src/shared/roomIndex';
import { conditionZoneId, roomLabel } from '@dnd/core/src/shared/prep';
import type {
  DungeonLayer,
  Layer,
  LightChild,
  Room,
  RoomNote,
  ScenePrep,
  TriggerAction,
  TriggerDef,
  ZoneChild,
} from '@/store/types';

export const CONDITION_LABELS: Record<TriggerDef['when']['kind'], string> = {
  'room-revealed': 'Room revealed',
  'enter-region': 'Enter region',
  'within-radius': 'Within radius',
};

export interface ZoneInfo {
  zone: ZoneChild;
  layer: DungeonLayer;
}

export interface PrepRow {
  key: string;
  kind: 'trigger' | 'note' | 'encounter';
  name: string;
  summary: string;
  /** Why the table would never fire this, or null when it can. */
  inert: string | null;
  /** A note that surfaces itself when its room is revealed. */
  pops: boolean;
  /** Trigger flags; absent on notes. */
  once?: boolean;
  enabled?: boolean;
}

export interface RoomInfo {
  room: Room;
  layer: DungeonLayer;
}

export interface PrepGroup {
  /** The group's key: the anchor zone's id, or `room:<id>` for a room-anchored group. */
  zoneId: string;
  /** The anchor's name: the zone's, or the room's as "N · name". */
  zoneName: string;
  /** Null when the anchor zone is gone, and for a room-anchored group. */
  zone: ZoneChild | null;
  /** The anchor room of a room-anchored group; null when it is gone or the group hangs on a zone. */
  room: RoomInfo | null;
  rows: PrepRow[];
}

/** Every room on every dungeon layer, by its permanent id, with the layer it sits on. */
export function collectRooms(layers: Layer[]): Map<string, RoomInfo> {
  const rooms = new Map<string, RoomInfo>();
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const room of (layer as DungeonLayer).rooms ?? []) rooms.set(room.id, { room, layer: layer as DungeonLayer });
  }
  return rooms;
}

/** The room a trigger hangs on directly (the room-revealed `roomId` form), or null. */
export function conditionRoomId(when: TriggerDef['when']): string | null {
  return 'roomId' in when ? when.roomId : null;
}

/** Every zone on every dungeon layer, by id, with the layer it sits on. */
export function collectZones(layers: Layer[]): Map<string, ZoneInfo> {
  const zones = new Map<string, ZoneInfo>();
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const child of (layer as DungeonLayer).children) {
      if (child.childType === 'zone') {
        zones.set(child.id, { zone: child as ZoneChild, layer: layer as DungeonLayer });
      }
    }
  }
  return zones;
}

function pinInsideRoom(info: ZoneInfo, position: { x: number; y: number }): boolean {
  return roomIndexOf(info.layer.rooms).roomAt(position.x, position.y) !== null;
}

/** Mirrors the server resolver's inert reasons closely enough to warn while authoring —
 *  the server stays the authority at the table. */
export function triggerInert(
  t: TriggerDef,
  zones: Map<string, ZoneInfo>,
  rooms: Map<string, RoomInfo> = new Map(),
): string | null {
  const zoneId = conditionZoneId(t.when);
  let layer: DungeonLayer;
  if (zoneId === null) {
    // Room-anchored: the room is the whole anchor, so it only has to exist.
    const room = rooms.get(conditionRoomId(t.when) ?? '');
    if (!room) return 'room deleted';
    layer = room.layer;
  } else {
    const info = zones.get(zoneId);
    if (!info) return 'zone deleted';
    const shape = info.zone.shape;
    if (t.when.kind === 'room-revealed') {
      if (shape.kind !== 'point') return 'needs a point zone';
      if (!pinInsideRoom(info, shape.position)) return 'pin not inside a room';
    } else if (shape.kind === 'point') {
      return 'zone has no area';
    }
    layer = info.layer;
  }
  const lights = new Set(
    layer.children.filter((c): c is LightChild => c.childType === 'light').map((c) => c.id),
  );
  for (const action of t.actions) {
    if (action.kind === 'light' && !lights.has(action.lightId)) return 'light missing';
    if (action.kind === 'trap' && action.damage && !isValidFormula(action.damage)) {
      return 'bad damage formula';
    }
    if (action.kind === 'encounter') {
      if (action.monsters.length === 0) return 'encounter has no monsters';
      if (action.monsters.some((m) => m.hp !== undefined && !isValidFormula(m.hp))) {
        return 'bad monster HP formula';
      }
    }
  }
  return null;
}

export function noteInert(
  n: RoomNote,
  zones: Map<string, ZoneInfo>,
  rooms: Map<string, RoomInfo> = new Map(),
): string | null {
  if (n.roomId) return rooms.has(n.roomId) ? null : 'room deleted';
  const info = zones.get(n.zoneId);
  if (!info) return 'zone deleted';
  if (!n.showOnReveal) return null;
  const shape = info.zone.shape;
  if (shape.kind === 'point' && !pinInsideRoom(info, shape.position)) return 'pin not inside a room';
  return null;
}

export function actionSummary(a: TriggerAction): string {
  switch (a.kind) {
    case 'show-text':
      return a.toPlayers ? 'Text to players' : 'Text to DM';
    case 'light':
      return a.on ? 'Light on' : 'Light off';
    case 'trap':
      return `Trap${a.save ? ` · DC ${a.save.dc} ${a.save.ability.toUpperCase()}` : ''}${a.damage ? ` · ${a.damage}` : ''}`;
    case 'ability-check':
      return `Check · DC ${a.dc} ${a.ability.toUpperCase()}`;
    case 'prompt':
      return `${a.prompt === 'initiative' ? 'Initiative' : 'Attack'} prompt`;
    case 'environment':
      return 'Environment';
    case 'encounter':
      return a.monsters.map((m) => `${m.count}× ${m.name}`).join(', ');
  }
}

export function triggerSummary(t: TriggerDef): string {
  const what = t.actions.length === 0 ? 'no actions' : t.actions.map(actionSummary).join(', ');
  return `${CONDITION_LABELS[t.when.kind]} → ${what}`;
}

export function noteSummary(n: RoomNote): string {
  const images = n.imageKeys.length;
  return `Note · DM only${images > 0 ? ` · ${images} image${images === 1 ? '' : 's'}` : ''}`;
}

/** Group every trigger and note by its anchor zone or room, in a stable name order. */
export function buildPrepGroups(prep: ScenePrep | null | undefined, layers: Layer[]): PrepGroup[] {
  const zones = collectZones(layers);
  const rooms = collectRooms(layers);
  const byZone = new Map<string, PrepGroup>();
  const groupFor = (zoneId: string): PrepGroup => {
    let g = byZone.get(zoneId);
    if (!g) {
      const info = zones.get(zoneId);
      g = { zoneId, zoneName: info?.zone.name ?? 'Deleted zone', zone: info?.zone ?? null, room: null, rows: [] };
      byZone.set(zoneId, g);
    }
    return g;
  };
  const groupForRoom = (roomId: string): PrepGroup => {
    const key = `room:${roomId}`;
    let g = byZone.get(key);
    if (!g) {
      const info = rooms.get(roomId) ?? null;
      g = { zoneId: key, zoneName: info ? roomLabel(info.room) || 'Unnamed room' : 'Deleted room', zone: null, room: info, rows: [] };
      byZone.set(key, g);
    }
    return g;
  };
  const anchorOf = (t: TriggerDef): PrepGroup => {
    const zoneId = conditionZoneId(t.when);
    return zoneId === null ? groupForRoom(conditionRoomId(t.when) ?? '') : groupFor(zoneId);
  };

  for (const t of prep?.triggers ?? []) {
    anchorOf(t).rows.push({
      key: t.id,
      kind: t.actions.some((a) => a.kind === 'encounter') ? 'encounter' : 'trigger',
      name: t.name,
      summary: triggerSummary(t),
      inert: triggerInert(t, zones, rooms),
      pops: false,
      once: t.once,
      enabled: t.enabled,
    });
  }
  for (const n of prep?.notes ?? []) {
    (n.roomId ? groupForRoom(n.roomId) : groupFor(n.zoneId)).rows.push({
      key: n.id,
      kind: 'note',
      name: n.title || 'Untitled note',
      summary: noteSummary(n),
      inert: noteInert(n, zones, rooms),
      pops: n.showOnReveal,
    });
  }

  // Zone-name order keeps the list stable while prep is being edited; unanchored
  // (deleted-zone) groups sink to the bottom where their warnings are visible together.
  const anchored = (g: PrepGroup) => !!g.zone || !!g.room;
  return [...byZone.values()].sort((a, b) => {
    if (anchored(a) !== anchored(b)) return anchored(a) ? -1 : 1;
    return a.zoneName.localeCompare(b.zoneName);
  });
}

/** The world point a zone is centred on when the camera jumps to it. */
export function zoneAnchor(zone: ZoneChild): { x: number; y: number } {
  const shape = zone.shape;
  if (shape.kind === 'rect') return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  return { x: shape.position.x, y: shape.position.y };
}

/** Screen-space room the chrome leaves free over the canvas. */
export interface VisibleGap {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Stage position that puts the world point in the middle of the gap at the given zoom. */
export function centreStageOn(
  point: { x: number; y: number },
  zoom: number,
  gap: VisibleGap,
): { x: number; y: number } {
  const cx = (gap.left + gap.right) / 2;
  const cy = (gap.top + gap.bottom) / 2;
  return { x: cx - point.x * zoom, y: cy - point.y * zoom };
}
