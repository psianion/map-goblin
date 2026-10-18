// The card vocabulary: plain data describing one Components-v2 message. Feature files build
// these and never import discord.js; lib/ui.ts is the only place a spec becomes builders.

import type { ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder } from 'discord.js'

/** Accent is state, not decoration: ink is the resting parchment, the rest say something. */
export const TONE = {
  ink: 0xb08d57,
  live: 0x3a9d5d,
  alert: 0xc0392b,
  quiet: 0x6b6358,
} as const

export interface MediaItem {
  /** An image url, or `attachment://name.png` for an attached buffer. */
  url: string
  /** Alt text, max 1024. */
  alt?: string
  spoiler?: boolean
}

export type Block =
  /** Markdown text. */
  | string
  /** Text with a small image beside it (Section + Thumbnail). */
  | { text: string; thumb: string; alt?: string }
  /** Text with a link button beside it (Section + Button). Link buttons send no interaction. */
  | { text: string; link: { label: string; url: string } }
  /** Text with a pressable button beside it (Section + Button). `id` is a ready custom id —
   * the caller builds it, so a feature file lays out the row without meeting custom-id.ts. */
  | { text: string; button: { label: string; id: string } }
  /** An attached non-image file, `attachment://name.pdf`. V2 hides attachments unless a
   * component shows them, so this is the only way such a file is reachable. */
  | { file: string }
  /** A subject change: a hairline, a hairline with air, or air alone. */
  | { rule: 'line' | 'wide' | 'gap' }

export interface ContainerSpec {
  accent?: number
  /** Small caps line above the header — where the card is from. */
  eyebrow?: string
  /** Rendered as an h2. */
  header?: string
  /** h1 instead — for a card whose header *is* the answer (a dice total). */
  big?: boolean
  /** A line of its own under the header, beside the same thumbnail: who, where, a link. */
  subhead?: string
  /** Image beside the header. */
  thumb?: string
  thumbAlt?: string
  blocks?: Block[]
  media?: (string | MediaItem)[]
  /** Subtext under a hairline at the foot of the card. */
  footer?: string
  rows?: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[]
  /** Blurs the whole card until clicked. */
  spoiler?: boolean
  /** Mentions still render as names, but nobody is notified — for a card that talks *about*
   * people (a roster, a status board) rather than *to* them. */
  noPing?: boolean
}

/** A one-line card: confirmations and errors, so nothing the bot says is bare text. */
export function notice(text: string, eyebrow?: string, accent: number = TONE.ink): ContainerSpec {
  return { accent, ...(eyebrow ? { eyebrow } : {}), blocks: [text] }
}

/** Every word a reader sees, top to bottom — what tests and logs read a card through. */
export function cardText(spec: ContainerSpec): string {
  const blocks = (spec.blocks ?? []).map((block) => {
    if (typeof block === 'string') return block
    if ('link' in block) return `${block.text}\n[${block.link.label}] ${block.link.url}`
    if ('button' in block) return `${block.text}\n[${block.button.label}]`
    return 'text' in block ? block.text : 'file' in block ? block.file : ''
  })
  return [spec.eyebrow, spec.header, spec.subhead, ...blocks, spec.footer].filter(Boolean).join('\n')
}

/** Discord allows 40 components in one message, nested ones included. */
export const MAX_COMPONENTS = 40

/** Components a spec will cost once built — what a list-shaped card checks before it grows. */
export function componentCount(spec: ContainerSpec): number {
  const head =
    spec.header || spec.eyebrow ? 1 + (spec.subhead ? 1 : 0) + (spec.thumb ? 2 : 0) + (spec.blocks?.length ? 1 : 0) : 0
  const blocks = (spec.blocks ?? []).reduce(
    (sum, block) => sum + (typeof block === 'string' || 'file' in block || 'rule' in block ? 1 : 3),
    0,
  )
  const rows = (spec.rows ?? []).reduce((sum, row) => sum + 1 + row.components.length, 0)
  return 1 + head + blocks + (spec.media?.length ? 1 : 0) + (spec.footer ? 2 : 0) + rows
}
