import type { ComponentType } from 'react';
import type { Role } from '@dnd/core/src/shared/protocol';

/**
 * D8 — the client plug-in point. A module folder owns its own UI: it calls
 * `registerPanel` at import time and GameTable's sidebar picks it up. Adding a
 * module never edits the shell again (D2's third-party test), which is the whole
 * point of this file existing instead of another `<SomePanel />` in the aside.
 */
export interface PanelDef {
  /** Stable id; re-registering the same id replaces (HMR, and no duplicates). */
  id: string;
  /** Rendered as the panel heading. Omit for a chrome-less panel. */
  title?: string;
  /** Roles that see this panel. */
  roles: readonly Role[];
  /** Ascending. Session controls 0, token library 10, log 50. */
  order: number;
  component: ComponentType;
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

/** Panels this role may see, already ordered. `undefined` role ⇒ nothing yet. */
export function usePanels(role: Role | undefined): readonly PanelDef[] {
  if (!role) return [];
  return panels.filter((p) => p.roles.includes(role));
}
