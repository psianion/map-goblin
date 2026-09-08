// Import scanned maps one after another through the same path `loadMap` uses for a
// `.mapbuilder` file: build the document, restore its images, create the map entry,
// load it into the store, save. Each map stands alone — one failing never stops the rest.

import { importedMapToDocument } from '@dnd/core/src/shared/import/toDocument';
import { useStore } from '@/store/store';
import { resizeImageToMax } from '@/canvas/importImage';
import type { ScannedMap } from './importFolder';

/**
 * Long-edge cap for an imported battlemap. A 47-cell map lands at ~87 px per cell.
 * ponytail: 8192 is one number away when a map needs it — the ceilings are the GPU
 * texture limit on small devices and the base64 copy every save carries.
 */
export const IMPORT_MAX_PX = 4096;

export interface ImportResult {
  name: string;
  ok: boolean;
  error?: string;
  warnings: string[];
  /** Image bytes stored with the map, for the summary. */
  bytes: number;
}

export async function importMaps(
  maps: ScannedMap[],
  onProgress?: (index: number, name: string) => void,
  /** Checked between maps — a stop request finishes the map in flight and skips the rest. */
  stopRequested?: () => boolean,
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const [index, row] of maps.entries()) {
    if (stopRequested?.()) break;
    onProgress?.(index, row.name);
    try {
      results.push(await importOne(row));
    } catch (err) {
      console.error('[importMaps]', row.name, err);
      results.push({
        name: row.name,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        warnings: [],
        bytes: 0,
      });
    }
  }
  return results;
}

async function importOne(row: ScannedMap): Promise<ImportResult> {
  const map = await row.load();
  const warnings = [...map.warnings];

  if (map.image) {
    const { width, height } = map.image;
    const longest = Math.max(width, height);
    if (longest > IMPORT_MAX_PX) {
      const scale = IMPORT_MAX_PX / longest;
      map.image = {
        dataUrl: await resizeImageToMax(map.image.dataUrl, IMPORT_MAX_PX, 'image/webp'),
        width: Math.floor(width * scale),
        height: Math.floor(height * scale),
        pxPerCell: map.image.pxPerCell * scale,
      };
      warnings.push(`image downscaled from ${width}×${height} to fit ${IMPORT_MAX_PX}px`);
    }
  }

  const doc = importedMapToDocument(map);
  const bytes = Object.values(doc.customImages).reduce((n, s) => n + s.length, 0);

  const { restoreCustomImages } = await import('@/assets/textureLoader');
  await restoreCustomImages(doc.customImages);

  const store = useStore.getState();
  await store.createNewMap(doc.mapSettings.name);
  useStore.getState().loadFromFile(doc);
  await useStore.getState().saveCurrentMap();

  return { name: map.name, ok: true, warnings, bytes };
}
