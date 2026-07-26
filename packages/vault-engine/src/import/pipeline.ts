import sharp from 'sharp';
import { validateFile } from './validate.js';
import { autoTag } from './auto-tag.js';
import { computePhash } from './phash.js';
import { findDuplicates, type HashEntry } from './dedup.js';
import type { ImportResult, AssetMetadata } from '../types.js';

export interface FileInput {
  filename: string;
  data: Buffer;
}

interface ValidatedFile {
  file: FileInput;
  valid: boolean;
  error?: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  dominantColor: string;
  phash: string;
}

export async function importFiles(files: FileInput[]): Promise<ImportResult[]> {
  // Phase 1: Validate + extract metadata
  const validated: ValidatedFile[] = [];

  for (const file of files) {
    const vResult = await validateFile(file.data, file.filename);
    if (!vResult.valid) {
      validated.push({
        file,
        valid: false,
        error: vResult.error,
        width: 0,
        height: 0,
        hasAlpha: false,
        dominantColor: '#000000',
        phash: '',
      });
      continue;
    }

    // Extract dominant color via sharp stats
    const stats = await sharp(file.data).stats();
    const r = Math.round(stats.channels[0]?.mean ?? 0);
    const g = Math.round(stats.channels[1]?.mean ?? 0);
    const b = Math.round(stats.channels[2]?.mean ?? 0);
    const dominantColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

    const phash = await computePhash(file.data);

    validated.push({
      file,
      valid: true,
      width: vResult.width!,
      height: vResult.height!,
      hasAlpha: vResult.hasAlpha ?? false,
      dominantColor,
      phash,
    });
  }

  // Phase 2: Dedup
  const hashEntries: HashEntry[] = validated
    .filter((v) => v.valid)
    .map((v) => ({ id: v.file.filename, hash: v.phash }));

  const dedupResults = findDuplicates(hashEntries);
  const dedupMap = new Map(dedupResults.map((d) => [d.id, d]));

  // Phase 3: Build results (first-seen-wins for duplicates)
  const results: ImportResult[] = [];
  const seenHashes = new Set<string>();

  for (const v of validated) {
    if (!v.valid) {
      results.push({ file: v.file.filename, status: 'rejected', reason: v.error });
      continue;
    }

    // First-seen-wins: only mark as duplicate if an earlier file had the same hash
    const dedup = dedupMap.get(v.file.filename);
    const isDuplicate = dedup?.duplicates.some((d) => {
      const other = validated.find((x) => x.file.filename === d);
      return other ? seenHashes.has(other.phash) : false;
    });
    seenHashes.add(v.phash);

    if (isDuplicate) {
      results.push({
        file: v.file.filename,
        status: 'duplicate',
        reason: 'Near-duplicate of earlier file in batch',
        similarTo: dedup!.duplicates,
      });
      continue;
    }

    const tags = autoTag({
      filename: v.file.filename,
      width: v.width,
      height: v.height,
      hasAlpha: v.hasAlpha,
      dominantColor: v.dominantColor,
    });

    const id = `${tags.material}_${tags.gridSize}_${tags.type}_${tags.variant}`;

    const metadata: AssetMetadata = {
      id,
      sourceFile: v.file.filename,
      type: tags.type,
      theme: '',
      material: tags.material,
      gridSize: tags.gridSize,
      pieceType: tags.type,
      variant: tags.variant,
      tint: tags.tint,
      tool: tags.tool,
      tileable: false,
      transparency: tags.transparency,
      contentBounds: { x: 0, y: 0, w: v.width, h: v.height },
      perceptualHash: v.phash,
      width: v.width,
      height: v.height,
    };

    const status =
      dedup && dedup.similar.length > 0
        ? ('similar' as const)
        : ('ok' as const);
    results.push({
      file: v.file.filename,
      status,
      metadata,
      similarTo: dedup?.similar.length ? dedup.similar : undefined,
    });
  }

  return results;
}
