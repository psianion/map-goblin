// The DM's push channel (plan §7): whatever they want the party to see — a game-server asset,
// an upload, a note, or all three — posted to the campaign's player channel. Pure models plus
// one fetch helper; the registry owns the auth and the attaching.

import type { ContainerSpec } from '../lib/ui'

export interface HandoutInput {
  campaignName: string
  /** The DM's own words. Optional — an image alone is a handout. */
  note: string | null
  /** Attached images, shown in the container's gallery. */
  imageNames?: string[]
  /** Attached non-images (a PDF, a text file): named, not shown. */
  fileNames?: string[]
}

export function handoutPost(input: HandoutInput): ContainerSpec {
  const blocks = [`The DM shared something with **${input.campaignName}**.`]
  if (input.note) blocks.push(input.note)
  if (input.fileNames?.length) blocks.push(input.fileNames.map((name) => `📎 \`${name}\``).join('\n'))
  return {
    header: 'Handout',
    blocks,
    ...(input.imageNames?.length ? { media: input.imageNames.map((name) => `attachment://${name}`) } : {}),
  }
}

export function handoutConfirmation(campaignName: string): string {
  return `Handout posted to ${campaignName}'s player channel.`
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
