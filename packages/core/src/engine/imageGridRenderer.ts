// The map grid over imported pictures. A battlemap is opaque and sits on a layer with no
// floor, so the floor grid (floorWallRenderer's redrawGrid, clipped to floors and drawn under
// the sprites) never shows on it. These lines draw in the layer's `imageGrid` sublayer, above
// its sprites, clipped to each picture's footprint, in the floor grid's own style; the
// sublayer is shown and hidden with the grid (subscribeToStore's applyGridVisibility).

import { Container, Graphics } from 'pixi.js';
import type { AssetChild, GridConfig } from '../store/types';

type Pt = [number, number];
type Seg = [Pt, Pt];

/** Whole-cell lines' opacity, the floor grid's since it was first drawn. */
export const GRID_LINE_ALPHA = 0.25;
/** The snap step's lines between them: about half as strong, so the cells still read first. */
export const GRID_SUBLINE_ALPHA = 0.12;

/**
 * How many parts each cell's lines split it into: the snap step while snapping, else whole
 * cells only (no step to show). 1, 2, 3, 4, 6 or 8; anything else reads as 1.
 */
export function gridDivision(grid: Pick<GridConfig, 'snapEnabled' | 'snapDivision'>): number {
  if (!grid.snapEnabled) return 1;
  const d = Math.round(grid.snapDivision);
  return Number.isFinite(d) && d >= 1 && d <= 8 ? d : 1;
}

/**
 * The lines of a grid over whole-cell bounds x0..x1 by y0..y1: one on every whole cell
 * (`major`), and `division - 1` between each pair of them on each axis (`minor`).
 */
export function gridLineSet(x0: number, x1: number, y0: number, y1: number, division = 1): { major: Seg[]; minor: Seg[] } {
  const major: Seg[] = [];
  const minor: Seg[] = [];
  const d = Math.max(1, Math.round(division) || 1);
  for (let gx = x0; gx <= x1; gx++) {
    major.push([[gx, y0], [gx, y1]]);
    if (gx < x1) for (let i = 1; i < d; i++) minor.push([[gx + i / d, y0], [gx + i / d, y1]]);
  }
  for (let gy = y0; gy <= y1; gy++) {
    major.push([[x0, gy], [x1, gy]]);
    if (gy < y1) for (let i = 1; i < d; i++) minor.push([[x0, gy + i / d], [x1, gy + i / d]]);
  }
  return { major, minor };
}

/**
 * The strokes for a line set: one screen pixel wide at every zoom, like the dot grid, the
 * subdivisions fainter. One Graphics per weight, so neither stroke re-runs the other's path.
 */
export function gridStrokes(color: number, set: { major: Seg[]; minor: Seg[] }): Graphics[] {
  const out: Graphics[] = [];
  for (const [segs, alpha] of [[set.major, GRID_LINE_ALPHA], [set.minor, GRID_SUBLINE_ALPHA]] as const) {
    if (segs.length === 0) continue;
    const g = new Graphics();
    g.setStrokeStyle({ color, width: 1, alpha, pixelLine: true });
    for (const [[ax, ay], [bx, by]] of segs) {
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
    }
    g.stroke();
    out.push(g);
  }
  return out;
}

/** The lines over one picture, and the footprint (a quad, turned with it) that clips them. */
export interface ImageGrid {
  clip: Pt[];
  /** On every whole cell. */
  lines: Seg[];
  /** At the snap step between them. */
  minor: Seg[];
}

/** The pictures on a layer that take the grid: imported images, shown. */
export function gridImages(children: readonly AssetChild[]): AssetChild[] {
  return children.filter((c) => c.objectType === 'image' && c.visible);
}

/** The footprint quad and the grid lines across its bounds. Empty for a picture of no size. */
export function imageGridLines(
  child: Pick<AssetChild, 'position' | 'width' | 'height' | 'scale' | 'rotation'>,
  division = 1,
): ImageGrid {
  const hw = Math.abs(child.width * child.scale) / 2;
  const hh = Math.abs(child.height * child.scale) / 2;
  if (!(hw > 0) || !(hh > 0)) return { clip: [], lines: [], minor: [] };
  const cos = Math.cos(child.rotation || 0);
  const sin = Math.sin(child.rotation || 0);
  const { x, y } = child.position;
  const at = (u: number, v: number): Pt => [x + u * cos - v * sin, y + u * sin + v * cos];
  const clip = [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)];
  const xs = clip.map((p) => p[0]);
  const ys = clip.map((p) => p[1]);
  const { major, minor } = gridLineSet(
    Math.floor(Math.min(...xs)),
    Math.ceil(Math.max(...xs)),
    Math.floor(Math.min(...ys)),
    Math.ceil(Math.max(...ys)),
    division,
  );
  return { clip, lines: major, minor };
}

/** What a layer's image grid was last drawn from, so an unrelated store change redraws nothing. */
const drawnFrom = new WeakMap<Container, string>();

function colorOf(hex: string | undefined): number {
  const n = hex ? parseInt(hex.replace('#', ''), 16) : NaN;
  return Number.isFinite(n) ? n : 0x000000;
}

/**
 * Redraws `host` with the grid over each of `images`, in the floor grid's stroke and colour
 * (the Grid lines colour), split at `division`, when any of them changed.
 */
export function syncImageGrid(host: Container, images: readonly AssetChild[], color: string | undefined, division = 1): void {
  const key = JSON.stringify([color, division, images.map((c) => [c.position.x, c.position.y, c.width, c.height, c.scale, c.rotation])]);
  if (drawnFrom.get(host) === key) return;
  drawnFrom.set(host, key);
  // Most layers hold no picture: nothing drawn, nothing to clear.
  if (images.length === 0 && host.children.length === 0) return;
  for (const child of host.removeChildren()) child.destroy();
  for (const image of images) {
    const { clip, lines, minor } = imageGridLines(image, division);
    if (clip.length === 0) continue;
    const mask = new Graphics();
    mask.poly(clip.flat()).fill({ color: 0xffffff });
    const box = new Container();
    box.addChild(mask, ...gridStrokes(colorOf(color), { major: lines, minor }));
    box.mask = mask;
    host.addChild(box);
  }
}
