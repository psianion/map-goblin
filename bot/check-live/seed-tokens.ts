// Drops a few unclaimed friendly tokens onto the live table so players who join have
// something to claim and walk. The DM half of the table dresser, nothing more.
//
// Run from bot/:  pnpm exec tsx check-live/seed-tokens.ts [campaignId] [--open]
// Without an argument, the campaign of the one live session in bot/data/bot.db is used.
// `--open` also opens the whole scene (the DM's "players see everything").

import { readFileSync } from 'node:fs'
import { WebSocket } from 'ws'
import { openDb } from '../src/db/db'
import { createSessions } from '../src/db/stores'
import { socketUrl, PROTOCOL_VERSION } from '../src/goblin/observer'
import { readScene } from '../src/render/map-svg'

const BASE = 'http://127.0.0.1:5600'
const NAMES = ['Anna', 'Bryn', 'Corin', 'Dael']
/** A placed token has no sight, and in vision mode a player may only stand on ground the party
 * has been shown — so a blind token is stuck at the edge of the DM's reveal. Eyes fix that. */
const SIGHT = { range: 12, angle: 360, visionMode: 'normal' }
/** The forest demo plays at night, and normal sight in the dark shows nothing — so each token
 * also carries a torch, which is what lights the ground its sight then reveals. */
const LIGHT = { bright: 4, dim: 8, color: '#ffb86b', angle: 360 }

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
) as Record<string, string>
const ADMIN_PASS = env.GOBLIN_ADMIN_PASS
if (!ADMIN_PASS) throw new Error('GOBLIN_ADMIN_PASS missing from bot/.env')

const campaignId =
  process.argv.slice(2).find((a) => !a.startsWith('--')) ??
  (() => {
    const live = createSessions(openDb('data/bot.db')).live()
    if (live.length !== 1) throw new Error(`expected one live session in bot.db, found ${live.length} — pass the campaign id`)
    return live[0].campaignId
  })()

async function mintDmToken(): Promise<string> {
  const response = await fetch(`${BASE}/api/campaigns/${campaignId}/dm-token`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN_PASS}` },
  })
  if (!response.ok) throw new Error(`dm-token mint failed: ${response.status} ${await response.text()}`)
  return ((await response.json()) as { token: string }).token
}

/** Grid cells whose centre lies inside a floor ring — the only ground a token can stand on. */
function floorCells(doc: unknown): [number, number][] {
  const scene = readScene(doc, true)
  const cells: [number, number][] = []
  const inside = (ring: [number, number][], x: number, y: number): boolean => {
    let hit = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
    }
    return hit
  }
  for (const rings of scene.floors) {
    const [outer, ...holes] = rings
    if (!outer?.length) continue
    const xs = outer.map(([x]) => x)
    const ys = outer.map(([, y]) => y)
    for (let col = Math.floor(Math.min(...xs)); col < Math.ceil(Math.max(...xs)); col++)
      for (let row = Math.floor(Math.min(...ys)); row < Math.ceil(Math.max(...ys)); row++) {
        const cx = col + 0.5
        const cy = row + 0.5
        if (inside(outer, cx, cy) && !holes.some((hole) => inside(hole, cx, cy))) cells.push([col, row])
      }
  }
  return cells
}

async function main(): Promise<void> {
  const token = await mintDmToken()
  const socket = new WebSocket(socketUrl(BASE, token))
  let seq = 0
  const send = (module: string, action: string, payload: unknown): void => {
    seq += 1
    socket.send(JSON.stringify({ type: 'command', module, action, payload, seq }))
  }

  const state = await new Promise<{ sceneId: string; existing: number; extra: string[]; seeded: string[] }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no session-state within 15s — is a session open?')), 15_000)
    socket.on('open', () => socket.send(JSON.stringify({ type: 'join', protocolVersion: PROTOCOL_VERSION })))
    socket.on('error', reject)
    socket.on('message', (raw) => {
      const frame = JSON.parse(String(raw)) as Record<string, unknown>
      if (frame.type === 'error') console.log(`[dm seat] ${JSON.stringify(frame)}`)
      if (frame.type !== 'session-state') return
      clearTimeout(timer)
      const s = frame.state as {
        activeSceneId?: string
        modules?: { tokens?: { byScene?: Record<string, Record<string, { id: string; name: string }>> } }
      }
      if (!s.activeSceneId) return reject(new Error('session has no active scene'))
      const tokens = Object.values(s.modules?.tokens?.byScene?.[s.activeSceneId] ?? {})
      // Anything past the first token of each seeded name is a repeat from an earlier run.
      const seen = new Set<string>()
      const extra = tokens
        .filter((t) => NAMES.includes(t.name) && (seen.has(t.name) || (seen.add(t.name), false)))
        .map((t) => t.id)
      const seeded = tokens.filter((t) => NAMES.includes(t.name) && !extra.includes(t.id)).map((t) => t.id)
      resolve({ sceneId: s.activeSceneId, existing: tokens.length - extra.length, extra, seeded })
    })
  })

  const response = await fetch(`${BASE}/api/maps/${state.sceneId}`, { headers: { authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`map fetch failed: ${response.status}`)
  const cells = floorCells(await response.json())
  if (cells.length < NAMES.length) throw new Error(`only ${cells.length} floor cells found on the active scene`)

  // Middle of the floor, spread one cell apart, so nobody spawns inside a wall.
  const mid = cells[Math.floor(cells.length / 2)]
  const near = cells
    .map((cell) => ({ cell, d: Math.hypot(cell[0] - mid[0], cell[1] - mid[1]) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, NAMES.length)
    .map(({ cell }) => cell)

  // Players only see an unclaimed friendly token on ground they have explored, so open the
  // floor around the spawn first: every floor cell within a short walk of the middle.
  const opened = cells.filter(([c, r]) => Math.abs(c - mid[0]) <= 8 && Math.abs(r - mid[1]) <= 6)
  send('fog', 'region-set', { sceneId: state.sceneId, cells: opened, op: 'reveal' })
  // `--open`: the DM's "players see everything" — every room revealed and every cell opened,
  // so the party can walk the whole scene instead of exploring it.
  if (process.argv.includes('--open')) send('fog', 'open-map', { sceneId: state.sceneId })

  for (const id of state.extra) send('tokens', 'delete', { sceneId: state.sceneId, id })
  // Tokens from an earlier run were placed blind; give them the same eyes.
  for (const id of state.seeded) send('tokens', 'update', { sceneId: state.sceneId, id, sight: SIGHT, light: LIGHT })

  // A second run opens ground again but does not double the party.
  const toPlace = state.existing === 0 ? NAMES : []
  toPlace.forEach((name, i) => {
    const [col, row] = near[i]
    send('tokens', 'place', { sceneId: state.sceneId, name, x: col + 0.5, y: row + 0.5, size: 'medium', disposition: 'friendly', sight: SIGHT, light: LIGHT })
  })
  // Read the scene back, so a refused update shows up here and not at the table.
  const after = await new Promise<Record<string, { name: string; sight: unknown; light: unknown; ownerId: string | null }>>(
    (resolve) => {
      // Several commands went out; the scene that matters is the one after the last of them.
      let latest = {}
      socket.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as { type: string; module?: string; state?: { byScene?: Record<string, never> } }
        if (frame.type === 'state-update' && frame.module === 'tokens') latest = frame.state?.byScene?.[state.sceneId] ?? {}
      })
      setTimeout(() => resolve(latest), 3000)
    },
  )
  for (const t of Object.values(after))
    console.log(`  ${t.name}: sight ${JSON.stringify(t.sight)} light ${JSON.stringify(t.light)} owner ${t.ownerId ?? '—'}`)
  console.log(
    `revealed ${opened.length} floor cells and placed ${toPlace.length} unclaimed friendly tokens on scene ${state.sceneId} (had ${state.existing} before, removed ${state.extra.length} repeats) at ${near
      .map(([c, r]) => `(${c},${r})`)
      .join(' ')}`,
  )
  socket.close()
}

main().catch((error: unknown) => {
  console.error(String(error))
  process.exit(1)
})
