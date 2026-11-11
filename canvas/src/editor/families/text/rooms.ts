// The Rooms tool: one tool over the rectangle room, polygon room and divide engine tools.
// The dock's Draw row picks which is in hand. Rectangle and Polygon draw a floor and its
// room in one gesture, Divide splits a room with a threshold or a wall. The floor texture
// strip rides with the drawing modes, so a room lands in the texture picked, not the
// layer's default.

import { LayoutPanelLeft, Pentagon, RectangleHorizontal, Scissors } from 'lucide-react';
import { z } from 'zod';
import type { ToolType, UISlice } from '@/store/types';
import { defineSetting, defineTool } from '@/editor/registry/define';
import type { DockColumnDef, EditorState, HintLine } from '@/editor/registry/types';
import { RoomsLook, RoomsPanel } from './RoomsControls';

export type RoomsMode = 'rect' | 'polygon' | 'divide';

/** The engine tool each mode draws with, in the order the Draw row shows them. */
export const ROOMS_ENGINE: Record<RoomsMode, ToolType> = {
  rect: 'roomRect',
  polygon: 'roomPolygon',
  divide: 'divide',
};

const MODE_OF = new Map<ToolType, RoomsMode>(
  (Object.entries(ROOMS_ENGINE) as [RoomsMode, ToolType][]).map(([mode, tool]) => [tool, mode]),
);

/** The mode in hand: the rooms engine tool that is active, else the first. */
export function roomsModeOf(state: Pick<EditorState, 'tools'>): RoomsMode {
  return MODE_OF.get(state.tools.activeTool) ?? 'rect';
}

/** Draw row. It follows the engine tool in hand, as the Floor tool's Shape row does. */
export const roomsMode = defineSetting<RoomsMode>({
  id: 'rooms.mode',
  label: 'Draw',
  schema: z.enum(['rect', 'polygon', 'divide']),
  default: 'rect',
  home: 'dock',
  control: 'seg',
  section: 'Draw',
  // Off R, the tool's own key.
  options: [
    { value: 'rect', label: 'Rectangle', icon: RectangleHorizontal, key: 'B' },
    { value: 'polygon', label: 'Polygon', icon: Pentagon, key: 'P' },
    { value: 'divide', label: 'Divide', icon: Scissors, key: 'K' },
  ],
  persist: false,
  bind: {
    read: roomsModeOf,
    write: (store, mode) => store.getState().setActiveTool(ROOMS_ENGINE[mode]),
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
  visibleWhen: (get) => get('rooms.mode') !== 'divide',
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
  visibleWhen: (get) => get('rooms.mode') === 'divide',
  bind: {
    read: (s) => s.ui.dividerMode,
    write: (store, v) => store.getState().setDividerMode(v),
  },
});

const floorColumn: DockColumnDef = { id: 'rooms.floor', caption: 'Look', render: RoomsLook };

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

const ROOMS_HINTS: Record<RoomsMode, HintLine> = {
  rect: { label: 'Rooms', segments: [t('Drag: the floor and its walls land together · '), k('Shift'), t(' square · '), k('Esc'), t(' cancel')] },
  polygon: { label: 'Rooms', segments: [t('Click the corners: the floor and its walls land together · '), k('Enter'), t(' close · '), k('Esc'), t(' cancel')] },
  divide: { label: 'Rooms', segments: [t('Drag across a floor: the ends snap to the walls · '), k('Shift'), t(' straight · '), k('Esc'), t(' cancel')] },
};

export const roomsTool = defineTool({
  id: 'rooms',
  label: 'Rooms',
  description: 'Draw a room or divide one',
  icon: LayoutPanelLeft,
  key: 'R',
  engine: [ROOMS_ENGINE.rect, ROOMS_ENGINE.polygon, ROOMS_ENGINE.divide],
  settings: [roomsMode, roomWalls, roomDivider],
  dock: [floorColumn],
  panelExtra: RoomsPanel,
  hint: (s) => ROOMS_HINTS[roomsModeOf(s)],
});
