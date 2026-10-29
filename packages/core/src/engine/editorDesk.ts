import type { Layer } from '../store/types';

/**
 * The editor's desk: a host whose chrome sits on a neutral, dotted desk (the v2 editor)
 * installs one, and the map then reads as a sheet laid on that desk.
 *
 * While a desk is installed:
 *  - the canvas clears to the desk colour, and the map's background is painted only inside
 *    its frame, so the map reads as a sheet on the desk;
 *  - a map with an untextured background is drawn on the desk's paper, whatever its colour
 *    (`sheetColor`); a textured background keeps its look;
 *  - the grid is the same one world-space dot grid as without a desk, continuous across desk
 *    and sheet, only drawn in the desk's dot colour;
 *  - the editing view is unlit unless `lit` is set, so the map's mood and the hour do not
 *    darken the sheet while it is being drawn.
 *
 * Presentation only. Nothing here touches the store or the saved map, and the export holds
 * the authored look for the length of its render (`holdAuthoredLook`), so files and
 * thumbnails come out the same either way. Nobody installs one by default; the table never does.
 */
export interface EditorDesk {
  /** CSS hex (#rrggbb): the desk around the map (the canvas clear colour). */
  desk: string;
  /** CSS hex (#rrggbb): the grid dots, on desk and sheet alike. */
  dot: string;
  /** CSS hex (#rrggbb): the paper an untextured map is drawn on. */
  sheet: string;
  /** CSS hex (#rrggbb): the snap cross-hair at the cursor. */
  ink: string;
  /** Show the map's lighting and mood in the editing view. Off by default. */
  lit?: boolean;
}

let current: EditorDesk | null = null;
let hold: ((opts: AuthoredLookOptions) => () => void) | null = null;

export function setEditorDesk(desk: EditorDesk | null): void {
  current = desk;
}

export function getEditorDesk(): EditorDesk | null {
  return current;
}

/**
 * The colour the sheet is painted in: the desk's paper whenever the map's background is
 * untextured, whatever colour was authored for it; the authored colour under a background
 * texture, or with no desk installed.
 */
export function sheetColor(layers: readonly Layer[], desk: EditorDesk | null): string {
  const bg = layers.find((l) => l.type === 'background');
  const authored = bg && bg.type === 'background' ? bg.backgroundColor : '#0f100e';
  if (!desk) return authored;
  const textured = bg && bg.type === 'background' && !!bg.backgroundTexture;
  return textured ? authored : desk.sheet;
}

/** What a file asks the scene to look like while it is rendered. */
export interface AuthoredLookOptions {
  /**
   * The file gets the map's lighting (the default). Either way the background is the authored
   * one; off, the grid dots are the ones the unlit editing view shows.
   */
  lit?: boolean;
}

/** Installed by the render loop: puts the authored look back, returning the undo. */
export function setAuthoredLookHold(fn: ((opts: AuthoredLookOptions) => () => void) | null): void {
  hold = fn;
}

/**
 * Hold the scene at the map's authored look (its own background, grid and frame) until
 * the returned function is called. The export wraps its render in this, synchronously.
 * An unlit file asks for the hold even without a desk.
 */
export function holdAuthoredLook(opts: AuthoredLookOptions = {}): () => void {
  const lit = opts.lit !== false;
  return hold && (current || !lit) ? hold({ lit }) : () => {};
}

/**
 * Whether the editing view is showing the map's lighting right now: always without a desk,
 * and with one only while its lit preview is on. Files default to matching it.
 */
export function editorShowsLighting(): boolean {
  return current ? current.lit === true : true;
}
