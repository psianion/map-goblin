// Boot, and the only file in the package with import-time side effects. Everything it
// wires is a pure or DI-friendly export, which is why none of it needs Discord to be tested.

import { Events, MessageFlags } from 'discord.js'
import { join } from 'node:path'
import { WebSocket } from 'ws'
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
  createSessions,
} from './db/stores'
import { parseEnv } from './env'
import { welcomeMessage } from './features/welcome'
import { createSessionRunner } from './goblin/live-session'
import { createObserver } from './goblin/observer'
import { createGoblinRest } from './goblin/rest'
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

const campaigns = createCampaigns(db)
const sessions = createSessions(db)
const calendar = createCalendar(db)
const goblin = createGoblinRest({ baseUrl: env.GOBLIN_SERVER_URL })

/** The only place `ws` is named: the observer takes a socket factory so its own tests can
 * drive a fake one, and the runner takes an observer factory for the same reason. */
const announce = async (channelId: string, spec: ContainerSpec): Promise<{ messageId: string } | undefined> => {
  const channel = await client.channels.fetch(channelId)
  if (!channel?.isSendable()) return undefined
  const message = await channel.send({ components: [container(spec)], flags: MessageFlags.IsComponentsV2 })
  return { messageId: message.id }
}

const edit = async (channelId: string, messageId: string, spec: ContainerSpec): Promise<void> => {
  const channel = await client.channels.fetch(channelId)
  if (!channel?.isTextBased()) return
  const message = await channel.messages.fetch(messageId)
  await message.edit({ components: [container(spec)], flags: MessageFlags.IsComponentsV2 })
}

const sessionRunner = createSessionRunner({
  publicTableUrl: env.PUBLIC_TABLE_URL,
  rest: goblin,
  sessions,
  calendar,
  announce,
  edit,
  createObserver: (token) =>
    createObserver({
      baseUrl: env.GOBLIN_SERVER_URL,
      token,
      createSocket: (url) => new WebSocket(url),
    }),
  campaignById: campaigns.byId,
})

const deps: RouterDeps = {
  ownerId: env.DISCORD_OWNER_ID,
  campaigns,
  characters: createCharacters(db),
  quests: createQuests(db),
  notes: createNotes(db),
  rolls: createRolls(db),
  ledger: createLedger(db),
  calendar,
  schedulePolls: createSchedulePolls(db),
  lfgPosts: createLfgPosts(db),
  lfgApplications: createLfgApplications(db),
  feedback: createFeedback(db),
  sessions,
  lfgChannelId: env.LFG_CHANNEL_ID,
  goblin,
  goblinAdminPass: env.GOBLIN_ADMIN_PASS,
  sessionRunner,
  db,
  registry,
  audit: channelLog.audit,
  announce,
  edit,
}

client.on(Events.InteractionCreate, (interaction) => void routeInteraction(interaction, deps))
client.on(Events.GuildMemberAdd, (member) => {
  if (!env.WELCOME_CHANNEL_ID) return
  void deps.announce(env.WELCOME_CHANNEL_ID, welcomeMessage(member.toString()))
})
client.once(Events.ClientReady, (ready) => {
  log.info('bot ready', { user: ready.user.tag, guild: env.DISCORD_GUILD_ID })
  // A table the bot was watching when it went down is still running — or was closed while
  // it was away, which the runner discovers and finalizes. Either way it is picked back up
  // here, after the gateway is live, because resuming edits a message.
  sessionRunner.resume()
})

await client.login(env.DISCORD_BOT_TOKEN)
