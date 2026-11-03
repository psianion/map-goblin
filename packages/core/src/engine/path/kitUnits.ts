// A kit's units as the walkers see them (sizes, cells) and as the canvas draws them (pooled
// sprites). Shared by the path renderer and the edge transitions, so both lay the same units
// the same way.

import { Sprite, type Container } from 'pixi.js';
import { GRID_CELL_PX, kitPiece, type CatalogEntry, type PathKit } from '../../assets/packCatalog';
import { resolveTexture } from '../../assets/textureLoader';
import type { EdgeUnit } from './pathKitLayout';

/** What a kit's edge units are laid at against their painted size when neither unit nor kit names a scale. */
export const KIT_UNIT_SCALE = 0.5;

/** A piece's painted width and height, cells: its content rect, else its grid size. */
export function paintedSize(entry: CatalogEntry): { w: number; h: number } {
  const cr = entry.contentRect;
  if (cr) return { w: cr.w / GRID_CELL_PX, h: cr.h / GRID_CELL_PX };
  const [w, h] = entry.gridSize.split('x').map(Number);
  return { w, h };
}

/** The kit's edge units the pack has art for, each at its laid scale and size, and their entries by key. */
export function kitEdgeUnits(kit: PathKit): { units: EdgeUnit[]; entries: Map<string, CatalogEntry> } {
  const units: EdgeUnit[] = [];
  const entries = new Map<string, CatalogEntry>();
  for (const u of kit.manifest.edge ?? []) {
    const entry = kitPiece(kit, u.key);
    if (!entry) continue;
    entries.set(u.key, entry);
    const scale = u.scale ?? kit.manifest.scale ?? KIT_UNIT_SCALE;
    const { w, h } = paintedSize(entry);
    units.push({ key: u.key, weight: u.weight, spacing: u.spacing, jitter: u.jitter, scale, size: Math.max(w, h) * scale });
  }
  return { units, entries };
}

/** A piece to draw: its pack entry, centre, turn, size against the authored one, and its own tint if it has one. */
export interface Piece {
  entry: CatalogEntry;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  tint?: number;
}

/**
 * Fill `pool` from index `from` with one sprite per piece, reusing the sprites already there.
 * The sprite pivots on its tile's centre even when its texture arrived trimmed to the content
 * rect, as the cave band's do. Returns the next free index.
 */
export function placePieces(pool: Container, pieces: readonly Piece[], tint: number, from: number): number {
  let at = from;
  for (const p of pieces) {
    const tex = resolveTexture(p.entry.id);
    if (tex.width <= 1) continue;
    const slot = pool.children[at];
    let sprite: Sprite;
    if (slot instanceof Sprite) {
      sprite = slot;
      sprite.texture = tex;
    } else {
      sprite = new Sprite(tex);
      pool.addChildAt(sprite, at);
    }
    const cr = p.entry.contentRect;
    if (cr) sprite.anchor.set((p.entry.naturalWidth / 2 - cr.x) / cr.w, (p.entry.naturalHeight / 2 - cr.y) / cr.h);
    else sprite.anchor.set(0.5, 0.5);
    sprite.position.set(p.x, p.y);
    sprite.rotation = p.rotation;
    const px = cr ? cr.w : p.entry.naturalWidth;
    sprite.scale.set(((px / tex.width) * p.scale) / GRID_CELL_PX);
    sprite.tint = p.tint ?? tint;
    sprite.label = p.entry.material;
    at++;
  }
  return at;
}
