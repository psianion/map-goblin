// Pure helpers for the party journal (plan §11 M3): FTS5 query sanitizing, relative-date
// formatting, and reply/embed building. No discord.js import — command-registry.ts wires
// this to the notes store.

import { userInput } from '../lib/errors'
import type { Note } from '../db/stores'
import type { ContainerSpec } from '../lib/ui'

/**
 * Turns free-text user input into a safe FTS5 MATCH string: every token becomes its own
 * quoted phrase (AND-ed by default), so operators, dangling quotes, leading `-`/`*`, and
 * bare keywords like `OR`/`NOT` can never reach FTS5's query grammar. Throws BotError
 * (user_input) rather than crash on an empty query.
 */
export function sanitizeFtsQuery(raw: string): string {
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) throw userInput('Give me something to search for.')
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' ')
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "just now" / "12m ago" / "3h ago" / "5d ago" / calendar date beyond that. */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - ts)
  if (delta < MINUTE) return 'just now'
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`
  if (delta < 30 * DAY) return `${Math.floor(delta / DAY)}d ago`
  return new Date(ts).toISOString().slice(0, 10)
}

export function noteSavedReply(): string {
  return 'Noted.'
}

export function recallEmbed(query: string, matches: Note[]): ContainerSpec {
  if (matches.length === 0) return { header: `Recall: "${query}"`, blocks: ["Nothing found for that."] }
  return {
    header: `Recall: "${query}"`,
    blocks: matches.map((n) => `<@${n.discordId}> · ${relativeTime(n.createdAt)}\n${n.text}`),
  }
}
