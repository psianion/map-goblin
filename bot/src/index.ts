// Boot, and the only file in the package with import-time side effects. Everything it
// wires is a pure or DI-friendly export, which is why none of it needs Discord to be tested.

import { Events } from 'discord.js'
import { join } from 'node:path'
import { createClient } from './bot/client'
import { registry } from './bot/command-registry'
import { routeInteraction, type RouterDeps } from './bot/interaction-router'
import { openDb } from './db/db'
import { createCampaigns } from './db/stores'
import { parseEnv } from './env'
import { createChannelLog, installExitFlush } from './lib/channel-log'
import { log, subscribe } from './lib/log'

const env = parseEnv()
const db = openDb(join(env.BOT_DATA, 'bot.db'))
const client = createClient()

const channelLog = createChannelLog({
  send: async (text) => {
    const channel = await client.channels.fetch(env.LOG_CHANNEL_ID)
    if (channel?.isSendable()) await channel.send(text)
  },
})
subscribe(channelLog.mirror) // warn/error mirror; redaction already happened below the sink
installExitFlush(channelLog)

const deps: RouterDeps = {
  ownerId: env.DISCORD_OWNER_ID,
  campaigns: createCampaigns(db),
  db,
  registry,
  audit: channelLog.audit,
}

client.on(Events.InteractionCreate, (interaction) => void routeInteraction(interaction, deps))
client.once(Events.ClientReady, (ready) => {
  log.info('bot ready', { user: ready.user.tag, guild: env.DISCORD_GUILD_ID })
})

await client.login(env.DISCORD_BOT_TOKEN)
