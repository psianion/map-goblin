// Which registry the surfaces render from. The editor uses the registered one; the
// development route and the tests hand in their own (a stub family) through the provider.

import { createContext, useContext } from 'react';
import { registry, type Registry } from '@/editor/registry';
import { settings, type Settings } from '@/editor/registry/settings';

export interface RegistryScope {
  registry: Registry;
  settings: Settings;
}

export const RegistryContext = createContext<RegistryScope>({ registry, settings });

export function useRegistry(): RegistryScope {
  return useContext(RegistryContext);
}
