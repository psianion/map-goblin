// The Variant stepper's positions: the members of the stamp's family in order, then Random,
// which re-rolls the variant after every stamp (the old Vary each stamp toggle). A light prop
// whose picture follows its light steps its models only, in the state picked (`variantTiles`):
// a brazier's nine pictures are three models.

import { familyPosition, lightPropOf, siblingOf } from '@dnd/core/src/assets/packCatalog';
import { variantTiles } from './propLightModel';

export const RANDOM = 'random';

/** A light prop's models in the state `asset` shows, or null for any other prop. */
function lightRing(asset: string): string[] | null {
  return lightPropOf(asset)?.states ? variantTiles(asset).map((e) => e.id) : null;
}

/** Where `asset` stands among its variants, 1-based, and how many there are. */
export function variantPosition(asset: string): { index: number; count: number } {
  const ring = lightRing(asset);
  return ring ? { index: ring.indexOf(asset) + 1, count: ring.length } : familyPosition(asset);
}

/** The member `n` (1-based) of `asset`'s family, walking from `asset`. */
function memberAt(asset: string, n: number): string {
  let id = asset;
  const { index } = familyPosition(asset);
  const dir = n > index ? 1 : -1;
  for (let i = index; i !== n; i += dir) id = siblingOf(id, dir);
  return id;
}

/** The position one step from `value` (an asset id, or Random) in a ring of members then Random. */
export function variantStep(asset: string, value: string, dir: 1 | -1): string {
  const ring = lightRing(asset);
  if (ring) {
    const count = ring.length;
    const index = ring.indexOf(asset) + 1;
    if (count < 2) return value;
    if (value === RANDOM) return ring[dir === 1 ? 0 : count - 1]!;
    if ((dir === 1 && index === count) || (dir === -1 && index === 1)) return RANDOM;
    return ring[index - 1 + dir]!;
  }
  const { index, count } = familyPosition(asset);
  if (count < 2) return value;
  if (value === RANDOM) return memberAt(asset, dir === 1 ? 1 : count);
  if ((dir === 1 && index === count) || (dir === -1 && index === 1)) return RANDOM;
  return siblingOf(asset, dir);
}
