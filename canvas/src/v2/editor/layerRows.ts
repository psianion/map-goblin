import type { AnyChild, DungeonLayer, Layer, Level, Room, WallSegment } from '@/store/types';
import { layerObjectCount } from '@dnd/core/src/store/layerCommands';

/*
 * The Layers sheet as rows (board L3): levels, their layers top of the stack first, a
 * layer's objects in kind groups, every object a row. Pure, so the sheet, its keys and
 * its tests read the same list. Walls and rooms get rows like any child.
 */

/** A kind group, in the sheet's fixed order. */
export type RowKind = 'room' | 'wall' | 'door' | 'asset' | 'light' | 'text' | 'zone' | 'shape' | 'water';

export const KIND_ORDER: readonly RowKind[] = ['room', 'wall', 'door', 'asset', 'light', 'text', 'zone', 'shape', 'water'];

export const KIND_LABEL: Record<RowKind, string> = {
  room: 'Rooms',
  wall: 'Walls',
  door: 'Doors',
  asset: 'Props',
  light: 'Lights',
  text: 'Labels',
  zone: 'Zones',
  shape: 'Floors',
  water: 'Water',
};

const KIND_NOUN: Record<RowKind, string> = {
  room: 'Room',
  wall: 'Wall',
  door: 'Door',
  asset: 'Prop',
  light: 'Light',
  text: 'Label',
  zone: 'Zone',
  shape: 'Floor',
  water: 'Water',
};

export type SheetRow =
  | { kind: 'level'; key: string; level: Level; layerCount: number; matchCount: number | null; open: boolean }
  | {
      kind: 'layer';
      key: string;
      layer: DungeonLayer;
      levelId: string;
      depth: number;
      count: number;
      open: boolean;
      /** The filter matched the layer's own name. */
      nameMatch: boolean;
    }
  | { kind: 'group'; key: string; layerId: string; type: RowKind; count: number; open: boolean; depth: number }
  | {
      kind: 'object';
      key: string;
      id: string;
      layerId: string;
      type: RowKind;
      name: string;
      depth: number;
      /** Undefined for rooms: they have neither eye nor lock. */
      visible?: boolean;
      locked?: boolean;
      /** The object itself, for the row's verbs. */
      child?: AnyChild;
      wall?: WallSegment;
      room?: Room;
    };

export interface RowState {
  layers: readonly Layer[];
  levels: readonly Level[];
  activeLevelId: string;
  expandedLayerIds: readonly string[];
  /** `${layerId}:${kind}` keys deviating from the default (props folded, the rest open). */
  childGroupOverrides: readonly string[];
  /** Levels whose fold deviates from the default (the one on show open, the rest folded). */
  levelOverrides: ReadonlySet<string>;
  filter: string;
}

export function kindOfChild(child: AnyChild): RowKind {
  return child.childType;
}

export function groupOpenByDefault(kind: RowKind): boolean {
  return kind !== 'asset';
}

export function roomTitle(room: Pick<Room, 'name' | 'number'>): string {
  return [room.number, room.name || 'Room'].filter((p) => p !== undefined && p !== '').join(' ');
}

/** Every object of a layer as (kind, name, record), in the sheet's order, top of each kind first. */
export function layerObjects(layer: DungeonLayer): { type: RowKind; id: string; name: string; child?: AnyChild; wall?: WallSegment; room?: Room }[] {
  const out: { type: RowKind; id: string; name: string; child?: AnyChild; wall?: WallSegment; room?: Room }[] = [];
  for (const room of layer.rooms ?? []) out.push({ type: 'room', id: room.id, name: roomTitle(room), room });
  layer.standaloneWalls.forEach((wall, i) => out.push({ type: 'wall', id: wall.id, name: `Wall ${i + 1}`, wall }));
  // Children draw bottom first; the sheet lists the top first, as the layers above it.
  for (let i = layer.children.length - 1; i >= 0; i--) {
    const child = layer.children[i];
    out.push({ type: kindOfChild(child), id: child.id, name: child.name || KIND_NOUN[kindOfChild(child)], child });
  }
  return out;
}

const levelOf = (layer: Layer, levels: readonly Level[]) =>
  levels.some((l) => l.id === layer.levelId) ? layer.levelId : (levels[0]?.id ?? '');

/** The rows the sheet shows right now, top to bottom. */
export function buildSheetRows(st: RowState): SheetRow[] {
  const q = st.filter.trim().toLowerCase();
  const filtering = q.length > 0;
  const matches = (text: string) => text.toLowerCase().includes(q);
  const grouped = st.levels.length > 1;
  const rows: SheetRow[] = [];

  const levels = st.levels.length > 0 ? st.levels : [{ id: '', name: '' }];
  for (const level of levels) {
    // Top of the stack first.
    const onLevel = st.layers
      .filter((l): l is DungeonLayer => l.type === 'dungeon' && (levelOf(l, st.levels) === level.id || st.levels.length === 0))
      .reverse();
    const layerRows: SheetRow[] = [];
    let shownLayers = 0;
    for (const layer of onLevel) {
      const objects = layerObjects(layer);
      const hits = filtering ? objects.filter((o) => matches(o.name)) : objects;
      const nameMatch = filtering && matches(layer.name);
      if (filtering && !nameMatch && hits.length === 0) continue;
      shownLayers++;
      const open = filtering ? hits.length > 0 : st.expandedLayerIds.includes(layer.id);
      const depth = grouped ? 1 : 0;
      layerRows.push({ kind: 'layer', key: `layer:${layer.id}`, layer, levelId: level.id, depth, count: layerObjectCount(layer), open, nameMatch });
      if (!open) continue;
      for (const type of KIND_ORDER) {
        const ofKind = hits.filter((o) => o.type === type);
        if (ofKind.length === 0) continue;
        const overridden = st.childGroupOverrides.includes(`${layer.id}:${type}`);
        const groupOpen = filtering || groupOpenByDefault(type) !== overridden;
        layerRows.push({ kind: 'group', key: `group:${layer.id}:${type}`, layerId: layer.id, type, count: ofKind.length, open: groupOpen, depth: depth + 1 });
        if (!groupOpen) continue;
        for (const o of ofKind) {
          const flags =
            o.type === 'room'
              ? {}
              : o.wall
                ? { visible: o.wall.visible !== false, locked: o.wall.locked === true }
                : { visible: o.child!.visible !== false, locked: o.child!.locked === true };
          layerRows.push({
            kind: 'object',
            key: `obj:${o.id}`,
            id: o.id,
            layerId: layer.id,
            type: o.type,
            name: o.name,
            depth: depth + 2,
            ...flags,
            child: o.child,
            wall: o.wall,
            room: o.room,
          });
        }
      }
    }
    if (grouped) {
      if (filtering && shownLayers === 0) continue;
      const defaultOpen = level.id === st.activeLevelId;
      const open = filtering || defaultOpen !== st.levelOverrides.has(level.id);
      rows.push({
        kind: 'level',
        key: `level:${level.id}`,
        level,
        layerCount: onLevel.length,
        matchCount: filtering ? shownLayers : null,
        open,
      });
      if (open) rows.push(...layerRows);
    } else {
      rows.push(...layerRows);
    }
  }
  return rows;
}

/** Above this many rows the sheet renders through a window. */
export const VIRTUAL_ROWS = 200;
