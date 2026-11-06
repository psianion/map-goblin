// The Rooms tools: Rectangle room and Polygon room draw a floor and its room in one gesture,
// Divide splits a room with a threshold or a wall. The floor texture strip rides with the
// drawing tools, so a room lands in the texture picked, not the layer's default.

import { RectangleHorizontal, Pentagon, Scissors } from 'lucide-react';
import { z } from 'zod';
import type { UISlice } from '@/store/types';
import { defineSetting, defineTool } from '@/editor/registry/define';
import type { DockColumnDef } from '@/editor/registry/types';
import { FloorLook } from '@/editor/families/design/LookColumn';
import { SuggestPanel } from './RoomsControls';

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

export const roomRectTool = defineTool({
  id: 'roomRect',
  label: 'Rectangle room',
  description: 'A floor and its room, dragged',
  icon: RectangleHorizontal,
  key: 'R',
  engine: ['roomRect'],
  settings: [roomWalls],
  dock: [floorColumn],
  panelExtra: SuggestPanel,
  hint: () => ({ label: 'Rectangle room', segments: [t('Drag: the floor and its walls land together · '), k('Shift'), t(' square · '), k('Esc'), t(' cancel')] }),
});

export const roomPolygonTool = defineTool({
  id: 'roomPolygon',
  label: 'Polygon room',
  description: 'A floor and its room, corner by corner',
  icon: Pentagon,
  key: 'P',
  engine: ['roomPolygon'],
  settings: [roomWalls],
  dock: [floorColumn],
  panelExtra: SuggestPanel,
  hint: () => ({ label: 'Polygon room', segments: [t('Click the corners: the floor and its walls land together · '), k('Enter'), t(' close · '), k('Esc'), t(' cancel')] }),
});

export const divideTool = defineTool({
  id: 'divide',
  label: 'Divide',
  description: 'Split a room with a threshold or a wall',
  icon: Scissors,
  // Off X and Q: the Text family's and Previous tool's.
  key: 'K',
  engine: ['divide'],
  settings: [roomDivider],
  dock: [],
  panelExtra: SuggestPanel,
  hint: () => ({ label: 'Divide', segments: [t('Drag across a floor: the ends snap to the walls · '), k('Shift'), t(' straight · '), k('Esc'), t(' cancel')] }),
});
