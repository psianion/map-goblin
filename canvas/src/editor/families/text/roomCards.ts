// The room, area and level cards. A room: Number, Name, Size, Area, then its Floor and
// Walls looks and its Key. An area: Name, Rooms and the two looks. A level: Name, Layers,
// Rooms and the two looks. No Mood on any of them: it barely changed the made map, and maps
// that carry it open without it.

import { z } from 'zod';
import { useStore } from '@/store/store';
import type { DungeonLayer, Level, MapBuilderStore, Room, RoomArea } from '@/store/types';
import {
  AddAreaCommand,
  AssignRoomsToAreaCommand,
  RenameAreaCommand,
  RenameLevelCommand,
  RenameRoomCommand,
  SetRoomNumberCommand,
} from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { defineCard, defineCardField } from '@/editor/registry/define';
import type { CardFieldDef, ObjectKind } from '@/editor/registry/types';
import { SELECTION_VERBS } from '@/editor/families/select';
import type { LookTarget } from '@/v2/editor/roomLook';
import { nextAreaName } from '@/v2/editor/roomActions';
import { layerOnLevel, levelDungeons, roomCountLabel } from '@/v2/editor/roomModel';
import { AreaPick, CountField, FloorSection, KeyField, NEW_AREA, NO_AREA, ReadoutField, TypedField, WallsSection } from './RoomFields';

const state = () => useStore.getState() as MapBuilderStore;

function layerOfRoom(id: string): DungeonLayer | undefined {
  return state().layers.find((l): l is DungeonLayer => l.type === 'dungeon' && !!(l as DungeonLayer).rooms?.some((r) => r.id === id));
}

function layerOfArea(id: string): DungeonLayer | undefined {
  return state().layers.find((l): l is DungeonLayer => l.type === 'dungeon' && !!(l as DungeonLayer).areas?.some((a) => a.id === id));
}

const lookSchema: z.ZodType<LookTarget> = z.union([
  z.object({ kind: z.literal('room'), layerId: z.string(), roomId: z.string() }),
  z.object({ kind: z.literal('area'), layerId: z.string(), areaId: z.string() }),
  z.object({ kind: z.literal('level'), levelId: z.string() }),
]);

/** Floor and Walls for a scope, whichever card it is on. */
function looks<K extends ObjectKind>(kind: string, target: (o: never) => LookTarget): CardFieldDef<K>[] {
  const base = { schema: lookSchema, default: { kind: 'level', levelId: '' } as LookTarget, home: 'card' as const, control: 'custom' as const, write: () => {} };
  return [
    defineCardField<K, LookTarget>({ ...base, id: `card.${kind}.floor`, label: 'Floor', render: FloorSection, read: target as never }),
    defineCardField<K, LookTarget>({ ...base, id: `card.${kind}.walls`, label: 'Walls', render: WallsSection, read: target as never }),
  ];
}

/* ── Room ──────────────────────────────────────────────── */

const roomField = <T>(def: Omit<CardFieldDef<'room', T>, 'home'>) => defineCardField<'room', T>({ ...def, home: 'card' });

const roomNumber = roomField<string>({
  id: 'card.room.number',
  label: 'Number',
  schema: z.string(),
  default: '',
  control: 'custom',
  render: TypedField,
  read: (r) => (r.number !== undefined ? String(r.number) : ''),
  write: (_s, ids, raw) => {
    const n = Number(raw.trim());
    const layer = layerOfRoom(ids[0]);
    const room = layer?.rooms?.find((r) => r.id === ids[0]);
    if (!layer || !room || !Number.isInteger(n) || n < 1 || n === room.number) return;
    undoManager.execute(new SetRoomNumberCommand(layer.id, room.id, n));
  },
});

const roomName = roomField<string>({
  id: 'card.room.name',
  label: 'Name',
  schema: z.string(),
  default: '',
  control: 'custom',
  render: TypedField,
  read: (r) => r.name,
  write: (_s, ids, raw) => {
    const next = raw.trim();
    const layer = layerOfRoom(ids[0]);
    const room = layer?.rooms?.find((r) => r.id === ids[0]);
    if (layer && room && next && next !== room.name) undoManager.execute(new RenameRoomCommand(layer.id, room.id, room.name, next));
  },
});

const roomSize = roomField<string>({
  id: 'card.room.size',
  label: 'Size',
  schema: z.string(),
  default: '',
  control: 'custom',
  render: ReadoutField,
  read: (r) => {
    const doors = r.doors?.length ?? 0;
    const size = r.area !== undefined ? `${Math.round(r.area)} sq` : 'No floor here';
    return `${size} · ${doors} door${doors === 1 ? '' : 's'}`;
  },
  write: () => {},
});

const roomArea = roomField<string>({
  id: 'card.room.area',
  label: 'Area',
  schema: z.string().min(1),
  default: NO_AREA,
  control: 'custom',
  render: AreaPick,
  read: (r) => {
    const layer = layerOfRoom(r.id);
    return r.areaId && layer?.areas?.some((a) => a.id === r.areaId) ? r.areaId : NO_AREA;
  },
  write: (_s, ids, value) => {
    const layer = layerOfRoom(ids[0]);
    if (!layer) return;
    if (value === NEW_AREA) {
      undoManager.execute(new AddAreaCommand(layer.id, { id: crypto.randomUUID(), name: nextAreaName(layer) }, [...ids]));
      return;
    }
    undoManager.execute(new AssignRoomsToAreaCommand(layer.id, [...ids], value === NO_AREA ? null : value));
  },
});

const roomKey = roomField<string>({
  id: 'card.room.key',
  label: 'Key',
  schema: z.string(),
  default: '',
  control: 'custom',
  render: KeyField,
  read: (r) => r.id,
  write: () => {},
});

export const roomCard = defineCard<'room'>({
  kind: 'room',
  title: (r: Room) => r.name || 'Room',
  verbs: SELECTION_VERBS,
  fields: [
    roomNumber,
    roomName,
    roomSize,
    roomArea,
    ...looks<'room'>('room', ((r: Room) => ({ kind: 'room', layerId: layerOfRoom(r.id)?.id ?? '', roomId: r.id })) as never),
    roomKey,
  ],
});

/* ── Area ──────────────────────────────────────────────── */

const areaField = <T>(def: Omit<CardFieldDef<'area', T>, 'home'>) => defineCardField<'area', T>({ ...def, home: 'card' });

export const areaCard = defineCard<'area'>({
  kind: 'area',
  title: (a: RoomArea) => a.name || 'Area',
  verbs: [],
  fields: [
    areaField<string>({
      id: 'card.area.name',
      label: 'Name',
      schema: z.string(),
      default: '',
      control: 'custom',
      render: TypedField,
      read: (a) => a.name,
      write: (_s, ids, raw) => {
        const next = raw.trim();
        const layer = layerOfArea(ids[0]);
        const area = layer?.areas?.find((a) => a.id === ids[0]);
        if (layer && area && next && next !== area.name) undoManager.execute(new RenameAreaCommand(layer.id, area.id, next));
      },
    }),
    areaField<string>({
      id: 'card.area.rooms',
      label: 'Rooms',
      schema: z.string(),
      default: '',
      control: 'custom',
      render: CountField,
      read: (a) => String((layerOfArea(a.id)?.rooms ?? []).filter((r) => r.areaId === a.id).length),
      write: () => {},
    }),
    ...looks<'area'>('area', ((a: RoomArea) => ({ kind: 'area', layerId: layerOfArea(a.id)?.id ?? '', areaId: a.id })) as never),
  ],
});

/* ── Level ─────────────────────────────────────────────── */

const levelField = <T>(def: Omit<CardFieldDef<'level', T>, 'home'>) => defineCardField<'level', T>({ ...def, home: 'card' });

export const levelCard = defineCard<'level'>({
  kind: 'level',
  title: (l: Level) => l.name || 'Level',
  verbs: [],
  fields: [
    levelField<string>({
      id: 'card.level.name',
      label: 'Name',
      schema: z.string(),
      default: '',
      control: 'custom',
      render: TypedField,
      read: (l) => l.name,
      write: (_s, ids, raw) => {
        const next = raw.trim();
        const level = state().levels.find((l) => l.id === ids[0]);
        if (level && next && next !== level.name) undoManager.execute(new RenameLevelCommand(level.id, next));
      },
    }),
    levelField<string>({
      id: 'card.level.layers',
      label: 'Layers',
      schema: z.string(),
      default: '',
      control: 'custom',
      render: ReadoutField,
      read: (l) => {
        const s = state();
        const names = s.layers.filter((x) => x.type !== 'background' && layerOnLevel(x, s.levels, l.id)).map((x) => x.name || 'Unnamed layer');
        return names.length > 0 ? names.join(', ') : 'None';
      },
      write: () => {},
    }),
    levelField<string>({
      id: 'card.level.rooms',
      label: 'Rooms',
      schema: z.string(),
      default: '',
      control: 'custom',
      render: CountField,
      read: (l) => {
        const s = state();
        const dungeons = levelDungeons(s.layers, s.levels, l.id);
        return roomCountLabel(
          dungeons.reduce((n, d) => n + (d.rooms?.length ?? 0), 0),
          dungeons.reduce((n, d) => n + (d.areas?.length ?? 0), 0),
        );
      },
      write: () => {},
    }),
    ...looks<'level'>('level', ((l: Level) => ({ kind: 'level', levelId: l.id })) as never),
  ],
});
