// src/testing/seedCatalog.ts
//
// Test-only: seed the AssetPackManager singleton with wall-set manifests so
// packCatalog queries (wall pieces, set ids) return real data in jsdom, where
// no pack ever installs.

import { getAssetPackManager, resetAssetPackManager } from '../engine/assetPackInstance';
import type { EntryRect, ManifestEntry, PackManifest } from '../engine/assetPackManager';

export { resetAssetPackManager };

/**
 * Seed one pack holding a full forge-style wall family per given set id — the
 * exact roster shape GG_Fieldstone ships (lengths, variants, halves, corners,
 * joints, connectors, ending, path), so layout and edit tests exercise the same
 * piece population the app renders.
 */
export function seedTestWallSets(setIds: string[] = ['GG_Test'], packId = 'gg-forge'): void {
  const entries: Record<string, ManifestEntry> = {};
  for (const set of setIds) {
    const piece = (
      stem: string,
      gridSize: string,
      pieceType: string,
      w: number,
      h: number,
      contentRect?: EntryRect,
      tags: string[] = [],
    ): void => {
      entries[`${set}_${stem}_${gridSize}_wall_A`] = {
        type: 'wall',
        material: `${set}_${stem}`,
        gridSize,
        pieceType,
        variant: 'A',
        frame: { x: 0, y: 0, w, h },
        contentRect,
        set,
        tags,
      };
    };
    const band = (w: number): EntryRect => ({ x: 0, y: 66, w, h: 68 });

    for (const letter of ['A', 'B', 'C']) {
      piece(`Straight_3x1_${letter}`, '3x1', 'straight', 600, 200, band(600));
      piece(`Straight_2x1_${letter}`, '2x1', 'straight', 400, 200, band(400));
      piece(`Straight_1x1_${letter}`, '1x1', 'straight', 200, 200, band(200));
      piece(`Straight_Half_${letter}`, '1x1', 'straight', 200, 200, band(100));
    }
    piece('Corner_A_1x1', '1x1', 'corner', 200, 200, undefined, ['standalone']);
    piece('Corner_B_1x1', '1x1', 'corner', 200, 200, undefined, ['standalone']);
    piece('Corner_C_1x1', '1x1', 'corner', 200, 200);
    piece('Corner_D_1x1', '1x1', 'corner', 200, 200);
    piece('Corner_E_1x1', '1x1', 'corner', 200, 200);
    piece('Corner_F_2x2', '2x2', 'corner', 400, 400);
    piece('Corner_G_2x2', '2x2', 'corner', 400, 400);
    piece('Corner_H_3x3', '3x3', 'corner', 600, 600);
    piece('Joint_A_1x1', '1x1', 'joint', 200, 200);
    piece('Joint_B_1x1', '1x1', 'joint', 200, 200);
    piece('Joint_C_1x1', '1x1', 'joint', 200, 200);
    piece('Joint_D_1x1', '1x1', 'joint', 200, 200);
    piece('Connector_A_1x1', '1x1', 'connector', 200, 200, { x: 51, y: 66, w: 99, h: 68 });
    piece('Connector_B_1x1', '1x1', 'connector', 200, 200, { x: 80, y: 66, w: 40, h: 68 });
    piece('Connector_DIAG_A_1x1', '1x1', 'connector', 200, 200, { x: 16, y: 66, w: 151, h: 114 });
    piece('Ending_A_1x1', '1x1', 'ending', 200, 200);
    piece('Straight_Path', '8x1', 'path', 1650, 200, band(1650));
  }
  const manifest: PackManifest = {
    name: packId,
    description: '',
    version: '1.0.0',
    bundleSize: 0,
    entries,
    atlases: {},
    files: {},
  };
  const manager = getAssetPackManager();
  (manager as unknown as { manifestCache: Map<string, PackManifest> }).manifestCache.set(packId, manifest);
  manager.catalogVersion++;
}
