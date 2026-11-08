/**
 * What a picked battlemap says about the map it should found: the "36x24" a published map
 * carries in its file name, else the cells the grid detector measured, else the 70 px a cell
 * most battlemaps are drawn at. The New map dialog fills its Size from this and says which.
 */

/** Image pixels per grid square assumed when nothing better is known (Roll20's default). */
export const GUESS_PX_PER_CELL = 70;

/**
 * Below this the detector's figure is noise, and the fallback is the 70 px guess. Shared so
 * every reader of a detection draws the line in the same place.
 */
export const MIN_DETECT_CONFIDENCE = 0.5;

// Digits on both sides are refused so the pixel size in "map_2520x1680.png" is not read as
// "520x168" squares.
const HINT = /(?<!\d)(\d{1,3})\s*[x×]\s*(\d{1,3})(?!\d)/i;

/** The W by H squares a file name announces, or null. Zero is not a size. */
export function parseSizeHint(fileName: string): { width: number; height: number } | null {
  const m = HINT.exec(fileName);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  return width >= 1 && height >= 1 ? { width, height } : null;
}

export type CellSource = 'hint' | 'detected' | 'guess';

export interface CellFill {
  width: number;
  height: number;
  source: CellSource;
}

/**
 * The map size in squares for an image `px` pixels across: the name's hint first, then a
 * confident detection, then the guess. Never below one square.
 */
export function battlemapCells(
  px: { width: number; height: number },
  hint: { width: number; height: number } | null,
  detected: { pxPerCell: number; confidence: number } | null = null,
): CellFill {
  if (hint) return { ...hint, source: 'hint' };
  const confident = detected && detected.confidence >= MIN_DETECT_CONFIDENCE && detected.pxPerCell > 0;
  const per = confident ? detected.pxPerCell : GUESS_PX_PER_CELL;
  return {
    width: Math.max(1, Math.round(px.width / per)),
    height: Math.max(1, Math.round(px.height / per)),
    source: confident ? 'detected' : 'guess',
  };
}

/** The Picked row's second line: "2520 × 1680 px · 36 × 24 squares". */
export function pickedImageLine(px: { width: number; height: number }, cells: { width: number; height: number }): string {
  return `${px.width} × ${px.height} px · ${cells.width} × ${cells.height} squares`;
}
