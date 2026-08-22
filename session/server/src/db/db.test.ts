// Real SQLite, no mocks: `:memory:` for the store tests, a temp file for the one that
// has to prove data outlives the process (tracker: "campaign persists across restart").

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import Sqlite from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrate, openDb, type Database } from './db'
import { MIGRATIONS } from './migrations'
import {
  AssetStore,
  CampaignStore,
  IdentityStore,
  MAX_MAP_BYTES,
  MAX_MAP_JSON_BYTES,
  MapStore,
  ModuleStateStore,
  PassStore,
  SceneStore,
  SessionStore,
} from './stores'

let db: Database

beforeEach(() => {
  db = openDb(':memory:')
})

afterEach(() => {
  db.close()
})

describe('migrations', () => {
  it('applies once and does nothing the second time', () => {
    // openDb already migrated, so a fresh run must find nothing left to do.
    expect(migrate(db)).toBe(0)
    expect(migrate(db)).toBe(0)

    const tables = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((t) => t.name)
    expect(tables).toEqual([
      'assets',
      'campaigns',
      'identities',
      'maps',
      'migrations',
      'module_state',
      'passes',
      'scenes',
      'sessions',
      'waitlist',
    ])
  })

  it('turns on the pragmas the rest of the code assumes', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)

    const campaigns = new CampaignStore(db)
    const maps = new MapStore(db)
    expect(() => maps.insert('m', 'no-such-campaign', 'Orphan', '{}')).toThrow(/FOREIGN KEY/i)
    expect(() => maps.insert('m', campaigns.create('Real').id, 'Fine', '{}')).not.toThrow()
  })
})

describe('CampaignStore', () => {
  it('creates, reads back, lists and touches', () => {
    const campaigns = new CampaignStore(db)
    const cragmaw = campaigns.create('Cragmaw Hideout')

    expect(campaigns.get(cragmaw.id)).toEqual(cragmaw)
    expect(campaigns.get('missing')).toBeUndefined()

    const other = campaigns.create('Wave Echo Cave')
    expect(campaigns.list().map((c) => c.name)).toContain('Wave Echo Cave')
    expect(campaigns.list()).toHaveLength(2)

    campaigns.touch(cragmaw.id)
    const touched = campaigns.get(cragmaw.id)
    expect(touched?.updated_at).toBeGreaterThanOrEqual(cragmaw.updated_at)
    expect(touched?.created_at).toBe(cragmaw.created_at)
    expect(campaigns.get(other.id)?.updated_at).toBe(other.updated_at)
  })
})

describe('MapStore', () => {
  it('stores a map, reads it back, and lists metadata without the payload', () => {
    const campaign = new CampaignStore(db).create('C')
    const maps = new MapStore(db)
    const data = JSON.stringify({ version: 1, layers: [] })

    const stored = maps.insert('map-1', campaign.id, 'Hideout', data)
    expect(stored.size_bytes).toBe(Buffer.byteLength(data))
    expect(maps.get('map-1')?.data).toBe(data)
    expect(maps.get('nope')).toBeUndefined()

    maps.insert('map-2', campaign.id, 'Cave', '{}')
    const listed = maps.listByCampaign(campaign.id)
    expect(listed.map((m) => m.name)).toEqual(['Hideout', 'Cave'])
    expect(listed[0]).not.toHaveProperty('data')
    expect(maps.listByCampaign('other-campaign')).toEqual([])
  })

  it('rejects anything over the unpacked cap without writing it', () => {
    const campaign = new CampaignStore(db).create('C')
    const maps = new MapStore(db)

    expect(() =>
      maps.insert('huge', campaign.id, 'Huge', 'x'.repeat(MAX_MAP_JSON_BYTES + 1)),
    ).toThrow(/too large/)
    expect(maps.get('huge')).toBeUndefined()
    // A document bigger than the *wire* cap is fine here: gzip is why it fit on the wire.
    expect(() =>
      maps.insert('embedded-art', campaign.id, 'Art', 'x'.repeat(MAX_MAP_BYTES + 1)),
    ).not.toThrow()
  })
})

describe('SceneStore (#47)', () => {
  it('creates in drag order, republishes in place, renames, hides/shows and reorders', () => {
    const campaign = new CampaignStore(db).create('C')
    const maps = new MapStore(db)
    const scenes = new SceneStore(db)
    const mapA = maps.insert('map-a', campaign.id, 'A', '{}')
    const mapB = maps.insert('map-b', campaign.id, 'B', '{}')
    const mapC = maps.insert('map-c', campaign.id, 'C-replacement', '{}')

    const first = scenes.create('scene-1', campaign.id, mapA.id, 'Hall')
    expect(first.sort_index).toBe(0)
    expect(first.visible_to_players).toBe(0) // hidden by default (D5)
    const second = scenes.create('scene-2', campaign.id, mapB.id, 'Crypt')
    expect(second.sort_index).toBe(1)

    expect(scenes.get('scene-1')).toEqual(first)
    expect(scenes.get('nope')).toBeUndefined()
    expect(scenes.listByCampaign(campaign.id).map((s) => s.name)).toEqual(['Hall', 'Crypt'])

    // Re-publish (D1's fix): the id — what fog/tokens/doors and active_scene_id key on —
    // never moves. Only the map it points at does.
    scenes.republish('scene-1', mapC.id)
    const republished = scenes.get('scene-1')!
    expect(republished.id).toBe('scene-1')
    expect(republished.map_id).toBe(mapC.id)
    expect(republished.updated_at).toBeGreaterThanOrEqual(first.updated_at)

    scenes.rename('scene-1', 'Great Hall')
    expect(scenes.get('scene-1')?.name).toBe('Great Hall')

    scenes.setVisibleToPlayers('scene-1', true)
    expect(scenes.get('scene-1')?.visible_to_players).toBe(1)
    scenes.setVisibleToPlayers('scene-1', false)
    expect(scenes.get('scene-1')?.visible_to_players).toBe(0)

    scenes.reorder(['scene-2', 'scene-1'])
    expect(scenes.listByCampaign(campaign.id).map((s) => s.id)).toEqual(['scene-2', 'scene-1'])

    scenes.delete('scene-2')
    expect(scenes.get('scene-2')).toBeUndefined()
    expect(scenes.listByCampaign(campaign.id)).toHaveLength(1)
  })

  it('keeps campaigns apart and rejects an orphan map', () => {
    const campaigns = new CampaignStore(db)
    const maps = new MapStore(db)
    const scenes = new SceneStore(db)
    const mine = campaigns.create('Mine')
    const yours = campaigns.create('Yours')
    scenes.create('s-mine', mine.id, maps.insert('m1', mine.id, 'M', '{}').id, 'Mine')
    scenes.create('s-yours', yours.id, maps.insert('m2', yours.id, 'M', '{}').id, 'Yours')

    expect(scenes.listByCampaign(mine.id).map((s) => s.id)).toEqual(['s-mine'])
    expect(scenes.listByCampaign(yours.id).map((s) => s.id)).toEqual(['s-yours'])
    expect(() => scenes.create('orphan', mine.id, 'no-such-map', 'Orphan')).toThrow(/FOREIGN KEY/i)
  })

  it('refuses two scenes pointing at the same map row', () => {
    const campaign = new CampaignStore(db).create('C')
    const map = new MapStore(db).insert('shared-map', campaign.id, 'M', '{}')
    const scenes = new SceneStore(db)
    scenes.create('s1', campaign.id, map.id, 'First')
    expect(() => scenes.create('s2', campaign.id, map.id, 'Second')).toThrow(/UNIQUE/i)
  })
})

describe('scenes migration (#47)', () => {
  /**
   * Simulates a database that predates migration 003: applies only migrations 1-2 by
   * hand (`openDb`/`migrate` always run every migration this build carries), seeds maps
   * the way a pre-#47 server would have, then runs the scenes migration on top and checks
   * every existing map came back as a scene with a *matching* id — the part that matters,
   * because that is what keeps `active_scene_id` and every `byScene` key resolving.
   */
  it('wraps every existing map row as a scene with the same id, hidden by default', () => {
    const raw = new Sqlite(':memory:')
    raw.pragma('foreign_keys = ON')
    raw.exec(MIGRATIONS[0]!) // campaigns, maps, sessions, identities, passes, module_state
    raw.exec(MIGRATIONS[1]!) // assets

    const campaigns = new CampaignStore(raw)
    const maps = new MapStore(raw)
    const cragmaw = campaigns.create('Cragmaw Hideout')
    const other = campaigns.create('Other')
    const first = maps.insert('legacy-map-1', cragmaw.id, 'Cragmaw Hideout', '{}')
    const secondMap = maps.insert('legacy-map-2', cragmaw.id, 'Wave Echo Cave', '{}')
    const theirs = maps.insert('their-map', other.id, 'Theirs', '{}')

    raw.exec(MIGRATIONS[2]!) // the scenes table + backfill
    raw.exec(MIGRATIONS[3]!) // scenes.prep column (M3) — SceneStore's statements expect it

    const scenes = new SceneStore(raw)
    // Same id as the map it wraps — a live server's `active_scene_id` or module state
    // naming `legacy-map-1` still resolves to exactly the map it always did.
    expect(scenes.get(first.id)).toMatchObject({
      id: first.id,
      map_id: first.id,
      name: 'Cragmaw Hideout',
      visible_to_players: 0,
    })
    expect(scenes.get(secondMap.id)?.map_id).toBe(secondMap.id)
    expect(scenes.get(theirs.id)).toMatchObject({ id: theirs.id, campaign_id: other.id })

    // Ordered, and kept apart by campaign — imported_at order becomes drag order.
    expect(scenes.listByCampaign(cragmaw.id).map((s) => s.id)).toEqual([first.id, secondMap.id])
    expect(scenes.listByCampaign(other.id).map((s) => s.id)).toEqual([theirs.id])

    raw.close()
  })
})

describe('SessionStore', () => {
  it('resolves an invite code only while the session is active', () => {
    const campaign = new CampaignStore(db).create('C')
    const sessions = new SessionStore(db)
    const session = sessions.createSession(campaign.id, 'ABC123')

    expect(sessions.getByInviteCode('ABC123')?.id).toBe(session.id)
    expect(sessions.getByInviteCode('NOPE00')).toBeUndefined()

    sessions.endSession(session.id)
    expect(sessions.getByInviteCode('ABC123')).toBeUndefined()
    expect(sessions.getActiveByCampaign(campaign.id)).toBeUndefined()
  })

  it('keeps at most one active session per campaign — a new one ends the old', () => {
    const campaigns = new CampaignStore(db)
    const sessions = new SessionStore(db)
    const campaign = campaigns.create('C')
    const elsewhere = campaigns.create('Other')

    const first = sessions.createSession(campaign.id, 'AAA111')
    const second = sessions.createSession(campaign.id, 'BBB222')

    expect(sessions.getActiveByCampaign(campaign.id)?.id).toBe(second.id)
    expect(sessions.getByInviteCode('AAA111')).toBeUndefined()
    expect(sessions.getByInviteCode('BBB222')?.id).toBe(second.id)
    expect(first.id).not.toBe(second.id)

    // Another campaign's session is untouched by any of that.
    const theirs = sessions.createSession(elsewhere.id, 'CCC333')
    expect(sessions.getActiveByCampaign(elsewhere.id)?.id).toBe(theirs.id)
    expect(sessions.getActiveByCampaign(campaign.id)?.id).toBe(second.id)
  })

  it('rejects a duplicate invite code', () => {
    const campaigns = new CampaignStore(db)
    const sessions = new SessionStore(db)
    sessions.createSession(campaigns.create('A').id, 'DUP123')
    expect(() => sessions.createSession(campaigns.create('B').id, 'DUP123')).toThrow(/UNIQUE/i)
  })

  it('moves the active scene', () => {
    const campaign = new CampaignStore(db).create('C')
    const sessions = new SessionStore(db)
    const session = sessions.createSession(campaign.id, 'SCN001')

    expect(sessions.getActiveByCampaign(campaign.id)?.active_scene_id).toBeNull()
    sessions.setActiveScene(session.id, 'map-1')
    expect(sessions.getActiveByCampaign(campaign.id)?.active_scene_id).toBe('map-1')
    sessions.setActiveScene(session.id, null)
    expect(sessions.getActiveByCampaign(campaign.id)?.active_scene_id).toBeNull()
  })

  it('clears the active scene wherever it was set, and leaves other scenes/sessions alone', () => {
    const campaign = new CampaignStore(db).create('C')
    const sessions = new SessionStore(db)
    const a = sessions.createSession(campaign.id, 'SCN002')
    sessions.setActiveScene(a.id, 'scene-doomed')
    expect(sessions.getActiveByCampaign(campaign.id)?.active_scene_id).toBe('scene-doomed')

    // #47 — a deleted scene stops being anyone's active one.
    sessions.clearActiveScene('scene-doomed')
    expect(sessions.getActiveByCampaign(campaign.id)?.active_scene_id).toBeNull()

    // Clearing a scene nobody had active is a no-op, not an error.
    sessions.setActiveScene(a.id, 'scene-kept')
    sessions.clearActiveScene('scene-never-active')
    expect(sessions.getActiveByCampaign(campaign.id)?.active_scene_id).toBe('scene-kept')
  })
})

describe('IdentityStore', () => {
  it('mints, bans and tracks last-seen', () => {
    const identities = new IdentityStore(db)
    const id = randomUUID()
    const minted = identities.mint(id, 'campaign-1', 'Bob', 'player')

    expect(minted.role).toBe('player')
    expect(identities.get(id)).toEqual(minted)
    expect(identities.isBanned(id)).toBe(false)
    expect(identities.isBanned('never-heard-of-them')).toBe(false)

    identities.ban(id)
    expect(identities.isBanned(id)).toBe(true)
    expect(identities.get(id)?.banned).toBe(1)

    expect(identities.get(id)?.last_seen).toBeNull()
    identities.touchLastSeen(id)
    expect(identities.get(id)?.last_seen).toBeGreaterThan(0)
  })
})

describe('PassStore', () => {
  it('finds live passes and ignores expired ones', () => {
    const passes = new PassStore(db)
    const admin = passes.create('hash-admin', null, null) // null campaign = server admin (D6)
    const dm = passes.create('hash-dm', 'campaign-1', Date.now() + 60_000)
    passes.create('hash-stale', 'campaign-1', Date.now() - 1)

    expect(passes.findValidByHash('hash-admin')).toEqual(admin)
    expect(passes.findValidByHash('hash-admin')?.campaign_id).toBeNull()
    expect(passes.findValidByHash('hash-dm')?.id).toBe(dm.id)
    expect(passes.findValidByHash('hash-stale')).toBeUndefined()
    expect(passes.findValidByHash('hash-nonexistent')).toBeUndefined()
  })
})

describe('ModuleStateStore', () => {
  it('round-trips JSON state, overwrites in place, and keeps campaigns and modules apart', () => {
    const campaigns = new CampaignStore(db)
    const mine = campaigns.create('Mine').id
    const yours = campaigns.create('Yours').id
    const state = new ModuleStateStore(db)

    // Never written = undefined, which is the registry's cue to seed `initialState`.
    expect(state.get(mine, 'tokens')).toBeUndefined()

    state.put(mine, 'tokens', { library: {}, byScene: { 'scene-1': { t1: { x: 3, y: 4 } } } })
    expect(state.get(mine, 'tokens')).toEqual({
      library: {},
      byScene: { 'scene-1': { t1: { x: 3, y: 4 } } },
    })

    // Upsert, not a second row — one row per (campaign, module) is the whole scoping rule.
    state.put(mine, 'tokens', { library: {}, byScene: {} })
    expect(state.get(mine, 'tokens')).toEqual({ library: {}, byScene: {} })
    expect(db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM module_state').get()?.n).toBe(1)

    state.put(mine, 'rolls', { log: [{ total: 17 }] })
    state.put(yours, 'tokens', { library: { goblin: {} }, byScene: {} })
    expect(state.get(mine, 'tokens')).toEqual({ library: {}, byScene: {} })
    expect(state.get(mine, 'rolls')).toEqual({ log: [{ total: 17 }] })
    expect(state.get(yours, 'tokens')).toEqual({ library: { goblin: {} }, byScene: {} })
    expect(state.get(yours, 'rolls')).toBeUndefined()
  })
})

describe('AssetStore', () => {
  it('stores bytes verbatim and measures the size itself', () => {
    const campaign = new CampaignStore(db).create('C')
    const assets = new AssetStore(db)
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff])

    const stored = assets.insert('asset-1', campaign.id, 'image/png', png)
    expect(stored.size).toBe(png.length)

    const read = assets.get('asset-1')
    expect(read?.mime).toBe('image/png')
    expect(read?.bytes.equals(png)).toBe(true) // BLOB, not a UTF-8 round trip
    expect(assets.get('nope')).toBeUndefined()
    expect(() => assets.insert('orphan', 'no-such-campaign', 'image/png', png)).toThrow(/FOREIGN KEY/i)
  })
})

describe('durability', () => {
  it('keeps campaigns, maps and sessions across a close and reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'game-db-test-'))
    const path = join(dir, 'nested', 'game.db') // openDb also has to create the directory
    try {
      const first = openDb(path)
      const campaign = new CampaignStore(first).create('Cragmaw Hideout')
      new MapStore(first).insert('map-1', campaign.id, 'Hideout', '{"version":1}')
      new SessionStore(first).createSession(campaign.id, 'ABC123')
      first.close()

      const second = openDb(path) // migrate() runs again on an existing file
      expect(new CampaignStore(second).get(campaign.id)?.name).toBe('Cragmaw Hideout')
      expect(new MapStore(second).get('map-1')?.data).toBe('{"version":1}')
      expect(new SessionStore(second).getByInviteCode('ABC123')?.campaign_id).toBe(campaign.id)
      expect(migrate(second)).toBe(0)
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
