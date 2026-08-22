import { ActivityType, Client, GatewayIntentBits } from 'discord.js'

/**
 * Guilds for commands, GuildMembers for nickname sync and welcomes. No message-content
 * intent: nothing in v1 reads messages, and an unused privileged intent is just risk.
 */
export function createClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    presence: {
      status: 'online',
      activities: [{ name: 'the tavern door', type: ActivityType.Watching }],
    },
  })
}
