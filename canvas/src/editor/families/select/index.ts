// The Select tool (plan 6.6, frames C and D): its panel is the Pick only chips, how picking
// works and Previous tool; with something picked the panel is the card for it. Select sits
// on the rail (registry/rail.ts), not in a family.

import { MousePointer2 } from 'lucide-react';
import { defineSetting, defineTool } from '@/editor/registry/define';
import { selectHint } from './hint';
import { pickOnlyBinding, pickOnlySchema, type PickChip } from './pickOnly';
import { PickOnlyChips, SelectGuide } from './SelectPanel';
import { SelectionPanel } from './SelectionPanel';

export const pickOnly = defineSetting<PickChip[]>({
  id: 'select.pickOnly',
  label: 'Pick only',
  schema: pickOnlySchema,
  default: [],
  home: 'panel',
  control: 'custom',
  section: 'Pick only',
  render: PickOnlyChips,
  persist: false,
  bind: pickOnlyBinding,
});

export const selectTool = defineTool({
  id: 'select',
  label: 'Select',
  description: 'Pick and edit what is on the map',
  icon: MousePointer2,
  key: 'V',
  engine: ['select'],
  settings: [pickOnly],
  dock: [],
  hint: selectHint,
  panelExtra: SelectGuide,
  selectionPanel: SelectionPanel,
});

export { SELECTION_VERBS, moreVerb } from './verbs';
