// The map grid over imported pictures. A battlemap is opaque and sits on a layer with no
// floor, so the floor grid (floorWallRenderer's redrawGrid, clipped to floors and drawn under
// the sprites) never shows on it. These lines draw in the layer's `imageGrid` sublayer, above
// its sprites, clipped to each picture's footprint, in the floor grid's own style; the
// sublayer is shown and hidden with the grid (subscribeToStore's applyGridVisibility).

import { Container, Graphics } from 'pixi.js';
import type { AssetChild } from '../store/types';

type Pt = [number, number];

/** The whole-cell lines over one picture, and the footprint (a quad, turned with it) that clips them. */
export interface ImageGrid {
  clip: Pt[];
  lines: [Pt, Pt][];
}

/** The pictures on a layer that take the grid: imported images, shown. */
export function gridImages(children: readonly AssetChild[]): AssetChild[] {
  return children.filter((c) => c.objectType === 'image' && c.visible);
}

/** The footprint quad and the whole-cell grid lines across its bounds. Empty for a picture of no size. */
export function imageGridLines(child: Pick<AssetChild, 'position' | 'width' | 'height' | 'scale' | 'rotation'>): ImageGrid {
  const hw = Math.abs(child.width * child.scale) / 2;
  const hh = Math.abs(child.height * child.scale) / 2;
  if (!(hw > 0) || !(hh > 0)) return { clip: [], lines: [] };
  const cos = Math.cos(child.rotation || 0);
  const sin = Math.sin(child.rotation || 0);
  const { x, y } = child.position;
  const at = (u: number, v: number): Pt => [x + u * cos - v * sin, y + u * sin + v * cos];
  const clip = [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)];
  const xs = clip.map((p) => p[0]);
  const ys = clip.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs));
  const x1 = Math.ceil(Math.max(...xs));
  const y0 = Math.floor(Math.min(...ys));
  const y1 = Math.ceil(Math.max(...ys));
  const lines: [Pt, Pt][] = [];
  for (let gx = x0; gx <= x1; gx++) lines.push([[gx, y0], [gx, y1]]);
  for (let gy = y0; gy <= y1; gy++) lines.push([[x0, gy], [x1, gy]]);
  return { clip, lines };
}

/** What a layer's image grid was last drawn from, so an unrelated store change redraws nothing. */
const drawnFrom = new WeakMap<Container, string>();

function colorOf(hex: string | undefined): number {
  const n = hex ? parseInt(hex.replace('#', ''), 16) : NaN;
  return Number.isFinite(n) ? n : 0x000000;
}

/** Redraws `host` with the grid over each of `images`, in the floor grid's stroke, when they changed. */
export function syncImageGrid(host: Container, images: readonly AssetChild[], color: string | undefined): void {
  const key = JSON.stringify([color, images.map((c) => [c.position.x, c.position.y, c.width, c.height, c.scale, c.rotation])]);
  if (drawnFrom.get(host) === key) return;
  drawnFrom.set(host, key);
  // Most layers hold no picture: nothing drawn, nothing to clear.
  if (images.length === 0 && host.children.length === 0) return;
  for (const child of host.removeChildren()) child.destroy();
  for (const image of images) {
    const { clip, lines } = imageGridLines(image);
    if (clip.length === 0) continue;
    const mask = new Graphics();
    mask.poly(clip.flat()).fill({ color: 0xffffff });
    const g = new Graphics();
    g.setStrokeStyle({ color: colorOf(color), width: 0.02, alpha: 0.25 });
    for (const [[ax, ay], [bx, by]] of lines) {
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
    }
    g.stroke();
    const box = new Container();
    box.addChild(mask, g);
    box.mask = mask;
    host.addChild(box);
  }
}
