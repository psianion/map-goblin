// B2 — every slash command driven through its real handler against the real dev server.
//
// Nothing here is part of the bot: it builds the same `Deps` command-registry.test.ts builds,
// but with the real REST client pointed at 127.0.0.1:5600, a real SessionRunner holding a real
// WS observer, and a temp copy of bot/data/bot.db. Discord is the only fake — announce/edit/
// thread seams capture into arrays.
//
// Run from bot/:  pnpm exec tsx check-live/commands.ts

import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Sqlite from 'better-sqlite3'
import { WebSocket } from 'ws'
import { registry, type Deps } from '../src/bot/command-registry'
import { openDb } from '../src/db/db'
import {
  createCalendar,
  createCampaigns,
  createCharacters,
  createFeedback,
  createLedger,
  createLfgApplications,
  createLfgPosts,
  createNotes,
  createQuests,
  createRolls,
  createSchedulePolls,
  createSessions,
  type Campaign,
} from '../src/db/stores'
import { createSessionRunner } from '../src/goblin/live-session'
import { createObserver, type WireInitiativeEntry } from '../src/goblin/observer'
import { createGoblinRest } from '../src/goblin/rest'
import { parse as parseCustomId } from '../src/lib/custom-id'
import { cardText } from '../src/lib/card'
import type { AttachedFile, ContainerSpec } from '../src/lib/ui'

const BASE = 'http://127.0.0.1:5600'
const CAMP = '18358431-cfeb-46c8-b72b-9a9ac33f0eb8'
const MILL_MAP_ID = '79c57b01-24de-407d-93d1-1d48473662bb'
const GAME_DB = '../session/server/data/game.db'

// ── env (never printed) ─────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
) as Record<string, string>
const ADMIN_PASS = env.GOBLIN_ADMIN_PASS
if (!ADMIN_PASS) throw new Error('GOBLIN_ADMIN_PASS missing from bot/.env')

// ── the row table ───────────────────────────────────────────────────────────────────────
interface Row {
  check: string
  result: 'PASS' | 'FAIL' | 'SKIP'
  detail: string
}
const rows: Row[] = []

async function check(name: string, fn: () => Promise<string> | string): Promise<void> {
  try {
    const detail = await fn()
    rows.push({ check: name, result: 'PASS', detail })
    console.log(`PASS  ${name} — ${detail}`)
  } catch (error) {
    const detail = error instanceof Error ? `${error.message}` : String(error)
    rows.push({ check: name, result: 'FAIL', detail })
    console.log(`FAIL  ${name} — ${detail}`)
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const trim = (text: string, max = 220): string =>
  text.length <= max ? text : `${text.slice(0, max)}…`

// ── the fake interaction (command-registry.test.ts's, minus vitest) ─────────────────────
interface Options {
  channelId?: string
  userId?: string
  subcommand?: string
  strings?: Record<string, string | null>
  integers?: Record<string, number | null>
  focused?: string
  attachments?: Record<string, unknown>
}

function chatInteraction(over: Options) {
  const calls: unknown[][] = []
  return {
    calls,
    channelId: over.channelId ?? '',
    guild: null,
    client: { ws: { ping: 42 } },
    user: { id: over.userId ?? '', username: 'harness' },
    options: {
      getSubcommand: () => over.subcommand ?? '',
      getString: (name: string, required?: boolean) => {
        const value = over.strings?.[name] ?? null
        if (required && value === null) throw new Error(`missing required option ${name}`)
        return value
      },
      getInteger: (name: string, required?: boolean) => {
        const value = over.integers?.[name] ?? null
        if (required && value === null) throw new Error(`missing required option ${name}`)
        return value
      },
      getFocused: () => over.focused ?? '',
      getAttachment: (name: string) => over.attachments?.[name] ?? null,
      getChannel: (name: string) => ({ id: over.strings?.[name] ?? name }),
      getRole: (name: string) => ({ id: over.strings?.[name] ?? name }),
      getUser: (name: string) => ({ id: over.strings?.[name] ?? name }),
    },
    editReply: async (payload: unknown) => void calls.push(['edit', payload]),
    respond: async (choices: unknown) => void calls.push(['respond', choices]),
  }
}

function componentInteraction(userId: string, roleIds: string[] = []) {
  const calls: unknown[][] = []
  return {
    calls,
    customId: 'x',
    user: { id: userId, username: 'harness' },
    member: { roles: roleIds },
    reply: async (payload: unknown) => void calls.push(['reply', payload]),
  }
}

/** Reply text for an assertion: a plain string, or every text block of a v2 container. */
function replyText(payload: unknown): string {
  if (typeof payload === 'string') return payload
  const seen: string[] = []
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown> & { toJSON?: () => unknown }
    if (typeof node.toJSON === 'function') return walk(node.toJSON())
    if (typeof node.content === 'string') seen.push(node.content)
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(walk)
      else if (child && typeof child === 'object') walk(child)
    }
  }
  walk(payload)
  return seen.join('\n')
}

const lastReply = (interaction: { calls: unknown[][] }): string => {
  const last = interaction.calls.at(-1)
  assert(last, 'the handler never replied')
  return replyText(last[1])
}

const specText = cardText

/** The error a handler threw, as the user would read it. */
async function refuses(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    const message = (error as { userMessage?: string }).userMessage
    return message ?? String(error)
  }
  throw new Error('expected a refusal, the handler resolved')
}

async function waitFor<T>(label: string, probe: () => T | undefined, ms = 20_000): Promise<T> {
  const until = Date.now() + ms
  for (;;) {
    const value = probe()
    if (value !== undefined && value !== null && value !== false) return value
    if (Date.now() > until) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

// ── direct REST, for the setup the handlers are not responsible for ─────────────────────
async function mintDmToken(): Promise<string> {
  const response = await fetch(`${BASE}/api/campaigns/${CAMP}/dm-token`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN_PASS}` },
  })
  if (!response.ok) throw new Error(`dm-token mint failed: ${response.status} ${await response.text()}`)
  return ((await response.json()) as { token: string }).token
}

/** GET /api/campaigns/:id/session answers `{sessionId, inviteCode}`, or `{error}` when idle. */
async function liveSessionId(token: string): Promise<string | undefined> {
  const response = await fetch(`${BASE}/api/campaigns/${CAMP}/session`, {
    headers: { authorization: `Bearer ${token}` },
  })
  const body = (await response.json()) as { sessionId?: string }
  return response.ok ? body.sessionId : undefined
}

// ── captured Discord ────────────────────────────────────────────────────────────────────
interface Sent {
  channelId: string
  spec: ContainerSpec
  files?: AttachedFile[]
}
const sent: Sent[] = []
const edits: { channelId: string; messageId: string; spec: ContainerSpec }[] = []
const threads: { channelId: string; name: string }[] = []
const archived: string[] = []

async function main(): Promise<void> {
  // A copy of the live bot's db, WAL and all, opened through the bot's own openDb (which
  // migrates). Nothing here ever touches bot/data/bot.db.
  const dir = mkdtempSync(join(tmpdir(), 'bot-check-live-'))
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      copyFileSync(join('data', `bot.db${suffix}`), join(dir, `bot.db${suffix}`))
    } catch {
      /* -wal/-shm may not exist */
    }
  }
  const dbPath = join(dir, 'bot.db')
  const db = openDb(dbPath)
  const campaigns = createCampaigns(db)
  const sessions = createSessions(db)
  const calendar = createCalendar(db)
  const characters = createCharacters(db)
  const goblin = createGoblinRest({ baseUrl: BASE })

  const row = campaigns.byId(CAMP)
  assert(row, `campaign ${CAMP} missing from the copied bot db`)
  const campaign: Campaign = row

  const announce = async (
    channelId: string,
    spec: ContainerSpec,
    files?: AttachedFile[],
  ): Promise<{ messageId: string }> => {
    sent.push({ channelId, spec, files })
    return { messageId: `msg-${sent.length}` }
  }
  const sessionRunner = createSessionRunner({
    publicTableUrl: env.PUBLIC_TABLE_URL ?? 'http://localhost:5602',
    rest: goblin,
    sessions,
    calendar,
    characters,
    announce,
    edit: async (channelId, messageId, spec) => void edits.push({ channelId, messageId, spec }),
    createThread: async (channelId, name) => {
      threads.push({ channelId, name })
      return { threadId: `thread-${threads.length}` }
    },
    archiveThread: async (threadId) => void archived.push(threadId),
    createObserver: (token) =>
      createObserver({
        baseUrl: BASE,
        token,
        createSocket: (url) => {
          const socket = new WebSocket(url)
          // Diagnostics only: the observer swallows why a socket went away.
          socket.on('close', (code, reason) => console.log(`[ws] close ${code} ${String(reason)}`))
          socket.on('error', (error) => console.log(`[ws] error ${String(error)}`))
          socket.on('message', (raw) => {
            const frame = JSON.parse(String(raw)) as { type?: string }
            if (frame.type === 'error') console.log(`[ws] error frame ${JSON.stringify(frame)}`)
          })
          return socket as never
        },
      }),
    campaignById: campaigns.byId,
    throttleMs: 200,
  })

  const deps: Deps = {
    ownerId: env.DISCORD_OWNER_ID ?? campaign.dmDiscordId,
    botData: dir,
    campaigns,
    characters,
    quests: createQuests(db),
    notes: createNotes(db),
    rolls: createRolls(db),
    ledger: createLedger(db),
    calendar,
    schedulePolls: createSchedulePolls(db),
    lfgPosts: createLfgPosts(db),
    lfgApplications: createLfgApplications(db),
    feedback: createFeedback(db),
    sessions,
    lfgChannelId: env.LFG_CHANNEL_ID ?? 'lfg-chan',
    goblin,
    goblinAdminPass: ADMIN_PASS,
    sessionRunner,
    db,
    announce,
    edit: async (channelId, messageId, spec) => void edits.push({ channelId, messageId, spec }),
  }

  const DM = campaign.dmDiscordId
  const DM_CHAN = campaign.dmChannelId
  const PARTY_CHAN = campaign.channelId
  const PLAYER = '900000000000000001'

  // ── pre-flight: clear the stale server session, make sure the image scene exists ──────
  const adminToken = await mintDmToken()
  const stale = await liveSessionId(adminToken)
  if (stale) {
    const ended = await fetch(`${BASE}/api/sessions/${stale}/end`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    console.log(`pre-flight: ended stale session ${stale} (${ended.status})`)
  }

  let imageSceneId = ''
  const before = await goblin.getScenes(adminToken, CAMP)
  const existing = before.find((scene) => scene.name === 'Riverside Mill')
  if (existing) {
    imageSceneId = existing.id
    console.log(`pre-flight: Riverside Mill already on the campaign (${imageSceneId})`)
  } else {
    const game = new Sqlite(GAME_DB, { readonly: true })
    const mill = game.prepare('SELECT data FROM maps WHERE id = ?').get(MILL_MAP_ID) as { data: string }
    game.close()
    const upload = await fetch(`${BASE}/api/campaigns/${CAMP}/maps`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: mill.data,
    })
    if (!upload.ok) throw new Error(`map upload failed: ${upload.status} ${await upload.text()}`)
    const uploaded = (await upload.json()) as { sceneId: string; name: string }
    imageSceneId = uploaded.sceneId
    console.log(`pre-flight: uploaded ${uploaded.name} as scene ${imageSceneId}`)
  }

  let sessionOpen = false
  try {
    // ── the seat seam ────────────────────────────────────────────────────────────────────
    await check('expired seats re-minted by the seam', async () => {
      const stored = campaigns.byId(CAMP)!
      const expiry = (token: string | null): number => {
        try {
          return (JSON.parse(Buffer.from((token ?? '').split('.')[0], 'base64url').toString()) as { exp: number }).exp
        } catch {
          return 0
        }
      }
      const wasExpired = expiry(stored.serviceToken) < Date.now()
      // The first server-facing command is what refreshes them (freshSeats in the registry).
      const interaction = chatInteraction({ channelId: DM_CHAN, userId: DM, focused: '' })
      await registry.session.autocomplete!(interaction as never, deps)
      const after = campaigns.byId(CAMP)!
      assert(expiry(after.serviceToken) > Date.now(), 'service seat still expired after a handler ran')
      assert(expiry(after.playerToken) > Date.now(), 'player seat still expired after a handler ran')
      assert(
        !wasExpired || after.serviceToken !== stored.serviceToken,
        'the stored seat was expired and was not replaced',
      )
      const scenes = JSON.stringify(interaction.calls.at(-1)![1])
      return `stored seat expired=${wasExpired}, both re-minted, scene autocomplete answered ${trim(scenes, 120)}`
    })

    // ── campaign ─────────────────────────────────────────────────────────────────────────
    await check('campaign setup', async () => {
      campaigns.setTokens(CAMP, 'stale.dm', 'stale.player')
      const interaction = chatInteraction({
        channelId: DM_CHAN,
        userId: DM,
        subcommand: 'setup',
        strings: {
          id: CAMP,
          name: campaign.name,
          channel: PARTY_CHAN,
          'dm-channel': DM_CHAN,
          role: campaign.roleId,
          dm: DM,
        },
      })
      await registry.campaign.execute(interaction as never, deps)
      const after = campaigns.byId(CAMP)!
      assert(after.serviceToken && after.serviceToken !== 'stale.dm', 'no DM seat minted')
      assert(after.playerToken && after.playerToken !== 'stale.player', 'no player seat minted')
      return `${trim(lastReply(interaction), 120)} · both seats minted off the real server`
    })

    await check('campaign status', async () => {
      const interaction = chatInteraction({ channelId: PARTY_CHAN, userId: DM, subcommand: 'status' })
      await registry.campaign.execute(interaction as never, deps)
      const text = lastReply(interaction)
      assert(text.includes(campaign.name), 'the status board never named the campaign')
      return trim(text.replace(/\n+/g, ' · '))
    })

    // ── db-only commands ─────────────────────────────────────────────────────────────────
    await check('character create', async () => {
      const interaction = chatInteraction({
        channelId: PARTY_CHAN,
        userId: PLAYER,
        subcommand: 'create',
        strings: { name: 'Harness Probe', class: 'Ranger' },
        integers: { level: 3 },
      })
      await registry.character.execute(interaction as never, deps)
      const made = characters.byCampaignAndName(CAMP, 'Harness Probe')
      assert(made, 'no character row was written')
      return `${trim(lastReply(interaction), 120)} (row id ${made.id}, level ${made.level})`
    })

    await check('character update', async () => {
      const interaction = chatInteraction({
        channelId: PARTY_CHAN,
        userId: PLAYER,
        subcommand: 'update',
        strings: { name: 'Harness Probe', class: 'Ranger' },
        integers: { level: 4 },
      })
      const before = sent.length
      await registry.character.execute(interaction as never, deps)
      const made = characters.byCampaignAndName(CAMP, 'Harness Probe')!
      assert(made.level === 4, `level stayed ${made.level}`)
      const levelUp = sent.slice(before).find((s) => s.channelId === PARTY_CHAN)
      assert(levelUp, 'no level-up announcement to the party channel')
      return `${trim(lastReply(interaction), 100)} · announced "${trim(specText(levelUp.spec), 80)}"`
    })

    await check('character show', async () => {
      const interaction = chatInteraction({
        channelId: PARTY_CHAN,
        userId: PLAYER,
        subcommand: 'show',
        strings: { name: 'Harness Probe' },
      })
      await registry.character.execute(interaction as never, deps)
      const payload = interaction.calls.at(-1)![1] as { files?: { attachment?: Buffer }[] }
      const png = payload.files?.[0]?.attachment
      assert(png && png.length > 1000, 'no card png attached')
      return `character card rendered, ${png.length} bytes`
    })

    await check('mycharacters', async () => {
      const interaction = chatInteraction({ channelId: PARTY_CHAN, userId: PLAYER })
      await registry.mycharacters.execute(interaction as never, deps)
      const text = lastReply(interaction)
      assert(text.includes('Harness Probe'), `list did not carry the character: ${trim(text)}`)
      return trim(text.replace(/\n+/g, ' · '))
    })

    await check('quests add', async () => {
      const interaction = chatInteraction({
        channelId: PARTY_CHAN,
        userId: DM,
        subcommand: 'add',
        strings: { title: 'Find the harness' },
      })
      await registry.quests.execute(interaction as never, deps)
      return trim(lastReply(interaction))
    })

    await check('quests log', async () => {
      const interaction = chatInteraction({ channelId: PARTY_CHAN, userId: DM, subcommand: 'log' })
      await registry.quests.execute(interaction as never, deps)
      const text = lastReply(interaction)
      assert(text.includes('Find the harness'), `quest missing from the log: ${trim(text)}`)
      return trim(text.replace(/\n+/g, ' · '))
    })

    await check('quests complete', async () => {
      const interaction = chatInteraction({
        channelId: PARTY_CHAN,
        userId: DM,
        subcommand: 'complete',
        strings: { title: 'Find the harness' },
      })
      await registry.quests.execute(interaction as never, deps)
      return trim(lastReply(interaction))
    })

    await check('note', async () => {
      const interaction = chatInteraction({
        channelId: PARTY_CHAN,
        userId: PLAYER,
        strings: { text: 'The miller keeps a key under the third stone.' },
      })
      await registry.note.execute(interaction as never, deps)
      return trim(lastReply(interaction))
    })

    await check('recall', async () => {
      const interaction = chatInteraction({ channelId: PARTY_CHAN, userId: PLAYER, strings: { query: 'miller' } })
      await registry.recall.execute(interaction as never, deps)
      const text = lastReply(interaction)
      assert(text.includes('third stone'), `search missed the note: ${trim(text)}`)
      return trim(text.replace(/\n+/g, ' · '))
    })

    await check('roll (1d20 natural 20 is a crit, 2d20 never is)', async () => {
      const random = Math.random
      // floor(rng * 20) + 1 === 20
      Math.random = () => 0.999
      try {
        const crit = chatInteraction({ channelId: PARTY_CHAN, userId: PLAYER, strings: { expr: '1d20' } })
        await registry.roll.execute(crit as never, deps)
        const pair = chatInteraction({ channelId: PARTY_CHAN, userId: PLAYER, strings: { expr: '2d20' } })
        await registry.roll.execute(pair as never, deps)
        const recorded = db
          .prepare('SELECT expr, total, faces, is_crit FROM rolls ORDER BY id DESC LIMIT 2')
          .all() as { expr: string; total: number; faces: string; is_crit: number }[]
        const byExpr = new Map(recorded.map((r) => [r.expr, r]))
        const one = byExpr.get('1d20')
        const two = byExpr.get('2d20')
        assert(one && two, `rolls not recorded: ${JSON.stringify(recorded)}`)
        assert(one.is_crit === 1, `1d20 ${one.faces} was not recorded as a crit`)
        assert(two.is_crit === 0, `2d20 ${two.faces} was recorded as a crit`)
        assert(lastReply(crit).includes('CRITICAL'), 'the 1d20 reply never said CRITICAL')
        assert(!lastReply(pair).includes('CRITICAL'), 'the 2d20 reply claimed a crit')
        return `1d20 ${one.faces} total ${one.total} crit=1; 2d20 ${two.faces} total ${two.total} crit=0`
      } finally {
        Math.random = random
      }
    })

    await check('loot add', async () => {
      const interaction = chatInteraction({
        channelId: PARTY_CHAN,
        userId: PLAYER,
        subcommand: 'add',
        strings: { item: 'Millstone shard', note: 'humming faintly' },
      })
      await registry.loot.execute(interaction as never, deps)
      return trim(lastReply(interaction))
    })

    await check('loot list', async () => {
      const interaction = chatInteraction({ channelId: PARTY_CHAN, userId: PLAYER, subcommand: 'list' })
      await registry.loot.execute(interaction as never, deps)
      const text = lastReply(interaction)
      assert(text.includes('Millstone shard'), `ledger missed the item: ${trim(text)}`)
      return trim(text.replace(/\n+/g, ' · '))
    })

    await check('gold split', async () => {
      const interaction = chatInteraction({
        channelId: PARTY_CHAN,
        userId: DM,
        subcommand: 'split',
        integers: { total: 101 },
      })
      const before = sent.length
      await registry.gold.execute(interaction as never, deps)
      const post = sent.slice(before).find((s) => s.channelId === PARTY_CHAN)
      assert(post, 'no split announcement to the party channel')
      return `${trim(lastReply(interaction), 100)} · announced "${trim(specText(post.spec), 100)}"`
    })

    await check('calendar set', async () => {
      const interaction = chatInteraction({
        channelId: PARTY_CHAN,
        userId: DM,
        subcommand: 'set',
        integers: { day: 12 },
        strings: { epoch: 'Harness Reckoning' },
      })
      await registry.calendar.execute(interaction as never, deps)
      return trim(lastReply(interaction))
    })

    await check('calendar advance', async () => {
      const interaction = chatInteraction({
        channelId: PARTY_CHAN,
        userId: DM,
        subcommand: 'advance',
        integers: { days: 3 },
      })
      const before = sent.length
      await registry.calendar.execute(interaction as never, deps)
      const post = sent.slice(before).find((s) => s.channelId === PARTY_CHAN)
      assert(post, 'no advance announcement to the party channel')
      return `${trim(lastReply(interaction), 100)} · announced "${trim(specText(post.spec), 100)}"`
    })

    await check('calendar show', async () => {
      const interaction = chatInteraction({ channelId: PARTY_CHAN, userId: PLAYER, subcommand: 'show' })
      await registry.calendar.execute(interaction as never, deps)
      const text = lastReply(interaction)
      assert(text.includes('15'), `expected day 15 after set 12 + advance 3: ${trim(text)}`)
      return trim(text.replace(/\n+/g, ' · '))
    })

    await check('handout', async () => {
      const interaction = chatInteraction({
        channelId: DM_CHAN,
        userId: DM,
        strings: { note: 'The mill wheel is jammed with bones.' },
      })
      const before = sent.length
      await registry.handout.execute(interaction as never, deps)
      const post = sent.slice(before).find((s) => s.channelId === PARTY_CHAN)
      assert(post, 'handout did not land in the player channel')
      const refusal = await refuses(() =>
        registry.handout.execute(chatInteraction({ channelId: DM_CHAN, userId: DM }) as never, deps),
      )
      return `posted to the player channel: "${trim(specText(post.spec), 90)}" · empty handout refused with "${refusal}"`
    })

    await check('schedule (create, two voters, close)', async () => {
      const create = chatInteraction({
        channelId: DM_CHAN,
        userId: DM,
        strings: { option1: '2026-09-20T19:00:00Z', option2: '2026-09-21T19:00:00Z' },
      })
      const before = sent.length
      await registry.schedule.execute(create as never, deps)
      const newest = (db.prepare('SELECT MAX(id) AS id FROM schedule_polls').get() as { id: number | null }).id
      const poll = newest === null ? undefined : deps.schedulePolls.byId(newest)
      assert(poll, 'no poll row written')
      const announced = sent.slice(before).find((s) => s.channelId === PARTY_CHAN)
      assert(announced, 'poll never announced to the party channel')

      const voteId = (index: number) => parseCustomId(`schedule:vote:*:${poll.id}:${index}`)!
      const a = componentInteraction(PLAYER, [campaign.roleId])
      await registry.schedule.component!(a as never, voteId(0), deps)
      const b = componentInteraction('900000000000000002', [campaign.roleId])
      await registry.schedule.component!(b as never, voteId(0), deps)
      const votes = deps.schedulePolls.byId(poll.id)!.votes
      assert(Object.keys(votes).length === 2, `expected two votes, got ${JSON.stringify(votes)}`)

      const close = componentInteraction(DM, [])
      await registry.schedule.component!(close as never, parseCustomId(`schedule:close:${DM}:${poll.id}`)!, deps)
      const closed = deps.schedulePolls.byId(poll.id)!
      assert(closed.status === 'closed', 'poll did not close')
      const result = sent.at(-1)!
      assert(
        campaigns.byId(CAMP)!.nextSessionAt === Date.parse('2026-09-20T19:00:00Z'),
        'the winning date was not written to the campaign row',
      )
      return `poll ${poll.id} created, 2 votes, closed · result "${trim(specText(result.spec), 90)}"`
    })

    await check('lfg open', async () => {
      const interaction = chatInteraction({
        channelId: PARTY_CHAN,
        userId: DM,
        subcommand: 'open',
        strings: { blurb: 'One seat open at the mill.' },
      })
      const before = sent.length
      await registry.lfg.execute(interaction as never, deps)
      const post = sent.slice(before).find((s) => s.channelId === deps.lfgChannelId)
      assert(post, 'nothing posted to the LFG board')
      return `${trim(lastReply(interaction), 90)} · board post "${trim(specText(post.spec), 80)}"`
    })

    await check('apply', async () => {
      const interaction = chatInteraction({
        channelId: PARTY_CHAN,
        userId: '900000000000000003',
        strings: { campaign: CAMP, message: 'I can play a cleric.' },
      })
      const before = sent.length
      await registry.apply.execute(interaction as never, deps)
      const card = sent.slice(before).find((s) => s.channelId === DM_CHAN)
      assert(card, 'the application card never reached the DM channel')
      return `${trim(lastReply(interaction), 90)} · DM card "${trim(specText(card.spec), 80)}"`
    })

    await check('lfg close', async () => {
      const interaction = chatInteraction({ channelId: PARTY_CHAN, userId: DM, subcommand: 'close' })
      await registry.lfg.execute(interaction as never, deps)
      assert(!deps.lfgPosts.openForCampaign(CAMP), 'the board post is still open')
      const refusal = await refuses(() =>
        registry.apply.execute(
          chatInteraction({ channelId: PARTY_CHAN, userId: '900000000000000004', strings: { campaign: CAMP } }) as never,
          deps,
        ),
      )
      return `${trim(lastReply(interaction), 90)} · later application refused with "${refusal}"`
    })

    await check('feedback', async () => {
      const interaction = chatInteraction({
        channelId: PARTY_CHAN,
        userId: PLAYER,
        strings: { text: 'The mill fight dragged.' },
      })
      const before = sent.length
      await registry.feedback.execute(interaction as never, deps)
      const card = sent.slice(before).find((s) => s.channelId === DM_CHAN)
      assert(card, 'feedback never reached the DM channel')
      const stored = db.prepare('SELECT * FROM feedback ORDER BY id DESC LIMIT 1').get() as Record<string, unknown>
      assert(!('discord_id' in stored), 'feedback row carries an author')
      return `${trim(lastReply(interaction), 90)} · anonymous row ${JSON.stringify(stored)}`
    })

    await check('ping', async () => {
      const interaction = chatInteraction({ channelId: DM_CHAN, userId: deps.ownerId })
      await registry.ping.execute(interaction as never, deps)
      const text = lastReply(interaction)
      assert(text.includes('db ok'), `db unreachable: ${text}`)
      return text
    })

    // ── the live table ───────────────────────────────────────────────────────────────────
    await check('session start', async () => {
      const interaction = chatInteraction({
        channelId: DM_CHAN,
        userId: DM,
        subcommand: 'start',
        strings: { scene: imageSceneId },
      })
      const before = sent.length
      await registry.session.execute(interaction as never, deps)
      sessionOpen = true
      const board = sent.slice(before).find((s) => s.channelId === PARTY_CHAN)
      assert(board, 'no live board posted to the party channel')
      const live = sessions.live().find((s) => s.campaignId === CAMP)
      assert(live, 'no live session row')
      const state = await waitFor('the observer snapshot', () => sessionRunner.liveState(CAMP)?.sceneId)
      assert(state === imageSceneId, `observer is watching ${state}, not the uploaded scene`)
      return `${trim(lastReply(interaction), 100)} · session ${live.goblinSessionId} invite ${live.inviteCode} · thread "${threads.at(-1)?.name}"`
    })

    // ── initiative ───────────────────────────────────────────────────────────────────────
    await check('initiative — no encounter running', async () => {
      assert(!sessionRunner.encounter(CAMP), 'an encounter was already running before the check')
      const refusal = await refuses(() =>
        registry.initiative.execute(
          chatInteraction({ channelId: PARTY_CHAN, userId: DM, integers: { value: 17 } }) as never,
          deps,
        ),
      )
      assert(/no encounter running/i.test(refusal), `wrong refusal: ${refusal}`)
      return refusal
    })

    let entries: WireInitiativeEntry[] = []
    await check('initiative — two same-named combatants are refused, not guessed', async () => {
      // Re-sent if the roster does not come back: observer.command() is fire-and-forget and
      // answers true for a send into a socket that has already gone away.
      let tries = 0
      const roster = (): WireInitiativeEntry[] | undefined => {
        const running = sessionRunner.encounter(CAMP)?.entries
        return running && running.length === 2 ? running : undefined
      }
      for (; tries < 4 && !roster(); tries++) {
        const ok = sessionRunner.command(CAMP, 'initiative', 'start', {
          sceneId: imageSceneId,
          entries: [
            { name: 'noel', kind: 'pc' },
            { name: 'noel', kind: 'pc' },
          ],
        })
        console.log(`[initiative] start sent (attempt ${tries + 1}, command()=${ok})`)
        await new Promise((resolve) => setTimeout(resolve, 3000))
      }
      entries = await waitFor('the encounter roster', roster, 5000)
      const refusal = await refuses(() =>
        registry.initiative.execute(
          chatInteraction({ channelId: PARTY_CHAN, userId: DM, integers: { value: 17 } }) as never,
          deps,
        ),
      )
      assert(/combatants are named/i.test(refusal), `wrong refusal: ${refusal}`)
      return `roster ${entries.map((e) => `${e.name}/${e.key}`).join(', ')} (${tries} start attempt(s)) → "${refusal}"`
    })

    await check('initiative — a chosen key sends set', async () => {
      const chosen = entries[1]
      const interaction = chatInteraction({
        channelId: PARTY_CHAN,
        userId: DM,
        integers: { value: 17 },
        strings: { character: chosen.key },
      })
      await registry.initiative.execute(interaction as never, deps)
      const landed = await waitFor('the table to take the number', () => {
        const entry = sessionRunner.encounter(CAMP)?.entries?.find((e) => e.key === chosen.key)
        return entry?.initiative === 17 ? entry : undefined
      })
      return `${lastReply(interaction)} · table now reads ${landed.name}/${landed.key} = ${landed.initiative}`
    })

    await check('initiative — autocomplete lists the encounter first', async () => {
      const interaction = chatInteraction({ channelId: PARTY_CHAN, userId: DM, focused: '' })
      await registry.initiative.autocomplete!(interaction as never, deps)
      const choices = interaction.calls.at(-1)![1] as { name: string; value: string }[]
      assert(choices.length >= 2, `only ${choices.length} choices`)
      assert(choices[0].value === entries[0].key, `first choice was ${JSON.stringify(choices[0])}`)
      return JSON.stringify(choices)
    })

    sessionRunner.command(CAMP, 'initiative', 'end', {})
    await new Promise((resolve) => setTimeout(resolve, 500))
  } finally {
    if (sessionOpen) {
      await check('session end', async () => {
        const interaction = chatInteraction({ channelId: DM_CHAN, userId: DM, subcommand: 'end' })
        const before = sent.length
        await registry.session.execute(interaction as never, deps)
        // The observer's own `session-ended` frame races the reply: whichever finalize wins
        // posts the recap, and the loser returns the stored one without posting. So the reply
        // resolving is not the same as the post having landed.
        const recap = await waitFor(
          `the recap post (/session end posted ${JSON.stringify(sent.slice(before).map((s) => s.channelId))})`,
          () => sent.slice(before).find((s) => s.channelId === PARTY_CHAN),
          10_000,
        )
        assert(sessions.live().length === 0, 'a live session row survived /session end')
        return `${trim(lastReply(interaction), 100)} · recap "${trim(specText(recap.spec), 110)}" · thread archived: ${archived.length > 0}`
      })
    }
    sessionRunner.stopAll()
    // Belt and braces: whatever the handlers did, the server must not be left holding a table.
    const token = await mintDmToken()
    const left = await liveSessionId(token)
    if (left) {
      await fetch(`${BASE}/api/sessions/${left}/end`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })
      console.log(`cleanup: ended leftover session ${left}`)
    }
    db.close()
    writeFileSync('check-live/rows.json', JSON.stringify(rows, null, 2))
    console.log('\n--- rows ---')
    for (const r of rows) console.log(`${r.result}\t${r.check}\t${r.detail}`)
  }
}

await main()
process.exit(0)
