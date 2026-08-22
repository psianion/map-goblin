// Prepared statements behind small classes. Rows come back exactly as stored
// (snake_case, SQLite's 0/1 for booleans) — a mapping layer would buy nothing here.

import { randomUUID } from 'node:crypto'
import type { Role } from '@dnd/core/src/shared/protocol'
import type { Database } from './db'

/** D7 — `.mapbuilder` files reach 20MB on the wire; anything past that we do not accept. */
export const MAX_MAP_BYTES = 20 * 1024 * 1024

/**
 * The same map *unpacked*, which is the form we store and hand back.
 *
 * A `.mapbuilder` carries the DM's imported pictures base64'd inside its JSON, and base64
 * of already-compressed PNG bytes gzips back down to roughly what it started as — so the
 * decompressed document runs well over the wire cap while the upload itself is comfortably
 * under it. Held at 20MB, three imported images were enough to have a perfectly good map
 * refused as unreadable. 3.2x the wire cap: room for the art, still a bounded expansion
 * ratio rather than an open invitation to a zip bomb.
 */
export const MAX_MAP_JSON_BYTES = 64 * 1024 * 1024

/** D11 — a token portrait, not a wallpaper. */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024

export interface Campaign {
  id: string
  name: string
  created_at: number
  updated_at: number
}

export interface MapRow {
  id: string
  campaign_id: string
  name: string
  /** The `.mapbuilder` JSON, verbatim. */
  data: string
  size_bytes: number
  imported_at: number
}

/** What the scene list needs — the same row without the multi-megabyte `data` blob. */
export type MapMeta = Omit<MapRow, 'data'>

export interface SessionRow {
  id: string
  campaign_id: string
  invite_code: string
  active_scene_id: string | null
  /** SQLite boolean: 1 while the session is live, 0 once ended. */
  active: number
  created_at: number
}

export interface Identity {
  id: string
  campaign_id: string
  name: string
  role: Role
  banned: number
  last_seen: number | null
}

export interface Pass {
  id: string
  /** null = server admin pass (D6); otherwise the campaign it authorizes. */
  campaign_id: string | null
  token_hash: string
  /** null = never expires. */
  expires_at: number | null
}

export class CampaignStore {
  readonly #insert
  readonly #get
  readonly #list
  readonly #touch

  constructor(db: Database) {
    this.#insert = db.prepare<[string, string, number, number]>(
      'INSERT INTO campaigns (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    )
    this.#get = db.prepare<[string], Campaign>('SELECT * FROM campaigns WHERE id = ?')
    this.#list = db.prepare<[], Campaign>('SELECT * FROM campaigns ORDER BY updated_at DESC')
    this.#touch = db.prepare<[number, string]>('UPDATE campaigns SET updated_at = ? WHERE id = ?')
  }

  create(name: string): Campaign {
    const campaign: Campaign = { id: randomUUID(), name, created_at: Date.now(), updated_at: Date.now() }
    this.#insert.run(campaign.id, campaign.name, campaign.created_at, campaign.updated_at)
    return campaign
  }

  get(id: string): Campaign | undefined {
    return this.#get.get(id)
  }

  list(): Campaign[] {
    return this.#list.all()
  }

  /** Marks the campaign as touched — call after anything that changes what it contains. */
  touch(id: string): void {
    this.#touch.run(Date.now(), id)
  }
}

export class MapStore {
  readonly #insert
  readonly #get
  readonly #list

  constructor(db: Database) {
    this.#insert = db.prepare<[string, string, string, string, number, number]>(
      'INSERT INTO maps (id, campaign_id, name, data, size_bytes, imported_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    this.#get = db.prepare<[string], MapRow>('SELECT * FROM maps WHERE id = ?')
    // Deliberately not `SELECT *`: the scene list must not drag 20MB blobs into memory.
    this.#list = db.prepare<[string], MapMeta>(
      'SELECT id, campaign_id, name, size_bytes, imported_at FROM maps WHERE campaign_id = ? ORDER BY imported_at',
    )
  }

  /**
   * @throws if `data` exceeds {@link MAX_MAP_JSON_BYTES}. `data` is the unpacked JSON, so
   * this is the unpacked cap, not the wire one. The size is measured here rather than
   * trusted from the caller — a caller-supplied count is a cap you can lie past, and it
   * would also let `size_bytes` disagree with what is actually stored.
   */
  insert(id: string, campaignId: string, name: string, data: string): MapRow {
    const size_bytes = Buffer.byteLength(data, 'utf8')
    if (size_bytes > MAX_MAP_JSON_BYTES) {
      throw new Error(
        `map too large: ${size_bytes} bytes exceeds the ${MAX_MAP_JSON_BYTES} byte limit`,
      )
    }
    const row: MapRow = { id, campaign_id: campaignId, name, data, size_bytes, imported_at: Date.now() }
    this.#insert.run(row.id, row.campaign_id, row.name, row.data, row.size_bytes, row.imported_at)
    return row
  }

  get(id: string): MapRow | undefined {
    return this.#get.get(id)
  }

  /** Metadata only — fetch the payload with {@link get} when a client actually renders it. */
  listByCampaign(campaignId: string): MapMeta[] {
    return this.#list.all(campaignId)
  }
}

export interface SceneRow {
  id: string
  campaign_id: string
  /** The map row this scene currently renders — the part re-publish repoints. */
  map_id: string
  name: string
  /** Flat drag-order (D4 of #47 — no chapters/acts). Dense per campaign, ascending. */
  sort_index: number
  /** SQLite boolean: 0 (default, hidden) until the DM opts a scene into the player list. */
  visible_to_players: number
  created_at: number
  updated_at: number
  /** DM-authored trigger prep (M3), JSON-encoded `ScenePrep` — null until the DM has any. */
  prep: string | null
}

/**
 * Scenes (#47): a scene is a published snapshot with its own id, distinct from the map
 * row backing it. `id` never changes after creation — fog, tokens, doors and
 * `sessions.active_scene_id` are all keyed by it — only `map_id` moves, which is what
 * lets a re-publish update a scene in place instead of orphaning it under a fresh id.
 */
export class SceneStore {
  readonly #db
  readonly #insert
  readonly #get
  readonly #list
  readonly #nextSort
  readonly #republish
  readonly #rename
  readonly #setVisible
  readonly #setSort
  readonly #setPrep
  readonly #delete

  constructor(db: Database) {
    this.#db = db
    this.#insert = db.prepare<[string, string, string, string, number, number, number, string | null]>(
      `INSERT INTO scenes (id, campaign_id, map_id, name, sort_index, created_at, updated_at, prep)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    this.#get = db.prepare<[string], SceneRow>('SELECT * FROM scenes WHERE id = ?')
    this.#list = db.prepare<[string], SceneRow>(
      'SELECT * FROM scenes WHERE campaign_id = ? ORDER BY sort_index',
    )
    this.#nextSort = db.prepare<[string], { n: number }>(
      'SELECT COALESCE(MAX(sort_index), -1) + 1 AS n FROM scenes WHERE campaign_id = ?',
    )
    this.#republish = db.prepare<[string, number, string]>(
      'UPDATE scenes SET map_id = ?, updated_at = ? WHERE id = ?',
    )
    this.#rename = db.prepare<[string, number, string]>(
      'UPDATE scenes SET name = ?, updated_at = ? WHERE id = ?',
    )
    this.#setVisible = db.prepare<[number, number, string]>(
      'UPDATE scenes SET visible_to_players = ?, updated_at = ? WHERE id = ?',
    )
    this.#setSort = db.prepare<[number, string]>('UPDATE scenes SET sort_index = ? WHERE id = ?')
    this.#setPrep = db.prepare<[string | null, number, string]>(
      'UPDATE scenes SET prep = ?, updated_at = ? WHERE id = ?',
    )
    this.#delete = db.prepare<[string]>('DELETE FROM scenes WHERE id = ?')
  }

  /**
   * `id` is the map's own freshly-minted id in the common "upload = publish" path
   * (http.ts's `uploadMap`), which is what lets an existing sceneId keep meaning the
   * same thing it always did. A scene published any other way mints its own.
   */
  create(id: string, campaignId: string, mapId: string, name: string, prep: string | null = null): SceneRow {
    const sortIndex = (this.#nextSort.get(campaignId) as { n: number }).n
    const now = Date.now()
    this.#insert.run(id, campaignId, mapId, name, sortIndex, now, now, prep)
    return {
      id,
      campaign_id: campaignId,
      map_id: mapId,
      name,
      sort_index: sortIndex,
      visible_to_players: 0,
      created_at: now,
      updated_at: now,
      prep,
    }
  }

  get(id: string): SceneRow | undefined {
    return this.#get.get(id)
  }

  listByCampaign(campaignId: string): SceneRow[] {
    return this.#list.all(campaignId)
  }

  /** Re-publish (#47 D1): repoints at a new map row without moving the scene's own id. */
  republish(id: string, mapId: string): void {
    this.#republish.run(mapId, Date.now(), id)
  }

  /** M3 — the handler decides keep-vs-overwrite; this always writes what it is given. */
  setPrep(id: string, prep: string | null): void {
    this.#setPrep.run(prep, Date.now(), id)
  }

  rename(id: string, name: string): void {
    this.#rename.run(name, Date.now(), id)
  }

  setVisibleToPlayers(id: string, visible: boolean): void {
    this.#setVisible.run(visible ? 1 : 0, Date.now(), id)
  }

  /** Bulk flat reorder (#47 D4) — `order` is every scene id for the campaign, in the new order. */
  reorder(order: readonly string[]): void {
    this.#db.transaction(() => {
      order.forEach((id, index) => this.#setSort.run(index, id))
    })()
  }

  delete(id: string): void {
    this.#delete.run(id)
  }
}

export class SessionStore {
  readonly #db
  readonly #insert
  readonly #byId
  readonly #byCode
  readonly #activeByCampaign
  readonly #setScene
  readonly #clearScene
  readonly #end
  readonly #endCampaign

  constructor(db: Database) {
    this.#db = db
    this.#insert = db.prepare<[string, string, string, number]>(
      'INSERT INTO sessions (id, campaign_id, invite_code, active, created_at) VALUES (?, ?, ?, 1, ?)',
    )
    this.#byId = db.prepare<[string], SessionRow>('SELECT * FROM sessions WHERE id = ?')
    this.#byCode = db.prepare<[string], SessionRow>(
      'SELECT * FROM sessions WHERE invite_code = ? AND active = 1',
    )
    this.#activeByCampaign = db.prepare<[string], SessionRow>(
      'SELECT * FROM sessions WHERE campaign_id = ? AND active = 1',
    )
    this.#setScene = db.prepare<[string | null, string]>(
      'UPDATE sessions SET active_scene_id = ? WHERE id = ?',
    )
    this.#clearScene = db.prepare<[string]>(
      'UPDATE sessions SET active_scene_id = NULL WHERE active_scene_id = ?',
    )
    this.#end = db.prepare<[string]>('UPDATE sessions SET active = 0 WHERE id = ?')
    this.#endCampaign = db.prepare<[string]>(
      'UPDATE sessions SET active = 0 WHERE campaign_id = ? AND active = 1',
    )
  }

  /** Starting a session ends whatever was still running for that campaign. */
  createSession(campaignId: string, inviteCode: string): SessionRow {
    const row: SessionRow = {
      id: randomUUID(),
      campaign_id: campaignId,
      invite_code: inviteCode,
      active_scene_id: null,
      active: 1,
      created_at: Date.now(),
    }
    this.#db.transaction(() => {
      this.#endCampaign.run(campaignId)
      this.#insert.run(row.id, row.campaign_id, row.invite_code, row.created_at)
    })()
    return row
  }

  /** Ended sessions included — the caller decides whether `active` still matters. */
  get(id: string): SessionRow | undefined {
    return this.#byId.get(id)
  }

  /** Active sessions only — a code from an ended session resolves to nothing (§2.3: 404). */
  getByInviteCode(code: string): SessionRow | undefined {
    return this.#byCode.get(code)
  }

  getActiveByCampaign(campaignId: string): SessionRow | undefined {
    return this.#activeByCampaign.get(campaignId)
  }

  setActiveScene(sessionId: string, sceneId: string | null): void {
    this.#setScene.run(sceneId, sessionId)
  }

  /** #47 — a deleted scene stops being anyone's active one, in whatever session had it. */
  clearActiveScene(sceneId: string): void {
    this.#clearScene.run(sceneId)
  }

  endSession(sessionId: string): void {
    this.#end.run(sessionId)
  }
}

export class IdentityStore {
  readonly #insert
  readonly #get
  readonly #ban
  readonly #touch
  readonly #byCampaignAndRole
  readonly #list

  constructor(db: Database) {
    this.#insert = db.prepare<[string, string, string, string]>(
      'INSERT INTO identities (id, campaign_id, name, role) VALUES (?, ?, ?, ?)',
    )
    this.#get = db.prepare<[string], Identity>('SELECT * FROM identities WHERE id = ?')
    this.#ban = db.prepare<[string]>('UPDATE identities SET banned = 1 WHERE id = ?')
    this.#touch = db.prepare<[number, string]>('UPDATE identities SET last_seen = ? WHERE id = ?')
    // A banned DM identity is not a candidate to reuse — its token would just be refused
    // the moment it was spent (N10, see `requireSession`'s banned check).
    this.#byCampaignAndRole = db.prepare<[string, string], Identity>(
      'SELECT * FROM identities WHERE campaign_id = ? AND role = ? AND banned = 0 LIMIT 1',
    )
    this.#list = db.prepare<[string], Identity>('SELECT * FROM identities WHERE campaign_id = ?')
  }

  /** `id` comes from the caller because A4 signs it into the session token as it mints one. */
  mint(id: string, campaignId: string, name: string, role: Role): Identity {
    this.#insert.run(id, campaignId, name, role)
    return { id, campaign_id: campaignId, name, role, banned: 0, last_seen: null }
  }

  get(id: string): Identity | undefined {
    return this.#get.get(id)
  }

  /** The campaign's existing, unbanned holder of this role, if any (N10 — dm-token reuse). */
  findByCampaignAndRole(campaignId: string, role: Role): Identity | undefined {
    return this.#byCampaignAndRole.get(campaignId, role)
  }

  listByCampaign(campaignId: string): Identity[] {
    return this.#list.all(campaignId)
  }

  ban(id: string): void {
    this.#ban.run(id)
  }

  /** An identity the server has never heard of is not banned — it is simply unknown. */
  isBanned(id: string): boolean {
    return this.get(id)?.banned === 1
  }

  touchLastSeen(id: string): void {
    this.#touch.run(Date.now(), id)
  }
}

export class PassStore {
  readonly #insert
  readonly #byHash
  readonly #serverAdmin

  constructor(db: Database) {
    this.#insert = db.prepare<[string, string | null, string, number | null]>(
      'INSERT INTO passes (id, campaign_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    )
    this.#byHash = db.prepare<[string, number], Pass>(
      'SELECT * FROM passes WHERE token_hash = ? AND (expires_at IS NULL OR expires_at > ?)',
    )
    this.#serverAdmin = db.prepare<[], Pass>('SELECT * FROM passes WHERE campaign_id IS NULL LIMIT 1')
  }

  create(tokenHash: string, campaignId: string | null, expiresAt: number | null): Pass {
    const pass: Pass = { id: randomUUID(), campaign_id: campaignId, token_hash: tokenHash, expires_at: expiresAt }
    this.#insert.run(pass.id, pass.campaign_id, pass.token_hash, pass.expires_at)
    return pass
  }

  /** Expiry is checked in SQL, so an expired pass is indistinguishable from no pass. */
  findValidByHash(tokenHash: string): Pass | undefined {
    return this.#byHash.get(tokenHash, Date.now())
  }

  /** Has the server admin pass been minted yet? Answers "is this the first run?" (D6). */
  hasServerAdmin(): boolean {
    return this.#serverAdmin.get() !== undefined
  }
}

export interface AssetRow {
  id: string
  campaign_id: string
  mime: string
  bytes: Buffer
  size: number
  created_at: number
}

/** D11 — image blobs modules point an id at (token portraits today). */
export class AssetStore {
  readonly #insert
  readonly #get

  constructor(db: Database) {
    this.#insert = db.prepare<[string, string, string, Buffer, number, number]>(
      'INSERT INTO assets (id, campaign_id, mime, bytes, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    this.#get = db.prepare<[string], AssetRow>('SELECT * FROM assets WHERE id = ?')
  }

  /** Size is measured here, not trusted from the caller — same reason as MapStore.insert. */
  insert(id: string, campaignId: string, mime: string, bytes: Buffer): AssetRow {
    const row: AssetRow = {
      id,
      campaign_id: campaignId,
      mime,
      bytes,
      size: bytes.length,
      created_at: Date.now(),
    }
    this.#insert.run(row.id, row.campaign_id, row.mime, row.bytes, row.size, row.created_at)
    return row
  }

  get(id: string): AssetRow | undefined {
    return this.#get.get(id)
  }
}

/**
 * D5 — one row per `(campaign_id, module)`. State is opaque JSON: the registry knows what
 * shape it is, this class only knows how to keep it. Written on every `setState`; the rows
 * are a few KB and the database is in WAL mode, so measure before batching anything.
 */
export class ModuleStateStore {
  readonly #get
  readonly #put
  #revision = 0

  constructor(db: Database) {
    this.#get = db.prepare<[string, string], { state: string }>(
      'SELECT state FROM module_state WHERE campaign_id = ? AND module = ?',
    )
    this.#put = db.prepare<[string, string, string]>(
      `INSERT INTO module_state (campaign_id, module, state) VALUES (?, ?, ?)
       ON CONFLICT (campaign_id, module) DO UPDATE SET state = excluded.state`,
    )
  }

  /** undefined = never written, which is the registry's cue to seed `initialState`. */
  get(campaignId: string, moduleId: string): unknown {
    const row = this.#get.get(campaignId, moduleId)
    return row === undefined ? undefined : JSON.parse(row.state)
  }

  put(campaignId: string, moduleId: string, state: unknown): void {
    this.#put.run(campaignId, moduleId, JSON.stringify(state))
    this.#revision++
  }

  /**
   * Writes so far. S3's fog cache keys itself on this: every answer it holds is derived
   * from module state, so "nothing has been written since" is exactly "still valid", and
   * there is no invalidation call anyone can forget to make.
   */
  get revision(): number {
    return this.#revision
  }
}

/** Landing-page waitlist (P5a) — email + when, nothing else. */
export class WaitlistStore {
  readonly #insert

  constructor(db: Database) {
    // ON CONFLICT DO NOTHING rather than a SELECT-then-INSERT: the unique index is the
    // only thing that needs to know whether this email is already in, and `changes`
    // says so atomically — no race between two submissions of the same address.
    this.#insert = db.prepare<[string, string, number]>(
      `INSERT INTO waitlist (id, email, created_at) VALUES (?, ?, ?)
       ON CONFLICT (email) DO NOTHING`,
    )
  }

  /** `email` is caller-normalized (trimmed, lowercased) — this class just stores it. */
  add(email: string): { duplicate: boolean } {
    const result = this.#insert.run(randomUUID(), email, Date.now())
    return { duplicate: result.changes === 0 }
  }
}

export interface Stores {
  campaigns: CampaignStore
  maps: MapStore
  scenes: SceneStore
  sessions: SessionStore
  identities: IdentityStore
  passes: PassStore
  assets: AssetStore
  moduleState: ModuleStateStore
  waitlist: WaitlistStore
}

/** One prepared-statement set per open database — boot calls this once (src/index.ts). */
export function createStores(db: Database): Stores {
  return {
    campaigns: new CampaignStore(db),
    maps: new MapStore(db),
    scenes: new SceneStore(db),
    sessions: new SessionStore(db),
    identities: new IdentityStore(db),
    passes: new PassStore(db),
    assets: new AssetStore(db),
    moduleState: new ModuleStateStore(db),
    waitlist: new WaitlistStore(db),
  }
}
