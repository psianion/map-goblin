// The Door tool: a click on a wall hangs a door there; on open floor it stands free at the
// dock's angle. Style, width and angle change per door, so they sit in the dock.

import { DoorOpen } from 'lucide-react';
import { z } from 'zod';
import type { DoorStyle } from '@/store/types';
import { doorStyleLabel, minDoorWidth, PLACEABLE_DOOR_STYLES } from '@dnd/core/src/engine/tools/DoorTool';
import { defineSetting, defineTool } from '@/editor/registry/define';
import { DOOR_WIDTH_MAX, DOOR_WIDTH_STEP } from '@/v2/editor/selectionModel';
import { DoorAngleControl } from './controls';

export const doorStyle = defineSetting<DoorStyle>({
  id: 'door.style',
  label: 'Style',
  schema: z.enum(PLACEABLE_DOOR_STYLES as [DoorStyle, ...DoorStyle[]]),
  default: 'single',
  home: 'dock',
  control: 'seg',
  section: 'Style',
  options: PLACEABLE_DOOR_STYLES.map((value) => ({ value, label: doorStyleLabel(value) })),
  bind: {
    read: (s) => s.tools.settings.doorStyle ?? 'single',
    // A wider style takes the width up with it.
    write: (store, style) => {
      const st = store.getState();
      st.updateToolSettings({ doorStyle: style, doorWidth: Math.max(st.tools.settings.doorWidth, minDoorWidth(style)) });
    },
  },
});

export const doorWidth = defineSetting<number>({
  id: 'door.width',
  label: 'Width',
  schema: z.number().min(1).max(DOOR_WIDTH_MAX),
  default: 1,
  home: 'dock',
  control: 'stepper',
  section: 'Width',
  range: { min: 1, max: DOOR_WIDTH_MAX, step: DOOR_WIDTH_STEP, unit: 'sq' },
  bind: {
    read: (s) => s.tools.settings.doorWidth,
    // Never narrower than the style allows: a double needs room for two leaves.
    write: (store, width) => {
      const st = store.getState();
      st.updateToolSettings({ doorWidth: Math.max(width, minDoorWidth(st.tools.settings.doorStyle)) });
    },
  },
});

/** The angle of a door placed on open floor, degrees; a door on a wall takes the wall's. */
export const doorAngle = defineSetting<number>({
  id: 'door.angle',
  label: 'Angle',
  schema: z.number().int().min(0).max(165).multipleOf(15),
  default: 0,
  home: 'dock',
  control: 'custom',
  section: 'Angle',
  range: { min: 0, max: 165, step: 15, unit: '°' },
  render: DoorAngleControl,
  path: 'doorAngle',
});

export const doorSecret = defineSetting<boolean>({
  id: 'door.secret',
  label: 'Secret',
  schema: z.boolean(),
  default: false,
  home: 'panel',
  control: 'switch',
  section: 'New doors',
  path: 'doorSecret',
});

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

export const doorTool = defineTool({
  id: 'door',
  label: 'Door',
  description: 'Single, double, portcullis, archway',
  icon: DoorOpen,
  key: 'D',
  engine: ['door'],
  settings: [doorStyle, doorWidth, doorAngle, doorSecret],
  dock: [],
  hint: () => ({
    label: 'Door',
    segments: [
      t('Click a wall to hang a door · on open floor it stands free · double-click a door opens or shuts it · '),
      k('Esc'),
      t(' cancel'),
    ],
  }),
});
