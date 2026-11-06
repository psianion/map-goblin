// The Label tool: Size, Colour and the style tiles in the dock. A click places a label in
// the picked style; Room name, Number pin and Door tag follow the room or door they land on.

import { Type } from 'lucide-react';
import { z } from 'zod';
import { defineSetting, defineTool } from '@/editor/registry/define';
import type { DockColumnDef } from '@/editor/registry/types';
import { LabelColourSwatch, SizeStepper, StyleTilesColumn } from './LabelControls';
import { LABEL_SIZE_RANGE } from './labelModel';
import { SelectionPanel } from '@/editor/families/select/SelectionPanel';

export const labelSize = defineSetting<number>({
  id: 'label.size',
  label: 'Size',
  schema: z.number().min(LABEL_SIZE_RANGE.min).max(LABEL_SIZE_RANGE.max),
  default: 0.8,
  home: 'dock',
  control: 'custom',
  section: 'Size',
  range: { ...LABEL_SIZE_RANGE, unit: 'sq' },
  render: SizeStepper,
  path: 'label.fontSize',
});

/** Null takes the layer's ink, so a label matches the lines it sits beside. */
export const labelColour = defineSetting<string | null>({
  id: 'label.colour',
  label: 'Colour',
  schema: z.string().regex(/^#[0-9a-f]{6}$/i).nullable(),
  default: null,
  home: 'dock',
  control: 'custom',
  section: 'Colour',
  render: LabelColourSwatch,
  path: 'label.color',
});

const stylesColumn: DockColumnDef = { id: 'label.styles', caption: 'Styles', render: StyleTilesColumn };

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

export const labelTool = defineTool({
  id: 'label',
  label: 'Label',
  description: 'Room names, door tags, notes and numbers',
  icon: Type,
  // Not N: that is Node mode's in every family.
  key: 'A',
  engine: ['text'],
  settings: [labelSize, labelColour],
  dock: [stylesColumn],
  // The label just placed is picked; its card takes the typing while the tool stays in hand.
  selectionPanel: SelectionPanel,
  hint: () => ({
    label: 'Label',
    segments: [t('Click to place, then type · '), k('Enter'), t(' done · '), k('Esc'), t(' takes a new label back')],
  }),
});
