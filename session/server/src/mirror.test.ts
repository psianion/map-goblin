// Decision 14 over a real server: one .ggvtt per scene on disk and one map row per scene,
// however often it is published; a deleted scene leaves no file, row or state behind; and
// the campaign export holds every scene, the state, the assets and a manifest.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { unzipSync } from 'fflate'
import { beforeAll, describe, expect, it } from 'vitest'
import type { GameModule } from '@dnd/mechanics/contract'
import { createAdminPass } from './auth'
import { createMirror, slug } from './mirror'
import { startServer, type RunningServer } from './index'

beforeAll(() => {
  process.env.GAME_SERVER_DATA = mkdtempSync(join(tmpdir(), 'game-server-mirror-'))
})

const map = (name: string, extra: Record<string, unknown> = {}) => ({
  version: '3.0',
  mapSettings: { name, cellScale: { value: 5, unit: 'ft' }, ambientLight: '#101018' },
  grid: { visible: true, snapDivision: 1, style: 'clean' },
  layers: [{ id: 'layer-1', name: 'Dungeon', type: 'dungeon', visible: true, locked: false, opacity: 1 }],
  customImages: {},
  ...extra,
})

/** A module keeping one slice per scene, like fog and tokens do. */
type ProbeState = { byScene: Record<string, number> }
const probe = {
  name: 'probe',
  initialState: { byScene: {} },
  commands: {},
  handle: () => null,
  forgetScene: (state: ProbeState, sceneId: string): ProbeState => {
    const rest = { ...state.byScene }
    delete rest[sceneId]
    return { byScene: rest }
  },
} as unknown as GameModule

interface Fixture {
  server: RunningServer
  base: string
  root: string
  campaignId: string
  token: string
}

async function withCampaign(body: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'game-server-maps-'))
  const server = await startServer({
    port: 0,
    trustedPort: 0,
    heartbeatMs: 60_000,
    dbPath: ':memory:',
    mirrorRoot: root,
    modules: [probe],
  })
  try {
    const base = `http://127.0.0.1:${server.port}`
    const created = await call(base, 'POST', '/api/campaigns', {
      token: createAdminPass(server.stores.passes),
      body: { name: 'Émberhold: The Crypt' },
    })
    await body({ server, base, root, campaignId: created.body.campaignId as string, token: created.body.token as string })
  } finally {
    await server.close()
  }
}

async function call(
  base: string,
  method: string,
  path: string,
  { token, body, raw }: { token?: string; body?: unknown; raw?: string } = {},
): Promise<{ status: number; body: Record<string, unknown>; bytes: Uint8Array; headers: Headers }> {
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body))
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: payload,
  })
  const bytes = new Uint8Array(await response.arrayBuffer())
  const text = new TextDecoder().decode(bytes)
  return {
    status: response.status,
    bytes,
    headers: response.headers,
    body: text.startsWith('{') ? (JSON.parse(text) as Record<string, unknown>) : {},
  }
}

/** Every .ggvtt under the root, as `<campaign dir>/<file>`. */
function files(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root).flatMap((dir) => readdirSync(join(root, dir)).map((f) => `${dir}/${f}`))
}

/** The JSON inside a .ggvtt container. */
function readGgvtt(bytes: Uint8Array): Record<string, unknown> {
  const buffer = Buffer.from(bytes)
  expect(buffer.subarray(0, 6).toString('latin1')).toBe('MPBLD\0')
  return JSON.parse(gunzipSync(buffer.subarray(6)).toString('utf8')) as Record<string, unknown>
}

describe('slug', () => {
  it('is lowercase kebab, at most 40 characters, with a fallback', () => {
    expect(slug('Émberhold: The Crypt', 'campaign')).toBe('emberhold-the-crypt')
    expect(slug('a'.repeat(39) + ' b', 'scene')).toBe('a'.repeat(39))
    expect(slug('!!!', 'scene')).toBe('scene')
  })
})

describe('the map mirror', () => {
  it('keeps one file and one map row per scene through a publish and a republish', async () => {
    await withCampaign(async ({ server, base, root, campaignId, token }) => {
      const up = await call(base, 'POST', `/api/campaigns/${campaignId}/maps`, { token, raw: JSON.stringify(map('Lower Halls')) })
      expect(up.status).toBe(201)
      const sceneId = up.body.sceneId as string
      const dir = `emberhold-the-crypt--${campaignId.slice(0, 8)}`
      const file = `lower-halls--${sceneId.slice(0, 8)}.ggvtt`
      expect(files(root)).toEqual([`${dir}/${file}`])

      const again = await call(base, 'PUT', `/api/scenes/${sceneId}/publish`, {
        token,
        raw: JSON.stringify(map('Lower Halls', { grid: { visible: false, snapDivision: 2, style: 'clean' } })),
      })
      expect(again.status).toBe(200)
      expect(files(root)).toEqual([`${dir}/${file}`])
      expect(readGgvtt(readFileSync(join(root, dir, file)))).toMatchObject({ grid: { snapDivision: 2 } })
      expect(server.stores.maps.listByCampaign(campaignId).map((m) => m.id)).toEqual([again.body.mapId])
    })
  })

  it('moves the file when the scene is renamed', async () => {
    await withCampaign(async ({ base, root, campaignId, token }) => {
      const up = await call(base, 'POST', `/api/campaigns/${campaignId}/maps`, { token, raw: JSON.stringify(map('Lower Halls')) })
      const sceneId = up.body.sceneId as string
      expect((await call(base, 'PATCH', `/api/scenes/${sceneId}`, { token, body: { name: 'Bone Pit' } })).status).toBe(200)
      expect(files(root)).toEqual([`emberhold-the-crypt--${campaignId.slice(0, 8)}/bone-pit--${sceneId.slice(0, 8)}.ggvtt`])
    })
  })

  it('takes the file, the map row and the scene state with a deleted scene', async () => {
    await withCampaign(async ({ server, base, root, campaignId, token }) => {
      const keep = await call(base, 'POST', `/api/campaigns/${campaignId}/maps`, { token, raw: JSON.stringify(map('Keep')) })
      const gone = await call(base, 'POST', `/api/campaigns/${campaignId}/maps`, { token, raw: JSON.stringify(map('Gone')) })
      const keepId = keep.body.sceneId as string
      const goneId = gone.body.sceneId as string
      server.stores.moduleState.put(campaignId, 'probe', { byScene: { [keepId]: 1, [goneId]: 2 } })

      expect((await call(base, 'DELETE', `/api/scenes/${goneId}`, { token })).status).toBe(200)

      expect(files(root)).toEqual([`emberhold-the-crypt--${campaignId.slice(0, 8)}/keep--${keepId.slice(0, 8)}.ggvtt`])
      expect(server.stores.maps.listByCampaign(campaignId).map((m) => m.id)).toEqual([keep.body.mapId])
      expect(server.stores.moduleState.get(campaignId, 'probe')).toEqual({ byScene: { [keepId]: 1 } })
    })
  })

  it('on startup writes the files that are missing and removes the ones whose scene is gone', async () => {
    await withCampaign(async ({ server, base, root, campaignId, token }) => {
      const up = await call(base, 'POST', `/api/campaigns/${campaignId}/maps`, { token, raw: JSON.stringify(map('Keep')) })
      const sceneId = up.body.sceneId as string
      const dir = join(root, `emberhold-the-crypt--${campaignId.slice(0, 8)}`)
      const expected = `keep--${sceneId.slice(0, 8)}.ggvtt`
      writeFileSync(join(dir, 'stale--deadbeef.ggvtt'), 'old')
      mkdirSync(join(root, 'gone-campaign--12345678'))
      writeFileSync(join(root, 'gone-campaign--12345678', 'x--12345678.ggvtt'), 'old')

      const fresh = mkdtempSync(join(tmpdir(), 'game-server-maps-'))
      expect(createMirror(fresh, server.stores).sync()).toEqual({ written: 1, removed: 0 })
      expect(readdirSync(join(fresh, `emberhold-the-crypt--${campaignId.slice(0, 8)}`))).toEqual([expected])

      expect(createMirror(root, server.stores).sync()).toEqual({ written: 0, removed: 2 })
      expect(files(root)).toEqual([`emberhold-the-crypt--${campaignId.slice(0, 8)}/${expected}`])
    })
  })
})

describe('the campaign export', () => {
  it('zips every scene, the module state, the assets and a manifest', async () => {
    await withCampaign(async ({ server, base, campaignId, token }) => {
      const a = await call(base, 'POST', `/api/campaigns/${campaignId}/maps`, {
        token,
        raw: JSON.stringify(map('Lower Halls', { prep: { version: 3, triggers: [], notes: [], rooms: [] } })),
      })
      const b = await call(base, 'POST', `/api/campaigns/${campaignId}/maps`, { token, raw: JSON.stringify(map('Bone Pit')) })
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])
      const asset = server.stores.assets.insert('asset-1', campaignId, 'image/png', png)
      server.stores.moduleState.put(campaignId, 'probe', { byScene: { [a.body.sceneId as string]: 7 } })

      const res = await call(base, 'GET', `/api/campaigns/${campaignId}/export`, { token })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/zip')
      const zip = unzipSync(res.bytes)
      const aFile = `maps/lower-halls--${(a.body.sceneId as string).slice(0, 8)}.ggvtt`
      const bFile = `maps/bone-pit--${(b.body.sceneId as string).slice(0, 8)}.ggvtt`
      expect(Object.keys(zip).sort()).toEqual(
        ['assets.json', 'assets/asset-1.png', aFile, bFile, 'manifest.json', 'state.json'].sort(),
      )
      expect(readGgvtt(zip[aFile]!)).toMatchObject({ mapSettings: { name: 'Lower Halls' } })
      expect(Buffer.from(zip['assets/asset-1.png']!)).toEqual(asset.bytes)

      const manifest = JSON.parse(new TextDecoder().decode(zip['manifest.json']!))
      expect(manifest).toMatchObject({
        campaign: { id: campaignId, name: 'Émberhold: The Crypt' },
        protocolVersion: expect.any(Number),
        exportedAt: expect.any(String),
      })
      expect(manifest.scenes).toEqual([
        expect.objectContaining({ name: 'Lower Halls', order: 0, visibleToPlayers: false, file: aFile, prep: expect.objectContaining({ version: 3 }) }),
        expect.objectContaining({ name: 'Bone Pit', order: 1, file: bFile, prep: null }),
      ])
      expect(JSON.parse(new TextDecoder().decode(zip['state.json']!))).toMatchObject({ probe: { byScene: { [a.body.sceneId as string]: 7 } } })
      expect(JSON.parse(new TextDecoder().decode(zip['assets.json']!))).toEqual([
        expect.objectContaining({ id: 'asset-1', file: 'assets/asset-1.png', mime: 'image/png' }),
      ])
    })
  })

  it('is the campaign DM’s alone', async () => {
    await withCampaign(async ({ base, campaignId }) => {
      expect((await call(base, 'GET', `/api/campaigns/${campaignId}/export`)).status).toBe(401)
    })
  })
})
