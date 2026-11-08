// The Path tool: click the nodes of a line and the pack's path units are laid along it, one
// after another at their own length, never a stretched strip. Width, Smoothness, Curve, Node
// mode and the pieces change on the fly, so they sit in the dock; the transitions at each
// end, Snap and Block light are set up in the panel. A placed path is picked like any object
// and its card edits the same fields after placing.

import { Route } from 'lucide-react';
import { z } from 'zod';
import { PATH_RANGES } from '@/store/slices/tools';
import { defineSetting, defineTool } from '@/editor/registry/define';
import type { DockColumnDef } from '@/editor/registry/types';
import { editCurve, editNodeMode, gridSnap } from '@/editor/registry/shared';
import { IntensityControl } from './TerrainControls';
import { PiecesColumn } from './PiecesColumn';

const { width, smoothness } = PATH_RANGES;

export const TRANSITION_IN_OPTIONS = [
  { value: 'hard' as const, label: 'Hard' },
  { value: 'fade' as const, label: 'Fade' },
  { value: 'grow' as const, label: 'Grow' },
];

export const TRANSITION_OUT_OPTIONS = [
  { value: 'hard' as const, label: 'Hard' },
  { value: 'fade' as const, label: 'Fade' },
  { value: 'shrink' as const, label: 'Shrink' },
];

export const pathWidth = defineSetting<number>({
  id: 'path.width',
  label: 'Width',
  schema: z.number().min(width.min).max(width.max),
  default: 1,
  home: 'dock',
  control: 'stepper',
  section: 'Width',
  range: { ...width, unit: 'sq' },
  path: 'path.width',
});

/** How round the line's corners are: 0 sharp, 100% round. */
export const pathSmoothness = defineSetting<number>({
  id: 'path.smoothness',
  label: 'Smoothness',
  schema: z.number().min(smoothness.min).max(smoothness.max),
  default: 0.6,
  home: 'dock',
  control: 'custom',
  section: 'Smoothness',
  range: { ...smoothness, unit: '%' },
  render: IntensityControl,
  path: 'path.smoothness',
});

export const pathTransitionIn = defineSetting<'hard' | 'fade' | 'grow'>({
  id: 'path.transitionIn',
  label: 'Transition in',
  schema: z.enum(['hard', 'fade', 'grow']),
  default: 'fade',
  home: 'panel',
  control: 'seg',
  section: 'Ends',
  options: TRANSITION_IN_OPTIONS,
  path: 'path.transitionIn',
});

export const pathTransitionOut = defineSetting<'hard' | 'fade' | 'shrink'>({
  id: 'path.transitionOut',
  label: 'Transition out',
  schema: z.enum(['hard', 'fade', 'shrink']),
  default: 'hard',
  home: 'panel',
  control: 'seg',
  section: 'Ends',
  options: TRANSITION_OUT_OPTIONS,
  path: 'path.transitionOut',
});

export const pathBlockLight = defineSetting<boolean>({
  id: 'path.blocksLight',
  label: 'Block light',
  schema: z.boolean(),
  default: false,
  home: 'panel',
  control: 'switch',
  section: 'Placement',
  path: 'path.blocksLight',
});

const piecesColumn: DockColumnDef = { id: 'path.pieces', caption: 'Pieces', render: PiecesColumn };

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

export const pathTool = defineTool({
  id: 'path',
  label: 'Path',
  description: 'Lay path pieces along a line of points',
  icon: Route,
  key: 'P',
  engine: ['path'],
  settings: [pathWidth, pathSmoothness, editCurve, editNodeMode, pathTransitionIn, pathTransitionOut, gridSnap, pathBlockLight],
  dock: [piecesColumn],
  hint: () => ({
    label: 'Path',
    segments: [t('Click points · '), k('Enter'), t(' end · '), k('Shift'), t(' bend')],
  }),
});
