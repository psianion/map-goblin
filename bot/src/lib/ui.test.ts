import { ButtonStyle, ComponentType } from 'discord.js'
import { describe, expect, it } from 'vitest'
import { componentCount, notice, TONE, type ContainerSpec } from './card'
import { container, payloadText } from './ui'

const FULL: ContainerSpec = {
  accent: TONE.live,
  eyebrow: 'Live session',
  header: 'The table is open',
  thumb: 'https://cdn.example/a.png',
  blocks: [
    'plain',
    { rule: 'wide' },
    { text: 'with a portrait', thumb: 'attachment://p.png', alt: 'a portrait' },
    { text: 'with a link', link: { label: 'Join', url: 'https://table.example/join/AB' } },
    { text: 'with a button', button: { label: 'Show card', id: 'mycharacters:show:user-1:7' } },
    { file: 'attachment://notes.pdf' },
  ],
  media: ['attachment://map.png', { url: 'attachment://secret.png', alt: 'a secret', spoiler: true }],
  footer: 'Opened just now',
}

describe('container', () => {
  it('builds every block kind into its own v2 component, in order', () => {
    const json = container(FULL).toJSON()
    expect(json.accent_color).toBe(TONE.live)
    expect(json.components.map((c) => c.type)).toEqual([
      ComponentType.Section, // eyebrow + header beside the thumbnail
      ComponentType.Separator,
      ComponentType.TextDisplay,
      ComponentType.Separator,
      ComponentType.Section,
      ComponentType.Section,
      ComponentType.Section,
      ComponentType.File,
      ComponentType.MediaGallery,
      ComponentType.Separator,
      ComponentType.TextDisplay,
    ])
    expect(payloadText(container(FULL))).toContain('-# LIVE SESSION\n## The table is open')
    expect(payloadText(container(FULL))).toContain('-# Opened just now')
  })

  it('hangs a pressable button off a section — a custom id, and never the link style', () => {
    const section = container(FULL).toJSON().components[6] as { accessory: { style: number; custom_id?: string; url?: string } }
    expect(section.accessory).toMatchObject({ custom_id: 'mycharacters:show:user-1:7', label: 'Show card' })
    expect(section.accessory.style).not.toBe(ButtonStyle.Link)
    expect(section.accessory.url).toBeUndefined()
  })

  it('counts what it builds, nested components included', () => {
    const count = (node: { components?: unknown[]; accessory?: unknown }): number =>
      1 + (node.components ?? []).reduce((sum: number, child) => sum + count(child as never), 0) + (node.accessory ? 1 : 0)
    expect(componentCount(FULL)).toBe(count(container(FULL).toJSON() as never))
  })

  it('names the card that outgrew one message instead of letting Discord answer 400', () => {
    const tooBig: ContainerSpec = { header: 'Roster', blocks: Array.from({ length: 14 }, () => ({ text: 'x', thumb: 'attachment://x.png' })) }
    expect(() => container(tooBig)).toThrow(/Roster/)
  })

  it('keeps a notice to one line under its eyebrow', () => {
    expect(payloadText(container(notice('Noted.', 'Party journal')))).toBe('-# PARTY JOURNAL\nNoted.')
  })
})
