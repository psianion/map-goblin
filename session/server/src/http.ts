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
import { MAX_MAP_BYTES, type Identity, type Stores } from './db/stores'
import { parseMapFile } from './mapImport'
import type { SessionManager } from './ws/SessionManager'

export interface HttpDeps {
  hmacSecret: string
  stores: Stores
  /** Live sockets — an ended session has to be told, not just written off in SQLite. */
  sessionManager: SessionManager
}

/** Everything but a map upload is a handful of fields. */
const JSON_BODY_LIMIT = 64 * 1024

export function createRequestHandler(deps: HttpDeps) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    cors(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }
    route(deps, req, res).catch((error: unknown) => {
      console.error('request failed:', error)
      if (!res.headersSent) json(res, 500, { error: 'internal error' })
      else res.end()
    })
  }
}

async function route(deps: HttpDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  const [api, resource, id, sub] = path.split('/').filter(Boolean)
  const method = req.method ?? 'GET'
  if (api !== 'api') return json(res, 404, { error: 'not found' })

  if (method === 'POST' && resource === 'campaigns' && !id) return createCampaign(deps, req, res)
  if (method === 'POST' && resource === 'campaigns' && id && sub === 'maps')
    return uploadMap(deps, req, res, id)
  if (method === 'GET' && resource === 'maps' && id && !sub) return getMap(deps, req, res, id)
  if (method === 'GET' && resource === 'resolve' && id) return resolveCode(deps, res, id)
  if (method === 'POST' && resource === 'join' && !id) return joinSession(deps, req, res)
  if (method === 'POST' && resource === 'sessions' && !id) return openSession(deps, req, res)
  if (resource === 'sessions' && id && (method === 'DELETE' || (method === 'POST' && sub === 'end')))
    return closeSession(deps, req, res, id)

  return json(res, 404, { error: 'not found' })
}

// ─── Routes ───────────────────────────────────────────────

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

/** POST /api/campaigns/:id/maps — the raw `.mapbuilder` JSON, ≤ 20MB (D7). */
async function uploadMap(
  deps: HttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
  campaignId: string,
): Promise<void> {
  if (!requireSession(deps, req, res, { campaignId, role: 'dm' })) return

  const body = await readBody(req, MAX_MAP_BYTES)
  if (!body.ok) return json(res, body.status, { error: body.error })

  const map = parseMapFile(body.text)
  if (!map.ok) return json(res, 400, { error: map.error })

  // Stored verbatim: the bytes the editor wrote are the bytes the renderer gets back.
  const row = deps.stores.maps.insert(randomUUID(), campaignId, map.name, body.text)
  deps.stores.campaigns.touch(campaignId)
  json(res, 201, { mapId: row.id, name: row.name, sizeBytes: row.size_bytes })
}

/** GET /api/maps/:id — any valid token for the campaign that owns it. */
function getMap(deps: HttpDeps, req: IncomingMessage, res: ServerResponse, mapId: string): void {
  const identity = requireSession(deps, req, res)
  if (!identity) return

  const map = deps.stores.maps.get(mapId)
  // Another campaign's map is not "forbidden", it is none of this token's business.
  if (!map || map.campaign_id !== identity.campaign_id) {
    return json(res, 404, { error: 'no such map' })
  }
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(map.data),
  })
  res.end(map.data)
}

/** GET /api/resolve/:code — public; the join page calls it before asking for a name. */
function resolveCode(deps: HttpDeps, res: ServerResponse, code: string): void {
  const session = resolveInviteCode(deps.stores.sessions, code)
  if (!session) return json(res, 404, { error: 'no active session for that code' })
  json(res, 200, { campaignId: session.campaign_id, sessionId: session.id })
}

/** POST /api/join — public; `{code, name}` in, player session token out. */
async function joinSession(deps: HttpDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req, res)
  if (!body) return

  const code = text(body.code)
  const name = text(body.name)
  if (!code || !name) return json(res, 400, { error: 'code and name are required' })

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
    token: issueToken(deps.hmacSecret, identity.id, session.campaign_id, 'player'),
  })
}

/** POST /api/sessions — DM starts a session for a campaign and gets its invite code. */
async function openSession(deps: HttpDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req, res)
  if (!body) return

  const campaignId = text(body.campaignId)
  if (!campaignId) return json(res, 400, { error: 'campaignId is required' })
  if (!requireSession(deps, req, res, { campaignId, role: 'dm' })) return

  // createSession ends whatever was running; the table it replaced deserves to hear so.
  const replaced = deps.stores.sessions.getActiveByCampaign(campaignId)
  const session = startSession(deps.stores.sessions, campaignId)
  if (replaced) deps.sessionManager.endSession(replaced.id)

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
  const session = deps.stores.sessions.get(sessionId)
  if (!session) return json(res, 404, { error: 'no such session' })
  if (!requireSession(deps, req, res, { campaignId: session.campaign_id, role: 'dm' })) return

  deps.stores.sessions.endSession(sessionId)
  deps.sessionManager.endSession(sessionId)
  json(res, 200, { sessionId, active: false })
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

// ─── Plumbing ─────────────────────────────────────────────

type Body = { ok: true; text: string } | { ok: false; status: number; error: string }

/**
 * Reads a request body, refusing anything over `limit` twice over: the declared
 * Content-Length is rejected before a byte is buffered, and the running byte count is
 * rejected before the buffer completes — so a lying (or absent) Content-Length costs the
 * server one chunk past the cap, not a 20MB allocation it never wanted.
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
        // Past the cap the bytes are dropped on the floor, but the stream is left flowing
        // and the connection is left open. Pausing or hanging up mid-upload sends an RST
        // that discards the 413 we just wrote — the client would see a reset instead of
        // the reason. ponytail: so an oversized upload is still read to its end; memory,
        // which is what the cap protects, stops growing here. Cap the *read* too if this
        // server ever faces something other than a self-hosted table's own DM.
        chunks.length = 0
        resolve(tooLarge)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve({ ok: true, text: Buffer.concat(chunks).toString('utf8') }))
    req.on('error', () => resolve({ ok: false, status: 400, error: 'request aborted' }))
  })
}

/** Small JSON body, or null when it has already answered the request. */
async function readJson(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  const body = await readBody(req, JSON_BODY_LIMIT)
  if (!body.ok) {
    json(res, body.status, { error: body.error })
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body.text || '{}')
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
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('access-control-allow-headers', 'authorization, content-type')
}

/** A non-empty trimmed string, or null — the only two things a caller wants to branch on. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
