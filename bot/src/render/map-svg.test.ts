import { describe, expect, it } from 'vitest'
import { battlemap, battlemapImageOnly, maskOf, region } from './__fixtures__/battlemap'
import { dmMap, playerMap, tokens } from './__fixtures__/two-rooms'
import { mapSvg, regionCell, type MapToken } from './map-svg'

/** The one marker only a secret door draws. */
const SECRET_LEAF = 'stroke-dasharray="0.22 0.16"'
/** The hidden ambusher's initial, as a text node — 'A' appears nowhere else in the fixtures. */
const HIDDEN_TOKEN = '>A</text>'

describe('mapSvg — the DM document', () => {
  const svg = mapSvg(dmMap, { dmView: true, tokens })

  it('renders the whole keep, its rooms and its secrets', () => {
    expect(svg).toMatchSnapshot()
  })

  it('labels rooms from the room rows, with the DM\'s override winning', () => {
    expect(svg).toContain('West Hall')
    expect(svg).toContain('Vault of Coins')
    expect(svg).not.toContain('East Vault') // overridden
    expect(svg).not.toContain('Corridor') // a pathway is a joint, not a room worth naming
  })

  it('marks the DM view, its secret door and its hidden token', () => {
    expect(svg).toContain('DM VIEW')
    expect(svg).toContain(SECRET_LEAF)
    expect(svg).toContain(HIDDEN_TOKEN)
  })

  it('draws a scale bar in the map\'s own units', () => {
    expect(svg).toContain('2 sq · 10 ft')
  })

  it('is deterministic — the same document renders byte for byte', () => {
    expect(mapSvg(dmMap, { dmView: true, tokens })).toBe(svg)
  })
})

describe('mapSvg — the player document', () => {
  const svg = mapSvg(playerMap, { tokens })

  it('renders only what the party has uncovered', () => {
    expect(svg).toMatchSnapshot()
  })

  it('keeps the full map\'s frame, so the dark half is visible as dark', () => {
    // frame is 0..22 wide; one cell of padding either side.
    expect(svg).toContain('viewBox="-1 ')
    expect(svg).toContain('24 ')
  })

  it('has no room the redactor cut', () => {
    expect(svg).toContain('West Hall')
    expect(svg).not.toContain('Vault of Coins')
  })

  it('never draws a hidden token, whatever the observer handed over', () => {
    expect(svg).not.toContain(HIDDEN_TOKEN)
    expect(svg).toContain('>Z</text>')
  })
})

describe('mapSvg — the second lock on DM-only geometry', () => {
  it('drops secret doors from a player render even when the document still carries them', () => {
    // A mis-issued token, or a server that forgot: the renderer refuses anyway.
    expect(mapSvg(dmMap, { dmView: false })).not.toContain(SECRET_LEAF)
    expect(mapSvg(dmMap, { dmView: true })).toContain(SECRET_LEAF)
  })

  it('drops hidden tokens from a player render', () => {
    const hidden: MapToken[] = [
      { id: 'x', name: 'Ambusher', x: 2, y: 2, cells: 1, disposition: 'hostile', hidden: true },
    ]
    expect(mapSvg(playerMap, { tokens: hidden })).not.toContain(HIDDEN_TOKEN)
    expect(mapSvg(playerMap, { tokens: hidden, dmView: true })).toContain(HIDDEN_TOKEN)
  })
})

describe('mapSvg — an imported battlemap', () => {
  it('draws the DM the whole image, uncut', () => {
    const svg = mapSvg(battlemap, { dmView: true })
    expect(svg).toContain('<image href="data:image/png;base64,')
    expect(svg).not.toContain('clip-path="url(#seen)"')
    expect(svg).toMatchSnapshot()
  })

  it('cuts the party\'s image to the cells they have swept', () => {
    const svg = mapSvg(battlemap, { region })
    expect(svg).toContain('clip-path="url(#seen)"')
    // The four-cell run on row 1 is one rect, the two-cell run on row 2 another, the stray
    // cell at (7, 5) a third — not seven rects, and not one per cell of the map.
    expect(svg).toContain('<clipPath id="seen"><rect x="1" y="1" width="4" height="1"/>')
    expect(svg).toContain('<rect x="1" y="2" width="2" height="1"/>')
    expect(svg).toContain('<rect x="7" y="5" width="1" height="1"/>')
    expect(svg).toMatchSnapshot()
  })

  it('draws no image at all when the party has no region and no floors', () => {
    // The fog-leak guarantee: a missing mask never means "show everything".
    const svg = mapSvg(battlemapImageOnly)
    expect(svg).not.toContain('<image')
    expect(svg).toContain('Nothing explored yet')
    // Same document, same absent mask, DM token: the DM still sees it.
    expect(mapSvg(battlemapImageOnly, { dmView: true })).toContain('<image')
  })

  it('cuts tokens to the same seen ground as the image on a player sheet', () => {
    // A figure on ground the party never swept must not sit on their blank parchment.
    expect(mapSvg(battlemapImageOnly, { tokens })).not.toContain('<circle')
    expect(mapSvg(battlemapImageOnly, { tokens, region })).toContain('<g clip-path="url(#seen)"><circle')
    // The DM's own sheet draws them uncut, and with no clip group at all.
    const dm = mapSvg(battlemapImageOnly, { tokens, dmView: true })
    expect(dm).toContain('<circle')
    expect(dm).not.toContain('clip-path="url(#seen)"')
  })

  it('cuts lamps and labels the same way — a light on unswept ground says what is there', () => {
    const lit = {
      ...battlemapImageOnly,
      layers: [
        ...battlemapImageOnly.layers,
        {
          id: 'layer-lights',
          name: 'Lights',
          type: 'dungeon',
          visible: true,
          children: [
            { childType: 'light', visible: true, position: { x: 3, y: 3 } },
            { childType: 'text', visible: true, text: 'Millpond', position: { x: 9, y: 6 }, fontSize: 0.5 },
          ],
        },
      ],
    }
    const LAMP_RING = 'r="0.85"'
    expect(mapSvg(lit)).not.toContain(LAMP_RING)
    expect(mapSvg(lit)).not.toContain('Millpond')
    const cut = mapSvg(lit, { region })
    expect(cut.indexOf(LAMP_RING)).toBeGreaterThan(cut.indexOf('<g clip-path="url(#seen)">'))
    expect(cut.indexOf('Millpond')).toBeGreaterThan(cut.indexOf('<g clip-path="url(#seen)">'))
    expect(mapSvg(lit, { dmView: true })).toContain(LAMP_RING)
  })

  it('keeps the base image out of a player sheet even when the rest of the map came through', () => {
    expect(mapSvg(battlemap)).not.toContain('<image')
  })

  /** The same import with a floor traced on top of it, so there is a grid to suppress. */
  const traced = {
    ...battlemap,
    layers: [
      ...battlemap.layers,
      {
        id: 'layer-traced',
        name: 'Traced',
        type: 'dungeon',
        visible: true,
        children: [{ childType: 'shape', visible: true, contours: [[[1, 1], [6, 1], [6, 6], [1, 6]]] }],
      },
    ],
  }

  it('leaves the imported map its own grid rather than drawing a second one', () => {
    expect(mapSvg(traced, { dmView: true })).not.toContain('clip-path="url(#floors)"')
    expect(mapSvg(dmMap, { dmView: true })).toContain('clip-path="url(#floors)"')
  })

  it('cuts the image to traced floors when the party has those and no mask', () => {
    const svg = mapSvg(traced)
    expect(svg).toContain('clip-path="url(#seen)"')
    expect(svg).toContain('<clipPath id="seen"><path d="M1 1L6 1L6 6L1 6Z"')
  })
})

describe('regionCell — the packed mask', () => {
  const mask = maskOf(10, 4, [
    [0, 0],
    [9, 1],
    [3, 3],
  ])

  it('resolves cells set at known bit offsets', () => {
    // bit 0, bit 1*10+9 = 19 (byte 2, bit 3), bit 3*10+3 = 33 (byte 4, bit 1).
    expect(regionCell(mask, 0, 0)).toBe(true)
    expect(regionCell(mask, 9, 1)).toBe(true)
    expect(regionCell(mask, 3, 3)).toBe(true)
  })

  it('says no to every cell nobody set, and to cells off the mask', () => {
    expect(regionCell(mask, 1, 0)).toBe(false)
    expect(regionCell(mask, 0, 1)).toBe(false)
    expect(regionCell(mask, 10, 0)).toBe(false)
    expect(regionCell(mask, 0, 4)).toBe(false)
    expect(regionCell(mask, -1, 0)).toBe(false)
    expect(regionCell(undefined, 0, 0)).toBe(false)
  })
})

describe('mapSvg — degenerate documents', () => {
  it('renders an honest empty sheet rather than an error', () => {
    for (const doc of [null, {}, { layers: [] }, { layers: [{ type: 'dungeon', children: [] }] }]) {
      const svg = mapSvg(doc)
      expect(svg).toContain('Nothing explored yet')
      expect(svg.startsWith('<svg')).toBe(true)
    }
  })

  it('survives a document whose fields are the wrong shape', () => {
    const junk = {
      mapSettings: { name: 42, cellScale: 'five feet' },
      layers: [{ type: 'dungeon', children: [{ childType: 'shape', contours: [[[0, 0], [4, 'x']]] }, null] }],
    }
    expect(() => mapSvg(junk)).not.toThrow()
  })

  it('escapes text that would otherwise close a tag', () => {
    const doc = {
      mapSettings: { name: '<script>&' },
      layers: [
        {
          type: 'dungeon',
          children: [{ childType: 'shape', contours: [[[0, 0], [4, 0], [4, 4], [0, 4]]] }],
        },
      ],
    }
    const svg = mapSvg(doc)
    expect(svg).toContain('&lt;SCRIPT&gt;&amp;')
    expect(svg).not.toContain('<script>')
  })
})
