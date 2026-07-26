// Real SQLite, no mocks: `:memory:` for the store tests, a temp file for the one that
// has to prove data outlives the process (tracker: "campaign persists across restart").

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrate, openDb, type Database } from './db'
import {
  CampaignStore,
  IdentityStore,
  MAX_MAP_BYTES,
  MapStore,
  PassStore,
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
      'campaigns',
      'identities',
      'maps',
      'migrations',
      'module_state',
      'passes',
      'sessions',
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

  it('rejects anything over the 20MB cap without writing it', () => {
    const campaign = new CampaignStore(db).create('C')
    const maps = new MapStore(db)

    expect(() => maps.insert('huge', campaign.id, 'Huge', 'x'.repeat(MAX_MAP_BYTES + 1))).toThrow(
      /too large/,
    )
    expect(maps.get('huge')).toBeUndefined()
    expect(() => maps.insert('edge', campaign.id, 'Edge', 'x'.repeat(MAX_MAP_BYTES))).not.toThrow()
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
