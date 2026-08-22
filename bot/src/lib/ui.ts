// One Components-v2 container assembler. Every message the bot sends goes through it, so
// the accent, the header weight and the separator rhythm stay one decision, not thirty.

import {
  ActionRowBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  type ButtonBuilder,
} from 'discord.js'

/** Parchment-ink accent from the art style guide. */
export const ACCENT = 0xb08d57

/** A buffer posted alongside a container, referenced from `media` as `attachment://<name>`.
 * Plain data, so every seam that carries one stays Discord-free. */
export interface AttachedFile {
  name: string
  data: Buffer
}

export interface ContainerSpec {
  accent?: number
  /** Rendered as an h2 line above the blocks. */
  header?: string
  /** Markdown text blocks, separated from each other. */
  blocks?: string[]
  /** Image urls, or `attachment://name.png` for an attached buffer. */
  media?: string[]
  rows?: ActionRowBuilder<ButtonBuilder>[]
}

export function container(spec: ContainerSpec): ContainerBuilder {
  const built = new ContainerBuilder().setAccentColor(spec.accent ?? ACCENT)

  if (spec.header) built.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${spec.header}`))

  spec.blocks?.forEach((block, index) => {
    if (index > 0 || spec.header) built.addSeparatorComponents(new SeparatorBuilder())
    built.addTextDisplayComponents(new TextDisplayBuilder().setContent(block))
  })

  if (spec.media?.length) {
    built.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        spec.media.map((url) => new MediaGalleryItemBuilder().setURL(url)),
      ),
    )
  }

  spec.rows?.forEach((row) => built.addActionRowComponents(row))
  return built
}
