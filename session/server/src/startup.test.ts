// Sprint 1 and 3 success metrics that only a real OS process can answer: cold start time,
// whether a campaign survives that process being killed, and — S3 §2.6 — whether the fog
// and the doors do. Everything here goes over HTTP and a real WebSocket against a spawned
// `tsx src/index.ts` — the same command `pnpm start` and the Dockerfile run — on a scratch
// data directory (D10: no mocks).

import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { ServerMessage, SessionState } from '@dnd/core/src/shared/protocol'
import type { DoorChild, Room } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'

const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url))
const FIXTURE = join(PKG_ROOT, '../testdata/demo-dungeon.mapbuilder')
/** The dressed gate map (D15) — the S3 rows are only honest against real content. */
const GATE_FIXTURE = join(PKG_ROOT, '../testdata/emberhold-crypt.mapbuilder')

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

/** The next frame `where` accepts; an `error` frame fails fast instead of timing out. */
function waitFor(socket: WebSocket, where: (msg: ServerMessage) => boolean): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage)
      reject(new Error('no matching frame in 5s'))
    }, 5000)
    const onMessage = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage
      const done = where(msg) || msg.type === 'error'
      if (!done) return
      clearTimeout(timer)
      socket.off('message', onMessage)
      if (msg.type === 'error' && !where(msg)) reject(new Error(`server refused: ${msg.code}`))
      else resolve(msg)
    }
    socket.on('message', onMessage)
  })
}

/** A connected, joined socket that stays open — commands go out on it and land in SQLite. */
async function seat(base: string, token: string) {
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`)
  await once(socket, 'open')
  const rejoin = async (): Promise<SessionState> => {
    const answered = waitFor(socket, (m) => m.type === 'session-state')
    socket.send(JSON.stringify({ type: 'join', protocolVersion: 3 }))
    return (await answered as Extract<ServerMessage, { type: 'session-state' }>).state
  }
  return {
    state: await rejoin(),
    rejoin,
    /** Sends and waits for that module's own broadcast — the write is durable by then. */
    async command(module: string, action: string, payload: unknown): Promise<void> {
      const settled = waitFor(socket, (m) => m.type === 'state-update' && m.module === module)
      socket.send(JSON.stringify({ type: 'command', module, action, payload, seq: 1 }))
      await settled
    },
    close: () => socket.close(),
  }
}

/** Connects, joins, and hands back the snapshot the server answered with. */
async function snapshot(base: string, token: string): Promise<SessionState> {
  const seated = await seat(base, token)
  try {
    return seated.state
  } finally {
    seated.close()
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

// ── §2.6 (S3): fog and door state across a restart ──────────────────────────
// The tracker row names `docker compose restart`; the container is walked at the gate. What
// this pins is the half a container cannot fake — that the state lives in SQLite and not in
// the process, so the same table comes back up mid-dungeon with the same rooms dark, the
// same door bolted and the same secret still secret.
//
// On the dressed gate map (D15), with ids taken by shape rather than spelled out: a
// re-authored map has to fail here loudly instead of asserting about rooms that moved.

const gate = JSON.parse(readFileSync(GATE_FIXTURE, 'utf8')) as SerializedMapData
const gateLayer = gate.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!
const gateRooms: Room[] = [...(gateLayer.rooms ?? [])].sort((a, b) => b.area - a.area)
const gateDoors = gateLayer.children.filter((c): c is DoorChild => c.childType === 'door')
/** An ordinary door with a leaf to swing — an archway rejects `toggle` (it is a hole). */
const SWINGS = gateDoors.find((d) => !d.isSecret && d.style !== 'archway')!
const HIDDEN_DOOR = gateDoors.find((d) => d.isSecret)!

interface FogSlice {
  byScene: Record<string, { rooms: Record<string, unknown>; concealBehindDoors: boolean }>
}
type DoorsSlice = { byScene: Record<string, Record<string, unknown>> }

describe('fog and doors persistence (§2.6, D1/D2)', () => {
  it(
    'comes back up mid-dungeon with the same rooms dark and the same door bolted',
    { timeout: 90_000 },
    async () => {
      const dataDir = scratch()
      const first = await boot(dataDir)
      let dmToken: string
      let playerToken: string
      let sceneId: string
      let fogBefore: FogSlice
      let doorsBefore: DoorsSlice

      try {
        const campaign = await api(first.base, 'POST', '/api/campaigns', {
          token: first.adminPass!,
          body: { name: 'Emberhold' },
        })
        expect(campaign.status).toBe(201)
        dmToken = campaign.body.token as string
        const campaignId = campaign.body.campaignId as string

        const upload = await api(first.base, 'POST', `/api/campaigns/${campaignId}/maps`, {
          token: dmToken,
          raw: readFileSync(GATE_FIXTURE, 'utf8'),
        })
        expect(upload.status).toBe(201)
        sceneId = upload.body.mapId as string

        const session = await api(first.base, 'POST', '/api/sessions', {
          token: dmToken,
          body: { campaignId },
        })
        expect(session.status).toBe(201)
        const joined = await api(first.base, 'POST', '/api/join', {
          body: { code: session.body.inviteCode as string, name: 'Borin' },
        })
        expect(joined.status).toBe(200)
        playerToken = joined.body.token as string

        // A table mid-session: one room lit, one explored and dark again, concealment off,
        // a door opened then bolted behind them, and the secret door found. Every field of
        // both modules moved off its authored default, so a restart that silently re-seeded
        // from the map file would look nothing like this.
        const dm = await seat(first.base, dmToken)
        try {
          await dm.command('fog', 'reveal', { roomId: gateRooms[0].id })
          await dm.command('fog', 'reveal', { roomId: gateRooms[1].id })
          await dm.command('fog', 'hide', { roomId: gateRooms[1].id })
          await dm.command('fog', 'set-conceal', { concealBehindDoors: false })
          await dm.command('doors', 'toggle', { id: SWINGS.id })
          await dm.command('doors', 'lock', { id: SWINGS.id })
          await dm.command('doors', 'reveal-secret', { id: HIDDEN_DOOR.id })

          const state = await dm.rejoin()
          fogBefore = state.modules.fog as FogSlice
          doorsBefore = state.modules.doors as DoorsSlice
        } finally {
          dm.close()
        }

        expect(fogBefore.byScene[sceneId].concealBehindDoors).toBe(false)
        expect(fogBefore.byScene[sceneId].rooms[gateRooms[0].id]).toEqual({
          status: 'revealed',
          wasEverRevealed: true,
        })
        expect(fogBefore.byScene[sceneId].rooms[gateRooms[1].id]).toEqual({
          status: 're_hidden',
          wasEverRevealed: true,
        })
        expect(doorsBefore.byScene[sceneId][SWINGS.id]).toEqual({
          open: true,
          locked: true,
          revealed: true,
        })
        expect(doorsBefore.byScene[sceneId][HIDDEN_DOOR.id]).toMatchObject({ revealed: true })
      } finally {
        await first.stop()
      }

      const second = await boot(dataDir)
      try {
        const after = await snapshot(second.base, dmToken)
        expect(after.modules.fog).toEqual(fogBefore)
        expect(after.modules.doors).toEqual(doorsBefore)

        // And the player's redacted half is the same cut it was: the room that went dark is
        // still theirs to draw (D4), the room nobody entered is still absent, and the door
        // the DM found is still the DM's own business until a player is in the room with it.
        const forPlayer = (await snapshot(second.base, playerToken)).modules.fog as FogSlice
        expect(Object.keys(forPlayer.byScene[sceneId].rooms).sort()).toEqual(
          [gateRooms[0].id, gateRooms[1].id].sort(),
        )

        console.log(
          `[metric] fog + doors persistence across process restart: ` +
            `${Object.keys(fogBefore.byScene[sceneId].rooms).length} room record(s) and ` +
            `${Object.keys(doorsBefore.byScene[sceneId]).length} door record(s) identical ` +
            `after the process was killed (restart took ${second.readyMs.toFixed(0)}ms)`,
        )
      } finally {
        await second.stop()
      }
    },
  )
})
