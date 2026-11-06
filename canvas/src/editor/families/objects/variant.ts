// The Variant stepper's positions: the members of the stamp's family in order, then Random,
// which re-rolls the variant after every stamp (the old Vary each stamp toggle).

import { familyPosition, siblingOf } from '@dnd/core/src/assets/packCatalog';

export const RANDOM = 'random';

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
  const { index, count } = familyPosition(asset);
  if (count < 2) return value;
  if (value === RANDOM) return memberAt(asset, dir === 1 ? 1 : count);
  if ((dir === 1 && index === count) || (dir === -1 && index === 1)) return RANDOM;
  return siblingOf(asset, dir);
}
