// The rolls module (§2.2, D7). `post` is open to everyone: whatever landed in your tab is
// your roll. The handler's whole job is to refuse malformed display data and stamp the parts
// a client is not allowed to choose — who rolled it and when.
//
// Table v2 (board 20) adds a `mode` per roll, server-side rolls (`roll`, `roll-table`) so a
// blind roll stays blind, the DM's roll requests and the answers to them, rollable tables and
// saved rolls.

import type { Viewer } from '../contract'
import { ANY_ROLE, type CommandError, type GameModule, type ModuleContext } from '../contract'
import { isValidFormula, roll, type RollResult } from '../dice/roll'
import { ID_MAX, Reject, bad, denied, num, obj, oneOf, str } from '../tokens/validate'
import type { RollEvent, RollMode, RollRequest, RollsState, RollTable, SavedRoll } from './types'

export type {
  RollEvent,
  RollMode,
  RollPost,
  RollRequest,
  RollRequestResult,
  RollsState,
  RollTable,
  SavedRoll,
} from './types'

/** Optional string fields and their caps. Anything longer is rejected, never truncated —
 *  a silently shortened roll reads as a real one. */
const CAPS = {
  characterName: 60,
  title: 100,
  formula: 100,
  breakdown: 200,
  text: 200,
  description: 2000,
} as const

/** D5: state carries the last 200 entries. Full history is a later feature. */
export const MAX_LOG = 200
/** Open requests kept; the oldest falls off. */
export const MAX_REQUESTS = 20
export const MAX_TABLES = 50
export const MAX_TABLE_ROWS = 100
export const MAX_SAVED = 50
export const LABEL_MAX = 60
export const ABILITY_MAX = 40
export const DC_MAX = 99

export const ROLL_MODES: readonly RollMode[] = ['public', 'dm', 'gmonly', 'blind']

type Ctx = ModuleContext<RollsState>
type Payload = Record<string, unknown>

// ponytail: a counter, not a UUID — this package is dependency-free with `lib: ES2022`, so
// neither `node:crypto` nor the DOM `crypto` global is in scope, and an id only has to be
// unique inside a 200-entry log. Swap for `crypto.randomUUID()` if ids ever leave the log.
let minted = 0
const mint = (prefix: string): string => {
  minted += 1
  return `${prefix}${Date.now().toString(36)}${minted.toString(36)}`
}

const invalid = (message: string): CommandError => ({ code: 'invalid-command', message })

/** A row written before `mode` existed reads as its visibility said. */
export const modeOf = (e: Pick<RollEvent, 'mode' | 'visibility'>): RollMode =>
  e.mode ?? (e.visibility === 'public' ? 'public' : 'dm')

/** Injectable for tests; real play rolls with `Math.random`. */
export interface RollsDeps {
  rng?: () => number
}

export function createRollsModule({ rng = Math.random }: RollsDeps = {}): GameModule<RollsState> {
  return {
    name: 'rolls',
    commands: {
      post: ANY_ROLE,
      roll: ANY_ROLE,
      request: ['dm'],
      'roll-result': ['player'],
      'share-request': ['dm'],
      'close-request': ['dm'],
      'table-upsert': ['dm'],
      'table-delete': ['dm'],
      'roll-table': ['dm'],
      'saved-upsert': ['dm'],
      'saved-delete': ['dm'],
    },
    initialState: { log: [] },

    handler(action, payload, ctx) {
      if (action === 'post') return post(payload, ctx)
      try {
        run(action, obj(payload ?? {}, 'payload'), ctx, rng)
      } catch (err) {
        if (err instanceof Reject) return { code: err.code, message: err.message }
        throw err
      }
    },

    // D4: a private roll reaches the roller and the DM, and never appears in anyone else's
    // frames at all. Table v2 widens that to four modes (see `RollMode`), cuts requests to
    // the seat's own, and keeps tables and saved rolls behind the screen. Pure and
    // idempotent — filtering an already-filtered state is a no-op.
    redact(state, viewer) {
      if (viewer.role === 'dm') return state
      const log = state.log.flatMap((e) => seen(e, viewer))
      const out: RollsState = { ...state, log }
      if (state.requests) {
        out.requests = state.requests
          .filter((r) => r.targets === null || r.targets.includes(viewer.identityId))
          .map((r) => ({ ...r, results: r.results.filter((x) => x.identityId === viewer.identityId) }))
      }
      if (state.tables) out.tables = []
      if (state.saved) out.saved = []
      return out
    },
  }
}

/** The production instance: rolls with `Math.random`. */
export const rollsModule: GameModule<RollsState> = createRollsModule()

/** One log line as `viewer` (never the DM) may see it: whole, cut, or not at all. */
function seen(e: RollEvent, viewer: Viewer): RollEvent[] {
  const mine = e.identityId === viewer.identityId
  switch (modeOf(e)) {
    case 'public':
      return [e]
    case 'dm':
      return mine ? [e] : []
    case 'gmonly':
      return []
    case 'blind': {
      if (!mine) return []
      if (e.blind) return [e]
      const cut: RollEvent = { ...e, blind: true }
      delete cut.total
      delete cut.breakdown
      delete cut.text
      delete cut.description
      return [cut]
    }
  }
}

function append(ctx: Ctx, event: RollEvent, patch: Partial<RollsState> = {}): void {
  ctx.setState({ ...ctx.state, ...patch, log: [...ctx.state.log, event].slice(-MAX_LOG) })
}

function stamp(ctx: Ctx, source: RollEvent['source'], mode: RollMode): RollEvent {
  return {
    id: mint('r'),
    at: Date.now(),
    identityId: ctx.sender.identityId,
    playerName: nameOf(ctx, ctx.sender.identityId),
    source,
    visibility: mode === 'public' ? 'public' : 'private',
    mode,
  }
}

const nameOf = (ctx: Ctx, identityId: string): string =>
  ctx.players.find((player) => player.identityId === identityId)?.name ?? 'Someone'

function post(payload: unknown, ctx: Ctx): CommandError | void {
  const p = (payload ?? {}) as Record<string, unknown>

  if (p.source !== 'dndbeyond' && p.source !== 'manual' && p.source !== 'discord') {
    return invalid("rolls.post needs source 'dndbeyond', 'manual' or 'discord'")
  }
  let mode: RollMode
  if (p.mode !== undefined) {
    if (!ROLL_MODES.includes(p.mode as RollMode)) return invalid(`rolls.post mode must be one of: ${ROLL_MODES.join(', ')}`)
    mode = p.mode as RollMode
  } else if (p.visibility === 'public' || p.visibility === 'private') {
    mode = p.visibility === 'public' ? 'public' : 'dm'
  } else {
    return invalid("rolls.post needs visibility 'public' or 'private', or a mode")
  }

  const event = stamp(ctx, p.source, mode)
  // A row written by an old client keeps exactly the shape it always had.
  if (p.mode === undefined) delete event.mode

  for (const field of Object.keys(CAPS) as (keyof typeof CAPS)[]) {
    const value = p[field]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string') return invalid(`rolls.post ${field} must be a string`)
    if (value.length > CAPS[field]) {
      return invalid(`rolls.post ${field} exceeds ${CAPS[field]} characters`)
    }
    if (value) event[field] = value
  }

  if (p.total !== undefined && p.total !== null) {
    if (typeof p.total !== 'number' || !Number.isFinite(p.total)) {
      return invalid('rolls.post total must be a finite number')
    }
    event.total = p.total
  }

  append(ctx, event)
}

function run(action: string, p: Payload, ctx: Ctx, rng: () => number): void {
  switch (action) {
    case 'roll':
      return serverRoll(p, ctx, rng)
    case 'request':
      return request(p, ctx)
    case 'roll-result':
      return rollResult(p, ctx, rng)
    case 'share-request':
      return shareRequest(p, ctx)
    case 'close-request':
      return closeRequest(p, ctx)
    case 'table-upsert':
      return tableUpsert(p, ctx)
    case 'table-delete':
      return tableDelete(p, ctx)
    case 'roll-table':
      return rollTable(p, ctx, rng)
    case 'saved-upsert':
      return savedUpsert(p, ctx)
    case 'saved-delete':
      return savedDelete(p, ctx)
    default:
      bad(`rolls has no action '${action}'`)
  }
}

function formulaOf(v: unknown, field = 'formula'): string {
  const formula = str(v, field, CAPS.formula)
  if (!isValidFormula(formula)) bad(`${field} is not a dice formula like 1d20+5`)
  return formula
}

const ADV = ['adv', 'dis'] as const

/** "4 + 6 + 2", the kept pool and the modifier, for the log line. */
function breakdownOf(r: RollResult): string {
  const mod = r.modifier === 0 ? '' : r.modifier > 0 ? ` + ${r.modifier}` : ` - ${-r.modifier}`
  return `${r.rolls.join(' + ')}${mod}`
}

function optionalText(p: Payload, field: 'title' | 'characterName'): string | undefined {
  return p[field] === undefined || p[field] === null ? undefined : str(p[field], field, CAPS[field])
}

/** `roll {formula, mode?, adv?, title?, characterName?}` — rolled here, so blind means blind. */
function serverRoll(p: Payload, ctx: Ctx, rng: () => number): void {
  const formula = formulaOf(p.formula)
  const mode = p.mode === undefined ? 'public' : oneOf(p.mode, ROLL_MODES, 'mode')
  const adv = p.adv === undefined || p.adv === null ? undefined : oneOf(p.adv, ADV, 'adv')
  const title = optionalText(p, 'title')
  const characterName = optionalText(p, 'characterName')
  const result = roll(formula, rng, adv)
  append(ctx, {
    ...stamp(ctx, 'server', mode),
    formula: adv ? `${result.formula} (${adv})` : result.formula,
    breakdown: breakdownOf(result),
    total: result.total,
    ...(title ? { title } : {}),
    ...(characterName ? { characterName } : {}),
  })
}

/** `request {targets: identityId[] | null, label, ability?, dc?}` (board 20, Ask players). */
function request(p: Payload, ctx: Ctx): void {
  const label = str(p.label, 'label', LABEL_MAX)
  const ability = p.ability === undefined || p.ability === null ? undefined : str(p.ability, 'ability', ABILITY_MAX)
  let dc: number | undefined
  if (p.dc !== undefined && p.dc !== null) {
    dc = num(p.dc, 'dc')
    if (!Number.isInteger(dc) || dc < 1 || dc > DC_MAX) bad(`dc must be a whole number in 1..${DC_MAX}`)
  }
  let targets: string[] | null = null
  if (p.targets !== undefined && p.targets !== null && p.targets !== 'all') {
    if (!Array.isArray(p.targets) || p.targets.length === 0) bad("targets must be a non-empty array of players, or 'all'")
    targets = [...new Set(p.targets.map((t, i) => str(t, `targets[${i}]`, ID_MAX)))]
    for (const id of targets) {
      if (!ctx.players.some((player) => player.identityId === id && player.role === 'player')) {
        bad('no such player at this table')
      }
    }
  }
  const req: RollRequest = {
    id: mint('q'),
    at: Date.now(),
    label,
    ...(ability ? { ability } : {}),
    ...(dc !== undefined ? { dc } : {}),
    targets,
    results: [],
    shared: false,
  }
  ctx.setState({ ...ctx.state, requests: [...(ctx.state.requests ?? []), req].slice(-MAX_REQUESTS) })
  // The nudge that opens the prompt card. The Broadcaster drops it for seats it does not name.
  ctx.broadcast({
    type: 'roll-requested',
    request: {
      requestId: req.id,
      label,
      ...(ability ? { ability } : {}),
      ...(dc !== undefined ? { dc } : {}),
      targets,
    },
  })
}

function findRequest(ctx: Ctx, v: unknown): { index: number; req: RollRequest } {
  const id = str(v, 'requestId', ID_MAX)
  const requests = ctx.state.requests ?? []
  const index = requests.findIndex((r) => r.id === id)
  if (index < 0) bad('no such roll request')
  return { index, req: requests[index] }
}

function withRequest(ctx: Ctx, index: number, req: RollRequest): RollRequest[] {
  const requests = (ctx.state.requests ?? []).slice()
  requests[index] = req
  return requests
}

/**
 * `roll-result {requestId, formula}` (rolled here) or `{requestId, total, formula?,
 * breakdown?}` (rolled elsewhere — Beyond20, dice on the table). One answer per seat; the
 * answer also lands in the log To DM, so the roller sees it and the table does not.
 */
function rollResult(p: Payload, ctx: Ctx, rng: () => number): void {
  const { index, req } = findRequest(ctx, p.requestId)
  const me = ctx.sender.identityId
  if (req.targets !== null && !req.targets.includes(me)) denied('that request is not for you')
  if (req.results.some((r) => r.identityId === me)) bad('you already answered that request')

  let total: number
  let formula: string | undefined
  let breakdown: string | undefined
  if (p.total === undefined) {
    const result = roll(formulaOf(p.formula), rng)
    total = result.total
    formula = result.formula
    breakdown = breakdownOf(result)
  } else {
    total = num(p.total, 'total')
    formula = p.formula === undefined ? undefined : str(p.formula, 'formula', CAPS.formula)
    breakdown = p.breakdown === undefined ? undefined : str(p.breakdown, 'breakdown', CAPS.breakdown)
  }
  const playerName = nameOf(ctx, me)
  const result = { identityId: me, playerName, total, at: Date.now(), ...(formula ? { formula } : {}), ...(breakdown ? { breakdown } : {}) }
  append(
    ctx,
    {
      ...stamp(ctx, 'server', 'dm'),
      title: req.dc === undefined ? req.label : `${req.label}, DC ${req.dc}`,
      total,
      requestId: req.id,
      ...(formula ? { formula } : {}),
      ...(breakdown ? { breakdown } : {}),
    },
    { requests: withRequest(ctx, index, { ...req, results: [...req.results, result] }) },
  )
}

/** "Perception, DC 14: Bram 17 pass, Yara 9 fail" — the DM's Share results. */
export function requestSummary(req: RollRequest): string {
  const head = req.dc === undefined ? req.label : `${req.label}, DC ${req.dc}`
  if (req.results.length === 0) return `${head}: no results yet`
  const parts = req.results.map((r) =>
    req.dc === undefined ? `${r.playerName} ${r.total}` : `${r.playerName} ${r.total} ${r.total >= req.dc ? 'pass' : 'fail'}`,
  )
  return `${head}: ${parts.join(', ')}`.slice(0, CAPS.text)
}

function shareRequest(p: Payload, ctx: Ctx): void {
  const { index, req } = findRequest(ctx, p.requestId)
  append(
    ctx,
    { ...stamp(ctx, 'server', 'public'), title: req.label, text: requestSummary(req), requestId: req.id },
    { requests: withRequest(ctx, index, { ...req, shared: true }) },
  )
}

function closeRequest(p: Payload, ctx: Ctx): void {
  const { req } = findRequest(ctx, p.requestId)
  ctx.setState({ ...ctx.state, requests: (ctx.state.requests ?? []).filter((r) => r !== req) })
}

function wholeNumber(v: unknown, field: string): number {
  const n = num(v, field)
  if (!Number.isInteger(n)) bad(`${field} must be a whole number`)
  return n
}

/** `table-upsert {id?, name, die, rows: {range: [min, max], text}[]}`. */
function tableUpsert(p: Payload, ctx: Ctx): void {
  const tables = ctx.state.tables ?? []
  const id = p.id === undefined ? mint('tb') : str(p.id, 'id', ID_MAX)
  const exists = tables.some((t) => t.id === id)
  if (!exists && tables.length >= MAX_TABLES) bad(`a campaign holds at most ${MAX_TABLES} tables`)
  if (!Array.isArray(p.rows) || p.rows.length === 0 || p.rows.length > MAX_TABLE_ROWS) {
    bad(`rows must be an array of 1..${MAX_TABLE_ROWS}`)
  }
  const rows = p.rows.map((raw, i) => {
    const o = obj(raw, `rows[${i}]`)
    if (!Array.isArray(o.range) || o.range.length !== 2) bad(`rows[${i}].range must be [min, max]`)
    const min = wholeNumber(o.range[0], `rows[${i}].range[0]`)
    const max = wholeNumber(o.range[1], `rows[${i}].range[1]`)
    if (max < min) bad(`rows[${i}].range must not run backwards`)
    return { range: [min, max] as [number, number], text: str(o.text, `rows[${i}].text`, CAPS.text) }
  })
  const table: RollTable = { id, name: str(p.name, 'name', LABEL_MAX), die: formulaOf(p.die, 'die'), rows }
  ctx.setState({
    ...ctx.state,
    tables: exists ? tables.map((t) => (t.id === id ? table : t)) : [...tables, table],
  })
}

function tableDelete(p: Payload, ctx: Ctx): void {
  const id = str(p.id, 'id', ID_MAX)
  const tables = ctx.state.tables ?? []
  if (!tables.some((t) => t.id === id)) bad('no such table')
  ctx.setState({ ...ctx.state, tables: tables.filter((t) => t.id !== id) })
}

/** `roll-table {id, mode?}` — the die rolled here, the row it lands on posted to the log. */
function rollTable(p: Payload, ctx: Ctx, rng: () => number): void {
  const id = str(p.id, 'id', ID_MAX)
  const table = (ctx.state.tables ?? []).find((t) => t.id === id)
  if (!table) bad('no such table')
  const mode = p.mode === undefined ? 'public' : oneOf(p.mode, ROLL_MODES, 'mode')
  const result = roll(table.die, rng)
  const row = table.rows.find((r) => result.total >= r.range[0] && result.total <= r.range[1])
  append(ctx, {
    ...stamp(ctx, 'server', mode),
    title: table.name,
    formula: result.formula,
    breakdown: breakdownOf(result),
    total: result.total,
    text: row?.text ?? 'No row for that roll',
  })
}

function savedUpsert(p: Payload, ctx: Ctx): void {
  const saved = ctx.state.saved ?? []
  const id = p.id === undefined ? mint('sv') : str(p.id, 'id', ID_MAX)
  const exists = saved.some((s) => s.id === id)
  if (!exists && saved.length >= MAX_SAVED) bad(`a campaign holds at most ${MAX_SAVED} saved rolls`)
  const entry: SavedRoll = { id, name: str(p.name, 'name', LABEL_MAX), formula: formulaOf(p.formula) }
  ctx.setState({ ...ctx.state, saved: exists ? saved.map((s) => (s.id === id ? entry : s)) : [...saved, entry] })
}

function savedDelete(p: Payload, ctx: Ctx): void {
  const id = str(p.id, 'id', ID_MAX)
  const saved = ctx.state.saved ?? []
  if (!saved.some((s) => s.id === id)) bad('no such saved roll')
  ctx.setState({ ...ctx.state, saved: saved.filter((s) => s.id !== id) })
}
