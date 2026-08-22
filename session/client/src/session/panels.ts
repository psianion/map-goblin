import type { ComponentType } from 'react';
import type { Role } from '@dnd/core/src/shared/protocol';
import type { IconName } from '../shell/icons';

/**
 * D8 — the client plug-in point. A module folder owns its own UI: it calls
 * `registerPanel` at import time and the rail/popover shell picks it up. Adding a
 * module never edits the shell again (D2's third-party test), which is the whole
 * point of this file existing instead of another `<SomePanel />` in a sidebar.
 */
export interface PanelDef {
  /** Stable id; re-registering the same id replaces (HMR, and no duplicates). */
  id: string;
  /** Popover header. A function reads live state (e.g. the active scene's name); a
   *  string is the common case. Omit to fall back to `id`. */
  title?: string | (() => string);
  /** Roles that see this panel. */
  roles: readonly Role[];
  /** Ascending. Session controls 0, token library 10, log 50. */
  order: number;
  component: ComponentType;
  icon: IconName;
  /** Single uppercase letter that opens this panel from the keyboard; '' for none. */
  key: string;
  /** Rail grouping: play items, then prep (divider between), then log (pinned bottom). */
  group: 'play' | 'prep' | 'log';
  /** Optional live line under the popover title, e.g. "Round 1 · 4 combatants". */
  subtitle?: () => string | null;
  /** Popover width; defaults to 320. A function for a panel whose ceiling widens past a row
   *  count (read live, the same way `subtitle`/`badge` are). */
  width?: 320 | 360 | (() => 320 | 360);
  /** false hides this panel from the rail — still openable via `openPanelById`. Default true. */
  rail?: boolean;
  /** Live text for the rail item's corner badge, e.g. "R1" or an unread count. */
  badge?: () => string | null;
  /** Rendered in the popover's footer strip, if present. */
  footer?: ComponentType;
  /** Rendered in the popover header, right of the title, left of the close button. */
  headerActions?: ComponentType;
}

/** Convenience for the common "everyone sees it" case. */
export const ALL_ROLES: readonly Role[] = ['dm', 'player'];

// ponytail: a module-level array, not a context/provider. Registration happens
// once at import time and never during render, so there is nothing to subscribe
// to — a provider would be ceremony around a constant.
const panels: PanelDef[] = [];

export function registerPanel(panel: PanelDef): void {
  const existing = panels.findIndex((p) => p.id === panel.id);
  if (existing >= 0) panels[existing] = panel;
  else panels.push(panel);
  // `id` breaks ties so the order is deterministic regardless of import order.
  panels.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Panels this role may see, already ordered. `undefined` role ⇒ nothing yet. Not a real
 *  hook (nothing here subscribes) — safe to call from a plain function too, but named
 *  `use*` for the components that read it. `hotkeys.ts` uses {@link panelsForRole} instead,
 *  since a `use`-named call from a non-component function trips the hooks lint rule. */
function panelsForRole(role: Role | undefined): readonly PanelDef[] {
  if (!role) return [];
  return panels.filter((p) => p.roles.includes(role));
}
export { panelsForRole };

export const usePanels = panelsForRole;

/** The rail's own subset — everything but the panels opened only programmatically. */
export const useRailPanels = (role: Role | undefined): readonly PanelDef[] =>
  panelsForRole(role).filter((p) => p.rail !== false);

/** One panel by id, regardless of role — Popover looks up whatever `shellStore` has open. */
export const usePanel = (id: string): PanelDef | undefined => panels.find((p) => p.id === id);

/** `PanelDef.title` resolved to today's string. */
export const resolvePanelTitle = (def: PanelDef): string =>
  (typeof def.title === 'function' ? def.title() : def.title) ?? def.id;
