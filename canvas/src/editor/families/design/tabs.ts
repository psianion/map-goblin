// The dock's Set up tabs: the looks a drawing uses beyond the tool in hand's own (the wall
// set and width, the door style, the floor texture), set from the dock without changing
// tool. Each is other tools' dock settings and columns, so it lives apart from them all and
// the families attach the tabs as they register (`withTabs`).

import type { DockTab, ToolDef } from '@/editor/registry/types';
import { floorLookColumn } from './floor';
import { wallCornerStyle, wallLookColumn, wallWidth } from './wall';
import { doorStyle, doorWidth } from './door';

export const WALLS_TAB: DockTab = { id: 'walls', label: 'Walls', settings: [wallWidth, wallCornerStyle], columns: [wallLookColumn] };
export const DOORS_TAB: DockTab = { id: 'doors', label: 'Doors', settings: [doorStyle, doorWidth] };
export const FLOOR_TAB: DockTab = { id: 'floor', label: 'Floor', columns: [floorLookColumn] };

/** `tool` with its Set up tabs. */
export function withTabs(tool: ToolDef, tabs: readonly DockTab[]): ToolDef {
  return { ...tool, tabs };
}
