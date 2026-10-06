// Sets the stage for a live Goblin Warren walk: DM seat + 2 Chrome players + 3 headless
// players, while the Discord bot mirrors the table. This is the stage crew, not the walk.
//
// Run from bot/:
//   pnpm exec tsx check-live/warren-stage.ts publish        (before /session start)
//   pnpm exec tsx check-live/warren-stage.ts dm-seat        (after /session start)
//   pnpm exec tsx check-live/warren-stage.ts seat <CODE>    (after /session start, before the DM's tab)
//
// ORDER MATTERS. `seat` needs a DM socket to place tokens and reveal ground, and
// `POST /api/campaigns/:id/dm-token` reuses the campaign's ONE DM identity (http.ts:184),
// so that socket kicks the human DM's browser tab. `seat` closes it before it parks, and
// says so — but seat the human DM *after* `seat` has printed "dm socket closed", or have
// them reload.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { WebSocket } from 'ws'
import { socketUrl, PROTOCOL_VERSION } from '../src/goblin/observer'
import { readScene } from '../src/render/map-svg'

const CAMP = '18358431-cfeb-46c8-b72b-9a9ac33f0eb8'
const SCENE_NAME = 'Goblin Warren'
const MAP_FILE = '../session/testdata/goblin-warren-recovered.mapbuilder'
const TABLE_URL = 'http://localhost:5602'
const OUT = 'check-live/out'

/** Three seats this script drives, two left claimable for the Chrome players. */
const HEADLESS = ['Nettle', 'Moss', 'Fenwick']
const CLAIMABLE = ['Willow', 'Marek']
const PARTY = [...HEADLESS, ...CLAIMABLE]

/** The forest camp: 17 tents at y 67–86, well clear of the cave floor (y ≲ 58). */
const CAMP_BAND: [number, number] = [67, 86]
/** A placed token has no sight, and in vision mode a player may only stand on ground the
 * party has been shown — a blind token is stuck where the DM's reveal ends. */
const SIGHT = { range: 12, angle: 360, visionMode: 'normal' }
/** The forest plays at night; normal sight in the dark shows nothing without a torch. */
const LIGHT = { bright: 4, dim: 8, color: '#ffb86b', angle: 360 }
/** Chebyshev radius of floor revealed around each spawn — enough to step off the spot. */
const REVEAL_R = 5

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
) as Record<string, string>
const BASE = env.GOBLIN_SERVER_URL ?? 'http://127.0.0.1:5600'
const ADMIN_PASS = env.GOBLIN_ADMIN_PASS
if (!ADMIN_PASS) throw new Error('GOBLIN_ADMIN_PASS missing from bot/.env')

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function api<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${await response.text()}`)
  return (await response.json()) as T
}

/** Admin pass in, the campaign's (single, reused) DM credential out. Never printed. */
async function mintDmToken(): Promise<string> {
  const response = await fetch(`${BASE}/api/campaigns/${CAMP}/dm-token`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN_PASS}` },
  })
  if (!response.ok) throw new Error(`dm-token mint failed: ${response.status} ${await response.text()}`)
  return ((await response.json()) as { token: string }).token
}

interface SceneRow {
  id: string
  name: string
  sortIndex: number
  visibleToPlayers: boolean
}
const listScenes = (token: string): Promise<SceneRow[]> =>
  api<{ scenes: SceneRow[] }>(token, 'GET', `/api/campaigns/${CAMP}/scenes`).then((b) => b.scenes)

/** Rooms and doors as the editor authored them — the same ids the server keys fog on. */
function roomsAndDoors(doc: unknown): { rooms: { id: string; name: string }[]; doors: { id: string; name: string }[] } {
  const layers = (doc as { layers?: { rooms?: { id: string; name: string }[]; children?: { id: string; name: string; childType?: string }[] }[] }).layers ?? []
  return {
    rooms: layers.flatMap((layer) => layer.rooms ?? []).map(({ id, name }) => ({ id, name })),
    doors: layers
      .flatMap((layer) => layer.children ?? [])
      .filter((child) => child.childType === 'door')
      .map(({ id, name }) => ({ id, name })),
  }
}

/** Grid cells whose centre lies inside a floor ring — the only ground a token can stand on.
 * Lifted from check-live/seed-tokens.ts; same even-odd test, same reason. */
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

// ── publish ─────────────────────────────────────────────────────────────────────────────

/**
 * Idempotent: the scene is looked up by name first, uploaded only when it is missing.
 *
 * Two things then make it the scene `/session start` opens on. The bot passes the `scene:`
 * option straight through (command-registry.ts:750 → live-session.ts:426 → POST /api/sessions
 * `sceneId`), so the DM picking "Goblin Warren" in the autocomplete is the real answer. When
 * the DM omits it the server writes no active scene and every snapshot falls back to the
 * campaign's *first* scene in drag order (index.ts:144) — so this also drags Goblin Warren
 * to sortIndex 0, and both paths land on the same map.
 */
async function publish(): Promise<void> {
  const token = await mintDmToken()
  let scenes = await listScenes(token)
  let scene = scenes.find((row) => row.name === SCENE_NAME)

  if (!scene) {
    // The server unwraps MPBLD+gzip itself (mapImport.ts `unwrapMapFile`), so the file goes
    // up exactly as it sits on disk — no decode step here.
    const response = await fetch(`${BASE}/api/campaigns/${CAMP}/maps`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: readFileSync(MAP_FILE),
    })
    if (!response.ok) throw new Error(`map upload failed: ${response.status} ${await response.text()}`)
    const minted = (await response.json()) as { sceneId: string; name: string }
    console.log(`uploaded ${MAP_FILE} → scene ${minted.sceneId} "${minted.name}"`)
    scenes = await listScenes(token)
    scene = scenes.find((row) => row.id === minted.sceneId)
  } else {
    console.log(`scene "${SCENE_NAME}" already published — reused, nothing uploaded`)
  }
  if (!scene) throw new Error('scene missing right after publish')

  if (!scene.visibleToPlayers) await api(token, 'PATCH', `/api/scenes/${scene.id}`, { visibleToPlayers: true })
  if (scene.sortIndex !== 0) {
    const order = [scene.id, ...scenes.filter((row) => row.id !== scene.id).map((row) => row.id)]
    await api(token, 'PUT', `/api/campaigns/${CAMP}/scenes/order`, { order })
  }

  const doc = await api<unknown>(token, 'GET', `/api/maps/${scene.id}`)
  const { rooms, doors } = roomsAndDoors(doc)
  const cells = floorCells(doc)
  const camp = cells.filter(([, row]) => row >= CAMP_BAND[0] && row <= CAMP_BAND[1])

  console.log(`\nscene        ${scene.id}`)
  console.log(`/session start scene: pick "${SCENE_NAME}" (autocomplete value = the id above)`)
  console.log(`order        now sortIndex 0 → the fallback when the DM picks no scene`)
  console.log(`rooms        ${rooms.length}`)
  for (const room of rooms) console.log(`  ${room.id}  ${room.name}`)
  console.log(`doors        ${doors.length}`)
  for (const door of doors) console.log(`  ${door.id}  ${door.name}`)
  console.log(`floor cells  ${cells.length} total, ${camp.length} in the camp band y ${CAMP_BAND[0]}–${CAMP_BAND[1]}`)
  console.log(`\nthe bot never sends startingRoom (live-session.ts:426 passes sceneId only), so the`)
  console.log(`table opens fully unrevealed — \`seat\` is what lights the camp.`)

  mkdirSync(OUT, { recursive: true })
  writeFileSync(`${OUT}/warren-scene.json`, `${JSON.stringify({ sceneId: scene.id, name: scene.name, rooms, doors }, null, 2)}\n`)
  console.log(`\nwrote ${OUT}/warren-scene.json`)
}

// ── dm-seat ─────────────────────────────────────────────────────────────────────────────

/** The two fields the table client reads out of sessionStorage['mg-seat'] (store.ts:106). */
async function dmSeat(): Promise<void> {
  const token = await mintDmToken()
  const open = await api<{ sessionId: string; inviteCode: string }>(token, 'GET', `/api/campaigns/${CAMP}/session`)
  mkdirSync(OUT, { recursive: true })
  writeFileSync(`${OUT}/dm-seat.json`, `${JSON.stringify({ token, inviteCode: open.inviteCode }, null, 2)}\n`)
  console.log(`wrote ${OUT}/dm-seat.json for session ${open.sessionId} (invite ${open.inviteCode}) — token not printed`)
  console.log(`in Chrome on ${TABLE_URL}:  sessionStorage.setItem('mg-seat', <the file's contents>)  then go to /table`)
}

// ── seat ────────────────────────────────────────────────────────────────────────────────

interface Placed {
  id: string
  name: string
  ownerId: string | null
}

/** A socket that has said hello and remembers the last tokens state it was told about. */
function seat(token: string, label: string) {
  const socket = new WebSocket(socketUrl(BASE, token))
  let seq = 0
  let state: { activeSceneId?: string } | undefined
  let tokens: Record<string, Placed> = {}
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: no session-state within 15s`)), 15_000)
    socket.on('error', reject)
    socket.on('open', () => socket.send(JSON.stringify({ type: 'join', protocolVersion: PROTOCOL_VERSION })))
    socket.on('message', (raw) => {
      const frame = JSON.parse(String(raw)) as { type: string; module?: string; state?: Record<string, never> }
      if (frame.type === 'error') console.log(`[${label}] ${String(raw)}`)
      if (frame.type === 'session-state') {
        state = frame.state as { activeSceneId?: string }
        const scene = state.activeSceneId
        const byScene = (state as { modules?: { tokens?: { byScene?: Record<string, Record<string, Placed>> } } }).modules?.tokens?.byScene
        if (scene && byScene?.[scene]) tokens = byScene[scene]
        clearTimeout(timer)
        resolve()
      }
      if (frame.type === 'state-update' && frame.module === 'tokens') {
        const scene = state?.activeSceneId
        const byScene = (frame.state as unknown as { byScene?: Record<string, Record<string, Placed>> })?.byScene
        if (scene && byScene?.[scene]) tokens = byScene[scene]
      }
    })
  })
  return {
    ready,
    socket,
    sceneId: (): string | undefined => state?.activeSceneId,
    tokens: (): Placed[] => Object.values(tokens),
    send: (module: string, action: string, payload: unknown): void => {
      seq += 1
      socket.send(JSON.stringify({ type: 'command', module, action, payload, seq }))
    },
  }
}

async function stage(inviteCode: string): Promise<void> {
  // 1. The DM seat. Short-lived on purpose — see the header.
  const dmToken = await mintDmToken()
  const dm = seat(dmToken, 'dm')
  await dm.ready
  const sceneId = dm.sceneId()
  if (!sceneId) throw new Error('the open session has no active scene')
  const scenes = await listScenes(dmToken)
  const warren = scenes.find((row) => row.name === SCENE_NAME)
  if (warren && warren.id !== sceneId)
    console.log(`WARNING: the table is on scene ${sceneId}, not "${SCENE_NAME}" (${warren.id}) — /session start picked another scene`)

  // 2. Where the party stands: floor cells in the camp band, five of them spread out.
  const doc = await api<unknown>(dmToken, 'GET', `/api/maps/${sceneId}`)
  const cells = floorCells(doc)
  const camp = cells.filter(([, row]) => row >= CAMP_BAND[0] && row <= CAMP_BAND[1])
  if (camp.length < PARTY.length) throw new Error(`only ${camp.length} floor cells in the camp band`)
  const mid = camp[Math.floor(camp.length / 2)]
  const spots: [number, number][] = []
  for (const cell of camp.slice().sort((a, b) => Math.hypot(a[0] - mid[0], a[1] - mid[1]) - Math.hypot(b[0] - mid[0], b[1] - mid[1]))) {
    // Two cells apart, so nobody spawns shoulder to shoulder or inside a tent post.
    if (spots.every(([c, r]) => Math.max(Math.abs(c - cell[0]), Math.abs(r - cell[1])) >= 2)) spots.push(cell)
    if (spots.length === PARTY.length) break
  }
  if (spots.length < PARTY.length) throw new Error(`could not spread ${PARTY.length} spawns in the camp band`)

  // 3. The headless players. Sockets first: `tokens.assign` checks the identity against the
  //    LIVE roster (tokens/module.ts:528), so an identity that is not connected is refused.
  const players = []
  for (const name of HEADLESS) {
    const response = await fetch(`${BASE}/api/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: inviteCode, name }),
    })
    if (!response.ok) throw new Error(`join as ${name} failed: ${response.status} ${await response.text()}`)
    const joined = (await response.json()) as { identityId: string; token: string }
    const player = seat(joined.token, name)
    await player.ready
    players.push({ name, identityId: joined.identityId, seat: player })
    console.log(`joined ${name} (identity ${joined.identityId})`)
  }

  // 4. Light the camp, then place. Unclaimed friendly tokens stay hidden until their ground
  //    has been explored, so the reveal goes first.
  const lit = new Set<string>()
  const opened = camp.filter(([col, row]) =>
    spots.some(([c, r]) => Math.abs(col - c) <= REVEAL_R && Math.abs(row - r) <= REVEAL_R),
  )
  for (const [col, row] of opened) lit.add(`${col},${row}`)
  dm.send('fog', 'region-set', { sceneId, cells: opened, op: 'reveal' })

  const already = new Set(dm.tokens().map((t) => t.name))
  const placing = PARTY.filter((name) => !already.has(name))
  placing.forEach((name) => {
    const [col, row] = spots[PARTY.indexOf(name)]
    dm.send('tokens', 'place', {
      sceneId,
      name,
      x: col + 0.5,
      y: row + 0.5,
      size: 'medium',
      disposition: 'friendly',
      sight: SIGHT,
      light: LIGHT,
    })
  })
  await sleep(1500)

  // 5. Hand the three headless seats their tokens; Willow and Marek stay unowned for Chrome.
  const byName = new Map(dm.tokens().map((t) => [t.name, t]))
  for (const player of players) {
    const token = byName.get(player.name)
    if (!token) {
      console.log(`WARNING: no token named ${player.name} to assign`)
      continue
    }
    dm.send('tokens', 'assign', { sceneId, id: token.id, identityId: player.identityId })
  }
  await sleep(1500)

  const final = dm.tokens().filter((t) => PARTY.includes(t.name))
  for (const t of final) console.log(`  ${t.name}: ${t.id} owner ${t.ownerId ?? '— (claimable)'}`)

  // 6. The DM socket goes away before the human DM sits down. Same identity, one socket.
  dm.socket.close()
  console.log(`dm socket closed — the human DM's seat is free now`)

  const { rooms, doors } = roomsAndDoors(doc)
  mkdirSync(OUT, { recursive: true })
  const out = {
    inviteCode,
    joinUrl: `${TABLE_URL}/join/${inviteCode}`,
    sceneId,
    rooms,
    doors,
    tokens: final.map((t) => ({ id: t.id, name: t.name, ownerId: t.ownerId })),
    headless: players.map((p) => ({ name: p.name, identityId: p.identityId })),
    revealedCells: opened.length,
    spawns: spots.map(([c, r], i) => ({ name: PARTY[i], x: c + 0.5, y: r + 0.5 })),
  }
  writeFileSync(`${OUT}/warren-stage.json`, `${JSON.stringify(out, null, 2)}\n`)
  console.log(`\nwrote ${OUT}/warren-stage.json`)
  console.log(`join url     ${out.joinUrl}`)
  console.log(`claimable    ${CLAIMABLE.join(', ')} — for the two Chrome players`)
  console.log(`revealed     ${opened.length} camp cells (the bot sets no startingRoom, so this is the only light)`)
  console.log(`\n${HEADLESS.length} player sockets are parked. Ctrl+C to close them.`)

  let closing = false
  process.on('SIGINT', () => {
    if (closing) return
    closing = true
    for (const player of players) player.seat.socket.close()
    console.log('\nclosed the headless sockets')
    setTimeout(() => process.exit(0), 300)
  })
  await new Promise(() => {})
}

const [step, arg] = process.argv.slice(2)
const run =
  step === 'publish'
    ? publish()
    : step === 'dm-seat'
      ? dmSeat()
      : step === 'seat'
        ? arg
          ? stage(arg)
          : Promise.reject(new Error('seat needs an invite code: warren-stage.ts seat ZM8Y99'))
        : Promise.reject(new Error('usage: warren-stage.ts publish | dm-seat | seat <inviteCode>'))

run.catch((error: unknown) => {
  console.error(String(error))
  process.exit(1)
})
