import {
  Crosshair,
  DoorOpen,
  Hexagon,
  Lightbulb,
  Minus,
  Mountain,
  MountainSnow,
  Pentagon,
  Square,
  Stamp,
  Type,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { DivideIcon, RoomPolygonIcon, RoomRectIcon } from './roomIcons';
import type { ToolType } from '@/store/types';
import { keyCaption } from '@/shortcuts/formatCombo';

export interface ToolEntry {
  tool: ToolType;
  label: string;
  shortcut: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}

export type DockTabId = 'floors' | 'plateaus' | 'walls' | 'rooms' | 'props' | 'lights' | 'labels' | 'assets';

export interface DockTab {
  id: DockTabId;
  label: string;
  /** The tool family this tab draws with. Assets has none: it picks what Props places. */
  tools: ToolEntry[];
}

/** Each tab picks a family of drawing tools; the layer is picked in the filmstrip. */
export const DOCK_TABS: DockTab[] = [
  {
    id: 'floors',
    label: 'Floors',
    tools: [
      { tool: 'rectangle', label: 'Rectangle', shortcut: keyCaption('tool.rectangle'), icon: Square },
      { tool: 'polygon', label: 'Polygon', shortcut: keyCaption('tool.polygon'), icon: Pentagon },
      { tool: 'regularPolygon', label: 'Regular polygon', shortcut: keyCaption('tool.regularPolygon'), icon: Hexagon },
      { tool: 'terrain', label: 'Terrain', shortcut: keyCaption('tool.terrain'), icon: Mountain },
    ],
  },
  {
    id: 'plateaus',
    label: 'Plateaus',
    tools: [{ tool: 'plateau', label: 'Plateau', shortcut: keyCaption('tool.plateau'), icon: MountainSnow }],
  },
  {
    id: 'walls',
    label: 'Walls',
    tools: [
      { tool: 'wall', label: 'Wall', shortcut: keyCaption('tool.wall'), icon: Minus },
      { tool: 'door', label: 'Door', shortcut: keyCaption('tool.door'), icon: DoorOpen },
    ],
  },
  {
    id: 'rooms',
    label: 'Rooms',
    tools: [
      { tool: 'roomRect', label: 'Rectangle room', shortcut: keyCaption('tool.roomRect'), icon: RoomRectIcon },
      { tool: 'roomPolygon', label: 'Polygon room', shortcut: keyCaption('tool.roomPolygon'), icon: RoomPolygonIcon },
      { tool: 'divide', label: 'Divide', shortcut: keyCaption('tool.divide'), icon: DivideIcon },
    ],
  },
  {
    id: 'props',
    label: 'Props',
    // One tool, two modes (Stamp, Scatter) sharing the library and settings.
    tools: [{ tool: 'scatterBrush', label: 'Props', shortcut: keyCaption('tool.scatterBrush'), icon: Stamp }],
  },
  {
    id: 'lights',
    label: 'Lights',
    tools: [{ tool: 'light', label: 'Light', shortcut: keyCaption('tool.light'), icon: Lightbulb }],
  },
  {
    id: 'labels',
    label: 'Labels',
    tools: [
      { tool: 'text', label: 'Label', shortcut: keyCaption('tool.text'), icon: Type },
      { tool: 'zone', label: 'Zone', shortcut: keyCaption('tool.zone'), icon: Crosshair },
    ],
  },
  { id: 'assets', label: 'Assets', tools: [] },
];

/** The tab whose family holds this tool, or null for tools the rail owns. */
export function tabForTool(tool: ToolType): DockTabId | null {
  return DOCK_TABS.find((t) => t.tools.some((e) => e.tool === tool))?.id ?? null;
}

/** Tools that lay down floor, so a floor texture picked while one is in hand goes on the floors. */
export const FLOOR_TOOLS: ToolType[] = ['rectangle', 'polygon', 'regularPolygon', 'roomRect', 'roomPolygon'];

/** Tools that draw with the layer's style, so the dock offers the style presets for them. */
export const STYLE_TOOLS: ToolType[] = ['rectangle', 'polygon', 'regularPolygon', 'wall'];

/** Whether the tool in hand has a row of presets in the dock. */
export function hasSwatches(tool: ToolType, tab: DockTabId): boolean {
  // The label style tiles are the Label tool's; the Zone tool on the same tab has none.
  return tool === 'terrain' || tool === 'scatterBrush' || STYLE_TOOLS.includes(tool) || tab === 'lights' || tool === 'text';
}

const COLLAPSED_KEY = 'v2-dock-collapsed';
const TAB_KEY = 'v2-dock-tab';

export function loadDockCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveDockCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    /* private mode: the choice lasts the session */
  }
}

export function loadDockTab(): DockTabId {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    return DOCK_TABS.some((t) => t.id === saved) ? (saved as DockTabId) : 'floors';
  } catch {
    return 'floors';
  }
}

export function saveDockTab(tab: DockTabId): void {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    /* private mode */
  }
}
