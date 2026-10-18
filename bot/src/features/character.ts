// Pure model -> container mapping for characters (plan §8's model/builder split) plus the
// autocomplete filter. No discord.js import here — command-registry.ts wires this to Discord.
//
// Portrait persistence lives here too (plan fix): Discord attachment URLs are ephemeral-CDN
// links with expiry signatures, so create/update download the bytes once and keep them under
// BOT_DATA instead of storing the link.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Character } from '../db/stores'
import { userInput } from '../lib/errors'
import { type Block, type ContainerSpec } from '../lib/card'

/** Whether an update crossed a level up — the trigger for the player-channel announce. */
export function leveledUp(oldLevel: number, newLevel: number): boolean {
  return newLevel > oldLevel
}

/** `portrait` is their saved one, or the blank character tile — a level-up without a picture
 * would sit at a different height to every other one. The card talks *about* them, so the
 * mention renders as a name and nobody is pinged. */
export function levelUpAnnouncement(character: Character, portrait?: string): ContainerSpec {
  return {
    eyebrow: 'Level up',
    header: `${character.name} reaches level ${character.level}`,
    subhead: `**${character.className}** · <@${character.discordId}>`,
    ...(portrait ? { thumb: portrait, thumbAlt: `${character.name}'s portrait` } : {}),
    noPing: true,
    blocks: ['A hard road, a scar or two, and something finally clicked. Drinks are on them tonight.'],
  }
}

/**
 * One row per character, every row the same shape: name, class and level, when they last sat
 * down, and beside it one accessory — a Section may only have one. On the private card that is
 * a "Show card" button (`showId` gives its custom id); on the shared copy, which nobody else
 * may press, it is the picture instead: their saved portrait, or `fallbackThumb` so a character
 * without one does not collapse into a shorter, odd row. `portraits` maps a character id to
 * something a thumbnail can show (`attachment://…` or a url). Capped at eight so the card fits
 * in one message; anyone past that reads as a line of text.
 */
export function myCharactersList(
  campaignName: string,
  characters: Character[],
  portraits: ReadonlyMap<number, string> = new Map(),
  fallbackThumb?: string,
  /** Set when the card is shared to the channel: "your" means nothing to everyone else. */
  ownerName?: string,
  /** Set on the private card — a ready custom id per row, built by the caller. */
  showId?: (character: Character) => string,
): ContainerSpec {
  const head = { eyebrow: campaignName, header: ownerName ? `${ownerName}'s characters` : 'Your characters' }
  if (characters.length === 0)
    return { ...head, blocks: ["_You haven't created a character here yet._\n`/character create` starts one."] }

  const row = (c: Character): string =>
    [
      `### ${c.name}`,
      `**${c.className}** · Level ${c.level}`,
      `-# ${c.lastPlayed ? `Last at the table <t:${Math.floor(c.lastPlayed / 1000)}:R>` : 'Yet to sit at the table'}`,
    ].join('\n')

  const shown = characters.slice(0, 8)
  const blocks: Block[] = shown.flatMap((c, i): Block[] => {
    const thumb = portraits.get(c.id) ?? fallbackThumb
    const accessory: Block = showId
      ? { text: row(c), button: { label: 'Show card', id: showId(c) } }
      : thumb
        ? { text: row(c), thumb, alt: portraits.has(c.id) ? `${c.name}'s portrait` : 'No portrait yet' }
        : row(c)
    return [...(i > 0 ? [{ rule: 'line' } as const] : []), accessory]
  })
  if (characters.length > shown.length)
    blocks.push({ rule: 'line' }, characters.slice(shown.length).map((c) => `**${c.name}** · ${c.className} ${c.level}`).join('\n'))

  const count = `${characters.length} character${characters.length === 1 ? '' : 's'}`
  return { ...head, blocks, footer: `${count} · \`/character show\` for the full card` }
}

/** The line under a character's name wherever the card carries one: class, level, and whose
 * they are. The mention renders as a name — every card that uses it says noPing. */
export function characterSubhead(character: Character): string {
  return `**${character.className}** · Level ${character.level} · <@${character.discordId}>`
}

export function characterCreatedReply(character: Character): string {
  return `**${character.name}** joins the party — ${character.className} ${character.level}.`
}

export function characterUpdatedReply(character: Character): string {
  return `**${character.name}** is updated — ${character.className} ${character.level}.`
}

// ── the character form, and what its values have to be ───────────────────────────────────

/** The thirteen 5e classes, in the order the modal's select offers them. */
export const CLASSES = [
  'Artificer',
  'Barbarian',
  'Bard',
  'Cleric',
  'Druid',
  'Fighter',
  'Monk',
  'Paladin',
  'Ranger',
  'Rogue',
  'Sorcerer',
  'Warlock',
  'Wizard',
] as const

export const LEVEL_MIN = 1
export const LEVEL_MAX = 20
/** Long enough for a full fantasy name, short enough to head a card on a phone. */
export const MAX_CHARACTER_NAME = 40

export interface CharacterDraft {
  name: string
  className: string
  level: number
}

/**
 * The typed half of the character modal, checked at the trust boundary: a modal's values
 * arrive as strings off the wire, and the select's option list is a suggestion to the client,
 * not a guarantee. A refusal reads back everything they put in — the modal is gone by the time
 * this runs, so the card has to hold the words long enough to retype them.
 */
export function readCharacterDraft(fields: Record<string, string>): CharacterDraft {
  const name = (fields.name ?? '').trim()
  const className = (fields.class ?? '').trim()
  const level = (fields.level ?? '').trim()
  const refuse = (why: string): never => {
    const put = [name, className, level].filter(Boolean).join(' · ')
    throw userInput(`${why}\n-# You put · ${put || 'nothing'}`)
  }

  if (!name) refuse('A character needs a name.')
  if (name.length > MAX_CHARACTER_NAME)
    refuse(`That name is ${name.length} characters — keep it to ${MAX_CHARACTER_NAME}.`)
  if (!(CLASSES as readonly string[]).includes(className)) refuse(`I don't know a class called "${className}".`)
  if (!/^\d{1,2}$/.test(level) || Number(level) < LEVEL_MIN || Number(level) > LEVEL_MAX)
    refuse(`Level has to be a whole number from ${LEVEL_MIN} to ${LEVEL_MAX} — you put "${level}".`)

  return { name, className, level: Number(level) }
}

/** Discord caps autocomplete choices at 25. Case-insensitive "contains" over an empty query. */
export function filterAutocomplete(names: string[], query: string): string[] {
  const q = query.toLowerCase()
  return names.filter((name) => name.toLowerCase().includes(q)).slice(0, 25)
}

// ── portrait persistence ─────────────────────────────────────────────────────────────────

const MAX_PORTRAIT_BYTES = 8 * 1024 * 1024

const PORTRAIT_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export interface PortraitDownload {
  bytes: Buffer
  ext: string
}

/** portrait_url is either a local relative path under BOT_DATA (rows saved by this fix), a
 * legacy http(s) Discord CDN link (rows written before it — those eventually 404), or null. */
export function isLocalPortraitPath(value: string): boolean {
  return !/^https?:\/\//i.test(value)
}

/**
 * Downloads a Discord attachment for a portrait. Throws userInput on any failure — network,
 * non-2xx, non-image content-type, or over the size cap — so command-registry.ts can fail the
 * create/update *before* writing anything: no character row for create, an untouched row for
 * update.
 */
export async function downloadPortrait(url: string): Promise<PortraitDownload> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => undefined)
  if (!res?.ok) throw userInput("Couldn't download that portrait — try attaching it again.")
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!contentType.startsWith('image/')) throw userInput('Portraits must be an image file.')
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > MAX_PORTRAIT_BYTES) throw userInput('Portraits must be 8MB or smaller.')
  return { bytes: buf, ext: PORTRAIT_EXTENSIONS[contentType] ?? 'bin' }
}

/** Saves already-downloaded bytes to `<botData>/portraits/<characterId>.<ext>` and returns the
 * relative path to store in `characters.portrait_url`. Named by character id (not upload id) so
 * a replacement with the same extension overwrites in place. */
export function writePortraitFile(botData: string, characterId: number, bytes: Buffer, ext: string): string {
  const relPath = `portraits/${characterId}.${ext}`
  mkdirSync(join(botData, 'portraits'), { recursive: true })
  writeFileSync(join(botData, relPath), bytes)
  return relPath
}

/** Best-effort delete of a replaced local portrait file. A no-op for a legacy url, null, or a
 * path that's already gone (e.g. the replacement overwrote it in place). */
export function deleteLocalPortrait(botData: string, portraitUrl: string | null): void {
  if (!portraitUrl || !isLocalPortraitPath(portraitUrl)) return
  try {
    rmSync(join(botData, portraitUrl))
  } catch {
    // best-effort — nothing to clean up
  }
}
