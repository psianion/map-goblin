// The initiative tracker: who is in the fight, what they rolled, and whose turn it is.
//
// The module owns the order and nothing else. It does not roll dice, does not know a DEX
// modifier, and never inspects the tokens module — the DM's client picks the combatants and
// sends them, because it is already rendering the tokens and already knows which are
// claimed. That keeps this a plain module object with no injected deps (rolls-style), not a
// factory over other modules' state (triggers-style).
//
// Roll capture lives at the *sender*, not here: the table's Beyond20 bridge, the table's
// manual roll box and the bot's `/roll` each post `initiative:set` beside their `rolls:post`
// when `isInitiativeRoll` says so. The registry's cascade is hardwired to `triggers` and
// documented as loop-proof; a second target would be a refactor of it, and all three roll
// sources are code we own anyway.

import type { GameModule, ModuleContext } from '../contract'
import { ANY_ROLE } from '../contract'
import { ID_MAX, NAME_MAX, Reject, bad, bool, denied, num, obj, oneOf, str } from '../tokens/validate'
import {
  CONDITIONS,
  HP_MAX,
  INITIAL_STATE,
  INITIATIVE_MAX,
  INITIATIVE_MIN,
  MAX_ENTRIES,
  MAX_LOG,
  conditionLabel,
  ordered,
  type InitiativeEntry,
  type InitiativeLogEntry,
  type InitiativeState,
} from './types'

export * from './types'

type Ctx = ModuleContext<InitiativeState>
type Payload = Record<string, unknown>

const KINDS = ['pc', 'npc'] as const

// ponytail: a counter, not a UUID — same reason as `rolls` and the table log. This package
// is dependency-free and a key only has to be unique inside one encounter of ≤50 entries.
let minted = 0
function mintKey(): string {
  minted += 1
  return `e${Date.now().toString(36)}${minted.toString(36)}`
}

/** Unrolled sinks below everyone, including a combatant who rolled a negative total. */
const rank = (entry: InitiativeEntry): number => entry.initiative ?? Number.NEGATIVE_INFINITY

/** The log with one more sentence on the end, capped. */
function note(log: readonly InitiativeLogEntry[], text: string): InitiativeLogEntry[] {
  const at = Date.now()
  minted += 1
  return [...log, { id: `il${at.toString(36)}${minted.toString(36)}`, at, text }].slice(-MAX_LOG)
}

/** "Goblin, Marra and Tomen" — the order, as a sentence rather than a list of rows. */
function andList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? 'nobody'
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export const initiativeModule: GameModule<InitiativeState> = {
  name: 'initiative',
  commands: {
    start: ['dm'],
    // The one action a player runs: their own number, and only while it is still being
    // gathered. Ownership is checked against `ctx.sender`, never against the payload.
    set: ANY_ROLE,
    begin: ['dm'],
    next: ['dm'],
    add: ['dm'],
    remove: ['dm'],
    end: ['dm'],
    // HP and conditions are the DM's bookkeeping. A player's own sheet lives in D&D Beyond;
    // what the table needs is one set of numbers nobody argues with.
    hp: ['dm'],
    damage: ['dm'],
    condition: ['dm'],
  },
  initialState: INITIAL_STATE,

  handler(action, payload, ctx) {
    try {
      run(action, obj(payload ?? {}, 'payload'), ctx)
    } catch (err) {
      if (err instanceof Reject) return { code: err.code, message: err.message }
      throw err
    }
  },

  // Names, initiative and conditions are in front of everyone on purpose — a tracker the
  // party cannot read is not a tracker. A monster's hit points are the one thing a DM keeps
  // behind the screen, so an NPC's pool leaves as a single bit: down or not.
  redact(state, viewer) {
    if (viewer.role === 'dm' || !Array.isArray(state.entries)) return state
    let touched = false
    const entries = state.entries.map((e) => {
      if (e.kind !== 'npc' || !e.hp) return e
      touched = true
      const { hp, ...rest } = e
      return hp.current === 0 ? { ...rest, hp: { current: 0, max: 0 } } : rest
    })
    return touched ? { ...state, entries } : state
  },
}

function run(action: string, p: Payload, ctx: Ctx): void {
  switch (action) {
    case 'start':
      return start(p, ctx)
    case 'set':
      return set(p, ctx)
    case 'begin':
      return begin(ctx)
    case 'next':
      return next(ctx)
    case 'add':
      return add(p, ctx)
    case 'remove':
      return remove(p, ctx)
    case 'hp':
      return hp(p, ctx)
    case 'damage':
      return damage(p, ctx)
    case 'condition':
      return condition(p, ctx)
    case 'end':
      // The log outlives the encounter it describes: the closing line still has to reach the
      // Discord thread, and it cannot do that from a state that was wiped in the same write.
      return ctx.setState({
        ...INITIAL_STATE,
        entries: [],
        log: note(ctx.state.log, 'The encounter ends.'),
      })
    default:
      bad(`initiative has no action '${action}'`)
  }
}

function start(p: Payload, ctx: Ctx): void {
  // Deliberately not a silent replace: restarting on top of a live fight would throw away an
  // order the table is mid-way through, and the DM is one `end` away from a clean start.
  if (ctx.state.status !== 'idle') bad('an encounter is already running — end it first')

  const sceneId = p.sceneId === undefined ? ctx.activeSceneId : str(p.sceneId, 'sceneId', ID_MAX)
  if (!sceneId) bad('no sceneId in the payload and no active scene')

  if (!Array.isArray(p.entries) || p.entries.length === 0) {
    bad('entries must be a non-empty array')
  }
  if (p.entries.length > MAX_ENTRIES) {
    bad(`an encounter holds at most ${MAX_ENTRIES} combatants`)
  }
  const entries = p.entries.map((v, i) => parseEntry(v, `entries[${i}]`))
  ctx.setState({
    status: 'gathering',
    sceneId,
    round: 0,
    turn: 0,
    entries,
    log: note([], 'An encounter begins — roll initiative.'),
  })
}

function set(p: Payload, ctx: Ctx): void {
  const state = ctx.state
  if (state.status === 'idle') bad('no encounter is running')

  const index = indexOf(state, p)
  const entry = state.entries[index]

  if (ctx.sender.role !== 'dm') {
    // Once the order is locked, a number is not a player's to change: shuffling the order
    // mid-round moves whose turn it is.
    if (state.status === 'running') denied('the order is locked — ask the DM')
    if (!entry.identityId || entry.identityId !== ctx.sender.identityId) {
      denied('that is not your combatant')
    }
  }

  const rolled = value(p.value, 'value')
  const entries = state.entries.slice()
  entries[index] = { ...entry, initiative: rolled }
  // Not re-sorted while running, on purpose: `begin` is what fixes the order, and a DM
  // correcting a typo in round three must not teleport the current turn to someone else.
  ctx.setState({ ...state, entries, log: note(state.log, `${entry.name} rolls initiative: ${rolled}`) })
}

function begin(ctx: Ctx): void {
  const state = ctx.state
  if (state.status !== 'gathering') bad('this encounter is not gathering initiative')
  const entries = ordered(state.entries)
  ctx.setState({
    ...state,
    status: 'running',
    round: 1,
    turn: 0,
    entries,
    log: note(
      state.log,
      `Initiative order: ${andList(entries.map((e) => e.name))}. Round 1 — ${entries[0].name}'s turn.`,
    ),
  })
}

function next(ctx: Ctx): void {
  const state = ctx.state
  if (state.status !== 'running') bad('this encounter has not begun')
  const wrapped = state.turn + 1 >= state.entries.length
  const turn = wrapped ? 0 : state.turn + 1
  const round = wrapped ? state.round + 1 : state.round
  const who = state.entries[turn].name
  ctx.setState({
    ...state,
    turn,
    round,
    log: note(state.log, wrapped ? `Round ${round} — ${who}'s turn.` : `${who}'s turn.`),
  })
}

function add(p: Payload, ctx: Ctx): void {
  const state = ctx.state
  if (state.status === 'idle') bad('no encounter is running')
  if (state.entries.length >= MAX_ENTRIES) {
    bad(`an encounter holds at most ${MAX_ENTRIES} combatants`)
  }
  const entry = parseEntry(p, 'entry')

  const joins = note(state.log, `${entry.name} joins the fight.`)
  if (state.status !== 'running') {
    ctx.setState({ ...state, entries: [...state.entries, entry], log: joins })
    return
  }

  // A reinforcement arriving mid-fight slots in where its roll puts it, and the creature
  // whose turn it is stays the creature whose turn it is — so the insert shifts `turn` only
  // when it landed at or above the current index.
  const entries = state.entries.slice()
  const at = entries.findIndex((e) => rank(entry) > rank(e))
  const index = at === -1 ? entries.length : at
  entries.splice(index, 0, entry)
  ctx.setState({
    ...state,
    entries,
    turn: index <= state.turn ? state.turn + 1 : state.turn,
    log: joins,
  })
}

function remove(p: Payload, ctx: Ctx): void {
  const state = ctx.state
  if (state.status === 'idle') bad('no encounter is running')
  const index = indexOf(state, p)

  const gone = state.entries[index].name
  const entries = state.entries.filter((_, i) => i !== index)
  const log = note(state.log, `${gone} drops out of the fight.`)
  // The last one standing ends the fight rather than leaving an encounter with nobody in it.
  if (entries.length === 0) {
    return ctx.setState({ ...INITIAL_STATE, entries: [], log: note(log, 'The encounter ends.') })
  }

  let { turn, round } = state
  // Dropping someone ahead of the current turn pulls the whole tail back by one; dropping
  // the current creature leaves the index pointing at whoever was next, which is right.
  if (index < turn) turn -= 1
  if (turn >= entries.length) {
    turn = 0
    round += 1
  }
  ctx.setState({ ...state, entries, turn, round, log })
}

/** Swap one entry and append one sentence — what all three bookkeeping commands do. */
function patch(ctx: Ctx, index: number, entry: InitiativeEntry, text?: string): void {
  const entries = ctx.state.entries.slice()
  entries[index] = entry
  const log = text === undefined ? ctx.state.log : note(ctx.state.log, text)
  ctx.setState({ ...ctx.state, entries, log })
}

/** "(5/12)" for a PC; nothing for an NPC, whose pool the party does not get to read off the log. */
const pool = (e: InitiativeEntry): string =>
  e.kind === 'pc' && e.hp ? ` (${e.hp.current}/${e.hp.max})` : ''

function hp(p: Payload, ctx: Ctx): void {
  if (ctx.state.status === 'idle') bad('no encounter is running')
  const index = indexOf(ctx.state, p)
  const entry = ctx.state.entries[index]
  const max = hpValue(p.max, 'max')
  if (max < 1) bad('max must be at least 1')
  const current = p.current === undefined ? max : Math.min(hpValue(p.current, 'current'), max)
  const next = { ...entry, hp: { current, max } }
  // Same screen the damage line keeps: a monster's pool is never said out loud, so there is
  // nothing to say — the DM's own panel is where that number shows.
  patch(ctx, index, next, entry.kind === 'pc' ? `${entry.name} has ${current}/${max} HP.` : undefined)
}

function damage(p: Payload, ctx: Ctx): void {
  if (ctx.state.status === 'idle') bad('no encounter is running')
  const index = indexOf(ctx.state, p)
  const entry = ctx.state.entries[index]
  if (!entry.hp) bad(`${entry.name} has no HP set`)
  const amount = hpValue(p.amount, 'amount')
  if (amount === 0) bad('amount must not be 0')
  const current = Math.max(0, Math.min(entry.hp.max, entry.hp.current - amount))
  const next = { ...entry, hp: { ...entry.hp, current } }
  const text =
    amount < 0
      ? `${entry.name} heals ${-amount}${pool(next)}.`
      : current === 0
        ? `${entry.name} takes ${amount} damage and drops to 0 HP.`
        : `${entry.name} takes ${amount} damage${pool(next)}.`
  patch(ctx, index, next, text)
}

function condition(p: Payload, ctx: Ctx): void {
  if (ctx.state.status === 'idle') bad('no encounter is running')
  const index = indexOf(ctx.state, p)
  const entry = ctx.state.entries[index]
  const name = oneOf(p.name, CONDITIONS, 'name')
  const on = bool(p.on, 'on')
  const had = entry.conditions ?? []
  // Toggling to where it already is would log a sentence about nothing.
  if (on === had.includes(name)) return
  const conditions = on ? [...had, name] : had.filter((c) => c !== name)
  const next: InitiativeEntry = { ...entry }
  if (conditions.length) next.conditions = conditions
  else delete next.conditions
  patch(ctx, index, next, `${entry.name} is ${on ? '' : 'no longer '}${conditionLabel(name)}.`)
}

// ─── payload parsing ────────────────────────────────────────

function hpValue(v: unknown, field: string): number {
  const n = num(v, field)
  if (!Number.isInteger(n) || n < -HP_MAX || n > HP_MAX) {
    bad(`${field} must be a whole number within ±${HP_MAX}`)
  }
  return n
}

function indexOf(state: InitiativeState, p: Payload): number {
  const key = str(p.key, 'key', ID_MAX)
  const index = state.entries.findIndex((e) => e.key === key)
  if (index < 0) bad(`no combatant '${key}' in this encounter`)
  return index
}

function value(v: unknown, field: string): number {
  const n = num(v, field)
  if (n < INITIATIVE_MIN || n > INITIATIVE_MAX) {
    bad(`${field} must be between ${INITIATIVE_MIN} and ${INITIATIVE_MAX}`)
  }
  return n
}

/** A combatant as the DM's client sends it. The key is minted here — never client-supplied. */
function parseEntry(v: unknown, field: string): InitiativeEntry {
  const o = obj(v, field)
  const tokenId = o.tokenId === undefined || o.tokenId === null ? undefined : str(o.tokenId, `${field}.tokenId`, ID_MAX)
  const identityId =
    o.identityId === undefined || o.identityId === null
      ? undefined
      : str(o.identityId, `${field}.identityId`, ID_MAX)
  return {
    key: mintKey(),
    name: str(o.name, `${field}.name`, NAME_MAX),
    kind: oneOf(o.kind, KINDS, `${field}.kind`),
    ...(tokenId === undefined ? {} : { tokenId }),
    ...(identityId === undefined ? {} : { identityId }),
    initiative:
      o.initiative === undefined || o.initiative === null
        ? null
        : value(o.initiative, `${field}.initiative`),
  }
}
