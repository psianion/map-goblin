// The tools above the families on the rail. Select grows its panel in the Select family
// (step 7); these defs give the rail its keys now so the key rules see every letter.

import { Hand, MousePointer2, Ruler } from 'lucide-react';
import { defineTool } from './define';

export const selectTool = defineTool({
  id: 'select',
  label: 'Select',
  description: 'Pick and edit what is on the map',
  icon: MousePointer2,
  key: 'V',
  settings: [],
  dock: [],
  hint: () => ({ label: 'Select', segments: [{ text: 'Click to pick · drag to box-select' }] }),
});

export const panTool = defineTool({
  id: 'pan',
  label: 'Pan',
  description: 'Move the view',
  icon: Hand,
  key: 'G',
  settings: [],
  dock: [],
  hint: () => ({ label: 'Pan', segments: [{ text: 'Drag to move the view' }] }),
});

export const measureTool = defineTool({
  id: 'ruler',
  label: 'Measure',
  description: 'Measure a distance',
  icon: Ruler,
  key: 'M',
  settings: [],
  dock: [],
  hint: () => ({ label: 'Measure', segments: [{ text: 'Drag to measure' }] }),
});

export const RAIL_TOOLS = [selectTool, panTool, measureTool] as const;
