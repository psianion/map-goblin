// Boot: config → db → http → ws upgrade → SessionManager.

import { createServer, type IncomingMessage } from 'node:http'
import { pathToFileURL } from 'node:url'
import type { GameModule } from '@dnd/mechanics/contract'
import { doorsModule } from '@dnd/mechanics/doors'
import { fogModule } from '@dnd/mechanics/fog'
import { rollsModule } from '@dnd/mechanics/rolls'
import { tokensModule } from '@dnd/mechanics/tokens'
import { WebSocketServer } from 'ws'
import { ensureAdminPass, verifyToken } from './auth'
import { loadConfig, type Config } from './config'
import { openDb } from './db/db'
import { createStores, type Stores } from './db/stores'
import { createVision } from './fog/vision'
import { createRequestHandler } from './http'
import { pingModule } from './modules/ping'
import { ModuleRegistry } from './modules/registry'
import { scenesModule } from './modules/scenes'
import { ClientConnection, type Identity } from './ws/ClientConnection'
import { SessionManager, type SessionManagerOptions } from './ws/SessionManager'

/**
 * The largest legal ClientMessage is a `command` whose payload is a few fields; `ws`
 * otherwise defaults to a 100MiB frame, which is 100MiB any token holder can hand to
 * JSON.parse. Heavy payloads go over HTTP (§2.3) — nothing on this socket is big.
 */
const MAX_WS_PAYLOAD_BYTES = 256 * 1024

/**
 * D6 — the only thing accepted at upgrade is a session token in `?token=`. The token says
 * who you are; the database says whether that still means anything: an identity that has
 * been banned, or a session that has ended, gets no socket no matter how well signed its
 * token is.
 */
export function authenticateUpgrade(
  req: IncomingMessage,
  hmacSecret: string,
  stores: Stores,
): Identity | null {
  const params = new URL(req.url ?? '/', 'http://localhost').searchParams
  const claims = verifyToken(hmacSecret, params.get('token'))
  if (!claims) return null

  const identity = stores.identities.get(claims.identityId)
  if (!identity || identity.banned === 1) return null

  // A session-bound token opens that session or nothing — ending it, or replacing it with
  // a new one under a fresh invite code, is what makes the token stop working. An unbound
  // (DM) token still means "whatever table this campaign is running".
  const session = claims.sessionId
    ? stores.sessions.get(claims.sessionId)
    : stores.sessions.getActiveByCampaign(claims.campaignId)
  if (!session || session.active !== 1 || session.campaign_id !== claims.campaignId) return null

  stores.identities.touchLastSeen(identity.id)
  return {
    identityId: identity.id,
    name: identity.name,
    // The row wins over the claim — see requireSession in http.ts.
    role: identity.role,
    sessionId: session.id,
    campaignId: session.campaign_id,
  }
}

export interface StartOptions extends SessionManagerOptions {
  /** Overrides PORT. 0 binds an ephemeral port — that is how the tests run. */
  port?: number
  /** Overrides the configured database path. Tests pass `:memory:`. */
  dbPath?: string
  /** Registered alongside the built-ins — the seam a test module arrives through. */
  modules?: readonly GameModule[]
}

export interface RunningServer {
  port: number
  sessions: SessionManager
  stores: Stores
  config: Config
  close(): Promise<void>
}

export async function startServer(options: StartOptions = {}): Promise<RunningServer> {
  const config = loadConfig()
  const db = openDb(options.dbPath ?? config.dbPath)
  const stores = createStores(db)
  ensureAdminPass(stores.passes)

  // Rooms, doors and who may see what: one cache behind every fog answer the server gives
  // (S3 §2.3). The three modules below take their map lookups from it.
  const vision = createVision(stores)

  // §2.3.8 — the whole module table. Rolls and tokens register here the same way, from
  // @dnd/mechanics; nothing else in the server changes when they do (D2).
  const modules = new ModuleRegistry(stores.moduleState)
  modules.register(pingModule)
  modules.register(scenesModule(stores))
  modules.register(rollsModule)
  modules.register(tokensModule(vision.visionOf))
  modules.register(fogModule(vision.roomsOf))
  modules.register(doorsModule(vision.doorsOf, vision.playerDoors))
  for (const module of options.modules ?? []) modules.register(module)

  const sessions = new SessionManager(modules, {
    vision,
    // Scene metadata is whatever the campaign has uploaded; the active one is session state.
    scenes: ({ id, campaignId }) => {
      const scenes = stores.maps.listByCampaign(campaignId).map((map) => ({ id: map.id, name: map.name }))
      return {
        scenes,
        // A session with no explicit choice falls back to a map rather than leaving every
        // client on "Waiting for the DM to pick a scene…" forever. The fallback is computed
        // per snapshot rather than written at upload time so a map uploaded *after* the
        // session opened still lights up the table.
        //
        // The *last* map, not the first: `listByCampaign` is ordered by `imported_at`, and a
        // DM who uploads a second map into a campaign means the table to show the one they
        // just uploaded. Falling back to the first left the table sitting on a stale map
        // while everything the DM did — reveals included — landed on the new one.
        activeSceneId:
          stores.sessions.get(id)?.active_scene_id ?? scenes[scenes.length - 1]?.id ?? null,
      }
    },
    // The upgrade checked both of these once; these are the same questions asked again for
    // a socket that is already open, because a ban or a closed table has to bite a client
    // that is sitting there rather than reconnecting.
    sessionActive: (id) => stores.sessions.get(id)?.active === 1,
    isBanned: (identityId) => stores.identities.isBanned(identityId),
    ...options,
  })
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD_BYTES })
  const http = createServer(
    createRequestHandler({
      hmacSecret: config.secrets.hmacSecret,
      stores,
      sessionManager: sessions,
      vision,
      modules,
    }),
  )

  http.on('upgrade', (req, socket, head) => {
    const identity = authenticateUpgrade(req, config.secrets.hmacSecret, stores)
    if (!identity) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => sessions.accept(new ClientConnection(ws, identity)))
  })

  await new Promise<void>((ready) => http.listen(options.port ?? config.port, ready))
  const address = http.address()
  const port = typeof address === 'object' && address !== null ? address.port : config.port
  console.log(`game-server listening on :${port}`)

  return {
    port,
    sessions,
    stores,
    config,
    close: async () => {
      sessions.close() // terminates live sockets so http.close() can actually settle
      wss.close()
      http.closeAllConnections() // ...and so does a keep-alive socket nobody is using
      await new Promise<void>((done) => http.close(() => done()))
      db.close()
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startServer()
}
