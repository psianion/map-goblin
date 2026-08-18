// The dispatch table: name → { authorize, execute }. `authorize` is a plain function of a
// context object and the deps, never of a live interaction, so every rule in plan §6 is
// unit-testable and runs before deferReply (see interaction-router.ts).

import { AttachmentBuilder, MessageFlags, type AutocompleteInteraction, type ChatInputCommandInteraction, type GuildMember, type MessageComponentInteraction } from 'discord.js'
import type { Database } from '../db/db'
import type { Campaign, Campaigns, CharacterPatch, Characters } from '../db/stores'
import { campaignSetupConfirmation } from '../features/campaign'
import { characterCreatedReply, characterUpdatedReply, filterAutocomplete, leveledUp, levelUpAnnouncement, myCharactersList } from '../features/character'
import { trySyncNickname } from '../features/nickname'
import type { CustomId } from '../lib/custom-id'
import { notAuthorized, notFound, wrongChannel } from '../lib/errors'
import { container, type ContainerSpec } from '../lib/ui'
import { fetchPortraitDataUri, renderCharacterCard } from '../render/card-kit'
import { campaign as campaignCommand, character as characterCommand, mycharacters as mycharactersCommand, ping } from './commands'

export interface Deps {
  /** DISCORD_OWNER_ID — the bot operator. */
  ownerId: string
  campaigns: Campaigns
  characters: Characters
  db: Database
  /** Sends a container to a specific channel — the seam that keeps features Discord-free.
   * Used for CBAC posts (level-up to the player channel, welcome to the welcome channel). */
  announce: (channelId: string, spec: ContainerSpec) => Promise<void>
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

// --- shared execute-time helpers ----------------------------------------------------

/** Same resolution as campaignForChannel, called again from execute (authorize and execute
 * run as separate calls — see interaction-router.ts). Always defined here: authorize already
 * proved the channel resolves, this just re-reads it. */
function requireCampaign(interaction: ChatInputCommandInteraction, deps: Deps): Campaign {
  const campaign = deps.campaigns.byChannel(interaction.channelId)
  if (!campaign) throw wrongChannel("This isn't a campaign channel.")
  return campaign
}

/** Fetches a full GuildMember (not the partial the gateway sometimes hands the interaction)
 * so `.manageable` and `.setNickname` are reliably available. Never throws. */
async function guildMemberOf(interaction: ChatInputCommandInteraction): Promise<GuildMember | undefined> {
  if (!interaction.guild) return undefined
  return interaction.guild.members.fetch(interaction.user.id).catch(() => undefined)
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

  campaign: {
    data: campaignCommand,
    ephemeral: true,
    authorize: ownerOnly,
    execute: async (interaction, deps) => {
      if (interaction.options.getSubcommand() !== 'setup') throw notFound("I don't have that campaign subcommand.")
      const input: Campaign = {
        goblinCampaignId: interaction.options.getString('id', true),
        name: interaction.options.getString('name', true),
        channelId: interaction.options.getChannel('channel', true).id,
        dmChannelId: interaction.options.getChannel('dm-channel', true).id,
        roleId: interaction.options.getRole('role', true).id,
        dmDiscordId: interaction.options.getUser('dm', true).id,
      }
      const campaign = deps.campaigns.upsert(input)
      await interaction.editReply(campaignSetupConfirmation(campaign))
    },
  },

  character: {
    data: characterCommand,
    ephemeral: true,
    authorize: memberOnly,
    execute: async (interaction, deps) => {
      const sub = interaction.options.getSubcommand()
      if (sub === 'create') return createCharacter(interaction, deps)
      if (sub === 'update') return updateCharacter(interaction, deps)
      if (sub === 'show') return showCharacter(interaction, deps)
      throw notFound("I don't have that character subcommand.")
    },
    autocomplete: async (interaction, deps) => {
      const campaign = deps.campaigns.byChannel(interaction.channelId)
      if (!campaign) return interaction.respond([])
      const sub = interaction.options.getSubcommand()
      const pool =
        sub === 'update'
          ? deps.characters.byOwner(campaign.goblinCampaignId, interaction.user.id)
          : deps.characters.byCampaign(campaign.goblinCampaignId)
      const names = filterAutocomplete(
        pool.map((c) => c.name),
        interaction.options.getFocused(),
      )
      await interaction.respond(names.map((name) => ({ name, value: name })))
    },
  },

  mycharacters: {
    data: mycharactersCommand,
    ephemeral: true,
    authorize: memberOnly,
    execute: async (interaction, deps) => {
      const campaign = requireCampaign(interaction, deps)
      const mine = deps.characters.byOwner(campaign.goblinCampaignId, interaction.user.id)
      await interaction.editReply({
        components: [container(myCharactersList(campaign.name, mine))],
        flags: MessageFlags.IsComponentsV2,
      })
    },
  },
}

async function createCharacter(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const portrait = interaction.options.getAttachment('portrait')
  const character = deps.characters.create({
    discordId: interaction.user.id,
    campaignId: campaign.goblinCampaignId,
    name: interaction.options.getString('name', true),
    className: interaction.options.getString('class', true),
    level: interaction.options.getInteger('level', true),
    portraitUrl: portrait?.url ?? null,
  })

  const member = await guildMemberOf(interaction)
  if (member) await trySyncNickname(member, character.name)

  await interaction.editReply(characterCreatedReply(character))
}

async function updateCharacter(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const currentName = interaction.options.getString('name', true)
  const existing = deps.characters.byCampaignAndName(campaign.goblinCampaignId, currentName)
  if (!existing) throw notFound(`No character named "${currentName}" here.`)
  if (existing.discordId !== interaction.user.id) throw notAuthorized("That's not your character.")

  const patch: CharacterPatch = {}
  const newClass = interaction.options.getString('class')
  if (newClass) patch.className = newClass
  const newLevel = interaction.options.getInteger('level')
  if (newLevel !== null) patch.level = newLevel
  const portrait = interaction.options.getAttachment('portrait')
  if (portrait) patch.portraitUrl = portrait.url
  const rename = interaction.options.getString('rename')
  if (rename) patch.name = rename

  const updated = deps.characters.update(existing.id, patch)

  if (rename) {
    const member = await guildMemberOf(interaction)
    if (member) await trySyncNickname(member, updated.name)
  }
  if (newLevel !== null && leveledUp(existing.level, newLevel)) {
    await deps.announce(campaign.channelId, levelUpAnnouncement(updated))
  }

  await interaction.editReply(characterUpdatedReply(updated))
}

async function showCharacter(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const name = interaction.options.getString('name', true)
  const character = deps.characters.byCampaignAndName(campaign.goblinCampaignId, name)
  if (!character) throw notFound(`No character named "${name}" here.`)

  const portraitDataUri = await fetchPortraitDataUri(character.portraitUrl)
  const png = await renderCharacterCard({
    name: character.name,
    className: character.className,
    level: character.level,
    campaignName: campaign.name,
    lastPlayed: character.lastPlayed ?? undefined,
    portraitDataUri,
  })
  const file = new AttachmentBuilder(png, { name: 'character.png' })

  await interaction.editReply({
    files: [file],
    components: [container({ media: ['attachment://character.png'] })],
    flags: MessageFlags.IsComponentsV2,
  })
}
