// Format 3.3 at the table: a map with a plateau, stairs and the DM's own crossing kinds goes up,
// comes back whole to the DM and to a player (the note included: the chip shows it), and the
// tokens module's ground reads its heights and blocking edges.
import { describe, expect, it } from 'vitest'
import { createAdminPass } from './auth'
import { startServer } from './index'
import { createTerrain } from './fog/terrain'
import type { SceneMap } from './fog/sceneMap'

const rect = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  childType: 'shape',
  visible: true,
  shapeType: 'rectangle',
  contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
  textureScale: 1,
  textureOffsetX: 0,
  textureOffsetY: 0,
  textureFillRotation: 0,
  textureTint: '#ffffff',
  ...extra,
})

const plat = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  childType: 'plateau',
  visible: true,
  contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
  height: 1,
  edge: 'cliff',
  ...extra,
})

const KINDS = [
  { id: 'free', name: 'Free', blocks: false },
  { id: 'climb', name: 'Climb', note: 'DC 15 Athletics', blocks: false },
  { id: 'rope', name: 'Rope', note: 'Needs a rope', blocks: true },
]

const MAP = {
  version: '3.3',
  mapSettings: {
    name: 'Mesa',
    cellScale: { value: 5, unit: 'ft' },
    ambientLight: '#101018',
    sightDropCells: 3,
    crossingKinds: KINDS,
  },
  grid: { visible: true, snapDivision: 1, style: 'clean' },
  layers: [
    {
      id: 'layer-1',
      name: 'Dungeon',
      type: 'dungeon',
      visible: true,
      locked: false,
      opacity: 1,
      children: [
        rect('ground', 0, 0, 30, 30),
        plat('mesa', 10, 10, 14, 14, { height: 3, edge: 'cliff', crossingId: 'rope', sightOverride: 'hide' }),
        { id: 'st', name: 'Stairs 1', childType: 'opening', visible: true, kind: 'stairs', hostId: 'mesa', t: 0.875, width: 2 },
      ],
      standaloneWalls: [],
      rooms: [],
      style: {},
    },
  ],
  customImages: {},
}

async function api(base: string, method: string, path: string, token?: string, raw?: string) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(raw ? { 'content-type': 'application/json' } : {}),
    },
    body: raw,
  })
  const text = await response.text()
  return { status: response.status, text, body: text.startsWith('{') ? (JSON.parse(text) as Record<string, unknown>) : {} }
}

type Doc = typeof MAP

describe('format 3.3 round trip', () => {
  it('keeps plateaus, openings, the sight threshold and the crossing kinds for the DM and the players', async () => {
    const server = await startServer({ port: 0, trustedPort: 0, heartbeatMs: 60_000, dbPath: ':memory:' })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const adminPass = createAdminPass(server.stores.passes)
      const campaign = await api(base, 'POST', '/api/campaigns', adminPass, JSON.stringify({}))
      const dmToken = campaign.body.token as string
      const campaignId = campaign.body.campaignId as string
      const uploaded = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, dmToken, JSON.stringify(MAP))
      expect(uploaded.status).toBe(201)
      const sceneId = uploaded.body.sceneId as string

      const dmMap = JSON.parse((await api(base, 'GET', `/api/maps/${sceneId}`, dmToken)).text) as Doc
      expect(dmMap.version).toBe('3.3')
      expect(dmMap.mapSettings.sightDropCells).toBe(3)
      expect(dmMap.mapSettings.crossingKinds).toEqual(KINDS)
      const dmChildren = dmMap.layers[0].children
      expect(dmChildren.find((c) => c.id === 'mesa')).toMatchObject({ height: 3, edge: 'cliff', crossingId: 'rope' })
      expect(dmChildren.find((c) => c.id === 'st')).toMatchObject({ childType: 'opening', hostId: 'mesa', t: 0.875 })

      await api(base, 'PATCH', `/api/scenes/${sceneId}`, dmToken, JSON.stringify({ visibleToPlayers: true }))
      const started = await api(base, 'POST', '/api/sessions', dmToken, JSON.stringify({ campaignId, sceneId }))
      const joined = await api(base, 'POST', '/api/join', undefined, JSON.stringify({ code: started.body.inviteCode, name: 'Bob' }))
      const playerMap = JSON.parse((await api(base, 'GET', `/api/maps/${sceneId}`, joined.body.token as string)).text) as Doc
      // The chip a player's drag shows names the kind and the DM's note, so both travel.
      expect(playerMap.mapSettings.crossingKinds).toEqual(KINDS)
      expect(playerMap.layers[0].children.some((c) => c.id === 'st')).toBe(true)
      // Plateaus are relief: they ship whole, so a player reads the heights the DM does.
      expect(playerMap.layers[0].children.find((c) => c.id === 'mesa')).toMatchObject({ childType: 'plateau', height: 3 })
    } finally {
      await server.close()
    }
  })
})

describe('the ground the tokens stand on', () => {
  const scene = { campaignId: 'c-1', data: MAP } as unknown as SceneMap
  let live: { byScene: Record<string, { edges: Record<string, string>; blocks: Record<string, boolean> }> } | undefined
  const terrainOf = createTerrain((id) => (id === 'scene-a' ? scene : null), () => live)

  it('reads heights off the plateau and part way down its stairs', () => {
    const t = terrainOf('scene-a')!
    expect(t.elevationAt(12, 12)).toBe(3)
    expect(t.elevationAt(5, 5)).toBe(0)
    expect(t.elevationAt(8.5, 12)).toBeCloseTo(1.5)
    expect(terrainOf('no-such-scene')).toBeNull()
  })

  it('refuses a crossing whose kind blocks, but never through the stairs, and follows the DM’s live rules', () => {
    const t = terrainOf('scene-a')!
    expect(t.crossingRefusal({ x: 12, y: 8 }, { x: 12, y: 11 })).toBe('CROSSING_BLOCKED rope: Rope — Needs a rope')
    expect(t.crossingRefusal({ x: 8, y: 12 }, { x: 11, y: 12 })).toBeNull()
    live = { byScene: { 'scene-a': { edges: { mesa: 'climb' }, blocks: {} } } }
    expect(t.crossingRefusal({ x: 12, y: 8 }, { x: 12, y: 11 })).toBeNull()
    live = { byScene: { 'scene-a': { edges: { mesa: 'climb' }, blocks: { climb: true } } } }
    expect(t.crossingRefusal({ x: 12, y: 8 }, { x: 12, y: 11 })).toMatch(/^CROSSING_BLOCKED climb/)
  })
})

describe('a bridge at the table', () => {
  // plateau-test's scenario 5: a plank bridge from the +2 outcrop to the +3 far mesa, over a
  // -2 pit, every cliff roped (its kind refuses a move).
  const bridge = {
    id: 'bridge',
    name: 'Plank bridge',
    childType: 'path',
    visible: true,
    points: [
      { x: 7, y: 11, height: 2 },
      { x: 7, y: 26, height: 3 },
    ],
    closed: false,
    width: 2,
    heightMode: 'set',
    materialId: 'gg-forge:planks',
    tint: '#ffffff',
    opacity: 1,
    offset: 0,
    flip: false,
    edge: 'hard',
    ends: { start: 'cut', end: 'cut', length: 1 },
    sort: 'overhead',
    under: 'walkable',
  }
  const cliff = { edge: 'cliff', crossingId: 'rope' }
  const data = {
    ...MAP,
    layers: [
      {
        ...MAP.layers[0],
        children: [
          rect('ground', 0, 0, 40, 40),
          plat('outcrop', 4, 4, 12, 11, { height: 2, ...cliff }),
          plat('pit', 5, 17, 11, 23, { height: -2, ...cliff }),
          plat('far-mesa', 4, 26, 12, 31, { height: 3, ...cliff }),
          bridge,
        ],
      },
    ],
  }
  const terrainOf = createTerrain((id) => (id === 'scene-b' ? ({ campaignId: 'c-1', data } as unknown as SceneMap) : null), () => undefined)

  it('stands a token that walks on from the landing at the deck’s height, and one beneath on the ground', () => {
    const t = terrainOf('scene-b')!
    // Over the pit: the deck rises from 2 to 3 along its 15 cells.
    expect(t.elevationAt(7, 20, undefined, 2)).toBe(2.6)
    expect(t.elevationAt(7, 25, undefined, 2.6)).toBe(2.9)
    // From the pit floor, or with no height before (a token placed there): the pit floor.
    expect(t.elevationAt(7, 20, undefined, -2)).toBe(-2)
    expect(t.elevationAt(7, 20)).toBe(-2)
    // On the ground beneath, between the outcrop and the pit.
    expect(t.elevationAt(7, 14, undefined, 0)).toBe(0)
    // Off the deck's width it is the ground again, whatever the height before.
    expect(t.elevationAt(9.5, 14, undefined, 2)).toBe(0)
  })

  it('lets a token on the deck cross the pit’s roped cliffs and both landings, but not one beneath', () => {
    const t = terrainOf('scene-b')!
    expect(t.crossingRefusal({ x: 7, y: 10.5 }, { x: 7, y: 27 }, undefined, 2)).toBeNull()
    // Beneath: into the pit over its rope cliff, and up into the outcrop by the landing.
    expect(t.crossingRefusal({ x: 7, y: 14 }, { x: 7, y: 19 }, undefined, 0)).toMatch(/^CROSSING_BLOCKED rope/)
    expect(t.crossingRefusal({ x: 7, y: 12 }, { x: 7, y: 10 }, undefined, 0)).toMatch(/^CROSSING_BLOCKED rope/)
  })
})
