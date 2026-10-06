// Pure model/vote logic for /schedule (plan §11 M4). No discord.js import —
// command-registry.ts wires this to the schedule_polls store and Discord.

import { userInput } from '../lib/errors'
import type { SchedulePoll } from '../db/stores'
import { TONE, type ContainerSpec } from '../lib/card'

/**
 * A typed date, or undefined. Date.parse alone is not the test: V8 reads "today at 11" as the
 * first of November, so a string only counts once it carries a real year-month-day.
 */
export function readTypedDate(raw: string): number | undefined {
  if (!/\d{4}-\d{2}-\d{2}/.test(raw)) return undefined
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? undefined : ms
}

/** Throws BotError(user_input) on anything that is not a dated slot — never on a well-formed date. */
export function parseCandidateDate(raw: string): number {
  const ms = readTypedDate(raw)
  if (ms === undefined)
    throw userInput(`Couldn't read "${raw}" as a date. Pick a slot from the list, or type one like "2026-08-22 19:00".`)
  return ms
}

/** Discord draws these in each reader's own timezone and keeps the relative one counting. */
const stamp = (ms: number, style: 'F' | 'R'): string => `<t:${Math.floor(ms / 1000)}:${style}>`

/** Discord's own long stamp, so every reader sees the slot in their zone; the raw text if unparseable. */
export function slotStamp(option: string): string {
  const ms = readTypedDate(option)
  return ms === undefined ? option : stamp(ms, 'F')
}

export interface SlotChoice {
  /** What the DM sees in the list: "Fri 19 Sep, 7:00 pm". */
  name: string
  /** What the poll stores — readable and Date.parse-able: "2026-09-19 19:00". */
  value: string
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
/** Words people put between the parts that carry no meaning of their own. */
const FILLER = new Set(['at', 'on', 'the', 'this', 'next', 'evening', 'night'])
/** Relative day words → offset from today. */
const RELATIVE: Record<string, number> = { today: 0, tonight: 0, tomorrow: 1 }
const DEFAULT_HOUR = 19
const SLOT_DAYS = 14
/** Discord caps an autocomplete answer at 25 choices. */
const MAX_CHOICES = 25

const two = (n: number): string => String(n).padStart(2, '0')

/** "2026-09-19 19:00" — local time, the shape the poll has always stored. */
export function slotValue(d: Date): string {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/** "Fri 19 Sep, 7:00 pm" — what a person scans for. */
export function slotLabel(d: Date): string {
  const day = DAYS[d.getDay()]!.slice(0, 3)
  const month = MONTHS[d.getMonth()]!.slice(0, 3)
  const h12 = d.getHours() % 12 || 12
  const ampm = d.getHours() < 12 ? 'am' : 'pm'
  const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1)
  return `${cap(day)} ${d.getDate()} ${cap(month)}, ${h12}:${two(d.getMinutes())} ${ampm}`
}

/** "8", "8pm", "20:30", "7:30 pm" → [hour, minute] in 24h; anything else undefined. */
function readTime(token: string): [number, number] | undefined {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(token)
  if (!m) return undefined
  let hour = Number(m[1])
  const minute = Number(m[2] ?? '0')
  const suffix = m[3]?.toLowerCase()
  if (hour > 23 || minute > 59) return undefined
  if (suffix === 'pm' && hour < 12) hour += 12
  if (suffix === 'am' && hour === 12) hour = 0
  // A bare small number is an evening hour: "7" is 7 pm, not 7 am — nobody polls for dawn.
  if (!suffix && !m[2] && hour >= 1 && hour <= 11) hour += 12
  return [hour, minute]
}

/**
 * The next two weeks of evenings, filtered by whatever the DM has typed so far: a weekday
 * ("sat"), a month ("oct"), a day number ("19"), a time ("8pm", "20:30") — in any order —
 * or a full date, which is offered first exactly as typed.
 *
 * ponytail: local time of the bot process, one default hour. Ceiling: a table in another zone
 * reads 7 pm as the host's 7 pm. Upgrade path: a timezone and usual-slot on the campaign row.
 */
export function slotSuggestions(query: string, now: number): SlotChoice[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  // "7:30 pm" arrives as two tokens; glue a trailing am/pm onto the number before it.
  for (let i = tokens.length - 1; i > 0; i--)
    if (/^(am|pm)$/.test(tokens[i]!) && /^\d/.test(tokens[i - 1]!)) tokens.splice(i - 1, 2, `${tokens[i - 1]}${tokens[i]}`)

  let hour = DEFAULT_HOUR
  let minute = 0
  let offsets: number[] | undefined
  const words: string[] = []
  for (const token of tokens) {
    if (FILLER.has(token)) continue
    if (token in RELATIVE) {
      offsets = [RELATIVE[token]!]
      continue
    }
    const time = readTime(token)
    if (time && !(token.length <= 2 && Number(token) > 12 && Number(token) <= 31)) [hour, minute] = time
    else words.push(token)
  }

  const out: SlotChoice[] = []
  const typed = readTypedDate(query.trim())
  if (typed !== undefined) {
    const d = new Date(typed)
    out.push({ name: `As typed — ${slotLabel(d)}`, value: slotValue(d) })
  }

  const start = new Date(now)
  start.setHours(hour, minute, 0, 0)
  for (const i of offsets ?? Array.from({ length: SLOT_DAYS }, (_, k) => k)) {
    if (out.length >= MAX_CHOICES) break
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    if (d.getTime() <= now) continue
    const label = slotLabel(d)
    const hay = [DAYS[d.getDay()]!, MONTHS[d.getMonth()]!, String(d.getDate()), label.toLowerCase()]
    const matches = words.every((w) => hay.some((h) => h.startsWith(w)))
    if (matches) out.push({ name: label, value: slotValue(d) })
  }
  return out
}

/** Clicking your current option removes your vote; clicking a different one switches it. */
export function toggleVote(votes: Record<string, number>, discordId: string, optionIndex: number): Record<string, number> {
  const next = { ...votes }
  if (next[discordId] === optionIndex) delete next[discordId]
  else next[discordId] = optionIndex
  return next
}

export interface Winner {
  index: number
  label: string
  votes: number
}

/** First-index tie-break — deterministic, no runoff (plan doesn't ask for one). */
export function winningOption(poll: SchedulePoll): Winner | undefined {
  const counts = poll.options.map((_, i) => Object.values(poll.votes).filter((v) => v === i).length)
  const max = Math.max(0, ...counts)
  if (max === 0) return undefined
  const index = counts.indexOf(max)
  return { index, label: poll.options[index], votes: max }
}

/** The role line must keep notifying, so this card never sets noPing. No running tally either:
 * the poll message is posted once and never edited, so a count printed here would freeze. */
export function pollAnnouncement(campaignName: string, roleId: string, options: string[], thumb?: string): ContainerSpec {
  const evenings = options.map((option, i) => {
    const ms = readTypedDate(option)
    return ms === undefined ? `**${i + 1}.** ${option}` : `**${i + 1}.** ${stamp(ms, 'F')}\n-# ${stamp(ms, 'R')}`
  })
  return {
    eyebrow: `Session poll · ${campaignName}`,
    header: 'When do we play?',
    ...(thumb ? { thumb, thumbAlt: 'Session poll' } : {}),
    blocks: [
      `<@&${roleId}> pick the evening that suits you best. One vote each; press again to change it.`,
      { rule: 'line' },
      ['### The evenings', ...evenings].join('\n'),
    ],
    footer: 'Times show in your own timezone · vote with the buttons below',
  }
}

export function pollResultAnnouncement(winner: Winner | undefined, thumb?: string): ContainerSpec {
  const thumbed = thumb ? { thumb, thumbAlt: 'Session poll' } : {}
  if (!winner)
    return { accent: TONE.quiet, eyebrow: 'Session poll', header: 'Poll closed', ...thumbed, blocks: ['No votes were cast. The table stays dark for now.'] }
  const ms = readTypedDate(winner.label)
  return {
    accent: TONE.live,
    eyebrow: 'Session poll',
    header: 'Session scheduled',
    ...thumbed,
    blocks: [ms === undefined ? `### ${winner.label}` : `### ${stamp(ms, 'F')}\n${stamp(ms, 'R')}`],
    footer: `Won with ${winner.votes} vote${winner.votes === 1 ? '' : 's'}`,
  }
}

export function voteConfirmation(poll: SchedulePoll, discordId: string): string {
  const choice = poll.votes[discordId]
  return choice === undefined ? 'Vote removed.' : `Voted for **${slotStamp(poll.options[choice])}**.`
}

export function pollCreatedConfirmation(): string {
  return 'Poll posted to the player channel.'
}
