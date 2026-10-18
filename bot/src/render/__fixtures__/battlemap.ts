// An imported battlemap, as `importedMapToDocument` writes one and `GET /api/maps/:sceneId`
// hands it back: a locked `Battlemap` dungeon layer holding a single image asset, and a
// `Walls` layer carrying the walls, doors and lights the importer traced. No floor shapes and
// no rooms — that is the whole point of this shape, and why the schematic's room-based cut
// has nothing to work with here.
//
// The image is a 4×4 solid-brown PNG. resvg renders a `data:` href natively, so a real one
// keeps the renderer honest without putting a battlemap into the repo.

/** 4×4 solid #8c6b3f, the smallest real PNG that proves the href survives to the raster. */
export const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR42mPoybaHIwbiOAD80xNhYrkacQAAAABJRU5ErkJggg=='

const ASSET_ID = 'img-battlemap'

/** The imported document. 12 × 8 cells of image, centred at (6, 4). */
export const battlemap = {
  mapSettings: {
    name: 'Sunless Citadel — Upper Halls',
    gridType: 'square',
    cellScale: { value: 5, unit: 'ft' },
  },
  customImages: { [ASSET_ID]: TINY_PNG },
  layers: [
    {
      id: 'layer-base',
      name: 'Battlemap',
      type: 'dungeon',
      visible: true,
      locked: true,
      children: [
        {
          id: 'asset-1',
          name: 'Battlemap',
          childType: 'asset',
          visible: true,
          objectType: 'image',
          assetId: ASSET_ID,
          position: { x: 6, y: 4 },
          rotation: 0,
          scale: 1,
          width: 12,
          height: 8,
        },
      ],
    },
    {
      id: 'layer-walls',
      name: 'Walls',
      type: 'dungeon',
      visible: true,
      standaloneWalls: [
        { id: 'wall-1', points: [[0, 0], [12, 0], [12, 8], [0, 8], [0, 0]], wallType: 'normal', width: 0.3 },
      ],
      children: [
        {
          id: 'door-1',
          name: 'Door 1',
          childType: 'door',
          visible: true,
          position: [6, 0],
          angle: 0,
          width: 1,
          state: 'closed',
          isSecret: false,
        },
        {
          id: 'light-1',
          name: 'Light',
          childType: 'light',
          visible: true,
          position: { x: 3, y: 3 },
        },
      ],
    },
  ],
}

/** What the party would hold before anything is swept: the image layer and nothing else. */
export const battlemapImageOnly = {
  ...battlemap,
  layers: battlemap.layers.filter((layer) => layer.name === 'Battlemap'),
}

/**
 * A region mask over the west half of the map: cells (1,1)–(4,2) and a stray at (7,5), so the
 * run-merge has both a multi-cell run and a lone cell to emit. World cell (col, row) is
 * (minX + col, minY + row), which here is the identity.
 */
export const region = maskOf(12, 8, [
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [1, 2],
  [2, 2],
  [7, 5],
])

/** Row-major, LSB first within a byte — the same packing `@dnd/mechanics/fog` writes. */
export function maskOf(cols: number, rows: number, cells: [number, number][]) {
  const bytes = new Uint8Array(Math.ceil((cols * rows) / 8))
  for (const [col, row] of cells) {
    const bit = row * cols + col
    bytes[bit >>> 3] |= 1 << (bit & 7)
  }
  return { minX: 0, minY: 0, cols, rows, bits: Buffer.from(bytes).toString('base64') }
}
