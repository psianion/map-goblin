// GuildMemberAdd -> a container spec. Takes a mention string, not a GuildMember, so it stays
// Discord-free and testable; index.ts passes `member.toString()`.

import type { ContainerSpec } from '../lib/ui'

export function welcomeMessage(mention: string): ContainerSpec {
  return {
    header: 'Welcome to the table',
    blocks: [
      `${mention} has wandered in. Grab a seat — \`/character create\` once you're placed in a campaign.`,
    ],
  }
}
