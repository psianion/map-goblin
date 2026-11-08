import type { ComponentType } from 'react';
import type { LucideIcon } from '@dnd/ui/icons';

export type DockTabId = 'fog' | 'map' | 'tokens' | 'encounter' | 'story' | 'world' | 'scenes' | 'dice';

/** The DM dock's tabs, in tab-row order; keys 1 to 8 follow it. */
export const DOCK_TAB_ORDER: readonly DockTabId[] = ['fog', 'map', 'tokens', 'encounter', 'story', 'world', 'scenes', 'dice'];

export interface DockTabDef {
  id: DockTabId;
  /** Tab label. */
  title: string;
  icon: LucideIcon;
  key: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
  /** Left part of the body: tools and settings. */
  Body: ComponentType;
  /** Right part of the body: pickable things (rooms, doors, tokens, scenes, handouts). */
  Strip?: ComponentType;
  /** Context text at the right end of the tab row while this tab is open ("on Web Gallery"). */
  context?: () => string | null;
  /** Overlay or sync loop the tab needs while the role is DM, open or not; returns the teardown. */
  onMap?: () => () => void;
}

const tabs = new Map<DockTabId, DockTabDef>();
let version = 0;
const listeners = new Set<() => void>();

/** Register a tab; the same id again replaces it (a stub swapped for its real body, HMR). */
export function registerDockTab(def: DockTabDef): void {
  tabs.set(def.id, def);
  version += 1;
  for (const l of listeners) l();
}

/** Every registered tab, in tab-row order. */
export function dockTabs(): DockTabDef[] {
  return DOCK_TAB_ORDER.flatMap((id) => {
    const def = tabs.get(id);
    return def ? [def] : [];
  });
}

export function dockTab(id: DockTabId): DockTabDef | undefined {
  return tabs.get(id);
}

/** Change counter for `useSyncExternalStore` readers. */
export const dockRegistryVersion = (): number => version;

export function subscribeDockRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
