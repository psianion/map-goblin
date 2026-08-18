// The dispatch table: name → { authorize, execute }. `authorize` is a plain function of a
// context object and the deps, never of a live interaction, so every rule in plan §6 is
// unit-testable and runs before deferReply (see interaction-router.ts).

import type { AutocompleteInteraction, ChatInputCommandInteraction, MessageComponentInteraction } from 'discord.js'
import type { Database } from '../db/db'
import type { Campaign, Campaigns } from '../db/stores'
import type { CustomId } from '../lib/custom-id'
import { notAuthorized, wrongChannel } from '../lib/errors'
import { ping } from './commands'

export interface Deps {
  /** DISCORD_OWNER_ID — the bot operator. */
  ownerId: string
  campaigns: Campaigns
  db: Database
}

/** Everything `authorize` is allowed to see. No interaction, no network. */
export interface AuthContext {
  userId: string
  channelId: string
  roleIds: string[]
}

export type Authorize = (ctx: AuthContext, deps: Deps) => void

export interface Command {
  /** Slash command JSON body, from commands.ts. */
  data: { toJSON: () => { name: string } }
  /** Excluded from sync unless its name is listed in DEV_FEATURES. */
  devOnly?: boolean
  /** Ephemeral defer + reply. Public output posts to a registered channel instead. */
  ephemeral?: boolean
  authorize: Authorize
  execute: (interaction: ChatInputCommandInteraction, deps: Deps) => Promise<void>
  autocomplete?: (interaction: AutocompleteInteraction, deps: Deps) => Promise<void>
  /** Buttons/selects whose custom-id namespace is this command's name. */
  component?: (interaction: MessageComponentInteraction, id: CustomId, deps: Deps) => Promise<void>
}

export type Registry = Record<string, Command>

// --- roles (plan §6) ---------------------------------------------------------------

export const everyone: Authorize = () => {}

export const ownerOnly: Authorize = (ctx, deps) => {
  if (ctx.userId !== deps.ownerId) throw notAuthorized('That one is for the bot operator.')
}

/** Channel-based campaign resolution (CBAC): no `campaign:` option on every command. */
export function campaignForChannel(ctx: AuthContext, deps: Deps): Campaign {
  const campaign = deps.campaigns.byChannel(ctx.channelId)
  if (!campaign) throw wrongChannel("This isn't a campaign channel.")
  return campaign
}

/** DB is the authority on who the DM is — a cosmetic Discord role proves nothing. */
export const dmOnly: Authorize = (ctx, deps) => {
  if (campaignForChannel(ctx, deps).dmDiscordId !== ctx.userId)
    throw notAuthorized("Only this campaign's DM can do that.")
}

export const memberOnly: Authorize = (ctx, deps) => {
  if (!ctx.roleIds.includes(campaignForChannel(ctx, deps).roleId))
    throw notAuthorized("You're not in this campaign.")
}

// --- commands ----------------------------------------------------------------------

export const registry: Registry = {
  ping: {
    data: ping,
    ephemeral: true,
    authorize: ownerOnly,
    execute: async (interaction, deps) => {
      const dbOk = deps.db.prepare<[], { ok: number }>('SELECT 1 AS ok').get()?.ok === 1
      const latency = Math.round(interaction.client.ws.ping)
      await interaction.editReply(
        `Gateway ${latency < 0 ? 'n/a' : `${latency}ms`} · db ${dbOk ? 'ok' : 'unreachable'}`,
      )
    },
  },
}
