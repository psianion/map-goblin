// Pure math + reply formatting for the loot ledger (plan §11 M3). No discord.js import —
// command-registry.ts wires this to the ledger store and Discord.

import type { LedgerEntry } from '../db/stores'
import { type ContainerSpec } from '../lib/card'

export interface Split {
  /** Gold per party member, floor division. */
  share: number
  /** Left in the pot after an even split — 0 when it divides cleanly. */
  remainder: number
}

/** Even split of `total` gold across `partySize` members. partySize <= 0 puts it all in the
 * remainder — there's no one to hand a share to. */
export function splitShares(total: number, partySize: number): Split {
  if (partySize <= 0) return { share: 0, remainder: total }
  return { share: Math.floor(total / partySize), remainder: total % partySize }
}

export function splitNote(partySize: number, split: Split): string {
  const base = `Split ${partySize} ways: ${split.share} gold each`
  return split.remainder > 0 ? `${base} (${split.remainder} left in the pot)` : base
}

export function lootAddedReply(item: string, note: string | null): string {
  return note ? `Logged **${item}** — ${note}` : `Logged **${item}**.`
}

/** Thousands separators, locale pinned so a hoard reads the same wherever the bot runs. */
const gold = (amount: number): string => amount.toLocaleString('en-US')

/** Discord draws these in each reader's own timezone and keeps the relative one counting. */
const stamp = (ms: number): string => `<t:${Math.floor(ms / 1000)}:R>`

export function goldSplitAnnouncement(total: number, partySize: number, split: Split, thumb?: string): ContainerSpec {
  return {
    eyebrow: 'Party purse',
    header: `${gold(total)} gold, split ${partySize} ways`,
    big: true,
    ...(thumb ? { thumb, thumbAlt: 'Party purse' } : {}),
    blocks: [`Each takes **${gold(split.share)} gold**.`],
    ...(split.remainder > 0 ? { footer: `${gold(split.remainder)} gold stays in the pot` } : {}),
  }
}

export function goldSplitConfirmation(total: number, partySize: number, split: Split): string {
  return `Recorded — ${total} gold: ${splitNote(partySize, split)}.`
}

/** What was logged, then who logged it and when — two lines per entry. */
function entryLines(entry: LedgerEntry): string[] {
  const delta = entry.delta ?? 0
  const what =
    entry.kind === 'gold' ? `**${delta >= 0 ? '+' : '-'}${gold(Math.abs(delta))} gold**` : `**${entry.item}**`
  return [`${what}${entry.note ? ` — ${entry.note}` : ''}`, `-# ${stamp(entry.createdAt)} · <@${entry.actor}>`]
}

export function lootLedger(
  campaignName: string,
  goldTotal: number,
  recent: LedgerEntry[],
  thumb?: string,
): ContainerSpec {
  return {
    eyebrow: `Party purse · ${campaignName}`,
    header: `${gold(goldTotal)} gold`,
    big: true,
    ...(thumb ? { thumb, thumbAlt: 'Party purse' } : {}),
    blocks: [
      recent.length === 0
        ? '_Nothing logged yet. The ledger is clean and the purse is light._'
        : ['### Latest entries', ...recent.flatMap(entryLines)].join('\n'),
    ],
    footer: '`/loot add` · `/gold split`',
  }
}
