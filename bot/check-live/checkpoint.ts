// One checkpoint of the three-way sync: what the TABLE persisted, what DISCORD shows, what the
// BOT thinks. Read-only everywhere — both SQLite files open readonly, Discord is GET-only.
//
//   pnpm exec tsx check-live/checkpoint.ts <label>          → check-live/out/cp-<label>.json
//   pnpm exec tsx check-live/checkpoint.ts diff <a> <b>     → plain-text delta
//
// Run from bot/. Secrets come from bot/.env and are never printed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { mapNames } from '../src/goblin/session-log'
import { payloadText } from '../src/lib/ui'

const CAMPAIGN_NAME = process.env.CP_CAMPAIGN ?? 'test01'
const OUT_DIR = 'check-live/out'
const BOT_DB = 'data/bot.db'
const GAME_DB = '../session/server/data/game.db'
const API = 'https://discord.com/api/v10'
/** Persisted per campaign in game.db `module_state`. Everything else about a live table is memory. */
const MODULES = ['doors', 'fog', 'tokens', 'initiative', 'rolls', 'triggers'] as const

// ── env, the way live.ts reads it ────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
) as Record<string, string>
const TOKEN = process.env.DISCORD_BOT_TOKEN ?? env.DISCORD_BOT_TOKEN

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null ? (v as Json) : {})

// ── Discord, GET only, sequential, 429-aware ─────────────────────────────────────────────
interface DiscordMessage {
  id: string
  timestamp: string
  author: string
  text: string
  attachments: string[]
}

async function api(path: string): Promise<unknown> {
  if (!TOKEN) throw new Error('DISCORD_BOT_TOKEN missing from bot/.env')
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${API}${path}`, { headers: { authorization: `Bot ${TOKEN}` } })
    if (response.status === 429) {
      const wait = Number(response.headers.get('retry-after') ?? '1') * 1000 + 250
      await new Promise((resolve) => setTimeout(resolve, wait))
      continue
    }
    if (!response.ok) throw new Error(`GET ${path} → ${response.status} ${(await response.text()).slice(0, 200)}`)
    // ponytail: one small pause per call instead of a bucket tracker — a handful of GETs per
    // checkpoint never approaches the limit. Upgrade path: read x-ratelimit-remaining/reset.
    await new Promise((resolve) => setTimeout(resolve, 120))
    return response.json()
  }
  throw new Error(`GET ${path} rate-limited out`)
}

/** Components V2 containers flatten through the bot's own payloadText, so the capture reads
 * like the card does. `content` is empty on every V2 message — the text lives in components. */
const flatten = (raw: Json): DiscordMessage => ({
  id: String(raw.id),
  timestamp: String(raw.timestamp),
  author: String(obj(raw.author).username ?? '?'),
  text: [
    typeof raw.content === 'string' ? raw.content : '',
    payloadText(raw.components),
    (Array.isArray(raw.embeds) ? raw.embeds : [])
      .map((e) => [obj(e).title, obj(e).description].filter(Boolean).join('\n'))
      .join('\n'),
  ]
    .filter(Boolean)
    .join('\n'),
  attachments: (Array.isArray(raw.attachments) ? raw.attachments : []).map((a) => String(obj(a).filename)),
})

async function messages(channelId: string, limit: number): Promise<DiscordMessage[]> {
  const raw = (await api(`/channels/${channelId}/messages?limit=${limit}`)) as Json[]
  return raw.map(flatten).reverse() // oldest first, so a diff reads as an append
}

async function tryIt<T>(label: string, fn: () => Promise<T>, errors: string[]): Promise<T | null> {
  try {
    return await fn()
  } catch (error) {
    errors.push(`${label}: ${String(error)}`)
    return null
  }
}

// ── capture ──────────────────────────────────────────────────────────────────────────────
async function capture(label: string): Promise<void> {
  const errors: string[] = []
  const bot = new Database(BOT_DB, { readonly: true })
  const game = new Database(GAME_DB, { readonly: true })

  const campaign = bot
    .prepare('SELECT * FROM campaigns WHERE name = ?')
    .get(CAMPAIGN_NAME) as Json | undefined
  if (!campaign) throw new Error(`no bot campaign named "${CAMPAIGN_NAME}" in ${BOT_DB}`)
  const campaignId = String(campaign.goblin_campaign_id)

  // The open session, else the most recent — the brief's rule.
  const botSession = bot
    .prepare(
      `SELECT * FROM sessions WHERE campaign_id = ?
       ORDER BY (ended_at IS NULL) DESC, started_at DESC LIMIT 1`,
    )
    .get(campaignId) as Json | undefined

  // ── 1. TABLE truth (game.db) ───────────────────────────────────────────────────────────
  const gameSession = (botSession &&
    (game.prepare('SELECT * FROM sessions WHERE id = ?').get(String(botSession.goblin_session_id)) as
      | Json
      | undefined)) ??
    (game.prepare('SELECT * FROM sessions WHERE campaign_id = ? AND active = 1').get(campaignId) as Json | undefined)

  const sceneId = gameSession ? (gameSession.active_scene_id as string | null) : null
  const scenes = game
    .prepare('SELECT id, name, map_id, visible_to_players FROM scenes WHERE campaign_id = ? ORDER BY sort_index')
    .all(campaignId) as Json[]
  const identities = game
    .prepare('SELECT id, name, role, banned, last_seen FROM identities WHERE campaign_id = ?')
    .all(campaignId) as Json[]
  const nameOfIdentity = new Map(identities.map((i) => [String(i.id), String(i.name)]))

  const state = Object.fromEntries(
    MODULES.map((module) => {
      const row = game
        .prepare('SELECT state FROM module_state WHERE campaign_id = ? AND module = ?')
        .get(campaignId, module) as { state?: string } | undefined
      return [module, row?.state ? (JSON.parse(row.state) as Json) : undefined]
    }),
  ) as Record<(typeof MODULES)[number], Json | undefined>

  // Door and room names live in the map document, not in module state.
  const names = new Map<string, string>()
  /** Authored doors. A door that has never been toggled has NO row in `module_state` — its truth
   * is the map's own `state` field, so without this the capture reads "0/0 doors" on a full map. */
  const authoredDoors = new Map<string, { name: string; open: boolean; secret: boolean }>()
  const mapRow = sceneId
    ? (game
        .prepare('SELECT data FROM maps WHERE id = (SELECT map_id FROM scenes WHERE id = ?)')
        .get(sceneId) as { data?: string } | undefined)
    : undefined
  if (mapRow?.data) {
    const doc = JSON.parse(mapRow.data) as Json
    for (const source of [doc, obj(doc.doc), obj(doc.map)]) for (const [id, n] of mapNames(source)) names.set(id, n)
    ;(function walk(node: unknown): void {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) return node.forEach(walk)
      const n = node as Json
      if (n.childType === 'door' && typeof n.id === 'string')
        authoredDoors.set(n.id, { name: String(n.name ?? n.id), open: n.state === 'open', secret: Boolean(n.isSecret) })
      for (const value of Object.values(n)) walk(value)
    })(doc)
  }

  const scene = <T>(byScene: unknown): T | undefined =>
    sceneId ? (obj(byScene)[sceneId] as T | undefined) : undefined

  const fogScene = scene<Json>(state.fog?.byScene)
  const rooms = Object.entries(obj(fogScene?.rooms)).map(([id, v]) => ({
    id,
    name: names.get(id) ?? null,
    status: String(obj(v).status),
    wasEverRevealed: Boolean(obj(v).wasEverRevealed),
  }))
  const doorState = obj(scene<Json>(state.doors?.byScene))
  const doors = [...new Set([...authoredDoors.keys(), ...Object.keys(doorState)])].map((id) => {
    const authored = authoredDoors.get(id)
    const live = doorState[id] ? obj(doorState[id]) : undefined
    return {
      id,
      name: names.get(id) ?? authored?.name ?? null,
      // `state` wins when the door has been touched this campaign; otherwise the map's authored value.
      open: live ? Boolean(live.open) : (authored?.open ?? false),
      locked: live ? Boolean(live.locked) : false,
      revealed: live ? Boolean(live.revealed) : !authored?.secret,
      source: live ? 'module_state' : authored ? 'authored (never toggled)' : 'orphan',
    }
  })
  const tokens = Object.values(obj(scene<Json>(state.tokens?.byScene))).map((v) => {
    const t = obj(v)
    return {
      id: String(t.id),
      name: String(t.name),
      pos: { x: t.x as number, y: t.y as number },
      hidden: Boolean(t.hidden),
      disposition: t.disposition ?? null,
      ownerId: (t.ownerId as string | null) ?? null,
      // "Claimed" IS ownerId being set — there is no separate claimed flag in persisted state.
      claimedBy: t.ownerId ? (nameOfIdentity.get(String(t.ownerId)) ?? '(unknown identity)') : null,
    }
  })
  const initiative = state.initiative
    ? {
        status: state.initiative.status,
        sceneId: state.initiative.sceneId,
        round: state.initiative.round,
        turn: state.initiative.turn,
        entries: (Array.isArray(state.initiative.entries) ? state.initiative.entries : []).map((e) => {
          const x = obj(e)
          return { key: x.key, name: x.name, kind: x.kind, initiative: x.initiative, hp: x.hp ?? null }
        }),
      }
    : null

  const logTail = (value: unknown, n = 12): Json[] => (Array.isArray(value) ? value.slice(-n) : [])

  const table = {
    // game.db `sessions` has no started_at/ended_at — only created_at and the `active` flag.
    session: gameSession
      ? {
          id: gameSession.id,
          inviteCode: gameSession.invite_code,
          activeSceneId: gameSession.active_scene_id,
          active: gameSession.active === 1,
          createdAt: gameSession.created_at,
          startedAt: { liveOnly: true, value: null, why: 'server keeps only created_at; started/ended live in bot.db' },
          endedAt: { liveOnly: true, value: null, why: 'server flips sessions.active; no end timestamp is stored' },
        }
      : null,
    scene: sceneId ? (scenes.find((s) => s.id === sceneId) ?? { id: sceneId, name: null }) : null,
    scenes: scenes.map((s) => ({ id: s.id, name: s.name, visibleToPlayers: s.visible_to_players === 1 })),
    identities: identities.map((i) => ({
      id: i.id,
      name: i.name,
      role: i.role,
      banned: i.banned === 1,
      lastSeen: i.last_seen,
    })),
    fog: {
      mode: fogScene?.mode ?? null,
      concealBehindDoors: fogScene?.concealBehindDoors ?? null,
      region: fogScene?.region ?? null,
      revealedRooms: rooms.filter((r) => r.status === 'revealed').length,
      rooms,
      logTail: logTail(state.fog?.log),
    },
    doors: { open: doors.filter((d) => d.open).length, total: doors.length, doors, logTail: logTail(state.doors?.log) },
    tokens: { count: tokens.length, claimed: tokens.filter((t) => t.claimedBy).length, tokens },
    initiative,
    triggers: {
      world: state.triggers?.world ?? null,
      fired: Object.keys(obj(scene<Json>(state.triggers?.byScene)?.fired)),
      journal: Array.isArray(state.triggers?.journal) ? state.triggers.journal : [],
    },
    rollsLogTail: logTail(state.rolls?.log, 20),
    // Facts that exist only in SessionManager memory — never guessed here.
    liveOnly: {
      connectedPlayers: { liveOnly: true, value: null, why: 'SessionManager.ts:250 keeps sessions in memory only' },
      dmConnected: { liveOnly: true, value: null, why: 'connection state is per-socket, never persisted' },
      seatedIdentities: { liveOnly: true, value: null, why: 'identities.last_seen is the only trace on disk' },
      tableLogPanel: { liveOnly: true, value: null, why: 'the Log panel re-derives from module logs; nearest disk truth is the logTail fields above' },
    },
  }

  // ── 2. DISCORD ─────────────────────────────────────────────────────────────────────────
  const partyChannel = String(campaign.channel_id)
  const dmChannel = String(campaign.dm_channel_id)
  const boardId = botSession?.live_message_id ? String(botSession.live_message_id) : null
  const threadId = botSession?.log_thread_id ? String(botSession.log_thread_id) : null

  const discord = {
    partyChannelId: partyChannel,
    dmChannelId: dmChannel,
    // The live board is edited in the PARTY channel (live-session.ts:184), not the DM channel.
    board: boardId
      ? await tryIt('board', async () => flatten((await api(`/channels/${partyChannel}/messages/${boardId}`)) as Json), errors)
      : null,
    // The log thread hangs under the DM channel (live-session.ts:447).
    thread: threadId ? await tryIt('thread', () => messages(threadId, 100), errors) : null,
    party: await tryIt('party channel', () => messages(partyChannel, 30), errors),
    dm: await tryIt('dm channel', () => messages(dmChannel, 30), errors),
  }

  // ── 3. BOT view (bot.db) ───────────────────────────────────────────────────────────────
  const sessionId = botSession ? String(botSession.goblin_session_id) : null
  const since = botSession ? Number(botSession.started_at) : 0
  const botView = {
    session: botSession
      ? {
          id: sessionId,
          inviteCode: botSession.invite_code,
          startedAt: botSession.started_at,
          endedAt: botSession.ended_at,
          liveMessageId: botSession.live_message_id,
          recapMessageId: botSession.recap_message_id,
          logThreadId: botSession.log_thread_id,
          open: botSession.ended_at === null,
        }
      : null,
    stats: botSession?.stats ? (JSON.parse(String(botSession.stats)) as Json) : null,
    recap: botSession?.recap ? (JSON.parse(String(botSession.recap)) as Json) : null,
    // Rolls and notes are campaign-scoped rows; the session window is what makes them "this evening".
    rolls: bot
      .prepare('SELECT id, discord_id, expr, total, is_crit, is_fail, created_at FROM rolls WHERE campaign_id = ? AND created_at >= ? ORDER BY created_at')
      .all(campaignId, since) as Json[],
    notes: bot
      .prepare('SELECT id, discord_id, text, created_at FROM notes WHERE campaign_id = ? AND created_at >= ? ORDER BY created_at')
      .all(campaignId, since) as Json[],
    characters: bot
      .prepare('SELECT id, discord_id, name, class, level, last_played FROM characters WHERE campaign_id = ?')
      .all(campaignId) as Json[],
    // The bot's live board numbers and /initiative roster live in the runner's memory.
    liveOnly: {
      boardCounters: { liveOnly: true, value: null, why: 'SessionStats is in-process; sessions.stats is the throttled save of scenes/doorsOpened/players/peakPlayers only' },
      encounter: { liveOnly: true, value: null, why: 'live-session.ts:291 keeps the last initiative snapshot in memory for /initiative' },
      observerConnection: { liveOnly: true, value: null, why: 'observer socket health is memory only (health() in live-session.ts)' },
    },
  }

  bot.close()
  game.close()

  const out = { label, capturedAt: Date.now(), campaign: { id: campaignId, name: campaign.name }, table, discord: discord, bot: botView, errors }
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  const file = `${OUT_DIR}/cp-${label}.json`
  writeFileSync(file, JSON.stringify(out, null, 2))

  // ── summary, ≤30 lines ─────────────────────────────────────────────────────────────────
  const say = console.log
  say(`cp-${label}  campaign ${campaign.name} (${campaignId.slice(0, 8)})  → ${file}`)
  say(`TABLE  session ${String(table.session?.id ?? '—').slice(0, 8)} active=${table.session?.active} invite=${table.session?.inviteCode ?? '—'}`)
  say(`TABLE  scene "${table.scene?.name ?? '—'}" ${String(sceneId ?? '').slice(0, 8)} visibleToPlayers=${scenes.find((s) => s.id === sceneId)?.visible_to_players === 1}`)
  say(`TABLE  identities ${identities.length} (${identities.filter((i) => i.role === 'dm').length} dm, ${identities.filter((i) => i.banned === 1).length} banned)`)
  say(`TABLE  fog ${table.fog.revealedRooms}/${rooms.length} rooms revealed, mode=${table.fog.mode ?? '—'}, region=${table.fog.region ? 'yes' : 'none'}`)
  say(`TABLE  doors ${table.doors.open}/${table.doors.total} open (${doors.filter((d) => d.source === 'module_state').length} toggled, rest authored), named=${doors.filter((d) => d.name).length}`)
  say(`TABLE  tokens ${table.tokens.count}, ${table.tokens.claimed} with an owner`)
  say(`TABLE  initiative ${initiative ? `${initiative.status} r${initiative.round} t${initiative.turn}, ${initiative.entries.length} entries` : 'none persisted'}`)
  say(`TABLE  journal entries ${table.triggers.journal.length}, triggers fired ${table.triggers.fired.length}`)
  say(`TABLE  live-only (null by design): connectedPlayers, dmConnected, seatedIdentities, tableLogPanel`)
  say(`DISC   party ${partyChannel} last ${discord.party?.length ?? '!'} msgs | dm ${dmChannel} last ${discord.dm?.length ?? '!'} msgs`)
  say(`DISC   board ${boardId ?? 'none'} ${discord.board ? `${discord.board.text.split('\n').length} lines, ${discord.board.text.length} chars` : '(not read)'}`)
  say(`DISC   thread ${threadId ?? 'none'} ${discord.thread ? `${discord.thread.length} messages` : '(none)'}`)
  if (discord.board) say(`DISC   board head: ${discord.board.text.split('\n').slice(0, 2).join(' / ').slice(0, 120)}`)
  if (discord.thread?.length) say(`DISC   thread tail: ${discord.thread.at(-1)!.text.split('\n').at(-1)!.slice(0, 120)}`)
  say(`BOT    session ${String(botView.session?.id ?? '—').slice(0, 8)} open=${botView.session?.open} thread=${botView.session?.logThreadId ? 'yes' : 'no'}`)
  say(`BOT    stats ${botView.stats ? JSON.stringify(botView.stats).slice(0, 140) : 'none'}`)
  say(`BOT    rolls ${botView.rolls.length} | notes ${botView.notes.length} | characters ${botView.characters.length}`)
  say(`BOT    live-only (null by design): boardCounters, encounter, observerConnection`)
  if (errors.length) for (const e of errors) say(`ERROR  ${e}`)
  else say('OK     all three sources read')
}

// ── diff ─────────────────────────────────────────────────────────────────────────────────
type Capture = Awaited<ReturnType<typeof load>>
const load = (label: string) =>
  JSON.parse(readFileSync(`${OUT_DIR}/cp-${label}.json`, 'utf8')) as {
    label: string
    capturedAt: number
    table: ReturnType<typeof Object> & Record<string, any>
    discord: Record<string, any>
    bot: Record<string, any>
  }

function diff(labelA: string, labelB: string): void {
  const a = load(labelA)
  const b = load(labelB)
  const out: string[] = []
  const say = (line: string) => out.push(line)

  say(`diff ${labelA} → ${labelB}  (+${Math.round((b.capturedAt - a.capturedAt) / 1000)}s)`)

  const field = (path: string, x: unknown, y: unknown) => {
    if (JSON.stringify(x) !== JSON.stringify(y)) say(`  ${path}: ${JSON.stringify(x)} → ${JSON.stringify(y)}`)
  }
  say('TABLE')
  field('scene', a.table.scene?.name, b.table.scene?.name)
  field('session.active', a.table.session?.active, b.table.session?.active)
  field('fog.revealedRooms', a.table.fog.revealedRooms, b.table.fog.revealedRooms)
  field('fog.mode', a.table.fog.mode, b.table.fog.mode)
  field('doors.open', a.table.doors.open, b.table.doors.open)
  field('tokens.count', a.table.tokens.count, b.table.tokens.count)
  field('tokens.claimed', a.table.tokens.claimed, b.table.tokens.claimed)
  field('initiative.status', a.table.initiative?.status, b.table.initiative?.status)
  field('initiative.round/turn', [a.table.initiative?.round, a.table.initiative?.turn], [b.table.initiative?.round, b.table.initiative?.turn])
  field('journal entries', a.table.triggers.journal.length, b.table.triggers.journal.length)
  field('identities', a.table.identities.length, b.table.identities.length)

  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]))
  const roomsA = byId(a.table.fog.rooms)
  for (const r of b.table.fog.rooms as { id: string; name: string | null; status: string }[]) {
    const was = roomsA.get(r.id)
    if (!was) say(`  room + ${r.name ?? r.id} = ${r.status}`)
    else if (was.status !== r.status) say(`  room ${r.name ?? r.id}: ${was.status} → ${r.status}`)
  }
  const doorsA = byId(a.table.doors.doors)
  for (const d of b.table.doors.doors as { id: string; name: string | null; open: boolean; locked: boolean }[]) {
    const was = doorsA.get(d.id)
    if (!was) say(`  door + ${d.name ?? d.id} open=${d.open}`)
    else if (was.open !== d.open || was.locked !== d.locked)
      say(`  door ${d.name ?? d.id}: open ${was.open}→${d.open} locked ${was.locked}→${d.locked}`)
  }
  const tokensA = byId(a.table.tokens.tokens)
  for (const t of b.table.tokens.tokens as { id: string; name: string; pos: { x: number; y: number }; claimedBy: string | null }[]) {
    const was = tokensA.get(t.id)
    if (!was) say(`  token + ${t.name} @${t.pos.x},${t.pos.y} owner=${t.claimedBy ?? '—'}`)
    else {
      if (was.pos.x !== t.pos.x || was.pos.y !== t.pos.y)
        say(`  token ${t.name} moved ${was.pos.x},${was.pos.y} → ${t.pos.x},${t.pos.y}`)
      if (was.claimedBy !== t.claimedBy) say(`  token ${t.name} owner ${was.claimedBy ?? '—'} → ${t.claimedBy ?? '—'}`)
    }
  }
  const gone = (b.table.tokens.tokens as { id: string }[]).map((t) => t.id)
  for (const t of a.table.tokens.tokens as { id: string; name: string }[])
    if (!gone.includes(t.id)) say(`  token − ${t.name}`)

  say('DISCORD')
  const boardA = (a.discord.board?.text ?? '').split('\n')
  const boardB = (b.discord.board?.text ?? '').split('\n')
  if (a.discord.board?.text === b.discord.board?.text) say('  board unchanged')
  else {
    const max = Math.max(boardA.length, boardB.length)
    for (let i = 0; i < max; i += 1) if (boardA[i] !== boardB[i]) say(`  board L${i + 1}: ${JSON.stringify(boardA[i] ?? null)} → ${JSON.stringify(boardB[i] ?? null)}`)
  }
  const newOnes = (x: any[] | null, y: any[] | null) => {
    const seen = new Set((x ?? []).map((m) => m.id))
    return (y ?? []).filter((m) => !seen.has(m.id))
  }
  for (const [where, added] of [
    ['thread', newOnes(a.discord.thread, b.discord.thread)],
    ['party', newOnes(a.discord.party, b.discord.party)],
    ['dm', newOnes(a.discord.dm, b.discord.dm)],
  ] as const) {
    if (!added.length) say(`  ${where}: no new messages`)
    for (const m of added) say(`  ${where} + [${m.author}] ${m.text.replace(/\n/g, ' ⏎ ').slice(0, 150)}`)
  }

  say('BOT')
  field('session.open', a.bot.session?.open, b.bot.session?.open)
  field('stats', a.bot.stats, b.bot.stats)
  field('recap', a.bot.recap ? 'present' : null, b.bot.recap ? 'present' : null)
  field('rolls', a.bot.rolls.length, b.bot.rolls.length)
  field('notes', a.bot.notes.length, b.bot.notes.length)
  for (const r of b.bot.rolls.slice(a.bot.rolls.length)) say(`  roll + ${r.expr} = ${r.total}`)
  for (const n of b.bot.notes.slice(a.bot.notes.length)) say(`  note + ${String(n.text).slice(0, 100)}`)

  console.log(out.slice(0, 60).join('\n'))
  if (out.length > 60) console.log(`… ${out.length - 60} more lines (read the JSON)`)
}

// ── entry ────────────────────────────────────────────────────────────────────────────────
const [first, second, third] = process.argv.slice(2)
if (first === 'diff') {
  if (!second || !third) throw new Error('usage: checkpoint.ts diff <labelA> <labelB>')
  diff(second, third)
} else {
  if (!first) throw new Error('usage: checkpoint.ts <label>')
  await capture(first)
}
