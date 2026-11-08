import { useMemo, type ReactNode } from 'react';
import { useStore } from '@/store/store';
import type { Registry } from '@/editor/registry';
import { createSettings } from '@/editor/registry/settings';
import { RegistryContext } from './registryContext';

/** Renders the surfaces under `registry`, with settings bound to the editor's store. */
export function RegistryProvider({ registry, children }: { registry: Registry; children: ReactNode }) {
  const scope = useMemo(() => ({ registry, settings: createSettings(registry, useStore) }), [registry]);
  return <RegistryContext.Provider value={scope}>{children}</RegistryContext.Provider>;
}
