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
import type { ContainerSpec } from '../lib/ui'

/** Whether an update crossed a level up — the trigger for the player-channel announce. */
export function leveledUp(oldLevel: number, newLevel: number): boolean {
  return newLevel > oldLevel
}

export function levelUpAnnouncement(character: Character): ContainerSpec {
  return {
    header: `${character.name} reached level ${character.level}!`,
    blocks: [`${character.className}, now level **${character.level}**.`],
  }
}

export function myCharactersList(campaignName: string, characters: Character[]): ContainerSpec {
  if (characters.length === 0) {
    return { header: `Your characters — ${campaignName}`, blocks: ["You haven't created a character here yet."] }
  }
  return {
    header: `Your characters — ${campaignName}`,
    blocks: [characters.map((c) => `**${c.name}** — ${c.className} ${c.level}`).join('\n')],
  }
}

export function characterCreatedReply(character: Character): string {
  return `**${character.name}** created — ${character.className} ${character.level}.`
}

export function characterUpdatedReply(character: Character): string {
  return `Updated **${character.name}** — ${character.className} ${character.level}.`
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
