// The tools above the families on the rail: Select (its family is families/select), Pan
// and Measure.

import { Hand, Ruler } from 'lucide-react';
import { selectTool } from '@/editor/families/select';
import { defineTool } from './define';

export { selectTool };

export const panTool = defineTool({
  id: 'pan',
  label: 'Pan',
  description: 'Move the view',
  icon: Hand,
  key: 'G',
  engine: ['pan'],
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
  engine: ['ruler'],
  settings: [],
  dock: [],
  hint: () => ({ label: 'Measure', segments: [{ text: 'Drag to measure' }] }),
});

export const RAIL_TOOLS = [selectTool, panTool, measureTool] as const;
