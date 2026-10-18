import { describe, expect, it } from 'vitest'
import { welcomeMessage } from './welcome'
import { cardText } from '../lib/card'
import { character, mycharacters, roll } from '../bot/commands'

describe('welcomeMessage', () => {
  it('mentions the new member', () => {
    const spec = welcomeMessage('<@123456789012345678>')
    expect(cardText(spec)).toContain('<@123456789012345678>')
  })

  // The whole point of the card is that the new member sees it — noPing would make it a
  // notice nobody is told about.
  it('leaves the mention notifying', () => {
    expect(welcomeMessage('<@1>').noPing).toBeUndefined()
  })

  // Read off commands.ts rather than typed out, so a rename cannot leave the door mat
  // pointing at a command the bot no longer has.
  it('names commands that actually exist', () => {
    const text = cardText(welcomeMessage('<@1>'))
    expect(text).toContain('### Getting started')
    for (const command of [character, mycharacters, roll]) expect(text).toContain(`/${command.name}`)
    expect(text).toContain('/character create')
  })
})
