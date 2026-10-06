// Pure model for `/initiative`'s receipt: the number the bot just sent, and the order it
// landed in. No discord.js import — command-registry.ts hands it the roster the session
// runner is holding.

import type { WireInitiativeEntry } from '../goblin/observer'
import { type Block, type ContainerSpec } from '../lib/card'

// A roster is one text block however long it gets, so this window is about the block's own
// length, not the component budget.
const SHOWN = 20
const WAITING_SHOWN = 12

/**
 * ponytail: the roll the player just sent is what this card bolds, because the table's
 * broadcast carries no turn pointer and no HP or conditions — `InitiativeState` is narrowed to
 * status, entries and the log (goblin/observer.ts), and widening it is a protocol change.
 * Ceiling until then: the card shows who is above and below the number, not whose turn it is.
 * When the state carries a turn key, bold that row instead and hang HP/conditions off each
 * line as subtext; nothing else here changes.
 */
export interface InitiativeReceiptInput {
  campaignName: string
  /** The combatant the number was set on. */
  entry: WireInitiativeEntry
  value: number
  /** The roster as the table last broadcast it — that is, before this number reached it. */
  entries: readonly WireInitiativeEntry[]
  thumb?: string
}

export function initiativeReceipt(input: InitiativeReceiptInput): ContainerSpec {
  // The set is sent but the table's next snapshot has not arrived yet, so the new number is
  // laid over the roster here — otherwise the card would show the row the player just changed
  // still carrying its old value.
  const roster = input.entries.map((e) =>
    e.key === input.entry.key ? { ...e, initiative: input.value } : e,
  )
  const rolled = roster
    .filter((e) => e.initiative !== null)
    .sort((a, b) => b.initiative! - a.initiative!)
  const waiting = roster.filter((e) => e.initiative === null).map((e) => e.name)

  const order = rolled.slice(0, SHOWN).map((e, i) => {
    const place = `**${i + 1}.**`
    return e.key === input.entry.key
      ? `${place} **${e.name}** · **${e.initiative}**`
      : `${place} ${e.name} · ${e.initiative}`
  })
  if (rolled.length > SHOWN) order.push(`-# and ${rolled.length - SHOWN} further down the order`)

  const blocks: Block[] = [['### The order', ...order].join('\n')]
  if (waiting.length) {
    const named = waiting.slice(0, WAITING_SHOWN).join(', ')
    const rest = waiting.length > WAITING_SHOWN ? ` and ${waiting.length - WAITING_SHOWN} more` : ''
    blocks.push(`-# Still to roll · ${named}${rest}`)
  }

  return {
    eyebrow: `Initiative · ${input.campaignName}`,
    header: 'Sent to the table',
    subhead: `**${input.entry.name}** · initiative **${input.value}**`,
    ...(input.thumb ? { thumb: input.thumb, thumbAlt: 'A twenty-sided die' } : {}),
    blocks,
    footer: 'Your row is in bold · the tracker at the table is the record',
  }
}
