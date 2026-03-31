import type { PackUpdateInfo } from './types';

/** Interface matching the subset of AssetPackManager used by the packs slice. */
export interface PackManager {
  checkForUpdates(): Promise<PackUpdateInfo[]>;
  installPack(packId: string): Promise<void>;
  uninstallPack(packId: string): Promise<void>;
  getInstalledPacks(): Array<{ packId: string; version: string; bundleSize: number }>;
}

type PackManagerFactory = () => PackManager;

let _factory: PackManagerFactory | null = null;

export function setPackManagerFactory(factory: PackManagerFactory): void {
  _factory = factory;
}

export function getPackManager(): PackManager {
  if (!_factory) throw new Error('@dnd/core: setPackManagerFactory() must be called before using pack management');
  return _factory();
}
