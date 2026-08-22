import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fetchPortraitDataUri, renderCharacterCard } from './card-kit'

const botData = mkdtempSync(join(tmpdir(), 'map-goblin-card-kit-'))

// 1x1 transparent PNG.
const FIXTURE_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function isPng(buf: Buffer): boolean {
  return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
}

describe('renderCharacterCard', () => {
  it('renders a monogram placeholder when there is no portrait', async () => {
    const png = await renderCharacterCard({ name: 'Thalor', className: 'Ranger', level: 3, campaignName: 'The Keep' })
    expect(isPng(png)).toBe(true)
  })

  it('renders with a fixture portrait data URI', async () => {
    const png = await renderCharacterCard({
      name: 'Bryn',
      className: 'Bard',
      level: 1,
      campaignName: 'The Keep',
      portraitDataUri: FIXTURE_DATA_URI,
    })
    expect(isPng(png)).toBe(true)
  })

  it('renders the last-played line when given a timestamp', async () => {
    const png = await renderCharacterCard({
      name: 'Zed',
      className: 'Fighter',
      level: 5,
      campaignName: 'The Keep',
      lastPlayed: Date.parse('2026-08-01'),
    })
    expect(isPng(png)).toBe(true)
  })
})

describe('fetchPortraitDataUri', () => {
  it('returns undefined for a missing url, no fetch call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(await fetchPortraitDataUri(botData, undefined)).toBeUndefined()
    expect(await fetchPortraitDataUri(botData, null)).toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('builds a data URI from a successful fetch on a legacy http(s) url', async () => {
    const bytes = Buffer.from([1, 2, 3, 4])
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as Response)
    const uri = await fetchPortraitDataUri(botData, 'https://cdn.example.com/portrait.jpg')
    expect(uri).toBe(`data:image/jpeg;base64,${bytes.toString('base64')}`)
    vi.restoreAllMocks()
  })

  it('returns undefined on a non-2xx response or a thrown network error for a legacy url', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false } as Response)
    expect(await fetchPortraitDataUri(botData, 'https://cdn.example.com/missing.jpg')).toBeUndefined()

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'))
    expect(await fetchPortraitDataUri(botData, 'https://cdn.example.com/timeout.jpg')).toBeUndefined()
    vi.restoreAllMocks()
  })

  it('reads a local relative path from disk under botData', async () => {
    writeFileSync(join(botData, 'local.png'), Buffer.from([5, 6, 7, 8]))
    const uri = await fetchPortraitDataUri(botData, 'local.png')
    expect(uri).toBe(`data:image/png;base64,${Buffer.from([5, 6, 7, 8]).toString('base64')}`)
  })

  it('returns undefined when the local file is missing', async () => {
    expect(await fetchPortraitDataUri(botData, 'portraits/404.png')).toBeUndefined()
  })
})
