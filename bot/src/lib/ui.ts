// One Components-v2 container assembler. Every message the bot sends goes through it, so
// the accent, the header weight and the separator rhythm stay one decision, not thirty.

import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  FileBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js'
import { componentCount, MAX_COMPONENTS, TONE, type ContainerSpec } from './card'

export type { Block, ContainerSpec, MediaItem } from './card'

/** Parchment-ink accent from the art style guide. */
export const ACCENT = TONE.ink

/** A buffer posted alongside a container, referenced from `media` as `attachment://<name>`.
 * Plain data, so every seam that carries one stays Discord-free. */
export interface AttachedFile {
  name: string
  data: Buffer
}

/** Every text display in a built payload, top to bottom — how a test or an audit line reads
 * what was actually sent, builders and all. */
export function payloadText(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (Array.isArray(payload)) return payload.map(payloadText).filter(Boolean).join('\n')
  if (!payload || typeof payload !== 'object') return ''
  const json = 'toJSON' in payload && typeof payload.toJSON === 'function' ? (payload.toJSON() as object) : payload
  const own = 'content' in json && typeof json.content === 'string' ? [json.content] : []
  const nested = ['components', 'accessory'].flatMap((key) => (key in json ? [payloadText((json as Record<string, unknown>)[key])] : []))
  return [...own, ...nested].filter(Boolean).join('\n')
}

const text = (content: string) => new TextDisplayBuilder().setContent(content)

const thumbnail = (url: string, alt?: string) => {
  const built = new ThumbnailBuilder().setURL(url)
  return alt ? built.setDescription(alt.slice(0, 1024)) : built
}

const RULES = {
  line: () => new SeparatorBuilder(),
  wide: () => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  gap: () => new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Large),
}

export function container(spec: ContainerSpec): ContainerBuilder {
  // Discord answers an oversized message with a bare 400; say which card grew instead.
  if (componentCount(spec) > MAX_COMPONENTS)
    throw new Error(`card "${spec.header ?? spec.eyebrow ?? 'untitled'}" needs more than ${MAX_COMPONENTS} components`)

  const built = new ContainerBuilder().setAccentColor(spec.accent ?? ACCENT)
  if (spec.spoiler) built.setSpoiler(true)

  const head = [spec.eyebrow && `-# ${spec.eyebrow.toUpperCase()}`, spec.header && `${spec.big ? '#' : '##'} ${spec.header}`]
    .filter(Boolean)
    .join('\n')
  if (head) {
    const lines = [text(head), ...(spec.subhead ? [text(spec.subhead)] : [])]
    if (spec.thumb)
      built.addSectionComponents(
        new SectionBuilder().addTextDisplayComponents(...lines).setThumbnailAccessory(thumbnail(spec.thumb, spec.thumbAlt)),
      )
    else built.addTextDisplayComponents(...lines)
    if (spec.blocks?.length) built.addSeparatorComponents(RULES.line())
  }

  for (const block of spec.blocks ?? []) {
    if (typeof block === 'string') built.addTextDisplayComponents(text(block))
    else if ('rule' in block) built.addSeparatorComponents(RULES[block.rule]())
    else if ('file' in block) built.addFileComponents(new FileBuilder().setURL(block.file))
    else if ('thumb' in block)
      built.addSectionComponents(
        new SectionBuilder().addTextDisplayComponents(text(block.text)).setThumbnailAccessory(thumbnail(block.thumb, block.alt)),
      )
    else if ('button' in block)
      built.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(text(block.text))
          .setButtonAccessory(
            new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel(block.button.label).setCustomId(block.button.id),
          ),
      )
    else
      built.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(text(block.text))
          .setButtonAccessory(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(block.link.label).setURL(block.link.url)),
      )
  }

  if (spec.media?.length) {
    built.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        spec.media.map((entry) => {
          const item = typeof entry === 'string' ? { url: entry } : entry
          const media = new MediaGalleryItemBuilder().setURL(item.url)
          if (item.alt) media.setDescription(item.alt.slice(0, 1024))
          if (item.spoiler) media.setSpoiler(true)
          return media
        }),
      ),
    )
  }

  if (spec.footer) {
    built.addSeparatorComponents(RULES.line())
    built.addTextDisplayComponents(text(`-# ${spec.footer}`))
  }

  spec.rows?.forEach((row) => built.addActionRowComponents(row))
  return built
}
