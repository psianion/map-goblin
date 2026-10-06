// B3 — the observer-driven paths, end to end against the real dev server, with a bot restart
// in the middle.
//
// Same shape as check-live/commands.ts: the bot's own SessionRunner, observer and REST client
// against 127.0.0.1:5600 and a temp copy of bot/data/bot.db, with Discord the only fake. What
// is new here is the second seat — a DM WebSocket of our own, minted from the admin pass —
// that drives the table the way a DM's browser would, and a second runner built on the same
// temp db to stand in for a bot restart.
//
// Run from bot/:  pnpm exec tsx check-live/live.ts

import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { createSessionRunner, type SessionRunner } from '../src/goblin/live-session'
import { createObserver, socketUrl, PROTOCOL_VERSION } from '../src/goblin/observer'
import { createGoblinRest } from '../src/goblin/rest'
import { cardText } from '../src/lib/card'
import type { AttachedFile, ContainerSpec } from '../src/lib/ui'
import { mapSvg, regionCell, type RegionMask } from '../src/render/map-svg'
import { decodePng, nonParchmentPixels } from './png'

const BASE = 'http://127.0.0.1:5600'
const CAMP = '18358431-cfeb-46c8-b72b-9a9ac33f0eb8'
const FIELDSTONE = 'f65f91d6-9528-4ed9-89eb-5cb610aeb6ab'
const MILL = '047c4129-abb1-4566-ba75-4894500d7ebf'
/** Both non-archway, non-secret, authored closed (session-stats only counts closed → open). */
const DOOR_ONE = 'door-02-vestry-door'
const DOOR_ONE_NAME = 'Vestry Door'
const DOOR_TWO = 'door-07-watch-door'
const DOOR_TWO_NAME = 'Watch Door'
const CARD_TITLE = 'The Mill Ledger'
const CARD_BODY = 'A tally of sacks, in a careful hand.\nThe last three entries are scratched out.'
/** Inside the brushed rectangle, so the recap snapshot's cut is what the pixels test. */
const TOKEN_AT = { x: 8.5, y: 7.5 }

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
) as Record<string, string>
const ADMIN_PASS = env.GOBLIN_ADMIN_PASS
if (!ADMIN_PASS) throw new Error('GOBLIN_ADMIN_PASS missing from bot/.env')

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
    const detail = error instanceof Error ? error.message : String(error)
    rows.push({ check: name, result: 'FAIL', detail })
    console.log(`FAIL  ${name} — ${detail}`)
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const trim = (text: string, max = 220): string => (text.length <= max ? text : `${text.slice(0, max)}…`)
const oneLine = (text: string): string => text.replace(/\n+/g, ' ⏎ ')

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor<T>(label: string, probe: () => T | undefined | false, ms = 20_000): Promise<T> {
  const until = Date.now() + ms
  for (;;) {
    const value = probe()
    if (value !== undefined && value !== null && value !== false) return value as T
    if (Date.now() > until) throw new Error(`timed out waiting for ${label}`)
    await sleep(200)
  }
}

// ── direct REST, for what the handlers are not responsible for ──────────────────────────
async function mintDmToken(): Promise<string> {
  const response = await fetch(`${BASE}/api/campaigns/${CAMP}/dm-token`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN_PASS}` },
  })
  if (!response.ok) throw new Error(`dm-token mint failed: ${response.status} ${await response.text()}`)
  return ((await response.json()) as { token: string }).token
}

async function liveSessionId(token: string): Promise<string | undefined> {
  const response = await fetch(`${BASE}/api/campaigns/${CAMP}/session`, {
    headers: { authorization: `Bearer ${token}` },
  })
  const body = (await response.json()) as { sessionId?: string }
  return response.ok ? body.sessionId : undefined
}

// ── the DM seat that drives the table ───────────────────────────────────────────────────
interface DoorFlags {
  open: boolean
  locked: boolean
}

/** A DM browser, near enough: join frame v5, then `command` frames, plus the door state it
 * needs to know whether a door is already open before it toggles one. */
function dmSeat(token: string) {
  const socket = new WebSocket(socketUrl(BASE, token))
  let seq = 0
  let doors: Record<string, Record<string, DoorFlags>> = {}
  let joined = false
  const errors: string[] = []

  socket.on('open', () => socket.send(JSON.stringify({ type: 'join', protocolVersion: PROTOCOL_VERSION })))
  socket.on('message', (raw) => {
    const frame = JSON.parse(String(raw)) as Record<string, unknown>
    if (frame.type === 'session-state') {
      joined = true
      const modules = (frame.state as { modules?: Record<string, unknown> }).modules
      const state = modules?.doors as { byScene?: typeof doors } | undefined
      doors = state?.byScene ?? {}
    }
    if (frame.type === 'state-update' && frame.module === 'doors')
      doors = (frame.state as { byScene?: typeof doors }).byScene ?? {}
    if (frame.type === 'error') {
      errors.push(JSON.stringify(frame))
      console.log(`[dm seat] error frame ${JSON.stringify(frame)}`)
    }
  })
  socket.on('error', (error) => console.log(`[dm seat] socket error ${String(error)}`))

  return {
    errors,
    ready: () => waitFor('the DM seat to join', () => joined, 15_000),
    send: (module: string, action: string, payload: unknown): void => {
      seq += 1
      socket.send(JSON.stringify({ type: 'command', module, action, payload, seq }))
    },
    doorOpen: (sceneId: string, id: string): boolean | undefined => doors[sceneId]?.[id]?.open,
    close: () => socket.close(),
  }
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

const specText = cardText

function chatInteraction(over: { channelId?: string; userId?: string; subcommand?: string; strings?: Record<string, string> }) {
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
      getInteger: () => null,
      getFocused: () => '',
      getAttachment: () => null,
    },
    editReply: async (payload: unknown) => void calls.push(['edit', payload]),
    respond: async (choices: unknown) => void calls.push(['respond', choices]),
  }
}

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

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'bot-check-b3-'))
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      copyFileSync(join('data', `bot.db${suffix}`), join(dir, `bot.db${suffix}`))
    } catch {
      /* -wal/-shm may not exist */
    }
  }
  const db = openDb(join(dir, 'bot.db'))
  const campaigns = createCampaigns(db)
  const sessions = createSessions(db)
  const calendar = createCalendar(db)
  const characters = createCharacters(db)
  const goblin = createGoblinRest({ baseUrl: BASE })

  const stored = campaigns.byId(CAMP)
  assert(stored, `campaign ${CAMP} missing from the copied bot db`)
  const campaign: Campaign = stored
  const PARTY_CHAN = campaign.channelId
  const DM_CHAN = campaign.dmChannelId
  const DM = campaign.dmDiscordId

  const announce = async (
    channelId: string,
    spec: ContainerSpec,
    files?: AttachedFile[],
  ): Promise<{ messageId: string }> => {
    sent.push({ channelId, spec, files })
    return { messageId: `msg-${sent.length}` }
  }
  const edit = async (channelId: string, messageId: string, spec: ContainerSpec): Promise<void> =>
    void edits.push({ channelId, messageId, spec })

  /** Both runners are built the same way — the second one is the restarted bot. */
  const buildRunner = (): SessionRunner =>
    createSessionRunner({
      publicTableUrl: env.PUBLIC_TABLE_URL ?? 'http://localhost:5602',
      rest: goblin,
      sessions,
      calendar,
      characters,
      announce,
      edit,
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
            socket.on('close', (code) => console.log(`[observer] close ${code}`))
            socket.on('error', (error) => console.log(`[observer] error ${String(error)}`))
            return socket as never
          },
        }),
      campaignById: campaigns.byId,
      // The real board throttle: the brief's six-second wait is this window plus slack.
    })

  let runner = buildRunner()
  const deps: Deps = {
    ownerId: env.DISCORD_OWNER_ID ?? DM,
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
    sessionRunner: runner,
    db,
    announce,
    edit,
  }

  // ── pre-flight: no other table may be open on this campaign ──────────────────────────
  const adminToken = await mintDmToken()
  const stale = await liveSessionId(adminToken)
  if (stale) {
    const ended = await fetch(`${BASE}/api/sessions/${stale}/end`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    console.log(`pre-flight: ended stale session ${stale} (${ended.status})`)
  }
  const scenes = await goblin.getScenes(adminToken, CAMP)
  assert(scenes.some((scene) => scene.id === MILL), `scene ${MILL} (Riverside Mill) is not on the campaign`)

  let sessionOpen = false
  let seat: ReturnType<typeof dmSeat> | undefined
  let regionAtEnd: RegionMask | undefined
  let statsAfterFirstDoor: number | undefined

  try {
    await check('expired seats re-minted by the seam', async () => {
      const expiry = (token: string | null): number => {
        try {
          return (JSON.parse(Buffer.from((token ?? '').split('.')[0], 'base64url').toString()) as { exp: number }).exp
        } catch {
          return 0
        }
      }
      const wasExpired = expiry(campaign.serviceToken) < Date.now()
      const interaction = chatInteraction({ channelId: DM_CHAN, userId: DM })
      await registry.session.autocomplete!(interaction as never, deps)
      const after = campaigns.byId(CAMP)!
      assert(expiry(after.serviceToken) > Date.now(), 'service seat still expired after a handler ran')
      assert(expiry(after.playerToken) > Date.now(), 'player seat still expired after a handler ran')
      assert(!wasExpired || after.serviceToken !== campaign.serviceToken, 'the expired seat was not replaced')
      return `stored seat expired=${wasExpired}, both seats valid, scene autocomplete answered ${trim(
        JSON.stringify(interaction.calls.at(-1)![1]),
        120,
      )}`
    })

    await check('session start through the runner', async () => {
      const interaction = chatInteraction({
        channelId: DM_CHAN,
        userId: DM,
        subcommand: 'start',
        strings: { scene: FIELDSTONE },
      })
      const before = sent.length
      await registry.session.execute(interaction as never, deps)
      sessionOpen = true
      const board = sent.slice(before).find((s) => s.channelId === PARTY_CHAN)
      assert(board, 'no live board posted to the party channel')
      const live = sessions.live().find((s) => s.campaignId === CAMP)
      assert(live, 'no live session row')
      const scene = await waitFor('the observer snapshot', () => runner.liveState(CAMP)?.sceneId)
      assert(scene === FIELDSTONE, `the observer is watching ${scene}, not Fieldstone Keep`)
      return `${trim(replyText(interaction.calls.at(-1)![1]), 90)} · session ${live.goblinSessionId} invite ${live.inviteCode} · thread "${threads.at(-1)?.name}"`
    })

    // ── drive the table from a seat of our own ──────────────────────────────────────────
    seat = dmSeat(await mintDmToken())
    await seat.ready()

    /** session-stats only counts a proven closed → open transition, so a door left open by an
     * earlier run is closed first — and the bot's baseline follows that close. */
    const openDoor = async (sceneId: string, id: string, name: string): Promise<void> => {
      if (seat!.doorOpen(sceneId, id) === true) {
        seat!.send('doors', 'toggle', { sceneId, id })
        await waitFor(`${name} to close`, () => seat!.doorOpen(sceneId, id) === false, 10_000)
        await sleep(1_000) // the bot's own doors update, so its baseline is "closed"
      }
      seat!.send('doors', 'toggle', { sceneId, id })
      await waitFor(`${name} to open`, () => seat!.doorOpen(sceneId, id) === true, 10_000)
    }

    await openDoor(FIELDSTONE, DOOR_ONE, DOOR_ONE_NAME)
    seat.send('scenes', 'activate', { sceneId: MILL })
    await waitFor('the observer to follow the scene change', () => runner.liveState(CAMP)?.sceneId === MILL)

    const CELLS: [number, number][] = []
    for (let col = 6; col < 17; col++) for (let row = 5; row < 13; row++) CELLS.push([col, row])
    seat.send('fog', 'region-set', { sceneId: MILL, cells: CELLS, op: 'reveal' })
    await waitFor('the brushed region to reach the observer', () => runner.liveState(CAMP)?.region)

    seat.send('triggers', 'share-card', { sceneId: MILL, kicker: 'lore', title: CARD_TITLE, body: CARD_BODY })
    seat.send('tokens', 'place', {
      sceneId: MILL,
      name: 'Harness Sentry',
      x: TOKEN_AT.x,
      y: TOKEN_AT.y,
      size: 'medium',
      disposition: 'friendly',
    })
    await waitFor(
      'the placed token to reach the observer',
      () => (runner.liveState(CAMP)?.tokens ?? []).some((token) => token.name === 'Harness Sentry'),
    )

    // The board edit and the thread flush are throttled at EMBED_EDIT_MS (5s).
    await sleep(6_000)

    const threadTextOf = (from = 0): string =>
      sent
        .slice(from)
        .filter((s) => s.channelId.startsWith('thread-'))
        .map((s) => specText(s.spec))
        .join('\n')
    const partyPosts = (): Sent[] => sent.filter((s) => s.channelId === PARTY_CHAN)

    await check('door line in the session thread', () => {
      const text = threadTextOf()
      assert(text.includes(`opened ${DOOR_ONE_NAME}`), `no "opened ${DOOR_ONE_NAME}" line in the thread: ${trim(oneLine(text), 300)}`)
      const line = text.split('\n').find((l) => l.includes(`opened ${DOOR_ONE_NAME}`))!
      return `thread carries "${trim(line, 140)}"`
    })

    await check('scene line in the session thread', () => {
      const text = threadTextOf()
      const line = text.split('\n').find((l) => l.includes('Scene: '))
      assert(line, `no "Scene:" line in the thread: ${trim(oneLine(text), 300)}`)
      assert(
        line.includes('Riverside Mill'),
        `the scene line named the id, not the scene: "${line}" — the map's name never reached the log`,
      )
      return `thread carries "${trim(line, 140)}"`
    })

    await check('Journal card posted to the party channel', () => {
      const all = partyPosts()
      const cards = all.filter((s) => s.spec.eyebrow === `Journal · ${campaign.name}`)
      assert(
        cards.length === 1,
        `expected exactly one Journal container, got ${cards.length} — party posts were ${JSON.stringify(all.map((s) => s.spec.header ?? '(no header)'))}`,
      )
      const text = specText(cards[0]!.spec)
      assert(
        text.includes(`Lore — ${CARD_TITLE}`),
        `the card text never carried "Lore — ${CARD_TITLE}": ${trim(JSON.stringify(cards[0]!.spec))}`,
      )
      for (const line of CARD_BODY.split('\n'))
        assert(text.includes(`> ${line}`), `body line not quoted with "> ": ${trim(text)}`)
      assert(!text.includes('>>>'), 'the body used >>> instead of per-line quoting')
      return `one container to ${PARTY_CHAN}: "${trim(oneLine(text), 170)}"`
    })

    await check('Journal card also in the session thread', () => {
      const text = threadTextOf()
      assert(text.includes(`Lore — ${CARD_TITLE}`), `the thread never got the card line: ${trim(oneLine(text), 300)}`)
      const line = text.split('\n').find((l) => l.includes(`Lore — ${CARD_TITLE}`))!
      return `thread carries "${trim(line, 140)}"`
    })

    await check('live board edited', () => {
      const boardEdits = edits.filter((e) => e.channelId === PARTY_CHAN)
      assert(boardEdits.length > 0, 'the live board was never edited')
      const last = boardEdits.at(-1)!
      const text = specText(last.spec)
      assert(text.includes('Riverside Mill'), `the board never followed the scene change: ${trim(oneLine(text), 200)}`)
      return `${boardEdits.length} edit(s) to message ${last.messageId}: "${trim(oneLine(text), 160)}"`
    })

    statsAfterFirstDoor = sessions.live().find((s) => s.campaignId === CAMP)?.stats?.doorsOpened

    // ── the restart ─────────────────────────────────────────────────────────────────────
    console.log('restart: disposing the first runner')
    runner.stopAll()
    await sleep(1_000)
    runner = buildRunner()
    deps.sessionRunner = runner
    runner.resume()
    await waitFor('the resumed observer snapshot', () => runner.liveState(CAMP)?.sceneId)

    const sentBeforeSecondDoor = sent.length
    await openDoor(FIELDSTONE, DOOR_TWO, DOOR_TWO_NAME)
    await sleep(6_000)

    await check('stats row carried the door count across the restart', () => {
      assert(statsAfterFirstDoor !== undefined, 'nothing was stored on the row before the restart')
      assert(statsAfterFirstDoor === 1, `the row read ${statsAfterFirstDoor} doors before the restart, expected 1`)
      const after = sessions.live().find((s) => s.campaignId === CAMP)?.stats
      assert(after?.doorsOpened === 2, `the row reads ${after?.doorsOpened} doors after the restart, expected 2`)
      const text = threadTextOf(sentBeforeSecondDoor)
      // The name degrades to "a door" when the resumed runner has not fetched that scene's
      // map — it only loads names for the active scene, and the second door is on the scene
      // the table left. Both spellings are the same event.
      const line = text.split('\n').find((l) => l.includes('opened'))
      assert(line, `the resumed runner never logged the second door: ${trim(oneLine(text), 300)}`)
      return `row stats ${JSON.stringify(after)} — 1 before the restart, 2 after · second runner logged "${trim(line, 90)}"`
    })

    regionAtEnd = runner.liveState(CAMP)?.region
  } finally {
    seat?.close()
    if (sessionOpen) {
      const before = sent.length
      await check('recap counts both doors', async () => {
        const recap = await runner.end(campaigns.byId(CAMP)!)
        const post = await waitFor(
          'the recap post',
          () => sent.slice(before).find((s) => s.channelId === PARTY_CHAN),
          15_000,
        )
        const text = specText(post.spec)
        assert(recap.doorsOpened === 2, `the recap object counted ${recap.doorsOpened} doors, expected 2`)
        assert(text.includes('**Doors opened** · 2'), `the posted recap says: ${trim(oneLine(text), 250)}`)
        assert(sessions.live().length === 0, 'a live session row survived the end')
        return `"${trim(oneLine(text), 200)}" · thread archived: ${archived.length > 0}`
      })

      await check('end snapshot is cut to the swept region', async () => {
        // The recap also carries its own thumbnail now, so pick the map out by name.
        const recapPost = sent.slice(before).find((s) => s.files?.some((f) => f.name === 'map.png'))
        const mapFile = recapPost?.files?.find((f) => f.name === 'map.png')
        assert(mapFile, 'the recap carried no map attachment')
        assert(regionAtEnd, 'the harness never saw a region to check the snapshot against')
        const png = mapFile.data
        const image = decodePng(png)
        const off = nonParchmentPixels(image)
        assert(off.count > 500, `only ${off.count} non-parchment pixels — nothing was drawn inside the region`)

        // The same document and options snapshotOf used, re-rendered for its geometry.
        const doc = await goblin.getMap(campaigns.byId(CAMP)!.playerToken!, MILL)
        const svg = mapSvg(doc, { tokens: [], region: regionAtEnd })
        const width = Number(/\bwidth="(\d+(?:\.\d+)?)"/.exec(svg)![1])
        const [minX, minY, viewWidth] = /viewBox="([^"]+)"/.exec(svg)![1].split(' ').map(Number)
        const cellPx = width / viewWidth
        // One pixel of slack at the clip edge: resvg antialiases the boundary.
        const outside = off.sample.filter(([x, y]) => {
          for (const [dx, dy] of [
            [0, 0],
            [-1, -1],
            [1, 1],
            [-1, 1],
            [1, -1],
          ]) {
            const worldX = minX + (x + 0.5 + dx) / cellPx
            const worldY = minY + (y + 0.5 + dy) / cellPx
            if (regionCell(regionAtEnd, Math.floor(worldX) - regionAtEnd.minX, Math.floor(worldY) - regionAtEnd.minY))
              return false
          }
          return true
        })
        assert(
          outside.length === 0,
          `${outside.length} of ${off.count} painted pixels fell outside the swept region, first at ${JSON.stringify(outside.slice(0, 5))}`,
        )
        return `${image.width}×${image.height}, ${off.count} painted pixels all inside region ${regionAtEnd.cols}×${regionAtEnd.rows} at (${regionAtEnd.minX},${regionAtEnd.minY}) · x ${off.minX}–${off.maxX}, y ${off.minY}–${off.maxY}`
      })
    }

    runner.stopAll()
    const token = await mintDmToken()
    const left = await liveSessionId(token)
    if (left) {
      await fetch(`${BASE}/api/sessions/${left}/end`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })
      console.log(`cleanup: ended leftover session ${left}`)
    }
    db.close()
    writeFileSync(
      'check-live/live-posts.json',
      JSON.stringify(
        { sent: sent.map((s) => ({ channelId: s.channelId, spec: s.spec, files: s.files?.map((f) => f.name) })), edits, threads, archived },
        null,
        2,
      ),
    )
    writeFileSync('check-live/live-rows.json', JSON.stringify(rows, null, 2))
    console.log('\n--- rows ---')
    for (const r of rows) console.log(`${r.result}\t${r.check}\t${r.detail}`)
  }
}

await main()
process.exit(0)
