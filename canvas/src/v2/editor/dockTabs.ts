import {
  Crosshair,
  DoorOpen,
  Droplets,
  Hexagon,
  Lightbulb,
  Minus,
  Mountain,
  Pen,
  Pentagon,
  Square,
  Stamp,
  Type,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { DivideIcon, RoomPolygonIcon, RoomRectIcon } from './roomIcons';
import type { ToolType } from '@/store/types';

export interface ToolEntry {
  tool: ToolType;
  label: string;
  shortcut: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}

export type DockTabId = 'floors' | 'walls' | 'rooms' | 'props' | 'lights' | 'labels' | 'assets';

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
      { tool: 'rectangle', label: 'Rectangle', shortcut: 'R', icon: Square },
      { tool: 'polygon', label: 'Polygon', shortcut: 'P', icon: Pentagon },
      { tool: 'regularPolygon', label: 'Regular polygon', shortcut: 'H', icon: Hexagon },
      { tool: 'path', label: 'Path', shortcut: 'A', icon: Pen },
      { tool: 'terrain', label: 'Terrain', shortcut: 'T', icon: Mountain },
      { tool: 'water', label: 'Water', shortcut: 'U', icon: Droplets },
    ],
  },
  {
    id: 'walls',
    label: 'Walls',
    tools: [
      { tool: 'wall', label: 'Wall', shortcut: 'W', icon: Minus },
      { tool: 'door', label: 'Door', shortcut: 'D', icon: DoorOpen },
    ],
  },
  {
    id: 'rooms',
    label: 'Rooms',
    tools: [
      { tool: 'roomRect', label: 'Rectangle room', shortcut: 'R', icon: RoomRectIcon },
      { tool: 'roomPolygon', label: 'Polygon room', shortcut: 'P', icon: RoomPolygonIcon },
      { tool: 'divide', label: 'Divide', shortcut: 'X', icon: DivideIcon },
    ],
  },
  {
    id: 'props',
    label: 'Props',
    // One tool, two modes (Stamp, Scatter) sharing the library and settings.
    tools: [{ tool: 'scatterBrush', label: 'Props', shortcut: 'B', icon: Stamp }],
  },
  {
    id: 'lights',
    label: 'Lights',
    tools: [{ tool: 'light', label: 'Light', shortcut: 'L', icon: Lightbulb }],
  },
  {
    id: 'labels',
    label: 'Labels',
    tools: [
      { tool: 'text', label: 'Label', shortcut: 'N', icon: Type },
      { tool: 'zone', label: 'Zone', shortcut: 'Z', icon: Crosshair },
    ],
  },
  { id: 'assets', label: 'Assets', tools: [] },
];

/** The tab whose family holds this tool, or null for tools the rail owns. */
export function tabForTool(tool: ToolType): DockTabId | null {
  return DOCK_TABS.find((t) => t.tools.some((e) => e.tool === tool))?.id ?? null;
}

/** The room tools, by the key that picks each while the Rooms tab is up (X picks Divide anywhere). */
export const ROOM_TOOL_KEYS: Record<string, ToolType> = { r: 'roomRect', p: 'roomPolygon', x: 'divide' };

/** Tools that lay down floor, so a floor texture picked while one is in hand goes on the floors. */
export const FLOOR_TOOLS: ToolType[] = ['rectangle', 'polygon', 'regularPolygon', 'path', 'roomRect', 'roomPolygon'];

/** Tools that draw with the layer's style, so the dock offers the style presets for them. */
export const STYLE_TOOLS: ToolType[] = ['rectangle', 'polygon', 'regularPolygon', 'path', 'wall'];

/** Whether the tool in hand has a row of presets in the dock. */
export function hasSwatches(tool: ToolType, tab: DockTabId): boolean {
  return tool === 'terrain' || tool === 'scatterBrush' || STYLE_TOOLS.includes(tool) || tab === 'lights' || tab === 'labels';
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
