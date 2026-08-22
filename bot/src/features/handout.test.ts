import { describe, expect, it } from 'vitest'
import { assetFileName, handoutConfirmation, handoutPost, isImage, safeFileName } from './handout'

describe('handoutPost', () => {
  it('shows images in the gallery and names everything else', () => {
    const spec = handoutPost({
      campaignName: 'The Sunken Keep',
      note: 'The tomb map.',
      imageNames: ['tomb.png'],
      fileNames: ['notes.pdf'],
    })
    expect(spec.header).toBe('Handout')
    expect(spec.media).toEqual(['attachment://tomb.png'])
    expect(spec.blocks?.join('\n')).toContain('The tomb map.')
    expect(spec.blocks?.join('\n')).toContain('notes.pdf')
  })

  it('is a note on its own when nothing is attached', () => {
    const spec = handoutPost({ campaignName: 'The Sunken Keep', note: 'Rest up.' })
    expect(spec.media).toBeUndefined()
    expect(spec.blocks).toEqual(['The DM shared something with **The Sunken Keep**.', 'Rest up.'])
  })

  it('says who it came from even with no note at all', () => {
    const spec = handoutPost({ campaignName: 'The Sunken Keep', note: null, imageNames: ['a.png'] })
    expect(spec.blocks).toHaveLength(1)
    expect(spec.media).toEqual(['attachment://a.png'])
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
  it('tells the DM where it went', () => {
    expect(handoutConfirmation('The Sunken Keep')).toContain("The Sunken Keep's player channel")
  })
})
