// The game server's REST surface, as the six calls the bot actually makes (plan §4). A thin
// wrapper over `fetch`, not a client library: every route is one line of URL and the token
// is an argument rather than instance state, because the bot holds a different one per
// campaign and per role.
//
// The server is the authority (plan §3) — nothing here caches, retries or re-derives its
// answers. `fetch` is injectable so the tests never open a socket.

import { internal, notFound, userInput } from '../lib/errors'

export type GoblinRole = 'dm' | 'player'

export interface ServiceToken {
  token: string
  campaignId: string
  role: GoblinRole
  name: string
}

export interface GoblinScene {
  id: string
  name: string
  sortIndex: number
  visibleToPlayers: boolean
  mapId: string
  updatedAt: number
}

export interface OpenedSession {
  sessionId: string
  campaignId: string
  inviteCode: string
}

export interface GoblinAsset {
  bytes: Buffer
  mime: string
}

export interface GoblinRestOptions {
  /** GOBLIN_SERVER_URL. Trailing slashes are tolerated. */
  baseUrl: string
  fetch?: typeof globalThis.fetch
}

export interface GoblinRest {
  /** Admin-pass gated, not token gated — this is the call that produces the tokens. */
  mintServiceToken: (adminPass: string, campaignId: string, role: GoblinRole) => Promise<ServiceToken>
  getScenes: (token: string, campaignId: string) => Promise<GoblinScene[]>
  openSession: (token: string, campaignId: string, sceneId?: string) => Promise<OpenedSession>
  endSession: (token: string, sessionId: string) => Promise<void>
  /** Milestone 6's map renderer input. A player token gets the server-redacted document. */
  getMap: (token: string, sceneId: string) => Promise<unknown>
  getAsset: (token: string, assetId: string) => Promise<GoblinAsset>
}

export function createGoblinRest(options: GoblinRestOptions): GoblinRest {
  const base = options.baseUrl.replace(/\/+$/, '')
  const doFetch = options.fetch ?? globalThis.fetch

  async function call(
    credential: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    let response: Response
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${credential}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      // A DNS miss, a refused connection, a dead box — one message, because the user can do
      // exactly one thing about all three.
      throw internal('The game server is not answering right now.')
    }
    if (!response.ok) throw await toBotError(response)
    return response
  }

  async function json<T>(credential: string, method: string, path: string, body?: unknown): Promise<T> {
    return (await call(credential, method, path, body)).json() as Promise<T>
  }

  return {
    mintServiceToken: (adminPass, campaignId, role) =>
      json<ServiceToken>(adminPass, 'POST', `/api/campaigns/${enc(campaignId)}/service-token`, { role }),

    getScenes: async (token, campaignId) =>
      (await json<{ scenes: GoblinScene[] }>(token, 'GET', `/api/campaigns/${enc(campaignId)}/scenes`)).scenes,

    openSession: (token, campaignId, sceneId) =>
      json<OpenedSession>(token, 'POST', '/api/sessions', {
        campaignId,
        ...(sceneId === undefined ? {} : { sceneId }),
      }),

    endSession: async (token, sessionId) => {
      await call(token, 'POST', `/api/sessions/${enc(sessionId)}/end`)
    },

    getMap: (token, sceneId) => json<unknown>(token, 'GET', `/api/maps/${enc(sceneId)}`),

    getAsset: async (token, assetId) => {
      const response = await call(token, 'GET', `/api/assets/${enc(assetId)}`)
      return {
        bytes: Buffer.from(await response.arrayBuffer()),
        mime: response.headers.get('content-type') ?? 'application/octet-stream',
      }
    },
  }
}

const enc = encodeURIComponent

/**
 * Server `{error}` → the bot's taxonomy. 401/403 are deliberately *not* passed through:
 * a rejected token is an operator problem the player cannot act on, and its message would
 * only describe the bot's own credentials in a channel.
 */
async function toBotError(response: Response): Promise<Error> {
  const message = await response
    .json()
    .then((body) => (body as { error?: unknown }).error)
    .catch(() => undefined)
  const detail = typeof message === 'string' ? message : 'the game server refused that'

  if (response.status === 400) return userInput(`The game server said: ${detail}.`)
  if (response.status === 404) return notFound(`The game server has no record of that: ${detail}.`)
  if (response.status === 429) return userInput('The game server is busy — try that again in a moment.')
  return internal()
}
