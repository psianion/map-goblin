// The Door tool: a click on a wall hangs a door there; on open floor, or anywhere with the
// panel's Freestanding on, it stands free at the dock's angle. Style, width and angle change
// per door, so they sit in the dock.

import { DoorOpen } from 'lucide-react';
import { z } from 'zod';
import { DOOR_ANGLE_STEP, minDoorWidth, PLACEABLE_DOOR_STYLES } from '@dnd/core/src/engine/tools/DoorTool';
import { choiceStyle, doorStyleChoice, doorStyleChoiceLabel, type DoorStyleChoice } from './doorModel';
import { defineSetting, defineTool } from '@/editor/registry/define';
import { DOOR_WIDTH_MAX, DOOR_WIDTH_STEP } from '@/editor/models/selectionModel';
import { DoorAngleControl } from './controls';
import { DoorKitColumn } from './DoorFields';

const STYLE_CHOICES: DoorStyleChoice[] = [...PLACEABLE_DOOR_STYLES, 'opening'];

export const doorStyle = defineSetting<DoorStyleChoice>({
  id: 'door.style',
  label: 'Style',
  schema: z.enum(STYLE_CHOICES as [DoorStyleChoice, ...DoorStyleChoice[]]),
  default: 'single',
  home: 'dock',
  control: 'seg',
  section: 'Style',
  options: STYLE_CHOICES.map((value) => ({ value, label: doorStyleChoiceLabel(value) })),
  bind: {
    read: (s) => doorStyleChoice(s.tools.settings.doorStyle ?? 'single', s.tools.settings.doorBare),
    // A wider style takes the width up with it. Opening is an archway placed bare.
    write: (store, choice) => {
      const st = store.getState();
      const style = choiceStyle(choice);
      st.updateToolSettings({
        doorStyle: style,
        doorBare: choice === 'opening',
        doorWidth: Math.max(st.tools.settings.doorWidth, minDoorWidth(style)),
      });
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
  schema: z.number().int().min(0).max(180 - DOOR_ANGLE_STEP).multipleOf(DOOR_ANGLE_STEP),
  default: 0,
  home: 'dock',
  control: 'custom',
  section: 'Angle',
  range: { min: 0, max: 180 - DOOR_ANGLE_STEP, step: DOOR_ANGLE_STEP, unit: '°' },
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

/** On, every click places a door free on a piece of its own, never on a wall. */
export const doorFreestanding = defineSetting<boolean>({
  id: 'door.freestanding',
  label: 'Freestanding',
  schema: z.boolean(),
  default: false,
  home: 'panel',
  control: 'switch',
  section: 'New doors',
  bind: {
    read: (s) => s.tools.settings.doorFreestanding ?? false,
    write: (store, on) => store.getState().updateToolSettings({ doorFreestanding: on }),
  },
});

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

export const doorTool = defineTool({
  id: 'door',
  label: 'Door',
  description: 'Single, double, portcullis, archway',
  icon: DoorOpen,
  // Not D: that is the Design family's own key.
  key: 'S',
  engine: ['door'],
  settings: [doorStyle, doorWidth, doorAngle, doorSecret, doorFreestanding],
  dock: [{ id: 'door.kit', caption: 'Kit', render: DoorKitColumn }],
  hint: (s) => ({
    label: 'Door',
    segments: [
      t(
        s.tools.settings.doorFreestanding
          ? 'Click anywhere to stand a door free · double-click a door opens or shuts it · '
          : 'Click a wall to hang a door · between two walls it spans the gap · on open floor it stands free · double-click a door opens or shuts it · ',
      ),
      k('Esc'),
      t(' cancel'),
    ],
  }),
});
