// Pure helpers for the party journal (plan §11 M3): FTS5 query sanitizing and card building.
// No discord.js import — command-registry.ts wires this to the notes store.

import { userInput } from '../lib/errors'
import type { Note } from '../db/stores'
import { type Block, type ContainerSpec } from '../lib/card'

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

/** Discord draws these in each reader's own timezone and keeps the relative one counting. */
const stamp = (ms: number): string => `<t:${Math.floor(ms / 1000)}:R>`

/** A player's own words, block-quoted so the card never reads them as the bot's, and cut
 * before a novel of a note can push the card past Discord's per-text limit. */
function quoted(text: string, limit: number): string {
  const cut = text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text
  return `> ${cut.replace(/\n/g, '\n> ')}`
}

// A journal grows forever and a card does not: show a window and count the rest.
const SHOWN = 8

export function noteSavedReply(text: string): ContainerSpec {
  return {
    eyebrow: 'Party journal',
    blocks: [`**Noted.**\n${quoted(text, 300)}\n-# \`/recall\` finds it again`],
  }
}

export function recallResults(campaignName: string, query: string, matches: Note[], thumb?: string): ContainerSpec {
  const head = {
    eyebrow: `Party journal · ${campaignName}`,
    header: `“${query}”`,
    subhead: `**${matches.length}** note${matches.length === 1 ? '' : 's'} found`,
    ...(thumb ? { thumb, thumbAlt: 'Party journal' } : {}),
    footer: '`/note` adds to the journal',
  }
  if (matches.length === 0) return { ...head, blocks: ['_Nothing found for that. Nobody wrote it down._'] }
  // One note per block, a hairline between them: each is its own voice and its own day.
  const blocks = matches.slice(0, SHOWN).flatMap((n, i): Block[] => [
    ...(i > 0 ? [{ rule: 'line' } as const] : []),
    `${quoted(n.text, 400)}\n-# <@${n.discordId}> · ${stamp(n.createdAt)}`,
  ])
  const hidden = matches.length - SHOWN
  if (hidden > 0) blocks.push(`-# and ${hidden} more — narrow the search`)
  return { ...head, blocks }
}
