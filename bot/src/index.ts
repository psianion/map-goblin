// Boot, and the only file in the package with import-time side effects. Everything it
// wires is a pure or DI-friendly export, which is why none of it needs Discord to be tested.

import { Events, MessageFlags } from 'discord.js'
import { join } from 'node:path'
import { createClient } from './bot/client'
import { registry } from './bot/command-registry'
import { routeInteraction, type RouterDeps } from './bot/interaction-router'
import { openDb } from './db/db'
import {
  createCalendar,
  createCampaigns,
  createCharacters,
  createFeedback,
  createLedger,
  createLfgApplications,
  createLfgPosts,
  createNotes,
  createQuests,
  createRolls,
  createSchedulePolls,
} from './db/stores'
import { parseEnv } from './env'
import { welcomeMessage } from './features/welcome'
import { createChannelLog, installExitFlush } from './lib/channel-log'
import { log, subscribe } from './lib/log'
import { container, type ContainerSpec } from './lib/ui'

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
  characters: createCharacters(db),
  quests: createQuests(db),
  notes: createNotes(db),
  rolls: createRolls(db),
  ledger: createLedger(db),
  calendar: createCalendar(db),
  schedulePolls: createSchedulePolls(db),
  lfgPosts: createLfgPosts(db),
  lfgApplications: createLfgApplications(db),
  feedback: createFeedback(db),
  lfgChannelId: env.LFG_CHANNEL_ID,
  db,
  registry,
  audit: channelLog.audit,
  announce: async (channelId: string, spec: ContainerSpec) => {
    const channel = await client.channels.fetch(channelId)
    if (!channel?.isSendable()) return undefined
    const message = await channel.send({ components: [container(spec)], flags: MessageFlags.IsComponentsV2 })
    return { messageId: message.id }
  },
}

client.on(Events.InteractionCreate, (interaction) => void routeInteraction(interaction, deps))
client.on(Events.GuildMemberAdd, (member) => {
  if (!env.WELCOME_CHANNEL_ID) return
  void deps.announce(env.WELCOME_CHANNEL_ID, welcomeMessage(member.toString()))
})
client.once(Events.ClientReady, (ready) => {
  log.info('bot ready', { user: ready.user.tag, guild: env.DISCORD_GUILD_ID })
})

await client.login(env.DISCORD_BOT_TOKEN)
