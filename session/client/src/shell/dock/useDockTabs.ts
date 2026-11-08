import { useEffect, useSyncExternalStore } from 'react';
import type { Role } from '@dnd/core/src/shared/protocol';
import { dockRegistryVersion, dockTabs, subscribeDockRegistry, type DockTabDef } from './registry';

/** The registered tabs, re-read when a tab is registered or replaced. */
export function useDockTabs(): DockTabDef[] {
  useSyncExternalStore(subscribeDockRegistry, dockRegistryVersion, dockRegistryVersion);
  return dockTabs();
}

/** Run every tab's `onMap` while the seat is the DM's, open or not; tear down on leaving. */
export function useDockMounts(role: Role | undefined): void {
  const version = useSyncExternalStore(subscribeDockRegistry, dockRegistryVersion, dockRegistryVersion);
  useEffect(() => {
    if (role !== 'dm') return;
    const downs = dockTabs().flatMap((t) => (t.onMap ? [t.onMap()] : []));
    return () => downs.forEach((d) => d());
  }, [role, version]);
}
