// The Rooms family's tools. Outline marks a room over whatever floor is there (a cave chamber,
// painted ground, a picture) by drawing its outline; Divide splits a room with a threshold or
// a wall; Draw room lays a floor, its walls and its room in one gesture, a rectangle or a
// polygon picked on its dock's Shape row. Every one carries the same panel: Suggest rooms,
// the Room outlines switch and the way to the rooms list.

import { BrickWall, Pentagon, RectangleHorizontal, Scissors, SquareDashed } from 'lucide-react';
import { z } from 'zod';
import type { ToolType, UISlice } from '@/store/types';
import { defineSetting, defineTool } from '@/editor/registry/define';
import type { DockColumnDef, EditorState, HintLine } from '@/editor/registry/types';
import { FloorLook } from '@/editor/families/design/LookColumn';
import { RoomsPanel } from './RoomsControls';

export type DrawRoomShape = 'rect' | 'polygon';

/** The engine tool each shape draws with, in the order the Shape row shows them. */
export const DRAW_ROOM_ENGINE: Record<DrawRoomShape, ToolType> = {
  rect: 'roomRect',
  polygon: 'roomPolygon',
};

/** The shape in hand: Polygon while its engine tool is, else Rectangle. */
export function drawRoomShapeOf(state: Pick<EditorState, 'tools'>): DrawRoomShape {
  return state.tools.activeTool === 'roomPolygon' ? 'polygon' : 'rect';
}

/** Shape row. It follows the engine tool in hand, as the Floor tool's Shape row does. */
export const drawRoomShape = defineSetting<DrawRoomShape>({
  id: 'rooms.shape',
  label: 'Shape',
  schema: z.enum(['rect', 'polygon']),
  default: 'rect',
  home: 'dock',
  control: 'seg',
  section: 'Shape',
  options: [
    { value: 'rect', label: 'Rectangle', icon: RectangleHorizontal, key: 'B' },
    { value: 'polygon', label: 'Polygon', icon: Pentagon, key: 'P' },
  ],
  persist: false,
  bind: {
    read: drawRoomShapeOf,
    write: (store, shape) => store.getState().setActiveTool(DRAW_ROOM_ENGINE[shape]),
  },
});

/** Whether a drawn room gets walls round its floor. A view of the session, not of the map. */
export const roomWalls = defineSetting<UISlice['roomWalls']>({
  id: 'rooms.walls',
  label: 'Walls',
  schema: z.enum(['with', 'none']),
  default: 'with',
  home: 'panel',
  control: 'seg',
  section: 'New rooms',
  options: [
    { value: 'with', label: 'With room' },
    { value: 'none', label: 'None' },
  ],
  persist: false,
  bind: {
    read: (s) => s.ui.roomWalls,
    write: (store, v) => store.getState().setRoomWalls(v),
  },
});

/** What Divide draws: a threshold splits the room and blocks nothing, a wall blocks both. */
export const roomDivider = defineSetting<UISlice['dividerMode']>({
  id: 'rooms.divider',
  label: 'Divider',
  schema: z.enum(['threshold', 'wall']),
  default: 'threshold',
  home: 'dock',
  control: 'seg',
  section: 'Divider',
  options: [
    { value: 'threshold', label: 'Threshold' },
    { value: 'wall', label: 'Wall' },
  ],
  persist: false,
  bind: {
    read: (s) => s.ui.dividerMode,
    write: (store, v) => store.getState().setDividerMode(v),
  },
});

const floorColumn: DockColumnDef = { id: 'rooms.floor', caption: 'Look', render: FloorLook };

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

/** The room the card's Outline it is drawing for, by its number or name; null with none pending. */
function outlineFor(s: EditorState): string | null {
  const id = s.ui.outlineRoomId;
  if (!id) return null;
  for (const l of s.layers) {
    if (l.type !== 'dungeon') continue;
    const room = l.rooms?.find((r) => r.id === id);
    if (room) return room.name || (room.number !== undefined ? `Room ${room.number}` : 'the room');
  }
  return null;
}

export function outlineHint(s: EditorState): HintLine {
  const target = outlineFor(s);
  const lead = target ? `Outline ${target}: drag a rectangle, or click the corners · ` : 'Drag a rectangle, or click the corners · ';
  return { label: 'Outline', segments: [t(lead), k('Enter'), t(' close · '), k('Shift'), t(' 15° steps · '), k('Esc'), t(' cancel')] };
}

const DIVIDE_HINT: HintLine = {
  label: 'Divide',
  segments: [t('Drag across a floor: the ends snap to the walls · '), k('Shift'), t(' straight · '), k('Esc'), t(' cancel')],
};

const DRAW_ROOM_HINTS: Record<DrawRoomShape, HintLine> = {
  rect: { label: 'Draw room', segments: [t('Drag: the floor and its walls land together · '), k('Shift'), t(' square · '), k('Esc'), t(' cancel')] },
  polygon: { label: 'Draw room', segments: [t('Click the corners: the floor and its walls land together · '), k('Enter'), t(' close · '), k('Esc'), t(' cancel')] },
};

export const outlineTool = defineTool({
  id: 'roomOutline',
  label: 'Outline',
  description: 'Mark a room by drawing round it',
  icon: SquareDashed,
  key: 'L',
  engine: ['outline'],
  settings: [],
  dock: [],
  panelExtra: RoomsPanel,
  hint: outlineHint,
});

export const divideTool = defineTool({
  id: 'roomDivide',
  label: 'Divide',
  description: 'Split a room with a threshold or a wall',
  icon: Scissors,
  key: 'K',
  engine: ['divide'],
  settings: [roomDivider],
  dock: [],
  panelExtra: RoomsPanel,
  hint: () => DIVIDE_HINT,
});

export const drawRoomTool = defineTool({
  id: 'roomDraw',
  label: 'Draw room',
  description: 'Lay a floor, its walls and its room together',
  icon: BrickWall,
  key: 'R',
  engine: [DRAW_ROOM_ENGINE.rect, DRAW_ROOM_ENGINE.polygon],
  settings: [drawRoomShape, roomWalls],
  dock: [floorColumn],
  panelExtra: RoomsPanel,
  hint: (s) => DRAW_ROOM_HINTS[drawRoomShapeOf(s)],
});
