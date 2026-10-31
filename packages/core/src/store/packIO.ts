import type { PackUpdateInfo } from './types';
import type { PackManifest } from '../engine/packManifest';

/** What a differential update actually moved — see AssetPackManager.updatePack. */
export interface PackDiff {
  changedFiles: number;
  unchangedFiles: number;
  downloadedBytes: number;
  totalFiles: number;
}

/**
 * A pack read out of a pack file and validated: the shape `registerPack` takes. The canvas
 * reads the zip (core stays free of a zip library) and hands this to `installPackFromFile`.
 */
export interface PackFile {
  packId: string;
  manifest: PackManifest;
  blobs: Map<string, Uint8Array>;
}

/** How installing a pack file went. A refusal leaves every installed pack as it was. */
export type PackFileInstall =
  | { status: 'installed' }
  | { status: 'replaced'; previousVersion: string }
  | { status: 'refused'; reason: string };

/** Interface matching the subset of AssetPackManager used by the packs slice. */
export interface PackManager {
  checkForUpdates(): Promise<PackUpdateInfo[]>;
  /** The same check, saying whether the index answered (`unreachable` keeps the last known updates). */
  checkForUpdatesReport(): Promise<{ status: 'ok' | 'unreachable'; updates: PackUpdateInfo[] }>;
  installPack(packId: string): Promise<void>;
  registerPack(packId: string, manifest: PackManifest, blobs: Map<string, Uint8Array>, bundled?: boolean): Promise<void>;
  updatePack(packId: string): Promise<PackDiff>;
  uninstallPack(packId: string): Promise<void>;
  getInstalledPacks(): Array<{ packId: string; version: string; bundleSize: number; bundled: boolean; installedAt: number }>;
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
