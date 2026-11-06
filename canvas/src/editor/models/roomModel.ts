// The rooms UI's model: which rooms the sheet lists and how it groups them, what a key
// says in one line, how a split names its halves, and what the status bar says for the
// room tools. Pure: no store, no React, so the sheet, the card and the dialog share it.
import { levelOf, lookSource, type LookChain, type LookKey, type LookSource } from '@dnd/core/src/shared/lookScope';
import { computeArea, computeCentroid } from '@dnd/core/src/shared/roomUtils';
import { roomLabel } from '@dnd/core/src/shared/prep';
import type { DungeonLayer, Layer, Level, MapBuilderStore, Room, RoomArea, RoomKey } from '@/store/types';
import { resolveRoomTarget, soleRoomTarget } from './selectionModel';

/* ── Levels ─────────────────────────────────────────────── */

/** Whether a layer shows on a level. With no levels at all (an old test store) every layer does. */
export function layerOnLevel(layer: Layer, levels: readonly Level[], levelId: string): boolean {
  if (levels.length === 0) return true;
  return levelOf(levels, layer).id === levelId;
}

/** The dungeon layers a level holds, in draw order. */
export function levelDungeons(layers: readonly Layer[], levels: readonly Level[], levelId: string): DungeonLayer[] {
  return layers.filter((l): l is DungeonLayer => l.type === 'dungeon' && layerOnLevel(l, levels, levelId));
}

/** "5" or "5 in 2 areas": how many rooms a level (or a layer) has, and in how many areas. */
export function roomCountLabel(rooms: number, areas: number): string {
  return areas > 0 ? `${rooms} in ${areas} area${areas === 1 ? '' : 's'}` : String(rooms);
}

/* ── Order ──────────────────────────────────────────────── */

/** Rooms by number; unnumbered ones last, in the order they were added. */
export function byNumber<R extends Pick<Room, 'number'>>(rooms: readonly R[]): R[] {
  return rooms
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.number ?? Infinity) - (b.r.number ?? Infinity) || a.i - b.i)
    .map((x) => x.r);
}

/**
 * The layer's room ids after a drag: `dragId` lifted out and put down before or after
 * `targetId`. Null when nothing moves.
 */
export function reorderIds(
  ordered: readonly string[],
  dragId: string,
  targetId: string,
  place: 'before' | 'after',
): string[] | null {
  if (dragId === targetId || !ordered.includes(dragId) || !ordered.includes(targetId)) return null;
  const rest = ordered.filter((id) => id !== dragId);
  const at = rest.indexOf(targetId) + (place === 'after' ? 1 : 0);
  const next = [...rest.slice(0, at), dragId, ...rest.slice(at)];
  return next.every((id, i) => id === ordered[i]) ? null : next;
}

/* ── Keys ───────────────────────────────────────────────── */

/** A key with nothing in it: no text anywhere, no monsters, no traps, no checks. */
export function isKeyEmpty(key: RoomKey | undefined | null): boolean {
  if (!key) return true;
  const blank = (s: string | undefined) => !s || s.trim() === '';
  return (
    blank(key.readAloud) &&
    blank(key.notes) &&
    blank(key.treasure) &&
    key.traps.length === 0 &&
    key.checks.length === 0 &&
    (!key.encounter || (blank(key.encounter.name) && key.encounter.monsters.length === 0))
  );
}

export function hasEncounter(key: RoomKey | undefined | null): boolean {
  return !!key?.encounter && key.encounter.monsters.length > 0;
}

const SUMMARY_MAX = 64;

/** The key in one line, for the card: the read-aloud's start, else the notes', else what it holds. */
export function keySummary(key: RoomKey | undefined | null): string {
  if (isKeyEmpty(key) || !key) return 'No read-aloud or notes yet.';
  const text = [key.readAloud, key.notes, key.treasure].map((s) => s.trim()).find((s) => s !== '');
  if (text) {
    const line = text.split('\n')[0];
    return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : line;
  }
  const parts: string[] = [];
  if (hasEncounter(key)) parts.push(key.encounter!.name.trim() || 'Encounter');
  if (key.traps.length) parts.push(`${key.traps.length} trap${key.traps.length === 1 ? '' : 's'}`);
  if (key.checks.length) parts.push(`${key.checks.length} check${key.checks.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** Every bit of text a key holds, lower-cased, for the sheet's filter. */
function keyText(key: RoomKey | undefined): string {
  if (!key) return '';
  return [
    key.readAloud,
    key.notes,
    key.treasure,
    key.encounter?.name ?? '',
    ...(key.encounter?.monsters.map((m) => m.name) ?? []),
    ...key.traps.map((t) => t.text),
    ...key.checks.map((c) => c.text),
  ]
    .join('\n')
    .toLowerCase();
}

/** Whether a room passes the sheet's filter: its name, its number, or anything in its key. */
export function roomMatches(room: Pick<Room, 'name' | 'number'>, key: RoomKey | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (room.name.toLowerCase().includes(q)) return true;
  if (room.number !== undefined && String(room.number) === q.replace(/^#/, '')) return true;
  return keyText(key).includes(q);
}

/* ── Sheet groups ───────────────────────────────────────── */

export interface SheetGroup {
  layer: DungeonLayer;
  /** Null for the layer's rooms in no area. */
  area: RoomArea | null;
  rooms: Room[];
}

/**
 * The sheet's groups for one layer: one per area, in the layer's area order, then the
 * rooms in none. A layer with no areas is one ungrouped list. Rooms keep number order
 * inside each group; `keep` filters them (the filter box), and an area left empty by the
 * filter drops out unless nothing is filtered (an empty area is still a drop target).
 */
export function sheetGroups(layer: DungeonLayer, keep: (room: Room) => boolean = () => true): SheetGroup[] {
  const rooms = byNumber(layer.rooms ?? []);
  const areas = layer.areas ?? [];
  const filtering = rooms.some((r) => !keep(r));
  if (areas.length === 0) return [{ layer, area: null, rooms: rooms.filter(keep) }];
  const known = new Set(areas.map((a) => a.id));
  const groups: SheetGroup[] = areas.map((area) => ({
    layer,
    area,
    rooms: rooms.filter((r) => r.areaId === area.id && keep(r)),
  }));
  const loose = rooms.filter((r) => (!r.areaId || !known.has(r.areaId)) && keep(r));
  groups.push({ layer, area: null, rooms: loose });
  return groups.filter((g) => g.rooms.length > 0 || (!filtering && g.area !== null));
}

/* ── Look labels ────────────────────────────────────────── */

export const FLOOR_KEYS = ['floorTextureId', 'floorTint'] as const satisfies readonly LookKey[];
export const WALL_KEYS = ['wallTextureSetId', 'wallTextureTint', 'wallWidth'] as const satisfies readonly LookKey[];
export const MOOD_KEYS = ['mood', 'moodTint', 'moodVision'] as const satisfies readonly LookKey[];

/** The scope whose card is showing: its own pins read "Pinned", anything nearer the map "Inherits …". */
export type LookScope = 'room' | 'area' | 'level';

const DEPTH: Record<LookSource, number> = { room: 4, area: 3, layer: 2, level: 1, map: 0 };

export interface SectionLook {
  /** The scope itself pins at least one of the section's keys: Reset has something to undo. */
  pinned: boolean;
  /** Where the section's values come from, nearest first, when the scope pins none. */
  from: LookSource;
}

/** Whether a card's section is pinned on its own scope, and where it inherits from if not. */
export function sectionLook(chain: LookChain, scope: LookScope, keys: readonly LookKey[]): SectionLook {
  const sources = keys.map((k) => lookSource(chain, k));
  if (sources.includes(scope)) return { pinned: true, from: scope };
  const from = sources.reduce<LookSource>((best, s) => (DEPTH[s] > DEPTH[best] ? s : best), 'map');
  return { pinned: false, from };
}

/** "Pinned", or "Inherits <name>" naming the scope the values come from. */
export function sectionLabel(look: SectionLook, chain: LookChain): string {
  if (look.pinned) return 'Pinned';
  switch (look.from) {
    case 'area':
      return `Inherits ${chain.area?.name || 'area'}`;
    case 'layer':
      return `Inherits ${chain.layer.name || 'layer'}`;
    case 'level':
      return `Inherits ${chain.level.name || 'level'}`;
    default:
      return 'Inherits Map';
  }
}

/** The quiet label an area header carries in the sheet: what the area pins, else that it inherits. */
export function areaPinLabel(area: RoomArea): string {
  const look = area.look ?? {};
  const floor = FLOOR_KEYS.some((k) => look[k] !== undefined);
  const walls = WALL_KEYS.some((k) => look[k] !== undefined);
  if (floor && walls) return 'Floor and walls pinned';
  if (floor) return 'Floor pinned';
  if (walls) return 'Walls pinned';
  return 'Inherits level';
}

/* ── Split ──────────────────────────────────────────────── */

export type Compass = 'north' | 'south' | 'east' | 'west';

/** Where `face` lies from `other`, by their centroids: the larger offset decides (y grows south). */
export function compassOf(face: [number, number][], other: [number, number][]): Compass {
  const [ax, ay] = computeCentroid(face);
  const [bx, by] = computeCentroid(other);
  const dx = ax - bx;
  const dy = ay - by;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

const CAP = (s: string) => s[0].toUpperCase() + s.slice(1);

/** "West half", for the dialog's choice. */
export function halfLabel(dir: Compass): string {
  return `${CAP(dir)} half`;
}

/** The new half's default name: the room's name and where it lies, "Warren hall, east". */
export function otherHalfName(roomName: string, dir: Compass): string {
  const base = roomName.trim() || 'Room';
  return `${base}, ${dir}`;
}

/** Shortest distance from a point to a ring's edges. */
export function distanceToRing(x: number, y: number, ring: readonly [number, number][]): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)));
  }
  return best;
}

/** How many of the given door positions sit on a face's outline (within `tol` cells). */
export function doorsOnFace(face: readonly [number, number][], doors: readonly [number, number][], tol = 0.75): number {
  return doors.filter(([x, y]) => distanceToRing(x, y, face) <= tol).length;
}

/** "24 sq · 1 door". */
export function halfMeta(face: [number, number][], doors: number): string {
  return `${Math.round(computeArea(face))} sq · ${doors} door${doors === 1 ? '' : 's'}`;
}

/* ── Status hints ───────────────────────────────────────── */

export interface ToolHint {
  label: string;
  /** Words and keys in order; keys are drawn as keycaps. */
  segments: { text: string; key?: boolean }[];
}

/** The line as one string, runs joined by " · " before each key: what the title attribute reads. */
export function hintText(hint: ToolHint): string {
  let out = '';
  for (const s of hint.segments) {
    if (!out) out = s.text;
    else out += s.key ? ` · ${s.text}` : ` ${s.text}`;
  }
  return out;
}

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

export const ROOM_RECT_HINT: ToolHint = {
  label: 'Rectangle room',
  segments: [t('drag to draw: the floor and its walls land together'), k('Shift'), t('square'), k('Esc'), t('cancel')],
};

export const ROOM_POLYGON_HINT: ToolHint = {
  label: 'Polygon room',
  segments: [t('click the corners: the floor and its walls land together'), k('Enter'), t('close'), k('Esc'), t('cancel')],
};

export const DIVIDE_HINT: ToolHint = {
  label: 'Divide',
  segments: [t('drag across a floor: ends snap to the walls'), k('Shift'), t('straight'), k('Esc'), t('cancel')],
};

export const SUGGEST_HINT: ToolHint = {
  label: 'Suggesting',
  segments: [t('enclosed floor with no room yet'), k('Enter'), t('accept all'), k('Esc'), t('dismiss')],
};

export function roomSelectedHint(room: Pick<Room, 'name' | 'number'>): ToolHint {
  const label = room.number !== undefined ? `Room ${roomLabel(room)}` : room.name || 'Room';
  return {
    label,
    segments: [k('Dbl-click'), t('reshape floor'), k('Del'), t('delete room, keep floor'), k('Esc'), t('deselect')],
  };
}

export function roomsSelectedHint(count: number): ToolHint {
  return { label: `${count} rooms selected`, segments: [k('Esc'), t('deselect')] };
}

export function areaSelectedHint(area: RoomArea, rooms: number): ToolHint {
  return {
    label: `Area · ${area.name}`,
    segments: [t(`${rooms} room${rooms === 1 ? '' : 's'}`), k('Esc'), t('deselect')],
  };
}

export function levelSelectedHint(level: Level, layers: number, rooms: number): ToolHint {
  return {
    label: `Level · ${level.name}`,
    segments: [
      t(`${layers} layer${layers === 1 ? '' : 's'}, ${rooms} room${rooms === 1 ? '' : 's'}`),
      k('Esc'),
      t('deselect'),
    ],
  };
}

/**
 * What the bar says for the room tools and a selected room, area or level: proposals up
 * first, then the room tool in hand, then the selection. Null when none of them applies.
 */
export function roomHintFor(s: MapBuilderStore): ToolHint | null {
  if (s.ui.roomSuggestions && s.ui.roomSuggestions.rooms.length > 0) return SUGGEST_HINT;
  const tool = s.tools.activeTool;
  if (tool === 'roomRect') return ROOM_RECT_HINT;
  if (tool === 'roomPolygon') return ROOM_POLYGON_HINT;
  if (tool === 'divide') return DIVIDE_HINT;
  const target = soleRoomTarget(s, s.selection.selectedIds);
  if (!target) {
    const n = s.selection.selectedIds.filter((id) => resolveRoomTarget(s, id)?.kind === 'room').length;
    return n > 1 && n === s.selection.selectedIds.length ? roomsSelectedHint(n) : null;
  }
  if (target.kind === 'room') return roomSelectedHint(target.room);
  if (target.kind === 'area') {
    return areaSelectedHint(target.area, (target.layer.rooms ?? []).filter((r) => r.areaId === target.area.id).length);
  }
  const layers = s.layers.filter((l) => l.type !== 'background' && layerOnLevel(l, s.levels, target.level.id)).length;
  const rooms = levelDungeons(s.layers, s.levels, target.level.id).reduce((n, l) => n + (l.rooms?.length ?? 0), 0);
  return levelSelectedHint(target.level, layers, rooms);
}

/** "5 rooms", or "3 rooms · 2 suggested" while proposals are up. */
export function roomCountText(rooms: number, suggested: number): string {
  const base = `${rooms} room${rooms === 1 ? '' : 's'}`;
  return suggested > 0 ? `${base} · ${suggested} suggested` : base;
}
