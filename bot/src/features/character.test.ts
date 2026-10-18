import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLASSES,
  deleteLocalPortrait,
  downloadPortrait,
  filterAutocomplete,
  leveledUp,
  levelUpAnnouncement,
  myCharactersList,
  readCharacterDraft,
  writePortraitFile,
} from './character'
import type { Character } from '../db/stores'
import { cardText } from '../lib/card'

const char = (over: Partial<Character> = {}): Character => ({
  id: 1,
  discordId: 'user-1',
  campaignId: 'camp-1',
  name: 'Thalor',
  className: 'Ranger',
  level: 1,
  portraitUrl: null,
  lastPlayed: null,
  ...over,
})

describe('levelUpAnnouncement', () => {
  it('names them without summoning them, and always carries a picture', () => {
    const spec = levelUpAnnouncement(char({ level: 4 }), 'attachment://thumb-character.png')
    expect(spec.header).toBe('Thalor reaches level 4')
    expect(spec.subhead).toBe('**Ranger** · <@user-1>')
    expect(spec.noPing).toBe(true)
    expect(spec.thumb).toBe('attachment://thumb-character.png')
  })
})

describe('leveledUp', () => {
  it('is true only when the new level is higher', () => {
    expect(leveledUp(1, 2)).toBe(true)
    expect(leveledUp(2, 2)).toBe(false)
    expect(leveledUp(3, 2)).toBe(false)
  })
})

describe('myCharactersList', () => {
  it('lists every character with class and level', () => {
    const spec = myCharactersList('The Sunken Keep', [char({ name: 'Anna', level: 3 })])
    expect(cardText(spec)).toContain('Anna')
    expect(cardText(spec)).toContain('**Ranger** · Level 3')
  })

  it('gives every row a picture — the saved portrait, or the stand-in — so rows stay one shape', () => {
    const spec = myCharactersList(
      'The Sunken Keep',
      [char({ id: 1, name: 'Anna' }), char({ id: 2, name: 'Bryn', lastPlayed: 1_700_000_000_000 })],
      new Map([[1, 'attachment://portrait-1.png']]),
      'attachment://thumb-character.png',
    )
    expect(spec.blocks).toEqual([
      expect.objectContaining({ thumb: 'attachment://portrait-1.png', alt: "Anna's portrait" }),
      { rule: 'line' },
      expect.objectContaining({ thumb: 'attachment://thumb-character.png', alt: 'No portrait yet' }),
    ])
    expect(cardText(spec)).toContain('Yet to sit at the table')
    expect(cardText(spec)).toContain('Last at the table <t:1700000000:R>')
    expect(spec.footer).toContain('2 characters')
  })

  it('spends the row accessory on a Show card button when one is offered', () => {
    const spec = myCharactersList(
      'The Sunken Keep',
      [char({ id: 1, name: 'Anna' })],
      new Map([[1, 'attachment://portrait-1.png']]),
      'attachment://thumb-character.png',
      undefined,
      (c) => `mycharacters:show:user-1:${c.id}`,
    )
    expect(spec.blocks).toEqual([
      expect.objectContaining({ button: { label: 'Show card', id: 'mycharacters:show:user-1:1' } }),
    ])
    expect(cardText(spec)).toContain('[Show card]')
  })

  it('says so when there are none yet', () => {
    const spec = myCharactersList('The Sunken Keep', [])
    expect(cardText(spec)).toMatch(/haven't created/)
  })
})

describe('readCharacterDraft', () => {
  const typed = { name: '  Thalor ', class: 'Ranger', level: '7' }

  it('trims what was typed and hands back a number for the level', () => {
    expect(readCharacterDraft(typed)).toEqual({ name: 'Thalor', className: 'Ranger', level: 7 })
    expect(CLASSES).toHaveLength(13)
  })

  it('refuses anything the form could not have produced, reading back what was put in', () => {
    expect(() => readCharacterDraft({ ...typed, name: '' })).toThrow(/needs a name/)
    expect(() => readCharacterDraft({ ...typed, name: 'a'.repeat(41) })).toThrow(/41 characters/)
    expect(() => readCharacterDraft({ ...typed, class: 'Goblin' })).toThrow(/class called "Goblin"/)
    for (const level of ['0', '21', '3.5', 'seven', '', '007'])
      expect(() => readCharacterDraft({ ...typed, level })).toThrow(/1 to 20/)
    expect(() => readCharacterDraft({ ...typed, level: '99' })).toThrow(/You put · Thalor · Ranger · 99/)
  })
})

describe('filterAutocomplete', () => {
  it('matches case-insensitively, empty query returns everything', () => {
    expect(filterAutocomplete(['Thalor', 'Bryn'], '')).toEqual(['Thalor', 'Bryn'])
    expect(filterAutocomplete(['Thalor', 'Bryn'], 'tha')).toEqual(['Thalor'])
  })

  it('caps at 25 choices', () => {
    const names = Array.from({ length: 30 }, (_, i) => `Char${i}`)
    expect(filterAutocomplete(names, '')).toHaveLength(25)
  })
})

describe('downloadPortrait', () => {
  afterEach(() => vi.restoreAllMocks())

  it('downloads bytes and picks an extension from content-type', async () => {
    const bytes = Buffer.from([1, 2, 3, 4])
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as Response)
    const download = await downloadPortrait('https://cdn.example.com/a.png')
    expect(download.ext).toBe('png')
    expect(download.bytes).toEqual(bytes)
  })

  it('rejects a non-image content-type', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/pdf' }),
      arrayBuffer: async () => new ArrayBuffer(4),
    } as Response)
    await expect(downloadPortrait('https://cdn.example.com/a.pdf')).rejects.toThrow(/image file/)
  })

  it('rejects a file over the size cap', async () => {
    const big = new ArrayBuffer(8 * 1024 * 1024 + 1)
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => big,
    } as Response)
    await expect(downloadPortrait('https://cdn.example.com/big.png')).rejects.toThrow(/8MB/)
  })

  it('rejects a non-2xx response or a network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false } as Response)
    await expect(downloadPortrait('https://cdn.example.com/missing.png')).rejects.toThrow(/download/)

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'))
    await expect(downloadPortrait('https://cdn.example.com/timeout.png')).rejects.toThrow(/download/)
  })
})

describe('writePortraitFile / deleteLocalPortrait', () => {
  it('saves bytes under <botData>/portraits/<id>.<ext> and reads them back', () => {
    const botData = mkdtempSync(join(tmpdir(), 'map-goblin-portrait-'))
    const relPath = writePortraitFile(botData, 42, Buffer.from([9, 9, 9]), 'png')
    expect(relPath).toBe('portraits/42.png')
    expect(readFileSync(join(botData, relPath))).toEqual(Buffer.from([9, 9, 9]))
  })

  it('overwrites in place on a same-extension replacement', () => {
    const botData = mkdtempSync(join(tmpdir(), 'map-goblin-portrait-'))
    writePortraitFile(botData, 42, Buffer.from([1]), 'png')
    const relPath = writePortraitFile(botData, 42, Buffer.from([2]), 'png')
    expect(readFileSync(join(botData, relPath))).toEqual(Buffer.from([2]))
  })

  it('deletes a local portrait best-effort, no-ops for a legacy url, null, or a missing file', () => {
    const botData = mkdtempSync(join(tmpdir(), 'map-goblin-portrait-'))
    const relPath = writePortraitFile(botData, 7, Buffer.from([1]), 'jpg')
    expect(existsSync(join(botData, relPath))).toBe(true)

    deleteLocalPortrait(botData, relPath)
    expect(existsSync(join(botData, relPath))).toBe(false)

    expect(() => deleteLocalPortrait(botData, 'https://cdn.example.com/old.png')).not.toThrow()
    expect(() => deleteLocalPortrait(botData, null)).not.toThrow()
    expect(() => deleteLocalPortrait(botData, 'portraits/already-gone.png')).not.toThrow()
  })
})
