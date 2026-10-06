// GuildMemberAdd -> a container spec. Takes a mention string, not a GuildMember, so it stays
// Discord-free and testable; index.ts passes `member.toString()` and the avatar url.

import type { ContainerSpec } from '../lib/card'

export function welcomeMessage(mention: string, avatarUrl?: string): ContainerSpec {
  return {
    eyebrow: 'A new face at the door',
    header: 'Welcome to the table',
    ...(avatarUrl ? { thumb: avatarUrl, thumbAlt: 'The new member’s avatar' } : {}),
    // The mention is the point of this card: no noPing, so the new member is actually notified.
    blocks: [
      `${mention} has wandered in. Pull up a chair — a DM places you in a campaign, and the rest is yours.`,
      { rule: 'line' },
      [
        '### Getting started',
        '**`/character create`** · name, class and level — your place on the party roster',
        '**`/mycharacters`** · the characters you already have in a campaign',
        '**`/roll 2d6+3`** · dice, in the channel, where everyone can see them',
        '-# Every one of these only works in a campaign channel you have the role for.',
      ].join('\n'),
    ],
  }
}
