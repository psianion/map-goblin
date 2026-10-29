import type { AnyChild, AssetChild } from './types';

/** The optional per-prop fields on `AssetChild`; absent means the default below. */
export type PropFieldKey =
  | 'opacity'
  | 'overhead'
  | 'locked'
  | 'castsShadow'
  | 'blocksLight'
  | 'blocksMovement'
  | 'glows';

/** One defaults table for every reader: renderer, card, table and the Lighting pass. */
export const PROP_DEFAULTS: { readonly [K in PropFieldKey]-?: NonNullable<AssetChild[K]> } = {
  opacity: 1,
  overhead: false,
  locked: false,
  castsShadow: true,
  blocksLight: false,
  blocksMovement: false,
  glows: false,
};

/** The field's value on `child`, or its default when the child never set it. */
export function propField<K extends PropFieldKey>(
  child: Pick<AssetChild, PropFieldKey>,
  key: K,
): NonNullable<AssetChild[K]> {
  return (child[key] ?? PROP_DEFAULTS[key]) as NonNullable<AssetChild[K]>;
}

/** An asset child the canvas may edit: an asset or imported image that is not locked. */
export function isEditableProp(child: AnyChild): child is AssetChild {
  return child.childType === 'asset' && !propField(child, 'locked');
}

/** The glow a prop burns with when `glows` is on and it never set `glow`: strong and steady. */
export const GLOW_DEFAULT: NonNullable<AssetChild['glow']> = { strength: 0.9 };

/** The prop's glow, or null when it does not glow. Strength clamped 0.1..1. */
export function glowOf(child: Pick<AssetChild, 'glows' | 'glow'>): NonNullable<AssetChild['glow']> | null {
  if (!child.glows) return null;
  const glow = child.glow ?? GLOW_DEFAULT;
  return { ...glow, strength: Math.min(1, Math.max(0.1, glow.strength)) };
}
