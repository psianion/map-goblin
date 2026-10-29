export interface ExportDimensions {
  widthPx: number;
  heightPx: number;
  /** The scale the map is actually rendered at — the requested one unless the limit bit. */
  pxPerCell: number;
  clampedToLimit: boolean;
}

/** Longest side of an export, in real pixels of the render texture the GPU allocates. */
export const MAX_EXPORT_PX = 8192;

/**
 * The export renders at one texture pixel per file pixel, whatever the screen's DPR. A
 * DPR-scaled texture held DPR times the pixels the file was sized for, and the pipeline
 * then kept only its top-left corner, drawn at DPR times the scale.
 */
export const EXPORT_RESOLUTION = 1;

/**
 * Compute pixel dimensions for export given grid cell counts and px-per-cell.
 *
 * A map too big for MAX_EXPORT_PX at the asked scale is rendered *smaller*, not cropped:
 * one factor shrinks both axes so the whole map still fits the texture, and the returned
 * `pxPerCell` is the scale the pipeline must render at. (Clamping the texture alone kept
 * the requested zoom and silently cut the right and bottom off large maps.)
 *
 * The cap is on real pixels: `resolution` is texture pixels per file pixel.
 */
export function computeExportDimensions(
  cellWidth: number,
  cellHeight: number,
  pxPerCell: number,
  resolution: number = EXPORT_RESOLUTION,
): ExportDimensions {
  // Ceil fractional cells first, then multiply by pixels per cell
  const cols = Math.ceil(cellWidth);
  const rows = Math.ceil(cellHeight);
  const rawW = cols * pxPerCell * resolution;
  const rawH = rows * pxPerCell * resolution;
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

/**
 * The world container's translation for an export of `widthPx`x`heightPx` at `pxPerCell`,
 * with `bounds` centred in the file. The file is whole cells, so it runs up to a cell wider
 * and taller than the bounds; that slack is split evenly on both sides instead of all
 * landing on the right and bottom, which left the room off-centre.
 */
export function exportWorldOffset(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  widthPx: number,
  heightPx: number,
  pxPerCell: number,
): { x: number; y: number } {
  const padX = Math.max(0, widthPx / pxPerCell - (bounds.maxX - bounds.minX)) / 2;
  const padY = Math.max(0, heightPx / pxPerCell - (bounds.maxY - bounds.minY)) / 2;
  return { x: -(bounds.minX - padX) * pxPerCell, y: -(bounds.minY - padY) * pxPerCell };
}
