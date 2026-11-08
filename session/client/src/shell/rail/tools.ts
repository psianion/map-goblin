import { Crosshair, MapPin, MousePointer2, Pencil, Radio, Ruler } from '@dnd/ui/icons';
import { useActiveTool, type ToolId } from '../../session/tools';
import { registerRailTool, railTool, type RailToolId } from './registry';

const ALL = ['dm', 'player'] as const;
const DM = ['dm'] as const;

const arm = (tool: ToolId | null) => () => useActiveTool.getState().setActiveTool(tool);
const disarm = () => useActiveTool.getState().setActiveTool(null);

// One registration per tool. Select is "no tool": tokens, doors and the camera take the click.
registerRailTool({ id: 'select', title: 'Select', icon: MousePointer2, key: 'V', roles: ALL, onArm: arm(null), onDisarm: () => {} });
registerRailTool({ id: 'ping', title: 'Ping', icon: Radio, key: 'P', roles: ALL, onArm: arm('ping'), onDisarm: disarm });
registerRailTool({ id: 'measure', title: 'Measure', icon: Ruler, key: 'M', roles: ALL, onArm: arm('measure'), onDisarm: disarm });
registerRailTool({ id: 'template', title: 'Template', icon: Crosshair, key: 'T', roles: DM, onArm: arm('template'), onDisarm: disarm });
registerRailTool({ id: 'draw', title: 'Draw', icon: Pencil, key: 'D', roles: DM, onArm: arm('draw'), onDisarm: disarm });
registerRailTool({ id: 'pin', title: 'Pin', icon: MapPin, key: 'I', roles: DM, onArm: arm('pin'), onDisarm: disarm });

const RAIL_IDS: readonly string[] = ['ping', 'measure', 'template', 'draw', 'pin'];

/** The rail tool in hand: Select while no tool is, none while a dock tool (fog) is. */
export function activeRailTool(tool: ToolId | null): RailToolId | null {
  if (tool === null) return 'select';
  return RAIL_IDS.includes(tool) ? (tool as RailToolId) : null;
}

/** Pick a rail tool; picking the one in hand again puts it down (back to Select). */
export function pickRailTool(id: RailToolId): void {
  const current = activeRailTool(useActiveTool.getState().activeTool);
  const currentDef = current ? railTool(current) : undefined;
  if (current === id && id !== 'select') {
    currentDef?.onDisarm();
    return;
  }
  currentDef?.onDisarm();
  railTool(id)?.onArm();
}
