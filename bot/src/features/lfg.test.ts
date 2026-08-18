import { describe, expect, it } from 'vitest'
import { applicationCard, applyConfirmation, lfgBoardPost, lfgCloseConfirmation, lfgClosedNotice, lfgOpenConfirmation } from './lfg'

describe('lfgBoardPost', () => {
  it('shows the campaign name and blurb', () => {
    const spec = lfgBoardPost('The Sunken Keep', 'Looking for a rogue')
    expect(spec.header).toContain('The Sunken Keep')
    expect(spec.blocks?.[0]).toBe('Looking for a rogue')
  })
})

describe('applicationCard', () => {
  it('pings the DM and names the applicant, with a message', () => {
    const spec = applicationCard('The Sunken Keep', 'dm-1', 'applicant-1', 'I love rogues')
    expect(spec.blocks?.[0]).toBe('<@dm-1>')
    expect(spec.blocks?.[1]).toContain('<@applicant-1>')
    expect(spec.blocks?.[1]).toContain('I love rogues')
  })

  it('omits the message body when the applicant sent none (the board-button case)', () => {
    const spec = applicationCard('The Sunken Keep', 'dm-1', 'applicant-1', null)
    expect(spec.blocks?.[1]).toBe('<@applicant-1> applied.')
  })
})

describe('confirmations', () => {
  it('name the campaign', () => {
    expect(applyConfirmation('The Sunken Keep')).toContain('The Sunken Keep')
    expect(lfgOpenConfirmation('The Sunken Keep')).toContain('The Sunken Keep')
    expect(lfgCloseConfirmation('The Sunken Keep')).toContain('The Sunken Keep')
    expect(lfgClosedNotice('The Sunken Keep').header).toContain('The Sunken Keep')
  })
})
