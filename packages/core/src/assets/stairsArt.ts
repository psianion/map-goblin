// Where the drawn stairs sit inside gg-demo's stairs art. The frames are not trimmed and the
// flights do not fill them (the short stone flight is 227x224 px of a 237x401 frame), so an
// opening that stretched the whole frame across its gap drew its steps a cell or more away
// from the cliff. Measured once from the shipped webps (alpha > 40), keyed like the kit:
// `material_gridSize`. The top of each flight is its high end.
//
// The cave ink stairs (GG_Cave_Ink, in gg-forge) need none: their entries carry the forge's
// `contentRect` (staging/cave-props/stairs-content.json) and are served cropped to it.

export interface ArtRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const STAIRS_CONTENT: Readonly<Record<string, ArtRect>> = {
  stairs_stone_long_2x4: { x: 9, y: 2, w: 222, h: 675 },
  stairs_stone_short_2x2: { x: 8, y: 164, w: 227, h: 224 },
  stairs_stone_wide_3x2: { x: 17, y: 2, w: 423, h: 249 },
  stairs_wood_long_2x4: { x: 2, y: 22, w: 228, h: 667 },
  stairs_wood_short_2x2: { x: 23, y: 7, w: 224, h: 221 },
  stairs_wood_short_down_2x2: { x: 25, y: 2, w: 244, h: 229 },
  stairs_wood_short_up_2x2: { x: 3, y: 37, w: 230, h: 233 },
  stairs_wood_spiral_down_3x3: { x: 0, y: 1, w: 500, h: 455 },
  stairs_wood_spiral_up_3x3: { x: 2, y: 2, w: 461, h: 432 },
  stairs_wood_wide_3x2: { x: 9, y: 32, w: 468, h: 228 },
};
