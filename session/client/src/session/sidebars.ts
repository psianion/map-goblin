import type { ComponentType } from 'react';
import type { Role } from '@dnd/core/src/shared/protocol';

/**
 * table-shell-redesign — the left sidebar's content seam. Mirrors `panels.ts`'s
 * `registerPanel`: a content module calls `registerSidebar` at import time (the same
 * side-effect-import line `pages/GameTable.tsx` already adds per module, D8) and the shell
 * never imports the DM's Prep body or the player's Journal body directly.
 *
 * One def per role, not a list — the sidebar shows exactly one body at a time, unlike the
 * rail's many panels, so there is nothing to sort or filter here.
 */
export interface SidebarDef {
  /** Header title, e.g. "Prep" / "Journal". */
  title: string;
  component: ComponentType;
  /** Live text/count for the edge toggle's badge while the sidebar is closed — a dot/number
   *  the content layer pulses on new prep or a new journal card. Read only while closed. */
  badge?: () => string | number | null;
}

const sidebars = new Map<Role, SidebarDef>();

export function registerSidebar(role: Role, def: SidebarDef): void {
  sidebars.set(role, def);
}

/** Not a real hook (nothing here subscribes, same note as `panelsForRole`) — registration
 *  happens at import time, before `GameTable` ever renders. */
export function sidebarForRole(role: Role | undefined): SidebarDef | undefined {
  return role ? sidebars.get(role) : undefined;
}

export const useSidebarDef = sidebarForRole;
