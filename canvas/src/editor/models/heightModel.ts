// The dock's Heights column: which heights a level uses, where each one stands, and what a
// card click does to the kept highlight. Pure: no store, no React, no Pixi.
import { layerPlateaus, plateauChains, plateausOf, pointInPoly } from '@dnd/core/src/shared/plateaus';
import type { Polygon } from '@dnd/core/src/types/geometry';
import type { DungeonLayer } from '@/store/types';

/**
 * The heights in use on a level's layers: distinct, highest first, then 0 for the ground; none
 * on a flat level. Read off the plateaus' nesting, the levels `layerPlateaus` makes its bands
 * of, so it needs no polygon union and works before the geometry engine has loaded.
 */
export function levelHeights(layers: readonly DungeonLayer[]): number[] {
  const seen = new Set<number>();
  for (const layer of layers) {
    for (const info of plateauChains(plateausOf(layer)).values()) if (info.chain.length > 0 && info.height !== 0) seen.add(info.height);
  }
  if (seen.size === 0) return [];
  return [...[...seen].sort((a, b) => b - a), 0];
}

/** A card's label: `+2`, `0`, `-2`. */
export const heightLabel = (height: number): string => (height > 0 ? `+${height}` : String(height));

/**
 * What a height's highlight leaves bright: for a raised or sunk height, the rings that stand
 * at it, everything outside them dimmed; for 0, every other height's rings, dimmed themselves.
 */
export interface HeightFocus {
  rings: Polygon[];
  dim: 'outside' | 'inside';
}

export function heightFocus(layers: readonly DungeonLayer[], height: number): HeightFocus {
  const rings: Polygon[] = [];
  for (const layer of layers) {
    for (const band of layerPlateaus(layer).bands) {
      if (height === 0 ? band.height !== 0 : band.height === height) rings.push(...band.surface);
    }
  }
  return { rings, dim: height === 0 ? 'inside' : 'outside' };
}

function signedArea(ring: Polygon): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Rings wound as the bands wind them (outers positive, holes negative), each outer with the holes it holds. */
export function ringRegions(rings: readonly Polygon[]): { outer: Polygon; holes: Polygon[] }[] {
  const live = rings.filter((r) => r.length >= 3);
  const holes = live.filter((r) => signedArea(r) < 0);
  return live
    .filter((r) => signedArea(r) > 0)
    .map((outer) => ({ outer, holes: holes.filter((h) => pointInPoly(h[0][0], h[0][1], outer)) }));
}

/** The kept highlight after a click on a card: that height, or none when it was already kept. */
export const nextHeightPin = (pin: number | null, height: number): number | null => (pin === height ? null : height);

/** The thumbnail key of a height's card on a level. */
export const heightThumbKey = (levelId: string, height: number): string => `height:${levelId}:${height}`;

/** A height card's thumbnail key read back, or null for any other key. */
export function parseHeightThumbKey(key: string): { levelId: string; height: number } | null {
  if (!key.startsWith('height:')) return null;
  const at = key.lastIndexOf(':');
  const height = Number(key.slice(at + 1));
  return at > 7 && Number.isFinite(height) ? { levelId: key.slice(7, at), height } : null;
}
