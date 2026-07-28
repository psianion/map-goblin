// Sprint 1 success metrics that only a real OS process can answer: cold start time, and
// whether a campaign survives that process being killed. Everything here goes over HTTP and
// a real WebSocket against a spawned `tsx src/index.ts` — the same command `pnpm start` and
// the Dockerfile run — on a scratch data directory (D10: no mocks).

import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { ServerMessage, SessionState } from '@dnd/core/src/shared/protocol'

const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url))
const FIXTURE = join(PKG_ROOT, '../testdata/demo-dungeon.mapbuilder')

interface Booted {
  child: ChildProcess
  base: string
  /** Only the first boot on a data directory prints one — it is minted once (D6). */
  adminPass: string | null
  /** Milliseconds from `spawn()` to the first HTTP response the server actually served. */
  readyMs: number
  stop: () => Promise<void>
}

/**
 * Cold boot on `dataDir`, timed. The clock starts before `spawn` — so tsx's TypeScript
 * transform, better-sqlite3's native load, the migrations and (on a fresh directory)
 * secret + admin-pass generation are all inside the measurement, because they are all
 * inside what a self-hoster waits for.
 *
 * PORT=0 so the ports are ephemeral and the suite never collides with a dev server; the
 * real one is read back off the line the server logs at listen.
 */
async function boot(dataDir: string): Promise<Booted> {
  const tsx = join(PKG_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.CMD' : 'tsx')

  const startedAt = performance.now()
  const child = spawn(`"${tsx}"`, ['src/index.ts'], {
    cwd: PKG_ROOT,
    env: { ...process.env, GAME_SERVER_DATA: dataDir, PORT: '0' },
    shell: true,
    detached: process.platform !== 'win32',
  })

  let log = ''
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not listen in 30s. Output:\n${log}`)), 30_000)
    const read = (chunk: Buffer) => {
      log += chunk.toString()
      const listening = /listening on :(\d+)/.exec(log)
      if (listening) {
        clearTimeout(timer)
        resolve(Number(listening[1]))
      }
    }
    child.stdout?.on('data', read)
    child.stderr?.on('data', read)
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`server exited with ${code} before listening. Output:\n${log}`))
    })
  })

  // "Ready" is a served response, not a log line: a bound socket whose handler is not
  // wired yet would still print. Any status counts — 404 for a nonsense code is the
  // server answering.
  const base = `http://127.0.0.1:${port}`
  await fetch(`${base}/api/resolve/ZZZZZZ`)
  const readyMs = performance.now() - startedAt

  return {
    child,
    base,
    adminPass: /admin pass \(first run\): (\S+)/.exec(log)?.[1] ?? null,
    readyMs,
    stop: async () => {
      // `tsx` runs under a shell here, so killing the shell alone would orphan the server
      // still holding the SQLite file — and the restart would open it underneath itself.
      if (child.pid) {
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        else process.kill(-child.pid, 'SIGKILL')
      }
      await once(child, 'exit')
    },
  }
}

async function api(
  base: string,
  method: string,
  path: string,
  options: { token?: string; body?: unknown; raw?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  })
  const text = await res.text()
  return { status: res.status, body: text.startsWith('{') ? (JSON.parse(text) as Record<string, unknown>) : {} }
}

/** Connects, joins, and hands back the snapshot the server answered with. */
async function snapshot(base: string, token: string): Promise<SessionState> {
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`)
  await once(socket, 'open')
  socket.send(JSON.stringify({ type: 'join', protocolVersion: 3 }))
  try {
    return await new Promise<SessionState>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no session-state in 5s')), 5000)
      socket.on('message', (raw: Buffer) => {
        const msg = JSON.parse(raw.toString()) as ServerMessage
        if (msg.type !== 'session-state') return
        clearTimeout(timer)
        resolve(msg.state)
      })
    })
  } finally {
    socket.close()
  }
}

const dataDirs: string[] = []
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'game-server-startup-'))
  dataDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of dataDirs) rmSync(dir, { recursive: true, force: true })
})

describe('server startup (Sprint 1 metric)', () => {
  it(
    'is serving requests under 3s from a cold spawn on an empty data directory',
    { timeout: 60_000 },
    async () => {
      const server = await boot(scratch())
      try {
        console.log(`[metric] cold server startup (spawn → first served response): ${server.readyMs.toFixed(0)}ms (target < 3000ms)`)
        // A cold directory is the slow case: secrets.json and the admin pass are minted here.
        expect(server.adminPass).toBeTruthy()
        expect(server.readyMs).toBeLessThan(3000)
      } finally {
        await server.stop()
      }
    },
  )
})

describe('campaign persistence (Sprint 1 metric)', () => {
  it(
    'serves the same session, scenes and map after the process is killed and restarted',
    { timeout: 90_000 },
    async () => {
      const dataDir = scratch()
      const first = await boot(dataDir)
      let campaignId: string
      let mapId: string
      let inviteCode: string
      let playerToken: string
      let before: SessionState

      try {
        const campaign = await api(first.base, 'POST', '/api/campaigns', {
          token: first.adminPass!,
          body: { name: 'Cragmaw Hideout' },
        })
        expect(campaign.status).toBe(201)
        campaignId = campaign.body.campaignId as string
        const dmToken = campaign.body.token as string

        const upload = await api(first.base, 'POST', `/api/campaigns/${campaignId}/maps`, {
          token: dmToken,
          raw: readFileSync(FIXTURE, 'utf8'),
        })
        expect(upload.status).toBe(201)
        mapId = upload.body.mapId as string

        const session = await api(first.base, 'POST', '/api/sessions', { token: dmToken, body: { campaignId } })
        expect(session.status).toBe(201)
        inviteCode = session.body.inviteCode as string

        const joined = await api(first.base, 'POST', '/api/join', { body: { code: inviteCode, name: 'Borin' } })
        expect(joined.status).toBe(200)
        playerToken = joined.body.token as string

        before = await snapshot(first.base, playerToken)
        expect(before.scenes.map((s) => s.name)).toEqual(['Demo Dungeon'])
        expect(before.activeSceneId).toBe(mapId)
      } finally {
        await first.stop()
      }

      const second = await boot(dataDir)
      try {
        // Not a first run any more: the pass was minted once and only its hash was kept.
        expect(second.adminPass).toBeNull()

        const resolved = await api(second.base, 'GET', `/api/resolve/${inviteCode}`)
        expect(resolved.status).toBe(200)
        expect(resolved.body).toMatchObject({ campaignId, sessionId: before.sessionId })

        // The same token the player was issued before the restart — the HMAC secret on
        // disk outlived the process, so nobody has to re-join.
        const after = await snapshot(second.base, playerToken)
        expect(after.sessionId).toBe(before.sessionId)
        expect(after.campaignId).toBe(before.campaignId)
        expect(after.activeSceneId).toBe(before.activeSceneId)
        expect(after.scenes).toEqual(before.scenes)

        // And the map bytes themselves, not just its metadata.
        const map = await api(second.base, 'GET', `/api/maps/${mapId}`, { token: playerToken })
        expect(map.status).toBe(200)
        expect((map.body.mapSettings as { name: string }).name).toBe('Demo Dungeon')

        console.log(
          `[metric] campaign persistence across process restart: session ${after.sessionId} ` +
            `+ ${after.scenes.length} scene(s) + player token all survived ` +
            `(restart took ${second.readyMs.toFixed(0)}ms)`,
        )
      } finally {
        await second.stop()
      }
    },
  )
})
