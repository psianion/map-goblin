// Pure model -> container mapping for the quest log (plan §11 M3). No discord.js import —
// command-registry.ts wires this to the quests store.

import type { Quest } from '../db/stores'
import { type Block, type ContainerSpec } from '../lib/card'

/** Discord draws these in each reader's own timezone and keeps the relative one counting. */
const stamp = (ms: number): string => `<t:${Math.floor(ms / 1000)}:R>`

// A log grows forever and a card does not: show a window and count the rest. Everything stays
// in plain text blocks, so a hundred quests still cost three components.
const OPEN_SHOWN = 10
const CLOSED_SHOWN = 5

const andMore = (hidden: number): string[] => (hidden > 0 ? [`-# and ${hidden} more`] : [])

function openBlock(open: Quest[]): string {
  const lines = open
    .slice(0, OPEN_SHOWN)
    .flatMap((q) => [`**${q.title}**`, `-# taken up ${stamp(q.createdAt)} · <@${q.addedBy}>`])
  return [`### Open · ${open.length}`, ...lines, ...andMore(open.length - OPEN_SHOWN)].join('\n')
}

function closedBlock(closed: Quest[]): string {
  // No completion time is stored, so "most recent" is when the quest was taken up.
  const lines = [...closed]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, CLOSED_SHOWN)
    .map((q) => `~~${q.title}~~`)
  return [`### Closed · ${closed.length}`, ...lines, ...andMore(closed.length - CLOSED_SHOWN)].join('\n')
}

export function questLog(campaignName: string, quests: Quest[], thumb?: string): ContainerSpec {
  const open = quests.filter((q) => q.status === 'active')
  const closed = quests.filter((q) => q.status === 'done')
  const blocks: Block[] = [
    open.length ? openBlock(open) : '_No active quests. The board is bare — trouble will find you soon enough._',
  ]
  if (closed.length) blocks.push({ rule: 'line' }, closedBlock(closed))
  return {
    eyebrow: campaignName,
    header: 'Quest log',
    subhead: `**${open.length}** open · **${closed.length}** closed`,
    ...(thumb ? { thumb, thumbAlt: 'Quest log' } : {}),
    blocks,
    footer: '`/quests add` · `/quests complete`',
  }
}

export function questAddedReply(quest: Quest): string {
  return `Added quest **${quest.title}**.`
}

export function questCompletedReply(quest: Quest): string {
  return `Completed **${quest.title}**.`
}
