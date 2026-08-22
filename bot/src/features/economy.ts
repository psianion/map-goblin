// Pure math + reply formatting for the loot ledger (plan §11 M3). No discord.js import —
// command-registry.ts wires this to the ledger store and Discord.

import type { LedgerEntry } from '../db/stores'
import type { ContainerSpec } from '../lib/ui'

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

export function goldSplitAnnouncement(total: number, partySize: number, split: Split): ContainerSpec {
  return {
    header: `${total} gold split`,
    blocks: [splitNote(partySize, split)],
  }
}

export function goldSplitConfirmation(total: number, partySize: number, split: Split): string {
  return `Recorded — ${total} gold: ${splitNote(partySize, split)}.`
}

function formatEntry(entry: LedgerEntry): string {
  if (entry.kind === 'gold') {
    const sign = (entry.delta ?? 0) >= 0 ? '+' : ''
    return `${sign}${entry.delta} gold${entry.note ? ` — ${entry.note}` : ''}`
  }
  return `${entry.item}${entry.note ? ` — ${entry.note}` : ''}`
}

export function lootListEmbed(goldTotal: number, recent: LedgerEntry[]): ContainerSpec {
  const lines =
    recent.length === 0 ? ['Nothing logged yet.'] : recent.map((e) => `• ${formatEntry(e)}`)
  return {
    header: `Party gold: ${goldTotal}`,
    blocks: [lines.join('\n')],
  }
}
