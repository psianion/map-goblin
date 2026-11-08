// The registry's keys, wired to this shell: installed while the shell is up, so the shortcut
// table's old tool keys stand down.

import { useEffect } from 'react';
import { useStore } from '@/store/store';
import { resolveSelection } from '@dnd/core/src/store/selectionResolve';
import type { ObjectKind, Registry } from '@/editor/registry';
import { createSettings } from '@/editor/registry/settings';
import { setRegistryShortcuts } from '@/shortcuts/defaultShortcuts';
import { registryShortcuts, type RegistryShortcut, type ShellKeyActions } from '@/shortcuts/registryShortcuts';
import { pickTool, toolForEngine } from '@/editor/surfaces/hooks';
import { useShell } from './shellStore';

export function shellKeyActions(registry: Registry): ShellKeyActions {
  const active = () => toolForEngine(registry, useStore.getState().tools.activeTool);
  return {
    flyout: () => useShell.getState().flyout,
    setFlyout: (f) => useShell.getState().setFlyout(f),
    pickTool,
    activeTool: active,
    lastTool: () => {
      const id = useShell.getState().lastToolId;
      return id ? registry.toolById(id) : undefined;
    },
    card: () => {
      const s = useStore.getState();
      if (!active()?.selectionPanel || s.selection.selectedIds.length !== 1) return null;
      const kinds = Object.keys(resolveSelection(s, s.selection.selectedIds).kinds) as ObjectKind[];
      return kinds.length === 1 ? (registry.cardForKind(kinds[0]) ?? null) : null;
    },
  };
}

/** Every key the registry generates, for this shell. */
export function shellShortcuts(registry: Registry): RegistryShortcut[] {
  return registryShortcuts(registry, createSettings(registry, useStore), shellKeyActions(registry));
}

export function useRegistryKeys(registry: Registry): void {
  useEffect(() => {
    setRegistryShortcuts(shellShortcuts(registry));
    return () => setRegistryShortcuts(null);
  }, [registry]);
}
