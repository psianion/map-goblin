import { describe, expect, it } from 'vitest'
import { dmMap, playerMap, tokens } from './__fixtures__/two-rooms'
import { mapSvg, readScene, type MapToken } from './map-svg'

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

describe('mapSvg — live door state', () => {
  // The fixture's hall door is authored closed and the vault door open; the table has since
  // opened the one and shut and locked the other.
  const doors = {
    'door-west': { open: true, locked: false },
    'door-vault': { open: false, locked: true },
  }
  const svg = mapSvg(playerMap, { tokens, doors })

  it('draws each door as the table left it, not as the file has it', () => {
    expect(svg).toMatchSnapshot()
    expect(svg).not.toBe(mapSvg(playerMap, { tokens }))
    expect(readScene(playerMap, false, doors).doors.map((door) => door.state)).toEqual(['open', 'locked'])
  })

  it('keeps the authored state for a door the table has said nothing about', () => {
    expect(readScene(playerMap, false, {}).doors.map((door) => door.state)).toEqual(['closed', 'open'])
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

describe('mapSvg — wall widths', () => {
  const doc = (walls: Record<string, unknown>[], wallWidth?: number) => ({
    layers: [{ type: 'dungeon', children: [], style: wallWidth === undefined ? {} : { wallWidth }, standaloneWalls: walls }],
  })
  const wall = (extra: Record<string, unknown> = {}) => ({ points: [[0, 0], [4, 0]], wallType: 'normal', ...extra })

  it('a wall without its own width takes its layer width, as the editor draws it', () => {
    expect(readScene(doc([wall()], 0.5), true).walls[0].width).toBe(0.5)
    expect(readScene(doc([wall({ width: 0.2 })], 0.5), true).walls[0].width).toBe(0.2)
  })

  it('falls back to a thin stroke when neither says', () => {
    expect(readScene(doc([wall()]), true).walls[0].width).toBe(0.3)
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

describe('mapSvg — map labels', () => {
  const floor = { childType: 'shape', contours: [[[0, 0], [12, 0], [12, 8], [0, 8]]] }
  const label = (text: string, extra: Record<string, unknown> = {}) => ({
    childType: 'text',
    text,
    position: { x: 6, y: 4 },
    rotation: 0,
    scale: 1,
    fontSize: 0.8,
    color: '#1b1b1b',
    width: 4,
    height: 1,
    ...extra,
  })
  const render = (...children: unknown[]) => mapSvg({ layers: [{ type: 'dungeon', children: [floor, ...children] }] }, { dmView: true })

  it('skips a DM-only label in every render, and draws one marked for players', () => {
    const svg = render(label('Trap here'), label('Beware', { players: true }))
    expect(svg).not.toContain('>Trap here</text>')
    expect(svg).toContain('>Beware</text>')
  })

  it('draws a label in its own colour and weight, MUTED when the colour is missing', () => {
    const svg = render(label('Red', { players: true, color: '#aa2222', weight: 'bold' }), label('Plain', { players: true, color: 7 }))
    expect(svg).toMatch(/<text [^>]*fill="#aa2222"[^>]*font-weight="700"[^>]*>Red<\/text>/)
    expect(svg).toMatch(/<text [^>]*fill="#6b5c46"[^>]*>Plain<\/text>/)
  })

  it('lines a left label up on its box’s left edge and a right one on its right edge', () => {
    const svg = render(label('Left', { players: true, align: 'left' }), label('Right', { players: true, align: 'right' }))
    expect(svg).toMatch(/<text x="4" [^>]*text-anchor="start"[^>]*>Left<\/text>/)
    expect(svg).toMatch(/<text x="8" [^>]*text-anchor="end"[^>]*>Right<\/text>/)
  })
})

describe('mapSvg — plateaus', () => {
  const floor = { childType: 'shape', visible: true, contours: [[[0, 0], [20, 0], [20, 14], [0, 14]]] }
  const plateau = (height: number) => ({
    childType: 'plateau',
    visible: true,
    contours: [[[4, 4], [10, 4], [10, 9], [4, 9]]],
    height,
    edge: 'cliff',
  })
  /** The contour path's rings, as the M commands that start them. */
  const rings = (svg: string) => {
    const m = /<path d="([^"]*)" fill="none" stroke="#[0-9a-f]+" stroke-opacity="0.7"/.exec(svg)
    return m ? [...m[1].matchAll(/M([-\d.]+) ([-\d.]+)/g)].map((r) => [Number(r[1]), Number(r[2])]) : []
  }
  const render = (...children: unknown[]) => mapSvg({ layers: [{ type: 'dungeon', children: [floor, ...children] }] })

  it('draws one contour ring per cell of drop, the outline first, out from a plateau', () => {
    const three = rings(render(plateau(3)))
    expect(three).toHaveLength(3)
    expect(three[0]).toEqual([4, 4])
    expect(three[1][0]).toBeLessThan(4)
    expect(three[2][0]).toBeLessThan(three[1][0])
    expect(rings(render(plateau(1)))).toHaveLength(1)
  })

  it('draws a pit’s rings inward, and nothing for a plateau with no height', () => {
    const pit = rings(render(plateau(-2)))
    expect(pit).toHaveLength(2)
    expect(pit[1][0]).toBeGreaterThan(4)
    expect(rings(render(plateau(0)))).toHaveLength(0)
  })
})
