// The story module (table v2, board 17): handouts the DM shows to the table, title cards,
// read-aloud shares, and the journal of everything that has been shared. One row per
// campaign — a handout is shown on whatever scene the table is on.
//
// Read-aloud reuses the existing share path: the triggers module's `share-card {roomId}`
// writes the read-aloud into the scene's journal as it always has, reached through the
// injected `shareReadAloud`; this module only remembers that it was shared.

import { type GameModule, type ModuleContext, type Viewer } from '../contract'
import { ID_MAX, Reject, bad, obj, oneOf, str } from '../tokens/validate'

export interface Handout {
  id: string
  /** An uploaded image, when the handout is a picture. */
  assetId?: string
  /** The handout's words, when it is a letter or a note. ≤ 2000. */
  text?: string
  /** ≤ 80. */
  caption: string
  /** "From the mayor", ≤ 60. */
  from?: string
}

export type Audience = 'all' | string[]

/** A seat that hid what is on show for itself ("Hide for me"); the name carries it to a rejoin. */
export interface Dismissal {
  id: string
  name: string
}

export interface StoryState {
  handouts: Handout[]
  /**
   * `shownAt` names this showing, so a dismissal of the last one does not hide the next.
   * `dismissed` is the DM's alone; a player who dismissed it is not sent `shown` at all.
   */
  shown: { handoutId: string; audience: Audience; mode: 'card' | 'full'; shownAt: number; dismissed: Dismissal[] } | null
  titleCard: { text: string; mode: 'over' | 'full'; shownAt: number; dismissed: Dismissal[] } | null
  /** Newest last, capped. `ref` is a handout id, a room id, or the title card's text. */
  journal: { id: string; sharedAt: number; kind: 'readaloud' | 'handout' | 'title'; ref: string; audience?: Audience; sceneId?: string }[]
}

export const STORY_INITIAL: StoryState = { handouts: [], shown: null, titleCard: null, journal: [] }

export const HANDOUTS_MAX = 200
export const JOURNAL_MAX = 200
export const CAPTION_MAX = 80
export const HANDOUT_TEXT_MAX = 2000
export const FROM_MAX = 60
export const TITLE_MAX = 120

export interface StoryDeps {
  /** Runs the existing read-aloud share for a room; returns a refusal message, or null. */
  shareReadAloud?(roomId: string, sceneId: string, ctx: Omit<ModuleContext<unknown>, 'state' | 'setState'>): string | null
}

type Ctx = ModuleContext<StoryState>
type Payload = Record<string, unknown>

let minted = 0
const mint = (prefix: string): string => {
  minted += 1
  return `${prefix}${Date.now().toString(36)}${minted.toString(36)}`
}

const inAudience = (audience: Audience | undefined, viewer: Viewer): boolean =>
  audience === undefined || audience === 'all' || audience.includes(viewer.identityId)

export function storyModule(deps: StoryDeps = {}): GameModule<StoryState> {
  return {
    name: 'story',
    commands: {
      'handout-upsert': ['dm'],
      'handout-delete': ['dm'],
      show: ['dm'],
      hide: ['dm'],
      'title-show': ['dm'],
      'title-hide': ['dm'],
      'share-readaloud': ['dm'],
      // Table lobby pass: "Hide for me", kept across a reload.
      dismiss: ['player'],
    },
    initialState: STORY_INITIAL,

    handler(action, payload, ctx) {
      try {
        const state = normalizeStory(ctx.state)
        run(action, obj(payload ?? {}, 'payload'), state === ctx.state ? ctx : { ...ctx, state }, deps)
      } catch (err) {
        if (err instanceof Reject) return { code: err.code, message: err.message }
        throw err
      }
    },

    // A player holds the handouts they have been shown and nothing the DM is still keeping
    // back: the journal lines addressed to them, the handout on screen if it is for them,
    // and only the handouts those name. Pure and idempotent.
    redact(stored, viewer) {
      const state = normalizeStory(stored)
      if (viewer.role === 'dm') return state
      const journal = state.journal.filter((j) => inAudience(j.audience, viewer))
      const shown = state.shown && inAudience(state.shown.audience, viewer) ? state.shown : null
      const named = new Set(journal.filter((j) => j.kind === 'handout').map((j) => j.ref))
      if (shown) named.add(shown.handoutId)
      return { ...state, journal, shown, handouts: state.handouts.filter((h) => named.has(h.id)) }
    },
  }
}

function run(action: string, p: Payload, ctx: Ctx, deps: StoryDeps): void {
  const state = ctx.state
  switch (action) {
    case 'handout-upsert': {
      const id = p.id === undefined ? mint('h') : str(p.id, 'id', ID_MAX)
      const exists = state.handouts.some((h) => h.id === id)
      if (!exists && state.handouts.length >= HANDOUTS_MAX) bad(`a campaign holds at most ${HANDOUTS_MAX} handouts`)
      const assetId = p.assetId === undefined || p.assetId === null ? undefined : str(p.assetId, 'assetId', ID_MAX)
      const text = p.text === undefined || p.text === null ? undefined : str(p.text, 'text', HANDOUT_TEXT_MAX)
      const from = p.from === undefined || p.from === null ? undefined : str(p.from, 'from', FROM_MAX)
      if (!assetId && !text) bad('a handout needs an image or some text')
      const handout: Handout = {
        id,
        caption: str(p.caption, 'caption', CAPTION_MAX),
        ...(assetId ? { assetId } : {}),
        ...(text ? { text } : {}),
        ...(from ? { from } : {}),
      }
      return ctx.setState({
        ...state,
        handouts: exists ? state.handouts.map((h) => (h.id === id ? handout : h)) : [...state.handouts, handout],
      })
    }
    case 'handout-delete': {
      const id = str(p.id, 'id', ID_MAX)
      if (!state.handouts.some((h) => h.id === id)) bad('no such handout')
      return ctx.setState({
        ...state,
        handouts: state.handouts.filter((h) => h.id !== id),
        shown: state.shown?.handoutId === id ? null : state.shown,
        journal: state.journal.filter((j) => !(j.kind === 'handout' && j.ref === id)),
      })
    }
    case 'show': {
      const handoutId = str(p.handoutId, 'handoutId', ID_MAX)
      if (!state.handouts.some((h) => h.id === handoutId)) bad('no such handout')
      const audience = audienceOf(p.audience, ctx)
      const mode = p.mode === undefined ? 'card' : oneOf(p.mode, ['card', 'full'] as const, 'mode')
      // F27: showing a handout again replaces its journal row rather than adding a second one.
      // The row keeps everyone it was ever shared with, so nobody's journal loses it.
      const earlier = state.journal.find((j) => j.kind === 'handout' && j.ref === handoutId)
      const prior = earlier ? (earlier.audience ?? 'all') : null
      const kept: Audience =
        prior === null ? audience : prior === 'all' || audience === 'all' ? 'all' : [...new Set([...prior, ...audience])]
      const rest = { ...state, journal: state.journal.filter((j) => !(j.kind === 'handout' && j.ref === handoutId)) }
      return ctx.setState({
        ...state,
        shown: { handoutId, audience, mode, shownAt: Date.now(), dismissed: [] },
        journal: journaled(rest, { kind: 'handout', ref: handoutId, audience: kept }),
      })
    }
    case 'hide':
      return ctx.setState({ ...state, shown: null })
    case 'title-show': {
      const text = str(p.text, 'text', TITLE_MAX)
      const mode = p.mode === undefined ? 'over' : oneOf(p.mode, ['over', 'full'] as const, 'mode')
      return ctx.setState({
        ...state,
        titleCard: { text, mode, shownAt: Date.now(), dismissed: [] },
        journal: journaled(state, { kind: 'title', ref: text }),
      })
    }
    case 'title-hide':
      return ctx.setState({ ...state, titleCard: null })
    case 'share-readaloud': {
      const roomId = str(p.roomId, 'roomId', ID_MAX)
      const sceneId = p.sceneId === undefined ? ctx.activeSceneId : str(p.sceneId, 'sceneId', ID_MAX)
      if (!sceneId) bad('no sceneId in the payload and no active scene')
      const refused = deps.shareReadAloud?.(roomId, sceneId, ctx) ?? null
      if (refused) bad(refused)
      return ctx.setState({ ...state, journal: journaled(state, { kind: 'readaloud', ref: roomId, sceneId }) })
    }
    case 'dismiss':
      return bad('story.dismiss is not built yet')
    default:
      bad(`story has no action '${action}'`)
  }
}

/** A row stored before the lobby pass: what is on show gains a `shownAt` and an empty `dismissed`. Same object when nothing lacks. */
export function normalizeStory(state: StoryState): StoryState {
  const { shown, titleCard } = state
  const shownOk = !shown || (typeof shown.shownAt === 'number' && Array.isArray(shown.dismissed))
  const titleOk = !titleCard || Array.isArray(titleCard.dismissed)
  if (shownOk && titleOk) return state
  return {
    ...state,
    shown: shown && !shownOk ? { ...shown, shownAt: shown.shownAt ?? 0, dismissed: shown.dismissed ?? [] } : shown,
    titleCard: titleCard && !titleOk ? { ...titleCard, dismissed: [] } : titleCard,
  }
}

function audienceOf(v: unknown, ctx: Ctx): Audience {
  if (v === undefined || v === 'all') return 'all'
  if (!Array.isArray(v) || v.length === 0) bad("audience must be 'all' or a non-empty array of players")
  const ids = [...new Set(v.map((id, i) => str(id, `audience[${i}]`, ID_MAX)))]
  for (const id of ids) {
    if (!ctx.players.some((player) => player.identityId === id)) bad('no such player at this table')
  }
  return ids
}

function journaled(state: StoryState, entry: Omit<StoryState['journal'][number], 'id' | 'sharedAt'>): StoryState['journal'] {
  return [...state.journal, { id: mint('sj'), sharedAt: Date.now(), ...entry }].slice(-JOURNAL_MAX)
}
