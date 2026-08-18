import { describe, expect, it } from 'vitest'
import { createGoblinRest } from './rest'
import { BotError } from '../lib/errors'

interface Call {
  url: string
  init: RequestInit
}

/** A `fetch` that records what it was asked and answers with what the test wants. */
function fakeFetch(reply: (call: Call) => Response | Promise<Response>): {
  fetch: typeof globalThis.fetch
  calls: Call[]
} {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    return reply({ url, init })
  }) as unknown as typeof globalThis.fetch
  return { fetch: fetchImpl, calls }
}

const ok = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

const fail = (status: number, error: string): Response =>
  new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } })

const headerOf = (call: Call, name: string): string =>
  ((call.init.headers ?? {}) as Record<string, string>)[name]

describe('goblin rest client', () => {
  it('bearers the credential it was handed, per call', async () => {
    const { fetch, calls } = fakeFetch(() => ok({ scenes: [] }))
    const rest = createGoblinRest({ baseUrl: 'http://localhost:5600/', fetch })

    await rest.getScenes('dm-token', 'camp-1')
    expect(calls[0].url).toBe('http://localhost:5600/api/campaigns/camp-1/scenes')
    expect(headerOf(calls[0], 'authorization')).toBe('Bearer dm-token')

    // The admin pass rides the same header — it is the credential the mint route wants.
    await rest.mintServiceToken('admin-pass', 'camp-1', 'player').catch(() => {})
    expect(headerOf(calls[1], 'authorization')).toBe('Bearer admin-pass')
  })

  it('unwraps the collections the server nests', async () => {
    const scene = { id: 's1', name: 'Hideout', sortIndex: 0, visibleToPlayers: true, mapId: 'm1', updatedAt: 1 }
    const { fetch } = fakeFetch(() => ok({ scenes: [scene] }))
    const rest = createGoblinRest({ baseUrl: 'http://localhost:5600', fetch })
    expect(await rest.getScenes('t', 'camp-1')).toEqual([scene])
  })

  it('sends the scene only when one was picked', async () => {
    const { fetch, calls } = fakeFetch(() => ok({ sessionId: 's', campaignId: 'c', inviteCode: 'ABC123' }))
    const rest = createGoblinRest({ baseUrl: 'http://localhost:5600', fetch })

    await rest.openSession('t', 'camp-1')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ campaignId: 'camp-1' })

    await rest.openSession('t', 'camp-1', 'scene-9')
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ campaignId: 'camp-1', sceneId: 'scene-9' })
  })

  it('maps the server error codes onto the bot taxonomy', async () => {
    const cases: [number, string, string][] = [
      [400, 'campaignId is required', 'user_input'],
      [404, 'no such campaign', 'not_found'],
      [429, 'too many attempts', 'user_input'],
      [500, 'internal error', 'internal'],
    ]
    for (const [status, message, code] of cases) {
      const { fetch } = fakeFetch(() => fail(status, message))
      const rest = createGoblinRest({ baseUrl: 'http://localhost:5600', fetch })
      const error = await rest.getScenes('t', 'camp-1').catch((e: unknown) => e)
      expect(error).toBeInstanceOf(BotError)
      expect((error as BotError).code).toBe(code)
    }
  })

  it('never repeats a rejected credential back to the user', async () => {
    for (const status of [401, 403]) {
      const { fetch } = fakeFetch(() => fail(status, 'invalid admin pass'))
      const rest = createGoblinRest({ baseUrl: 'http://localhost:5600', fetch })
      const error = (await rest.getScenes('t', 'camp-1').catch((e: unknown) => e)) as BotError
      expect(error.code).toBe('internal')
      expect(error.userMessage).not.toMatch(/admin pass/)
    }
  })

  it('turns an unreachable server into one internal error, not a raw fetch failure', async () => {
    const fetchImpl = (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof globalThis.fetch
    const rest = createGoblinRest({ baseUrl: 'http://localhost:5600', fetch: fetchImpl })
    const error = (await rest.getScenes('t', 'camp-1').catch((e: unknown) => e)) as BotError
    expect(error.code).toBe('internal')
    expect(error.userMessage).toMatch(/not answering/)
  })

  it('hands back asset bytes with the mime the server declared', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const { fetch } = fakeFetch(
      () => new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } }),
    )
    const rest = createGoblinRest({ baseUrl: 'http://localhost:5600', fetch })
    const asset = await rest.getAsset('t', 'asset-1')
    expect(asset.mime).toBe('image/png')
    expect([...asset.bytes]).toEqual([...bytes])
  })
})
