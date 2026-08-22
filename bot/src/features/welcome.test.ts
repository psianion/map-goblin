import { describe, expect, it } from 'vitest'
import { welcomeMessage } from './welcome'

describe('welcomeMessage', () => {
  it('mentions the new member', () => {
    const spec = welcomeMessage('<@123456789012345678>')
    expect(spec.blocks?.[0]).toContain('<@123456789012345678>')
  })
})
