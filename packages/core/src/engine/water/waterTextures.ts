// The textures the water tool paints with. They ship in the bundled gg-forge pack
// (placeholder art from scripts/gen-water-placeholders.mjs until the forge set
// lands under the same entry keys). Saves from before they had a pack prefix hold
// the bare entry ids; packCatalog.qualifyTextureId resolves those.

/** Tiling water surface every new body is filled with. */
export const WATER_TEXTURE_ID = 'gg-forge:water-still-a-01';

/** Shoreline strip drawn when Banks is on. Banks off is the empty string. */
export const WATER_BANK_TEXTURE_ID = 'gg-forge:bank-grassy-01-a1';
