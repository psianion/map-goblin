import type { Role } from '@dnd/core/src/shared/protocol';
import type { LucideIcon } from '@dnd/ui/icons';

export type RailToolId = 'select' | 'ping' | 'measure' | 'template' | 'draw' | 'pin';

export interface RailToolDef {
  id: RailToolId;
  title: string;
  icon: LucideIcon;
  /** Single uppercase letter, shown in the button's corner and bound by `shell/hotkeys.ts`. */
  key: string;
  roles: readonly Role[];
  onArm(): void;
  onDisarm(): void;
}

const RAIL_ORDER: readonly RailToolId[] = ['select', 'ping', 'measure', 'template', 'draw', 'pin'];
const tools = new Map<RailToolId, RailToolDef>();

/** Register a rail tool; the same id again replaces it. */
export function registerRailTool(def: RailToolDef): void {
  tools.set(def.id, def);
}

/** The rail for a role, top to bottom. No role yet: nothing. */
export function railToolsFor(role: Role | undefined): RailToolDef[] {
  if (!role) return [];
  return RAIL_ORDER.flatMap((id) => {
    const def = tools.get(id);
    return def && def.roles.includes(role) ? [def] : [];
  });
}

export function railTool(id: RailToolId): RailToolDef | undefined {
  return tools.get(id);
}
