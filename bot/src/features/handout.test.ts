import { describe, expect, it } from 'vitest'
import { assetFileName, handoutConfirmation, handoutPost, isImage, readHandoutDraft, safeFileName } from './handout'
import { cardText } from '../lib/card'

describe('handoutPost', () => {
  const from = { campaignName: 'The Sunken Keep', dmDiscordId: 'dm-1' }

  it('shows images in the gallery and names everything else', () => {
    const spec = handoutPost({ ...from, note: 'The tomb map.', imageNames: ['tomb.png'], fileNames: ['notes.pdf'] })
    expect(spec.eyebrow).toBe('Handout · The Sunken Keep')
    expect(spec.subhead).toBe('**DM** <@dm-1>')
    expect(spec.noPing).toBe(true)
    expect(spec.media).toEqual([{ url: 'attachment://tomb.png', alt: 'Handout image 1 of 1' }])
    expect(cardText(spec)).toContain('The tomb map.')
    expect(spec.blocks).toContainEqual({ file: 'attachment://notes.pdf' })
  })

  it('is a note on its own when nothing is attached', () => {
    const spec = handoutPost({ ...from, note: 'Rest up.' })
    expect(spec.media).toBeUndefined()
    expect(spec.eyebrow).toContain('The Sunken Keep')
    expect(spec.blocks).toEqual(['> Rest up.'])
    expect(spec.footer).toBeUndefined()
  })

  it('says who it came from even with no note at all', () => {
    const spec = handoutPost({ ...from, note: null, imageNames: ['a.png'] })
    expect(spec.blocks).toHaveLength(1)
    expect(spec.eyebrow).toContain('The Sunken Keep')
    expect(spec.media).toEqual([{ url: 'attachment://a.png', alt: 'Handout image 1 of 1' }])
  })

  it('counts what is attached in the footer', () => {
    const two = handoutPost({ ...from, note: null, imageNames: ['a.png', 'b.png'], fileNames: ['notes.pdf'] })
    expect(two.footer).toBe('2 images · 1 file')
    expect(two.media?.map((item) => (typeof item === 'string' ? item : item.alt))).toEqual([
      'Handout image 1 of 2',
      'Handout image 2 of 2',
    ])
    expect(handoutPost({ ...from, note: null, fileNames: ['notes.pdf', 'map.txt'] }).footer).toBe('2 files')
  })

  it('heads the card with the title when there is one, and says who it is from when there is not', () => {
    expect(handoutPost({ ...from, title: 'The letter from the Duke', note: null }).header).toBe(
      'The letter from the Duke',
    )
    expect(handoutPost({ ...from, note: null }).header).toBe('From the DM')
  })

  it('blurs the card and every picture on it when the DM ticked the spoiler', () => {
    const spec = handoutPost({ ...from, note: 'Look away.', imageNames: ['tomb.png'], spoiler: true })
    expect(spec.spoiler).toBe(true)
    expect(spec.media).toEqual([{ url: 'attachment://tomb.png', alt: 'Handout image 1 of 1', spoiler: true }])
    expect(handoutPost({ ...from, note: 'Fine.', imageNames: ['a.png'] }).spoiler).toBeUndefined()
  })

  it('keeps the blank lines inside a body, so paragraphs survive the block quote', () => {
    const spec = handoutPost({ ...from, note: 'One.\n\nTwo.' })
    expect(spec.blocks).toEqual(['> One.\n> \n> Two.'])
  })
})

describe('readHandoutDraft', () => {
  it('takes a title, a body, an asset id and the spoiler tick', () => {
    expect(readHandoutDraft({ title: 'A letter', body: 'Read it.', asset: 'asset-7', spoiler: 'true' }, false)).toEqual(
      { title: 'A letter', note: 'Read it.', assetId: 'asset-7', spoiler: true },
    )
    expect(readHandoutDraft({ body: 'Rest up.', spoiler: 'false' }, false)).toEqual({
      title: null,
      note: 'Rest up.',
      assetId: null,
      spoiler: false,
    })
  })

  it('needs something to hand out — a file on its own is enough', () => {
    expect(() => readHandoutDraft({}, false)).toThrowError(/something to hand out/i)
    expect(readHandoutDraft({}, true)).toMatchObject({ note: null, assetId: null })
  })

  it('refuses an over-long title or body, reading back what was typed', () => {
    expect(() => readHandoutDraft({ title: 'x'.repeat(81) }, true)).toThrowError(/81 characters/)
    expect(() => readHandoutDraft({ title: 'A letter', body: 'x'.repeat(2001) }, true)).toThrowError(/2001 characters/)
    expect(() => readHandoutDraft({ title: 'x'.repeat(81) }, true)).toThrowError(/You put · xxx/)
  })
})

describe('file names', () => {
  it('gives a fetched asset an extension Discord can preview', () => {
    expect(assetFileName('asset-7', 'image/png')).toBe('asset-7.png')
    expect(assetFileName('asset-7', 'image/jpeg; charset=binary')).toBe('asset-7.jpg')
    expect(assetFileName('asset-7', 'application/octet-stream')).toBe('asset-7.bin')
    expect(assetFileName('../../etc/passwd', 'image/png')).toBe('etcpasswd.png')
  })

  it('scrubs an uploaded name before it goes back out', () => {
    expect(safeFileName('map of the keep.png')).toBe('map_of_the_keep.png')
    expect(safeFileName('../../secret.png')).toBe('secret.png')
    expect(safeFileName('....')).toBe('handout')
    expect(safeFileName('a'.repeat(200)).length).toBe(80)
  })

  it('knows an image from everything else', () => {
    expect(isImage('image/webp')).toBe(true)
    expect(isImage('IMAGE/PNG')).toBe(true)
    expect(isImage('application/pdf')).toBe(false)
    expect(isImage(null)).toBe(false)
  })
})

describe('handoutConfirmation', () => {
  it('tells the DM which channel it went to', () => {
    expect(cardText(handoutConfirmation('player-chan'))).toContain('**Handout posted** to <#player-chan>.')
  })
})
