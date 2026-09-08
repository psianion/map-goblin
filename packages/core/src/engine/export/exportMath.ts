export interface ExportDimensions {
  widthPx: number;
  heightPx: number;
  /** The scale the map is actually rendered at — the requested one unless the limit bit. */
  pxPerCell: number;
  clampedToLimit: boolean;
}

export const MAX_EXPORT_PX = 8192;

/**
 * Compute pixel dimensions for export given grid cell counts and px-per-cell.
 *
 * A map too big for MAX_EXPORT_PX at the asked scale is rendered *smaller*, not cropped:
 * one factor shrinks both axes so the whole map still fits the texture, and the returned
 * `pxPerCell` is the scale the pipeline must render at. (Clamping the texture alone kept
 * the requested zoom and silently cut the right and bottom off large maps.)
 */
export function computeExportDimensions(
  cellWidth: number,
  cellHeight: number,
  pxPerCell: number,
): ExportDimensions {
  // Ceil fractional cells first, then multiply by pixels per cell
  const cols = Math.ceil(cellWidth);
  const rows = Math.ceil(cellHeight);
  const rawW = cols * pxPerCell;
  const rawH = rows * pxPerCell;
  const scale = Math.min(1, MAX_EXPORT_PX / rawW, MAX_EXPORT_PX / rawH);
  const effective = pxPerCell * scale;
  return {
    widthPx: Math.round(cols * effective),
    heightPx: Math.round(rows * effective),
    pxPerCell: effective,
    clampedToLimit: scale < 1,
  };
}

/**
 * Build the auto-filename: `{mapName}-{W}x{H}-{pxPerCell}ppc.{format}`.
 * Sanitizes map name by replacing spaces/slashes with hyphens.
 */
export function buildExportFilename(
  mapName: string,
  widthPx: number,
  heightPx: number,
  pxPerCell: number,
  format: 'png' | 'jpeg',
): string {
  const safe = mapName.trim().replace(/[\s/\\]+/g, '-') || 'map';
  return `${safe}-${widthPx}x${heightPx}-${pxPerCell}ppc.${format}`;
}

/**
 * Convert world-space bounds (in world units) to grid cell counts.
 * Each world unit = 1 grid cell.
 */
export function worldBoundsToCells(worldBounds: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}): { cellWidth: number; cellHeight: number } {
  return {
    cellWidth: Math.max(1, Math.ceil(worldBounds.maxX - worldBounds.minX)),
    cellHeight: Math.max(1, Math.ceil(worldBounds.maxY - worldBounds.minY)),
  };
}
