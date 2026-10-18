// The DM's push channel (plan §7): whatever they want the party to see — a game-server asset,
// an upload, a note, or all three — posted to the campaign's player channel. Pure models plus
// one fetch helper; the registry owns the auth and the attaching.

import { userInput } from '../lib/errors'
import { type Block, type ContainerSpec } from '../lib/card'

export const MAX_HANDOUT_TITLE = 80
export const MAX_HANDOUT_BODY = 2000

export interface HandoutDraft {
  title: string | null
  note: string | null
  assetId: string | null
  spoiler: boolean
}

/**
 * The typed half of the handout form, checked at the trust boundary. "Give me something" is
 * the submit's check, not a field's — a picture, a note and an asset are each a handout on
 * their own — so `hasFiles` is what the caller already knows about the uploads.
 */
export function readHandoutDraft(fields: Record<string, string>, hasFiles: boolean): HandoutDraft {
  const title = (fields.title ?? '').trim()
  const note = (fields.body ?? '').trim()
  const assetId = (fields.asset ?? '').trim()
  const refuse = (why: string): never => {
    throw userInput(`${why}\n-# You put · ${[title, note].filter(Boolean).join(' · ') || 'nothing'}`)
  }

  if (title.length > MAX_HANDOUT_TITLE)
    refuse(`That title is ${title.length} characters — keep it to ${MAX_HANDOUT_TITLE}.`)
  if (note.length > MAX_HANDOUT_BODY) refuse(`That is ${note.length} characters — keep it to ${MAX_HANDOUT_BODY}.`)
  if (!hasFiles && !note && !assetId) refuse('Give me something to hand out: a file, an asset id, or a note.')

  return { title: title || null, note: note || null, assetId: assetId || null, spoiler: fields.spoiler === 'true' }
}

export interface HandoutInput {
  campaignName: string
  /** Named in the subhead — noPing keeps that a name, not a notification. */
  dmDiscordId: string
  /** Heads the card when the DM gave one; otherwise it says who it is from. */
  title?: string | null
  /** The DM's own words. Optional — an image alone is a handout. */
  note: string | null
  /** Attached images, shown in the container's gallery. */
  imageNames?: string[]
  /** Attached non-images (a PDF, a text file): each gets a File component — under the v2 flag
   * an attachment no component points at is invisible, so naming it in text would strand it. */
  fileNames?: string[]
  /** Shown beside the header. Must be attached to the same message as the handout's own files. */
  thumb?: string
  /** Blurs the whole card and every picture on it until the reader clicks. */
  spoiler?: boolean
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

export function handoutPost(input: HandoutInput): ContainerSpec {
  const images = input.imageNames ?? []
  const files = input.fileNames ?? []
  const blocks: Block[] = [input.note ? `> ${input.note.replace(/\n/g, '\n> ')}` : '_The DM slides something across the table._']
  if (files.length) blocks.push({ rule: 'line' }, ...files.map((name): Block => ({ file: `attachment://${name}` })))
  const tally = [images.length ? count(images.length, 'image') : '', files.length ? count(files.length, 'file') : ''].filter(Boolean)
  return {
    eyebrow: `Handout · ${input.campaignName}`,
    header: input.title || 'From the DM',
    subhead: `**DM** <@${input.dmDiscordId}>`,
    ...(input.thumb ? { thumb: input.thumb, thumbAlt: 'Handout' } : {}),
    noPing: true,
    ...(input.spoiler ? { spoiler: true } : {}),
    blocks,
    ...(images.length
      ? {
          media: images.map((name, i) => ({
            url: `attachment://${name}`,
            alt: `Handout image ${i + 1} of ${images.length}`,
            // Both: the container blur hides the card, the media blur survives a reader who
            // opened the card and is still scrolling past the picture.
            ...(input.spoiler ? { spoiler: true } : {}),
          })),
        }
      : {}),
    ...(tally.length ? { footer: tally.join(' · ') } : {}),
  }
}

export function handoutConfirmation(playerChannelId: string): ContainerSpec {
  return { eyebrow: 'Handout', blocks: [`**Handout posted** to <#${playerChannelId}>.`] }
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}

/** Discord decides how to preview a file from its name, so a fetched asset needs one. */
export function assetFileName(assetId: string, mime: string): string {
  const base = assetId.replace(/[^a-z0-9_-]/gi, '') || 'handout'
  return `${base}.${EXTENSIONS[mime.split(';')[0].trim().toLowerCase()] ?? 'bin'}`
}

/** An uploaded name goes back out as an attachment name, so it is scrubbed to something a
 * file system and a CDN both accept. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, '_').slice(0, 80)
  return cleaned.replace(/^[._]+/, '') || 'handout'
}

export const isImage = (mime: string | null | undefined): boolean => (mime ?? '').toLowerCase().startsWith('image/')

/**
 * Pulls an upload's bytes back off Discord's CDN so the handout is re-posted as a real
 * attachment. Linking the original url instead would post something that expires.
 */
export async function fetchAttachment(url: string): Promise<Buffer | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return undefined
    return Buffer.from(await response.arrayBuffer())
  } catch {
    return undefined
  }
}
