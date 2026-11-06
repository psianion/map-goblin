// Which registry the surfaces render from. The editor uses the registered one; the
// development route and the tests hand in their own through the provider. The default is
// built on first use, not at load: the registry's families import the surfaces, so this
// module can load while the registry is still loading.

import { createContext, useContext } from 'react';
import { useStore } from '@/store/store';
import { registry, type Registry } from '@/editor/registry';
import { createSettings, type Settings } from '@/editor/registry/settings';

export interface RegistryScope {
  registry: Registry;
  settings: Settings;
}

export const RegistryContext = createContext<RegistryScope | null>(null);

let registered: RegistryScope | null = null;

export function useRegistry(): RegistryScope {
  const scope = useContext(RegistryContext);
  return scope ?? (registered ??= { registry, settings: createSettings(registry, useStore) });
}
