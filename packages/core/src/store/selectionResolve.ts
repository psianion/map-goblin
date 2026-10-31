// What a selection holds, once: every consumer that acts on `selectedIds` (the Select tool,
// the shortcuts, the menus, the cards, align, move to layer, delete, copy) reads it through
// `resolveSelection` instead of walking the layers for its own subset.

import type { AnyChild, ChildType, DungeonLayer, Layer, Room, WallSegment } from './types';

/** The kinds a selection can hold: every child kind, drawn walls, and rooms. */
export type SelectionKind = ChildType | 'wall' | 'room';

export interface ResolvedSelection {
  children: { child: AnyChild; layer: DungeonLayer }[];
  walls: { wall: WallSegment; layer: DungeonLayer }[];
  rooms: { room: Room; layer: DungeonLayer }[];
  /** Ids of the members locked per object (children and walls; rooms have no lock). */
  locked: string[];
  /** How many members of each kind. */
  kinds: Partial<Record<SelectionKind, number>>;
}

/** Whether a child or a wall is locked on its own (its layer's lock is a separate matter). */
export function isLockedObject(o: { locked?: boolean }): boolean {
  return o.locked === true;
}

/** Whether a drawn wall is shown. Absent means shown. */
export function isWallShown(w: { visible?: boolean }): boolean {
  return w.visible !== false;
}

/** Resolves `ids` against the dungeon layers, in selection order; unknown ids drop out. */
export function resolveSelection(state: { layers: readonly Layer[] }, ids: readonly string[]): ResolvedSelection {
  const out: ResolvedSelection = { children: [], walls: [], rooms: [], locked: [], kinds: {} };
  if (ids.length === 0) return out;
  const want = new Set(ids);
  const found = new Map<string, () => void>();
  for (const layer of state.layers) {
    if (layer.type !== 'dungeon') continue;
    const dl = layer as DungeonLayer;
    for (const child of dl.children) {
      if (want.has(child.id)) found.set(child.id, () => out.children.push({ child, layer: dl }));
    }
    for (const wall of dl.standaloneWalls ?? []) {
      if (want.has(wall.id)) found.set(wall.id, () => out.walls.push({ wall, layer: dl }));
    }
    for (const room of dl.rooms ?? []) {
      if (want.has(room.id)) found.set(room.id, () => out.rooms.push({ room, layer: dl }));
    }
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    found.get(id)?.();
  }
  const count = (k: SelectionKind) => (out.kinds[k] = (out.kinds[k] ?? 0) + 1);
  for (const { child } of out.children) {
    count(child.childType);
    if (isLockedObject(child)) out.locked.push(child.id);
  }
  for (const { wall } of out.walls) {
    count('wall');
    if (isLockedObject(wall)) out.locked.push(wall.id);
  }
  if (out.rooms.length > 0) out.kinds.room = out.rooms.length;
  return out;
}

/** Singular and plural nouns per kind, in the order a title lists them. */
const KIND_NOUNS: [SelectionKind, string, string][] = [
  ['asset', 'prop', 'props'],
  ['light', 'light', 'lights'],
  ['text', 'label', 'labels'],
  ['shape', 'floor', 'floors'],
  ['water', 'water body', 'water bodies'],
  ['wall', 'wall', 'walls'],
  ['door', 'door', 'doors'],
  ['zone', 'zone', 'zones'],
  ['room', 'room', 'rooms'],
];

/** "3 props · 2 lights · 1 label": each kind present, counted. */
export function selectionTitle(kinds: Partial<Record<SelectionKind, number>>): string {
  return KIND_NOUNS.filter(([k]) => (kinds[k] ?? 0) > 0)
    .map(([k, one, many]) => `${kinds[k]} ${kinds[k] === 1 ? one : many}`)
    .join(' · ');
}

/**
 * What a toast calls the objects it acted on, counted by kind: "1 wall", "3 props",
 * "2 water bodies"; two or more kinds together are "objects". Empty for none.
 */
export function selectionNoun(kinds: Partial<Record<SelectionKind, number>>): string {
  const present = KIND_NOUNS.filter(([k]) => (kinds[k] ?? 0) > 0);
  if (present.length === 0) return '';
  const n = present.reduce((sum, [k]) => sum + (kinds[k] ?? 0), 0);
  if (present.length > 1) return `${n} ${n === 1 ? 'object' : 'objects'}`;
  const [, one, many] = present[0];
  return `${n} ${n === 1 ? one : many}`;
}

/** Counts by kind for a list of children and walls, as `selectionNoun` reads them. */
export function kindCounts(children: readonly { childType: string }[], walls = 0): Partial<Record<SelectionKind, number>> {
  const kinds: Partial<Record<SelectionKind, number>> = {};
  for (const c of children) kinds[c.childType as SelectionKind] = (kinds[c.childType as SelectionKind] ?? 0) + 1;
  if (walls > 0) kinds.wall = walls;
  return kinds;
}

/** Ids among `ids` that still name something a selection can hold. */
export function liveSelectionIds(
  state: { layers: readonly Layer[]; levels?: readonly { id: string }[] },
  ids: readonly string[],
): string[] {
  if (ids.length === 0) return [];
  const live = new Set<string>();
  for (const layer of state.layers) {
    live.add(layer.id);
    if (layer.type !== 'dungeon') continue;
    const dl = layer as DungeonLayer;
    for (const c of dl.children) live.add(c.id);
    for (const w of dl.standaloneWalls ?? []) live.add(w.id);
    for (const r of dl.rooms ?? []) live.add(r.id);
    for (const a of dl.areas ?? []) live.add(a.id);
  }
  for (const l of state.levels ?? []) live.add(l.id);
  return ids.filter((id) => live.has(id));
}

/**
 * Ids among `ids` the map still shows: an object (child, wall, room, area) whose layer
 * `isShown` refuses drops out; anything else (a level) stays.
 */
export function shownSelectionIds(
  state: { layers: readonly Layer[] },
  ids: readonly string[],
  isShown: (layer: Layer) => boolean,
): string[] {
  if (ids.length === 0) return [];
  const hidden = new Set<string>();
  for (const layer of state.layers) {
    if (layer.type !== 'dungeon' || isShown(layer)) continue;
    const dl = layer as DungeonLayer;
    for (const c of dl.children) hidden.add(c.id);
    for (const w of dl.standaloneWalls ?? []) hidden.add(w.id);
    for (const r of dl.rooms ?? []) hidden.add(r.id);
    for (const a of dl.areas ?? []) hidden.add(a.id);
  }
  return ids.filter((id) => !hidden.has(id));
}
