import { describe, expect, it } from 'vitest'
import { dmMap, playerMap, tokens } from './__fixtures__/two-rooms'
import { mapSvg, type MapToken } from './map-svg'

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
