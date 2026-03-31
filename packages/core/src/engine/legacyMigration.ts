// src/engine/legacyMigration.ts
//
// Validates that all legacy texture IDs from existing saves can be resolved
// through the legacy mapping table to valid pack textures. The unified
// resolver (resolveTexture) handles runtime resolution — this module
// validates the mapping table is complete at boot time.

import { resolveLegacyId } from './legacyAssetMapping';
import type { AssetPackManager } from './assetPackManager';

export interface MigrationReport {
  total: number;
  resolved: number;
  unresolved: string[];
}

/**
 * Validate that all legacy IDs in the provided list resolve to installed pack textures.
 * Call after rehydrate + bundled pack install to verify mapping completeness.
 */
export function validateLegacyMappings(
  legacyIds: string[],
  packManager: AssetPackManager,
): MigrationReport {
  const unresolved: string[] = [];
  let resolved = 0;

  for (const id of legacyIds) {
    const mapped = resolveLegacyId(id);
    if (!mapped) {
      unresolved.push(id);
      continue;
    }

    // Check if the mapped ID's pack is installed
    const packId = mapped.split(':')[0];
    const installed = packManager.getInstalledPacks().some((p) => p.packId === packId);
    if (installed) {
      resolved++;
    } else {
      unresolved.push(id);
    }
  }

  return {
    total: legacyIds.length,
    resolved,
    unresolved,
  };
}

/**
 * Log a summary of legacy ID migration status.
 * Non-blocking — informational only.
 */
export function logMigrationStatus(report: MigrationReport): void {
  if (report.unresolved.length === 0) {
    console.info(
      `[legacyMigration] All ${report.total} legacy IDs resolve to pack textures`,
    );
  } else {
    console.warn(
      `[legacyMigration] ${report.unresolved.length}/${report.total} legacy IDs unresolved:`,
      report.unresolved,
    );
  }
}
