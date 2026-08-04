// Spec §2.3 — HTTP does issuance and heavy payloads; WS does realtime.
// node:http and a handful of `if`s: seven routes do not need a router, and a framework
// would be a dependency whose whole job is the twenty lines in `route()`.
//
// DEVIATION FROM SPEC (approved): §2.3 says the map upload is multipart. It is not —
// a `.mapbuilder` file *is* JSON, so the body is posted raw as application/json. A
// multipart parser written by hand (or a dependency to avoid writing one) would buy a
// boundary-delimited envelope around bytes we already have.

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  isAdminPass,
  issueToken,
  resolveInviteCode,
  startSession,
  verifyToken,
} from './auth'
import {
  MAX_ASSET_BYTES,
  MAX_MAP_BYTES,
  MAX_MAP_JSON_BYTES,
  type Identity,
  type Stores,
} from './db/stores'
import type { Vision } from './fog/vision'
import { parseMapFile, unwrapMapFile } from './mapImport'
import type { SerializedMapData } from '@dnd/core/src/store/types'
import type { ModuleRegistry } from './modules/registry'
import type { SessionManager } from './ws/SessionManager'

export interface HttpDeps {
  hmacSecret: string
  stores: Stores
  /** Live sockets — an ended session has to be told, not just written off in SQLite. */
  sessionManager: SessionManager
  /** S3 — the map GET's player path goes through it (D4/D5). */
  vision: Vision
  /** The DM's starting room is a `fog.reveal` like any other — see `openSession`. */
  modules: ModuleRegistry
}

/** Everything but a map upload is a handful of fields. */
const JSON_BODY_LIMIT = 64 * 1024

/** What the two public, guessable routes get: generous for typing, useless for a script. */
const INVITE_ATTEMPTS = 10
const INVITE_WINDOW_MS = 60_000

type RouteDeps = HttpDeps & { rateLimit: RateLimiter }

export function createRequestHandler(deps: HttpDeps) {
  // Per handler, not per module: the test suite runs several servers in one process and
  // they must not share a budget.
  const rateLimit = createRateLimiter(INVITE_ATTEMPTS, INVITE_WINDOW_MS)
  return (req: IncomingMessage, res: ServerResponse): void => {
    cors(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }
    route({ ...deps, rateLimit }, req, res).catch((error: unknown) => {
      console.error('request failed:', error)
      if (!res.headersSent) json(res, 500, { error: 'internal error' })
      else res.end()
    })
  }
}

async function route(deps: RouteDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const [api, resource, id, sub, sub2] = new URL(req.url ?? '/', 'http://localhost').pathname
    .split('/')
    .filter(Boolean)
  const method = req.method ?? 'GET'
  if (api !== 'api') return json(res, 404, { error: 'not found' })

  if (method === 'GET' && resource === 'campaigns' && !id) return listCampaigns(deps, req, res)
  if (method === 'POST' && resource === 'campaigns' && !id) return createCampaign(deps, req, res)
  if (method === 'POST' && resource === 'campaigns' && id && sub === 'maps')
    return uploadMap(deps, req, res, id)
  if (method === 'POST' && resource === 'campaigns' && id && sub === 'assets')
    return uploadAsset(deps, req, res, id)
  if (method === 'PUT' && resource === 'campaigns' && id && sub === 'scenes' && sub2 === 'order')
    return reorderScenes(deps, req, res, id)
  if (method === 'GET' && resource === 'campaigns' && id && sub === 'scenes' && !sub2)
    return listScenes(deps, req, res, id)
  if (method === 'GET' && resource === 'maps' && id && !sub) return getMap(deps, req, res, id)
  if (method === 'GET' && resource === 'maps' && id && sub === 'images' && sub2)
    return getMapImage(deps, req, res, id, sub2)
  if (method === 'GET' && resource === 'assets' && id && !sub) return getAsset(deps, req, res, id)
  if (method === 'GET' && resource === 'resolve' && id) return resolveCode(deps, req, res, id)
  if (method === 'POST' && resource === 'join' && !id) return joinSession(deps, req, res)
  if (method === 'POST' && resource === 'sessions' && !id) return openSession(deps, req, res)
  if (method === 'POST' && resource === 'identities' && id && sub === 'ban')
    return banIdentity(deps, req, res, id)
  if (resource === 'sessions' && id && (method === 'DELETE' || (method === 'POST' && sub === 'end')))
    return closeSession(deps, req, res, id)
  if (method === 'PUT' && resource === 'scenes' && id && sub === 'publish')
    return publishScene(deps, req, res, id)
  if (method === 'PATCH' && resource === 'scenes' && id && !sub) return patchScene(deps, req, res, id)
  if (method === 'DELETE' && resource === 'scenes' && id && !sub) return deleteScene(deps, req, res, id)

  return json(res, 404, { error: 'not found' })
}

// ─── Routes ───────────────────────────────────────────────

/**
 * GET /api/campaigns — admin pass in, every campaign on this server out (#47 D3).
 *
 * There is no per-DM account in this auth model (D6: admin pass / invite code / session
 * token, and a DM token is minted once per campaign and never lists anything). The admin
 * pass is the one credential that already means "whoever can create a campaign here" —
 * the same gate `createCampaign` uses — so it is also the one that means "whoever may
 * come back and see what they created". A self-hosted table has exactly one such person.
 */
function listCampaigns(deps: HttpDeps, req: IncomingMessage, res: ServerResponse): void {
  if (!isAdminPass(deps.stores.passes, credential(req))) {
    return json(res, 401, { error: 'invalid admin pass' })
  }
  const campaigns = deps.stores.campaigns.list().map((c) => ({
    id: c.id,
    name: c.name,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }))
  json(res, 200, { campaigns })
}

/** POST /api/campaigns — admin pass in, campaign + DM session token out. */
async function createCampaign(deps: HttpDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isAdminPass(deps.stores.passes, credential(req))) {
    return json(res, 401, { error: 'invalid admin pass' })
  }
  const body = await readJson(req, res)
  if (!body) return

  const campaign = deps.stores.campaigns.create(text(body.name) ?? 'Untitled campaign')
  const dm = deps.stores.identities.mint(randomUUID(), campaign.id, text(body.dmName) ?? 'DM', 'dm')
  json(res, 201, {
    campaignId: campaign.id,
    identityId: dm.id,
    token: issueToken(deps.hmacSecret, dm.id, campaign.id, 'dm'),
  })
}

/**
 * POST /api/campaigns/:id/maps — the raw `.mapbuilder` JSON, ≤ 20MB (D7).
 *
 * #47 — upload doubles as first publish: it mints the map row *and* the scene that
 * renders it, with the scene's id set to the map's own. That keeps the wizard's "upload
 * a file, get something you can open the table on" flow exactly as it was; re-publishing
 * an *existing* scene from a new file is a different, explicit call (`publishScene`)
 * because that is the one that has to preserve a scene's id rather than mint one.
 */
async function uploadMap(
  deps: HttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
  campaignId: string,
): Promise<void> {
  if (!requireSession(deps, req, res, { campaignId, role: 'dm' })) return

  const body = await readBody(req, MAX_MAP_BYTES)
  if (!body.ok) return failBody(req, res, body)

  // The editor saves gzipped; testdata fixtures are plain JSON. Both are `.mapbuilder`, and
  // the stored form is the JSON either way — everything downstream reads `maps.data` with a
  // bare `JSON.parse`, and the DM's map GET hands the row straight back.
  //
  // Unpacked against the unpacked cap: a map with imported art gzips to well under the wire
  // limit and still expands past it (see MAX_MAP_JSON_BYTES).
  const text = unwrapMapFile(body.bytes, MAX_MAP_JSON_BYTES)
  if (text === null) return json(res, 400, { error: 'could not read that .mapbuilder file' })

  const map = parseMapFile(text)
  if (!map.ok) return json(res, 400, { error: map.error })

  // Stored verbatim: the bytes the editor wrote are the bytes the renderer gets back.
  const row = deps.stores.maps.insert(randomUUID(), campaignId, map.name, text)
  const scene = deps.stores.scenes.create(row.id, campaignId, row.id, map.name)
  deps.stores.campaigns.touch(campaignId)
  deps.sessionManager.refreshScenes(campaignId)
  json(res, 201, {
    mapId: row.id,
    sceneId: scene.id,
    name: row.name,
    sizeBytes: row.size_bytes,
  })
}

/** GET /api/campaigns/:id/scenes — the DM's own full library, in drag order (#47). */
function listScenes(deps: HttpDeps, req: IncomingMessage, res: ServerResponse, campaignId: string): void {
  if (!requireSession(deps, req, res, { campaignId, role: 'dm' })) return
  const scenes = deps.stores.scenes.listByCampaign(campaignId).map((scene) => ({
    id: scene.id,
    name: scene.name,
    sortIndex: scene.sort_index,
    visibleToPlayers: scene.visible_to_players === 1,
    mapId: scene.map_id,
    updatedAt: scene.updated_at,
  }))
  json(res, 200, { scenes })
}

/** PUT /api/campaigns/:id/scenes/order — `{order: [sceneId, ...]}`, every scene once (#47 D4). */
async function reorderScenes(
  deps: HttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
  campaignId: string,
): Promise<void> {
  if (!requireSession(deps, req, res, { campaignId, role: 'dm' })) return
  const body = await readJson(req, res)
  if (!body) return

  const order = Array.isArray(body.order) ? body.order : null
  if (!order || !order.every((id): id is string => typeof id === 'string')) {
    return json(res, 400, { error: 'order must be an array of scene ids' })
  }
  const owned = deps.stores.scenes.listByCampaign(campaignId).map((s) => s.id)
  // Every scene named once, nothing left out and nothing foreign — a partial list would
  // leave the missing scenes with whatever sort_index they last had, silently interleaved.
  if (order.length !== owned.length || new Set(order).size !== owned.length) {
    return json(res, 400, { error: 'order must name every scene in this campaign exactly once' })
  }
  const known = new Set(owned)
  if (!order.every((id) => known.has(id))) {
    return json(res, 400, { error: 'order names a scene from another campaign' })
  }

  deps.stores.scenes.reorder(order)
  deps.sessionManager.refreshScenes(campaignId)
  json(res, 200, { order })
}

/**
 * PATCH /api/scenes/:id — rename and/or the D5 visibility flag, DM only.
 *
 * Authentication first, existence second (as `closeSession`/`banIdentity` do): a scene
 * that belongs to someone else's campaign answers exactly like one that does not exist,
 * so probing scene ids cannot tell the two apart.
 */
async function patchScene(
  deps: HttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
  sceneId: string,
): Promise<void> {
  const identity = requireSession(deps, req, res)
  if (!identity) return
  const scene = deps.stores.scenes.get(sceneId)
  if (!scene || scene.campaign_id !== identity.campaign_id) {
    return json(res, 404, { error: 'no such scene' })
  }
  if (identity.role !== 'dm') return json(res, 403, { error: 'dm only' })

  const body = await readJson(req, res)
  if (!body) return
  if (body.name === undefined && body.visibleToPlayers === undefined) {
    return json(res, 400, { error: 'patch needs a name and/or visibleToPlayers' })
  }

  const name = text(body.name)
  if (body.name !== undefined) {
    if (!name) return json(res, 400, { error: 'name cannot be blank' })
    deps.stores.scenes.rename(sceneId, name)
  }
  if (body.visibleToPlayers !== undefined) {
    if (typeof body.visibleToPlayers !== 'boolean') {
      return json(res, 400, { error: 'visibleToPlayers must be a boolean' })
    }
    deps.stores.scenes.setVisibleToPlayers(sceneId, body.visibleToPlayers)
  }
  const updated = deps.stores.scenes.get(sceneId)!
  deps.sessionManager.refreshScenes(scene.campaign_id)
  json(res, 200, {
    id: updated.id,
    name: updated.name,
    visibleToPlayers: updated.visible_to_players === 1,
  })
}

/**
 * PUT /api/scenes/:id/publish — re-publish (#47 D1). A fresh `.mapbuilder` upload, same
 * shape as `uploadMap`, but repoints an *existing* scene's `map_id` instead of minting a
 * new scene — which is the whole fix: fog, tokens and doors are keyed on the scene's id,
 * never its map, so nothing tied to this scene moves when its map does.
 */
async function publishScene(
  deps: HttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
  sceneId: string,
): Promise<void> {
  const identity = requireSession(deps, req, res)
  if (!identity) return
  const scene = deps.stores.scenes.get(sceneId)
  if (!scene || scene.campaign_id !== identity.campaign_id) {
    return json(res, 404, { error: 'no such scene' })
  }
  if (identity.role !== 'dm') return json(res, 403, { error: 'dm only' })

  const body = await readBody(req, MAX_MAP_BYTES)
  if (!body.ok) return failBody(req, res, body)

  const raw = unwrapMapFile(body.bytes, MAX_MAP_JSON_BYTES)
  if (raw === null) return json(res, 400, { error: 'could not read that .mapbuilder file' })
  const map = parseMapFile(raw)
  if (!map.ok) return json(res, 400, { error: map.error })

  const row = deps.stores.maps.insert(randomUUID(), scene.campaign_id, map.name, raw)
  deps.stores.scenes.republish(sceneId, row.id)
  // The cached geometry `sceneMapOf`/`vision` hold for this id was read off the map row
  // this scene *used* to point at — without this a republish would answer fog, doors and
  // the player's own map GET with the scene's old geometry until something else evicted it.
  deps.vision.invalidateScene(sceneId)
  deps.stores.campaigns.touch(scene.campaign_id)
  // The re-published map is live state for anyone at the table — `changedSceneId` is what
  // tells a session playing this scene to drop its map and refetch (see refreshScenes).
  deps.sessionManager.refreshScenes(scene.campaign_id, sceneId)
  json(res, 200, { sceneId, mapId: row.id, name: row.name, sizeBytes: row.size_bytes })
}

/** DELETE /api/scenes/:id — DM only. */
function deleteScene(deps: HttpDeps, req: IncomingMessage, res: ServerResponse, sceneId: string): void {
  const identity = requireSession(deps, req, res)
  if (!identity) return
  const scene = deps.stores.scenes.get(sceneId)
  if (!scene || scene.campaign_id !== identity.campaign_id) {
    return json(res, 404, { error: 'no such scene' })
  }
  if (identity.role !== 'dm') return json(res, 403, { error: 'dm only' })

  deps.stores.scenes.delete(sceneId)
  // A session that had this scene active does not keep pointing at a scene that no longer
  // exists — `scenesModule`/`sceneMapOf` would both refuse it anyway, but a live table is
  // better told than left silently stuck.
  deps.stores.sessions.clearActiveScene(sceneId)
  deps.vision.invalidateScene(sceneId)
  deps.sessionManager.refreshScenes(scene.campaign_id)
  json(res, 200, { sceneId, deleted: true })
}

/** POST /api/campaigns/:id/assets — DM, ≤ 2MB, raw image bytes (D11). */
async function uploadAsset(
  deps: HttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
  campaignId: string,
): Promise<void> {
  if (!requireSession(deps, req, res, { campaignId, role: 'dm' })) return

  const body = await readBody(req, MAX_ASSET_BYTES)
  if (!body.ok) return failBody(req, res, body)

  // The bytes decide the type, not the Content-Type header the uploader claimed: the mime
  // we store here is the one we hand back on GET, and a browser will honour it.
  const mime = sniffImage(body.bytes)
  if (!mime) return json(res, 400, { error: 'expected a png, jpeg or webp image' })

  const asset = deps.stores.assets.insert(randomUUID(), campaignId, mime, body.bytes)
  json(res, 201, { id: asset.id })
}

/** GET /api/assets/:id — any valid token for the campaign that owns it. */
function getAsset(deps: HttpDeps, req: IncomingMessage, res: ServerResponse, assetId: string): void {
  const identity = requireSession(deps, req, res)
  if (!identity) return

  const asset = deps.stores.assets.get(assetId)
  if (!asset || asset.campaign_id !== identity.campaign_id) {
    return json(res, 404, { error: 'no such asset' })
  }
  res.writeHead(200, {
    'content-type': asset.mime,
    'content-length': asset.size,
    // Ids are random and a stored asset is never rewritten, so the URL is the version.
    'cache-control': 'public, max-age=31536000, immutable',
  })
  res.end(asset.bytes)
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The mime the first few bytes actually are, or null for anything else (D11). */
function sniffImage(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  // RIFF....WEBP — the four bytes between are the file size, which proves nothing.
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp'
  }
  return null
}

/**
 * GET /api/maps/:id — any valid token for the campaign that owns it. `:id` is a scene id
 * (#47): the client only ever holds one from `activeSceneId`/`scenes`, and resolving
 * through the scene rather than a bare map row is what makes a re-published scene answer
 * with its *current* map — a raw map id would keep serving whatever the scene pointed at
 * when this route was still named for what it fetched.
 */
function getMap(deps: HttpDeps, req: IncomingMessage, res: ServerResponse, sceneId: string): void {
  const identity = requireSession(deps, req, res)
  if (!identity) return

  const scene = deps.stores.scenes.get(sceneId)
  const map = scene ? deps.stores.maps.get(scene.map_id) : undefined
  // Another campaign's scene is not "forbidden", it is none of this token's business.
  if (!map || map.campaign_id !== identity.campaign_id) {
    return json(res, 404, { error: 'no such map' })
  }
  // `?images=external`: the document goes out without its embedded images — their keys
  // ride in `imageKeys` and the bytes come from `getMapImage`, binary. Megabytes of
  // base64 stop transiting (and being JSON.parsed) with every map fetch.
  const external =
    new URL(req.url ?? '/', 'http://localhost').searchParams.get('images') === 'external'
  // D4/D5 — the DM gets the file as uploaded, byte for byte. A player gets the rooms the
  // party has seen and nothing else: this is where the anti-Owlbear guarantee is kept,
  // because it is the only route the map data travels.
  let body = map.data
  if (identity.role !== 'dm') {
    const player = deps.vision.playerMap(sceneId)
    // Unredactable is unsendable: a map the server cannot read is one it cannot fence.
    if (!player) return json(res, 500, { error: 'map could not be read' })
    body = JSON.stringify(external ? externalizeImages(player) : player)
  } else if (external) {
    try {
      body = JSON.stringify(externalizeImages(JSON.parse(map.data) as SerializedMapData))
    } catch {
      return json(res, 500, { error: 'map could not be read' })
    }
  }
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** Swap embedded data URLs for a key list — the binary image route serves the bytes. */
function externalizeImages(doc: SerializedMapData): SerializedMapData {
  return { ...doc, customImages: {}, imageKeys: Object.keys(doc.customImages ?? {}) }
}

// One-entry memo: a map load fans out into one image request per key, all against the
// same immutable map row (a republish mints a new row id, so staleness cannot happen).
// ponytail: last-row memo, swap for an LRU if concurrent tables thrash it.
let cachedImagesRowId: string | null = null
let cachedImages: Record<string, string> = {}

/**
 * GET /api/maps/:sceneId/images/:key — one embedded image, as binary. Same auth as
 * `getMap`. Deliberately role-blind: images are not redacted per room — the whole-map
 * splat going to players is a documented decision (see integration.test.ts §4), and this
 * route changes its encoding, not its reach.
 */
function getMapImage(
  deps: HttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
  sceneId: string,
  rawKey: string,
): void {
  const identity = requireSession(deps, req, res)
  if (!identity) return

  const scene = deps.stores.scenes.get(sceneId)
  const map = scene ? deps.stores.maps.get(scene.map_id) : undefined
  if (!map || map.campaign_id !== identity.campaign_id) {
    return json(res, 404, { error: 'no such map' })
  }

  if (cachedImagesRowId !== map.id) {
    try {
      cachedImages =
        ((JSON.parse(map.data) as { customImages?: Record<string, string> }).customImages ?? {})
    } catch {
      cachedImages = {}
    }
    cachedImagesRowId = map.id
  }

  const dataUrl = cachedImages[decodeURIComponent(rawKey)]
  const comma = dataUrl?.indexOf(',') ?? -1
  if (!dataUrl || comma < 0) return json(res, 404, { error: 'no such image' })
  const meta = dataUrl.slice(0, comma)
  const mime = meta.startsWith('data:') ? meta.slice(5, meta.indexOf(';')) : ''
  const bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64')
  res.writeHead(200, {
    'content-type': mime || 'application/octet-stream',
    'content-length': bytes.length,
  })
  res.end(bytes)
}

/** GET /api/resolve/:code — public; the join page calls it before asking for a name. */
function resolveCode(deps: RouteDeps, req: IncomingMessage, res: ServerResponse, code: string): void {
  if (rateLimited(deps, req, res)) return
  const session = resolveInviteCode(deps.stores.sessions, code)
  if (!session) return json(res, 404, { error: 'no active session for that code' })
  json(res, 200, { campaignId: session.campaign_id, sessionId: session.id })
}

/** POST /api/join — public; `{code, name}` in, player session token out. */
async function joinSession(deps: RouteDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (rateLimited(deps, req, res)) return
  const body = await readJson(req, res)
  if (!body) return

  const code = text(body.code)
  // §2.3.7 — `text` trims, so "   " is no name at all. Without this the table fills up
  // with blank seats the client then renders as a ghost "Someone" (S1 gate finding).
  const name = text(body.name)
  if (!name) return json(res, 400, { error: 'name-required' })
  if (!code) return json(res, 400, { error: 'code is required' })

  const session = resolveInviteCode(deps.stores.sessions, code)
  if (!session) return json(res, 404, { error: 'no active session for that code' })

  // Always a fresh identity, never one named by the caller: identityIds are public roster
  // data (they key players client-side), so honouring a supplied one would let anyone read
  // the DM's id off the table and mint themselves a DM token. Bans therefore bite where the
  // token is spent — `requireSession` here and `authenticateUpgrade` on the socket.
  const identity = deps.stores.identities.mint(
    randomUUID(),
    session.campaign_id,
    name.slice(0, 64),
    'player',
  )
  json(res, 200, {
    identityId: identity.id,
    campaignId: session.campaign_id,
    sessionId: session.id,
    // Bound to *this* session: the invite got them into this table, not into every table
    // the campaign runs for the next seven days.
    token: issueToken(deps.hmacSecret, identity.id, session.campaign_id, 'player', session.id),
  })
}

/**
 * POST /api/sessions — DM starts a session for a campaign and gets its invite code.
 *
 * `startingRoom` is §2.6's optional one: the room the DM picked while setting the table up,
 * lit before anyone is in the door. It is not a second kind of fog — it is the reveal the DM
 * would have clicked, run here through the same module, so the stored fog is the only source
 * of truth and redaction, the DM's panel and every join agree without being told about it.
 */
async function openSession(deps: HttpDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req, res)
  if (!body) return

  const campaignId = text(body.campaignId)
  if (!campaignId) return json(res, 400, { error: 'campaignId is required' })
  const dm = requireSession(deps, req, res, { campaignId, role: 'dm' })
  if (!dm) return

  // Checked before anything is started, so a bad pick cannot leave the DM with a table whose
  // invite code went out in a 400. `vision.roomsOf` resolves the scene the same way every
  // other fog-backed answer does (#47 — through the scenes table, not a bare map id).
  const named = body.startingRoom as { sceneId?: unknown; roomId?: unknown } | undefined
  let start: { sceneId: string; roomId: string } | null = null
  if (named != null) {
    const sceneId = text(named.sceneId)
    const roomId = text(named.roomId)
    if (!sceneId || !roomId) {
      return json(res, 400, { error: 'startingRoom needs a sceneId and a roomId' })
    }
    if (!deps.vision.roomsOf(campaignId, sceneId).includes(roomId)) {
      return json(res, 400, { error: `no room '${roomId}' in that scene` })
    }
    start = { sceneId, roomId }
  }

  // Which scene the table opens on. The wizard names it because it is the one it just
  // published, and the campaign's scene order cannot be asked instead — an older scene in
  // the same campaign is just as plausibly first. A starting room already names one.
  const scene = text(body.sceneId) ?? start?.sceneId ?? null
  if (scene && deps.stores.scenes.get(scene)?.campaign_id !== campaignId) {
    return json(res, 400, { error: `no scene '${scene}' in this campaign` })
  }

  // createSession ends whatever was running; the table it replaced deserves to hear so.
  const replaced = deps.stores.sessions.getActiveByCampaign(campaignId)
  const session = startSession(deps.stores.sessions, campaignId)
  if (replaced) deps.sessionManager.endSession(replaced.id)

  // The scene the wizard set the table up with is the scene the table opens on. Without it
  // the snapshot falls back to the campaign's *first* scene (see `scenes` in index.ts), and
  // on a campaign holding more than one that is not the scene the DM just published: the
  // reveal was stored against theirs while the fog panel read a scene nothing had been revealed in,
  // so the DM saw "Unrevealed" and the player joined to full black — with a 201 and no error
  // on either half to say so.
  if (scene) deps.stores.sessions.setActiveScene(session.id, scene)

  // Nobody can be at this table yet — the invite code is still in this function — so the
  // reveal lands before the first join rather than racing it, and the broadcast it would
  // normally make has no one to make it to.
  if (start) {
    deps.modules.dispatch('fog', 'reveal', start, {
      campaignId,
      sessionId: session.id,
      activeSceneId: start.sceneId,
      sender: { role: 'dm', identityId: dm.id },
      players: [],
      broadcast: () => {},
    })
  }

  json(res, 201, {
    sessionId: session.id,
    campaignId,
    inviteCode: session.invite_code,
  })
}

/** DELETE /api/sessions/:id (or POST .../end) — DM closes the table. */
function closeSession(
  deps: HttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
): void {
  // Authentication first, existence second. The other order answered 404 to an anonymous
  // caller for an id that does not exist and 401 for one that does, which is a free oracle
  // for walking session ids.
  const identity = requireSession(deps, req, res)
  if (!identity) return

  const session = deps.stores.sessions.get(sessionId)
  // Another campaign's session is not "forbidden", it is none of this token's business.
  if (!session || session.campaign_id !== identity.campaign_id) {
    return json(res, 404, { error: 'no such session' })
  }
  if (identity.role !== 'dm') return json(res, 403, { error: 'dm only' })

  deps.stores.sessions.endSession(sessionId)
  deps.sessionManager.endSession(sessionId)
  json(res, 200, { sessionId, active: false })
}

/**
 * POST /api/identities/:id/ban — the DM throws someone out for good.
 *
 * A ban is the only revocation that outlives a session: `IdentityStore.ban` marks the row,
 * `requireSession` and `authenticateUpgrade` refuse the token that names it, and the live
 * sockets it already opened are hung up here rather than left to notice.
 */
function banIdentity(
  deps: HttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
  identityId: string,
): void {
  const dm = requireSession(deps, req, res)
  if (!dm) return

  const target = deps.stores.identities.get(identityId)
  if (!target || target.campaign_id !== dm.campaign_id) {
    return json(res, 404, { error: 'no such identity' })
  }
  if (dm.role !== 'dm') return json(res, 403, { error: 'dm only' })
  // Otherwise one mistyped id locks the DM out of their own campaign, permanently.
  if (target.id === dm.id) return json(res, 400, { error: 'the DM cannot ban themselves' })

  deps.stores.identities.ban(identityId)
  deps.sessionManager.disconnectIdentity(identityId)
  json(res, 200, { identityId, banned: true })
}

// ─── Auth ─────────────────────────────────────────────────

/** `Authorization: Bearer <x>`, or a bare `<x>` for the admin pass typed into a form. */
function credential(req: IncomingMessage): string | null {
  const header = req.headers.authorization
  if (!header) return null
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : header
}

/**
 * Verifies the session token and the identity behind it, answering the request itself on
 * failure. `campaignId`/`role` narrow it to one campaign and one seat at that table.
 */
function requireSession(
  deps: HttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
  scope?: { campaignId: string; role?: Identity['role'] },
): Identity | null {
  const claims = verifyToken(deps.hmacSecret, credential(req))
  if (!claims) {
    json(res, 401, { error: 'invalid or expired token' })
    return null
  }
  const identity = deps.stores.identities.get(claims.identityId)
  if (!identity) {
    json(res, 401, { error: 'unknown identity' })
    return null
  }
  if (identity.banned === 1) {
    json(res, 403, { error: 'banned' })
    return null
  }
  if (scope && claims.campaignId !== scope.campaignId) {
    json(res, 403, { error: 'token is for another campaign' })
    return null
  }
  // The row wins over the claim: a role changed after issuance must take effect without
  // waiting out the token's TTL.
  if (scope?.role && identity.role !== scope.role) {
    json(res, 403, { error: `${scope.role} only` })
    return null
  }
  return identity
}

// ─── Rate limiting ────────────────────────────────────────

/** Seconds the caller must wait, or 0 when the request is within budget. */
type RateLimiter = (key: string) => number

/**
 * An invite code is six characters from a 31-letter alphabet — 887M combinations, which is
 * only out of reach if guessing is slow. `/api/join` and `/api/resolve` are the two routes
 * that will answer a guess, so they get a budget.
 *
 * ponytail: a Map of timestamps in this process. That is the right size for a self-hosted
 * table; it counts per server rather than per cluster, so put a real store behind this if
 * the day ever comes that two of these run behind one address.
 */
function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const hits = new Map<string, number[]>()
  return (key) => {
    const now = Date.now()
    // Anything that has aged out of the window is not an attempt any more.
    const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs)
    hits.set(key, recent)

    if (recent.length >= limit) return Math.ceil((windowMs - (now - recent[0]!)) / 1000)
    recent.push(now)

    // One array per address that has ever called is a slow leak; sweep the idle ones
    // rather than hold every address the server has seen since boot.
    if (hits.size > 1024) {
      for (const [seen, at] of hits) if (now - (at[at.length - 1] ?? 0) >= windowMs) hits.delete(seen)
    }
    return 0
  }
}

/** Answers 429 and returns true when the caller has spent its budget. */
function rateLimited(deps: RouteDeps, req: IncomingMessage, res: ServerResponse): boolean {
  // `remoteAddress`, never `x-forwarded-for`: nothing trusted sits in front of this server,
  // and a limit keyed on a header the caller writes is a limit with an opt-out.
  const retryAfter = deps.rateLimit(req.socket.remoteAddress ?? 'unknown')
  if (retryAfter === 0) return false
  res.setHeader('retry-after', String(retryAfter))
  json(res, 429, { error: 'too many attempts — wait a moment and try again' })
  return true
}

// ─── Plumbing ─────────────────────────────────────────────

type Body = { ok: true; bytes: Buffer } | { ok: false; status: number; error: string }

/**
 * Reads a request body, refusing anything over `limit` twice over: the declared
 * Content-Length is rejected before a byte is buffered, and the running byte count is
 * rejected before the buffer completes — so a lying (or absent) Content-Length costs the
 * server one chunk past the cap, not a 20MB allocation it never wanted.
 *
 * Past the cap the stream is paused and the buffer dropped; {@link failBody} answers and
 * then hangs up, so the rest of an upload we already refused is never read.
 */
function readBody(req: IncomingMessage, limit: number): Promise<Body> {
  const tooLarge: Body = { ok: false, status: 413, error: `body exceeds the ${limit} byte limit` }

  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) return Promise.resolve(tooLarge)

  return new Promise<Body>((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        chunks.length = 0
        req.pause()
        resolve(tooLarge)
        return
      }
      chunks.push(chunk)
    })
    // Bytes, not text: an image body decoded as UTF-8 and re-encoded is a different image.
    req.on('end', () => resolve({ ok: true, bytes: Buffer.concat(chunks) }))
    req.on('error', () => resolve({ ok: false, status: 400, error: 'request aborted' }))
  })
}

/**
 * Answers a body that could not be read. A 413 also hangs up: the sender is mid-upload with
 * megabytes still to come, and reading them to the end is doing exactly the work the cap
 * exists to refuse. `readBody` has already paused the stream, so nothing further is read
 * either way; this closes the connection it was arriving on.
 *
 * The close is a FIN and not a `destroy()`, and the difference matters: destroying a socket
 * that still has an unread request body in its receive buffer resets the connection, and the
 * reset overtakes the 413 — the client is left with a dead socket and no idea why. Ending it
 * once the response has flushed delivers the reason and then goes.
 *
 * ponytail: a client that ignores the FIN and keeps writing holds one stalled socket (it
 * cannot make progress — nobody is reading) until Node's requestTimeout reaps it. That is
 * far cheaper than draining the upload, and the place to tighten it is that timeout.
 */
function failBody(req: IncomingMessage, res: ServerResponse, body: Extract<Body, { ok: false }>): void {
  if (body.status !== 413) return json(res, body.status, { error: body.error })

  // We are the ones hanging up, so the abort that follows is ours and not news. Without
  // these it surfaces as an unhandled 'error' on a stream nobody is listening to any more,
  // which is a process-level crash caused by a request the server deliberately refused.
  req.on('error', () => {})
  res.on('error', () => {})

  const payload = JSON.stringify({ error: body.error })
  res.writeHead(413, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    connection: 'close',
  })
  res.end(payload, () => req.socket.end())
}

/** Small JSON body, or null when it has already answered the request. */
async function readJson(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  const body = await readBody(req, JSON_BODY_LIMIT)
  if (!body.ok) {
    failBody(req, res, body)
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body.bytes.toString('utf8') || '{}')
  } catch {
    json(res, 400, { error: 'body must be JSON' })
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    json(res, 400, { error: 'body must be a JSON object' })
    return null
  }
  return parsed as Record<string, unknown>
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/**
 * CORS is wide open on purpose: this is a self-hosted server whose client is served from
 * another port in dev and, later, from inside a Discord iframe (D9). There is no cookie
 * and no ambient credential to protect — every route is authorized by a header the browser
 * only attaches when the client deliberately does. Narrow it when there is a deployment
 * story to narrow it to.
 */
function cors(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
  res.setHeader('access-control-allow-headers', 'authorization, content-type')
}

/** A non-empty trimmed string, or null — the only two things a caller wants to branch on. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
