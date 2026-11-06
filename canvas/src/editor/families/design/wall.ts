// The Wall tool: chained walls, their type and width on the fly, curve and node mode.

import { BrickWall } from 'lucide-react';
import { z } from 'zod';
import { GROUP_WALL_TYPE, wallTypeGroup, type WallTypeGroup } from '@dnd/core/src/shared/wallLook';
import { defineSetting, defineTool } from '@/editor/registry/define';
import { editCurve, editNodeMode, gridSnap, gridSnapStep } from '@/editor/registry/shared';
import { WALL_TYPE_CHOICES } from '@/editor/models/selectionModel';
import { WallWidthControl } from './controls';
import { wallLookValue, setWallLook } from './wallLook';
import { WallLook } from './LookColumn';
import type { DockColumnDef } from '@/editor/registry/types';

/** Solid, Window or Open. Picking the group the stored type already acts as keeps that type. */
export const wallType = defineSetting<WallTypeGroup>({
  id: 'wall.type',
  label: 'Type',
  schema: z.enum(['solid', 'window', 'open']),
  default: 'solid',
  home: 'dock',
  control: 'seg',
  section: 'Type',
  options: WALL_TYPE_CHOICES.map(({ value, label }) => ({ value, label })),
  bind: {
    read: (s) => wallTypeGroup(s.tools.settings.wallType),
    write: (store, group) => {
      const st = store.getState();
      if (wallTypeGroup(st.tools.settings.wallType) !== group) st.updateToolSettings({ wallType: GROUP_WALL_TYPE[group] });
    },
  },
});

export const WALL_WIDTH_RANGE = { min: 0.05, max: 1, step: 0.05 } as const;

/**
 * Thickness of the walls, in cells: the picked room's when one is picked, else the layer's
 * (the walls already on it follow). Hidden for a cave kit, whose rock has no width to set.
 * One label, Width, everywhere; the floor tools no longer carry it.
 */
export const wallWidth = defineSetting<number>({
  id: 'wall.width',
  label: 'Width',
  schema: z.number().min(WALL_WIDTH_RANGE.min).max(WALL_WIDTH_RANGE.max),
  default: 0.5,
  home: 'dock',
  control: 'custom',
  section: 'Width',
  range: WALL_WIDTH_RANGE,
  render: WallWidthControl,
  persist: false,
  bind: {
    read: (s) => wallLookValue(s, 'wallWidth') ?? 0.5,
    write: (store, width) => setWallLook(store.getState(), { wallWidth: width }, 'Wall width'),
  },
});

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

/** Tint, the style presets and the wall-set strip. */
const wallLookColumn: DockColumnDef = { id: 'wall.look', caption: 'Look', render: WallLook };

export const wallTool = defineTool({
  id: 'wall',
  label: 'Wall',
  description: 'Chained walls, solid, window or open',
  icon: BrickWall,
  key: 'W',
  engine: ['wall'],
  settings: [wallType, wallWidth, editCurve, editNodeMode, gridSnap, gridSnapStep],
  dock: [wallLookColumn],
  hint: (s) => ({
    label: 'Wall',
    segments: [
      t('Click points · '),
      k('Enter'),
      t(' or double-click finishes · '),
      k('Shift'),
      t(' 15° steps · '),
      k('C'),
      t(s.tools.curveMode ? ' straight · ' : ' curve · '),
      k('Esc'),
      t(' cancel'),
    ],
  }),
});
