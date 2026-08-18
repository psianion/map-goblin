// The dispatch table: name → { authorize, execute }. `authorize` is a plain function of a
// context object and the deps, never of a live interaction, so every rule in plan §6 is
// unit-testable and runs before deferReply (see interaction-router.ts).

import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type AutocompleteInteraction, type ChatInputCommandInteraction, type GuildMember, type MessageComponentInteraction } from 'discord.js'
import type { Database } from '../db/db'
import type {
  Calendar,
  Campaign,
  Campaigns,
  CharacterPatch,
  Characters,
  Feedback,
  Ledger,
  LfgApplications,
  LfgPosts,
  Notes,
  Quests,
  Rolls,
  SchedulePolls,
  Sessions,
} from '../db/stores'
import type { SessionRunner } from '../goblin/live-session'
import type { GoblinRest } from '../goblin/rest'
import { calendarAdvanceAnnouncement, calendarSetConfirmation, calendarShow } from '../features/calendar'
import { campaignSetupConfirmation, campaignSetupTokenFailure } from '../features/campaign'
import { characterCreatedReply, characterUpdatedReply, filterAutocomplete, leveledUp, levelUpAnnouncement, myCharactersList } from '../features/character'
import { rollExpression, rollReply, summarizeFaces } from '../features/dice'
import { goldSplitAnnouncement, goldSplitConfirmation, lootAddedReply, lootListEmbed, splitNote, splitShares } from '../features/economy'
import { feedbackCard, feedbackThanks } from '../features/feedback'
import { noteSavedReply, recallEmbed, sanitizeFtsQuery } from '../features/journal'
import { applicationCard, applyConfirmation, lfgBoardPost, lfgCloseConfirmation, lfgClosedNotice, lfgOpenConfirmation } from '../features/lfg'
import { trySyncNickname } from '../features/nickname'
import { questAddedReply, questCompletedReply, questLog } from '../features/quests'
import {
  parseCandidateDate,
  pollAnnouncement,
  pollCreatedConfirmation,
  pollResultAnnouncement,
  toggleVote,
  voteConfirmation,
  winningOption,
} from '../features/schedule'
import { sessionEndedReply, sessionStartedReply } from '../features/session'
import { campaignStatus } from '../features/status'
import { build, SHARED_OWNER, type CustomId } from '../lib/custom-id'
import { internal, notAuthorized, notFound, userInput, wrongChannel } from '../lib/errors'
import { container, type ContainerSpec } from '../lib/ui'
import { fetchPortraitDataUri, renderCharacterCard } from '../render/card-kit'
import {
  apply as applyCommand,
  calendar as calendarCommand,
  campaign as campaignCommand,
  character as characterCommand,
  feedback as feedbackCommand,
  gold as goldCommand,
  lfg as lfgCommand,
  loot as lootCommand,
  mycharacters as mycharactersCommand,
  note as noteCommand,
  ping,
  quests as questsCommand,
  recall as recallCommand,
  roll as rollCommand,
  schedule as scheduleCommand,
  session as sessionCommand,
} from './commands'

export interface Deps {
  /** DISCORD_OWNER_ID — the bot operator. */
  ownerId: string
  campaigns: Campaigns
  characters: Characters
  quests: Quests
  notes: Notes
  rolls: Rolls
  ledger: Ledger
  calendar: Calendar
  schedulePolls: SchedulePolls
  lfgPosts: LfgPosts
  lfgApplications: LfgApplications
  feedback: Feedback
  sessions: Sessions
  db: Database
  /** LFG_CHANNEL_ID — the one fixed cross-campaign recruiting board. */
  lfgChannelId: string
  /** The game server's REST surface (plan §4). */
  goblin: GoblinRest
  /** GOBLIN_ADMIN_PASS — the one credential that mints service tokens. */
  goblinAdminPass: string
  /** Owns the live table: observer, board edits, recap (plan §11 M5). */
  sessionRunner: SessionRunner
  /** Sends a container to a specific channel — the seam that keeps features Discord-free.
   * Used for CBAC posts (level-up to the player channel, welcome to the welcome channel).
   * Resolves the sent message's ref, or undefined if the channel wasn't sendable — schedule
   * polls and LFG posts store it so a later action (vote, close) can find the row. */
  announce: (channelId: string, spec: ContainerSpec) => Promise<{ messageId: string } | undefined>
  /** The announce twin for a message the bot already posted — the live session board is
   * edited in place rather than re-posted every time somebody walks through a door (§8). */
  edit: (channelId: string, messageId: string, spec: ContainerSpec) => Promise<void>
}

/** Everything `authorize` is allowed to see. No interaction, no network. */
export interface AuthContext {
  userId: string
  channelId: string
  roleIds: string[]
  /** Set only for chat input interactions — the subcommand name, if any. Lets one command
   * give different roles to different subcommands (e.g. /quests log vs /quests add). */
  subcommand?: string
}

export type Authorize = (ctx: AuthContext, deps: Deps) => void

export interface Command {
  /** Slash command JSON body, from commands.ts. */
  data: { toJSON: () => { name: string } }
  /** Excluded from sync unless its name is listed in DEV_FEATURES. */
  devOnly?: boolean
  /** Ephemeral defer + reply. Public output posts to a registered channel instead. A function
   * picks per-subcommand (e.g. /loot add is public, /loot list is ephemeral). */
  ephemeral?: boolean | ((interaction: ChatInputCommandInteraction) => boolean)
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

/** A command whose read-only subcommands are member-level and the rest are DM-only
 * (/quests log vs add/complete, /calendar show vs set/advance). */
function memberViews(...viewSubcommands: string[]): Authorize {
  return (ctx, deps) => {
    if (viewSubcommands.includes(ctx.subcommand ?? '')) return memberOnly(ctx, deps)
    return dmOnly(ctx, deps)
  }
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

/** Same role read as the router's contextOf, duplicated locally rather than imported —
 * command-registry.ts is what interaction-router.ts imports, so the reverse import would
 * be circular. Used by the schedule poll's shared-sentinel vote button to check membership
 * itself (the router only owns the owner-stamp check, not campaign membership). */
type MemberLike = { roles?: string[] | { cache: Map<string, unknown> } } | null
function memberRoleIds(member: MemberLike): string[] {
  const roles = member?.roles
  if (!roles) return []
  return Array.isArray(roles) ? roles : [...roles.cache.keys()]
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
    // Every other subcommand is owner-only registration; status is a member-level read.
    authorize: (ctx, deps) => (ctx.subcommand === 'status' ? memberOnly(ctx, deps) : ownerOnly(ctx, deps)),
    execute: async (interaction, deps) => {
      const sub = interaction.options.getSubcommand()
      if (sub === 'setup') return campaignSetup(interaction, deps)
      if (sub === 'status') return campaignStatusCmd(interaction, deps)
      throw notFound("I don't have that campaign subcommand.")
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

  quests: {
    data: questsCommand,
    ephemeral: true,
    authorize: memberViews('log'),
    execute: async (interaction, deps) => {
      const sub = interaction.options.getSubcommand()
      if (sub === 'log') return questsLog(interaction, deps)
      if (sub === 'add') return questsAdd(interaction, deps)
      if (sub === 'complete') return questsComplete(interaction, deps)
      throw notFound("I don't have that quests subcommand.")
    },
    autocomplete: async (interaction, deps) => {
      const campaign = deps.campaigns.byChannel(interaction.channelId)
      if (!campaign) return interaction.respond([])
      const names = filterAutocomplete(
        deps.quests.active(campaign.goblinCampaignId).map((q) => q.title),
        interaction.options.getFocused(),
      )
      await interaction.respond(names.map((name) => ({ name, value: name })))
    },
  },

  note: {
    data: noteCommand,
    ephemeral: true,
    authorize: memberOnly,
    execute: async (interaction, deps) => {
      const campaign = requireCampaign(interaction, deps)
      deps.notes.add(campaign.goblinCampaignId, interaction.user.id, interaction.options.getString('text', true))
      await interaction.editReply(noteSavedReply())
    },
  },

  recall: {
    data: recallCommand,
    ephemeral: true,
    authorize: memberOnly,
    execute: async (interaction, deps) => {
      const campaign = requireCampaign(interaction, deps)
      const query = interaction.options.getString('query', true)
      const matches = deps.notes.search(campaign.goblinCampaignId, sanitizeFtsQuery(query))
      await interaction.editReply({
        components: [container(recallEmbed(query, matches))],
        flags: MessageFlags.IsComponentsV2,
      })
    },
  },

  roll: {
    data: rollCommand,
    ephemeral: false,
    authorize: memberOnly,
    execute: async (interaction, deps) => {
      const campaign = requireCampaign(interaction, deps)
      const expr = interaction.options.getString('expr', true)
      const result = rollExpression(expr)

      let characterId: number | null = null
      let rollerLabel = interaction.user.username
      const explicitName = interaction.options.getString('character')
      if (explicitName) {
        const char = deps.characters.byCampaignAndName(campaign.goblinCampaignId, explicitName)
        if (!char) throw notFound(`No character named "${explicitName}" here.`)
        characterId = char.id
        rollerLabel = char.name
      } else {
        const mine = deps.characters.byOwner(campaign.goblinCampaignId, interaction.user.id)
        if (mine.length === 1) {
          characterId = mine[0].id
          rollerLabel = mine[0].name
        }
      }

      deps.rolls.record({
        campaignId: campaign.goblinCampaignId,
        characterId,
        discordId: interaction.user.id,
        expr,
        total: result.total,
        faces: summarizeFaces(result),
        isCrit: result.isCrit,
        isFail: result.isFail,
      })

      await interaction.editReply({
        components: [container(rollReply(rollerLabel, result))],
        flags: MessageFlags.IsComponentsV2,
      })
    },
    autocomplete: async (interaction, deps) => {
      const campaign = deps.campaigns.byChannel(interaction.channelId)
      if (!campaign) return interaction.respond([])
      const names = filterAutocomplete(
        deps.characters.byCampaign(campaign.goblinCampaignId).map((c) => c.name),
        interaction.options.getFocused(),
      )
      await interaction.respond(names.map((name) => ({ name, value: name })))
    },
  },

  loot: {
    data: lootCommand,
    ephemeral: (interaction) => interaction.options.getSubcommand() === 'list',
    authorize: memberOnly,
    execute: async (interaction, deps) => {
      const sub = interaction.options.getSubcommand()
      if (sub === 'add') return lootAdd(interaction, deps)
      if (sub === 'list') return lootList(interaction, deps)
      throw notFound("I don't have that loot subcommand.")
    },
  },

  gold: {
    data: goldCommand,
    ephemeral: true,
    authorize: dmOnly,
    execute: async (interaction, deps) => {
      if (interaction.options.getSubcommand() !== 'split') throw notFound("I don't have that gold subcommand.")
      const campaign = requireCampaign(interaction, deps)
      const total = interaction.options.getInteger('total', true)
      const partySize = new Set(deps.characters.byCampaign(campaign.goblinCampaignId).map((c) => c.discordId)).size
      const split = splitShares(total, partySize)
      deps.ledger.add({
        campaignId: campaign.goblinCampaignId,
        kind: 'gold',
        delta: total,
        actor: interaction.user.id,
        note: splitNote(partySize, split),
      })
      await deps.announce(campaign.channelId, goldSplitAnnouncement(total, partySize, split))
      await interaction.editReply(goldSplitConfirmation(total, partySize, split))
    },
  },

  calendar: {
    data: calendarCommand,
    ephemeral: true,
    authorize: memberViews('show'),
    execute: async (interaction, deps) => {
      const sub = interaction.options.getSubcommand()
      if (sub === 'show') return calendarShowCmd(interaction, deps)
      if (sub === 'set') return calendarSet(interaction, deps)
      if (sub === 'advance') return calendarAdvance(interaction, deps)
      throw notFound("I don't have that calendar subcommand.")
    },
  },

  schedule: {
    data: scheduleCommand,
    ephemeral: true,
    authorize: dmOnly,
    execute: async (interaction, deps) => {
      const campaign = requireCampaign(interaction, deps)
      const options = [
        interaction.options.getString('option1', true),
        interaction.options.getString('option2', true),
        interaction.options.getString('option3'),
        interaction.options.getString('option4'),
      ].filter((o): o is string => Boolean(o))
      options.forEach(parseCandidateDate) // throws user_input on anything Date.parse can't read

      const poll = deps.schedulePolls.create(campaign.goblinCampaignId, options)
      const sent = await deps.announce(campaign.channelId, {
        ...pollAnnouncement(campaign.name, campaign.roleId, options),
        rows: [scheduleVoteRow(poll.id, options), scheduleCloseRow(poll.id, campaign.dmDiscordId)],
      })
      if (sent) deps.schedulePolls.setMessageRef(poll.id, campaign.channelId, sent.messageId)
      await interaction.editReply(pollCreatedConfirmation())
    },
    component: async (interaction, id, deps) => {
      const poll = deps.schedulePolls.byId(Number(id.extra[0]))
      if (!poll) throw notFound('This poll no longer exists.')
      const campaign = deps.campaigns.byId(poll.campaignId)
      if (!campaign) throw notFound('This campaign no longer exists.')
      if (poll.status !== 'open') throw userInput('This poll is already closed.')

      if (id.action === 'vote') {
        if (!memberRoleIds(interaction.member as MemberLike).includes(campaign.roleId))
          throw notAuthorized("You're not in this campaign.")
        const updated = deps.schedulePolls.setVotes(
          poll.id,
          toggleVote(poll.votes, interaction.user.id, Number(id.extra[1])),
        )
        await interaction.reply({ content: voteConfirmation(updated, interaction.user.id), flags: MessageFlags.Ephemeral })
        return
      }

      if (id.action === 'close') {
        // Belt and suspenders: the button is owner-stamped to the DM already (the router
        // rejects anyone else before this runs), but the handler proves it again per plan §11.
        if (interaction.user.id !== campaign.dmDiscordId) throw notAuthorized("Only this campaign's DM can do that.")
        const closed = deps.schedulePolls.close(poll.id)
        const winner = winningOption(closed)
        if (winner) deps.campaigns.setNextSession(campaign.goblinCampaignId, parseCandidateDate(winner.label))
        await deps.announce(campaign.channelId, pollResultAnnouncement(winner))
        await interaction.reply({ content: 'Poll closed.', flags: MessageFlags.Ephemeral })
      }
    },
  },

  session: {
    data: sessionCommand,
    ephemeral: true,
    authorize: dmOnly,
    execute: async (interaction, deps) => {
      const campaign = requireCampaign(interaction, deps)
      const sub = interaction.options.getSubcommand()
      if (sub === 'start') {
        const { joinLink } = await deps.sessionRunner.start(
          campaign,
          interaction.options.getString('scene') ?? undefined,
        )
        await interaction.editReply(sessionStartedReply(joinLink))
        return
      }
      if (sub === 'end') {
        await interaction.editReply(sessionEndedReply(await deps.sessionRunner.end(campaign)))
        return
      }
      throw notFound("I don't have that session subcommand.")
    },
    // The scene library lives on the game server, not in the bot DB — the one autocomplete
    // that goes over the wire. A failure here is an empty list (see interaction-router.ts).
    autocomplete: async (interaction, deps) => {
      const campaign = deps.campaigns.byChannel(interaction.channelId)
      if (!campaign?.serviceToken) return interaction.respond([])
      const query = interaction.options.getFocused().toLowerCase()
      const scenes = await deps.goblin.getScenes(campaign.serviceToken, campaign.goblinCampaignId)
      await interaction.respond(
        scenes
          .filter((scene) => scene.name.toLowerCase().includes(query))
          .slice(0, 25)
          .map((scene) => ({ name: scene.name, value: scene.id })),
      )
    },
  },

  lfg: {
    data: lfgCommand,
    ephemeral: true,
    authorize: dmOnly,
    execute: async (interaction, deps) => {
      const sub = interaction.options.getSubcommand()
      if (sub === 'open') return lfgOpen(interaction, deps)
      if (sub === 'close') return lfgClose(interaction, deps)
      throw notFound("I don't have that lfg subcommand.")
    },
  },

  apply: {
    data: applyCommand,
    ephemeral: true,
    authorize: everyone,
    execute: async (interaction, deps) => {
      const campaignId = interaction.options.getString('campaign', true)
      const message = interaction.options.getString('message')
      const campaign = await submitApplication(deps, campaignId, interaction.user.id, message)
      await interaction.editReply(applyConfirmation(campaign.name))
    },
    autocomplete: async (interaction, deps) => {
      const query = interaction.options.getFocused().toLowerCase()
      const choices = deps.lfgPosts
        .open()
        .map((post) => deps.campaigns.byId(post.campaignId))
        .filter((c): c is Campaign => Boolean(c))
        .filter((c) => c.name.toLowerCase().includes(query))
        .slice(0, 25)
      await interaction.respond(choices.map((c) => ({ name: c.name, value: c.goblinCampaignId })))
    },
    component: async (interaction, id, deps) => {
      const campaign = await submitApplication(deps, id.extra[0], interaction.user.id, null)
      await interaction.reply({ content: applyConfirmation(campaign.name), flags: MessageFlags.Ephemeral })
    },
  },

  feedback: {
    data: feedbackCommand,
    ephemeral: true,
    authorize: memberOnly,
    execute: async (interaction, deps) => {
      const campaign = requireCampaign(interaction, deps)
      const text = interaction.options.getString('text', true)
      deps.feedback.add(campaign.goblinCampaignId, text) // no discord_id stored anywhere (plan §7)
      await deps.announce(campaign.dmChannelId, feedbackCard(campaign.name, text))
      await interaction.editReply(feedbackThanks())
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

async function questsLog(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const all = deps.quests.byCampaign(campaign.goblinCampaignId)
  await interaction.editReply({
    components: [container(questLog(campaign.name, all))],
    flags: MessageFlags.IsComponentsV2,
  })
}

async function questsAdd(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const title = interaction.options.getString('title', true)
  const quest = deps.quests.add(campaign.goblinCampaignId, title, interaction.user.id)
  await interaction.editReply(questAddedReply(quest))
}

async function questsComplete(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const title = interaction.options.getString('title', true)
  const quest = deps.quests.complete(campaign.goblinCampaignId, title)
  await interaction.editReply(questCompletedReply(quest))
}

async function lootAdd(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const item = interaction.options.getString('item', true)
  const note = interaction.options.getString('note')
  deps.ledger.add({ campaignId: campaign.goblinCampaignId, kind: 'item', item, actor: interaction.user.id, note })
  await interaction.editReply(lootAddedReply(item, note))
}

async function lootList(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const goldTotal = deps.ledger.goldTotal(campaign.goblinCampaignId)
  const recent = deps.ledger.recent(campaign.goblinCampaignId)
  await interaction.editReply({
    components: [container(lootListEmbed(goldTotal, recent))],
    flags: MessageFlags.IsComponentsV2,
  })
}

async function calendarShowCmd(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const state = deps.calendar.get(campaign.goblinCampaignId)
  await interaction.editReply({
    components: [container(calendarShow(state))],
    flags: MessageFlags.IsComponentsV2,
  })
}

async function calendarSet(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const day = interaction.options.getInteger('day', true)
  const epoch = interaction.options.getString('epoch')
  const state = deps.calendar.set(campaign.goblinCampaignId, day, epoch ?? undefined)
  await interaction.editReply(calendarSetConfirmation(state))
}

async function calendarAdvance(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const days = interaction.options.getInteger('days', true)
  const state = deps.calendar.advance(campaign.goblinCampaignId, days)
  await deps.announce(campaign.channelId, calendarAdvanceAnnouncement(state, days))
  await interaction.editReply(calendarSetConfirmation(state))
}

async function campaignSetup(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const input = {
    goblinCampaignId: interaction.options.getString('id', true),
    name: interaction.options.getString('name', true),
    channelId: interaction.options.getChannel('channel', true).id,
    dmChannelId: interaction.options.getChannel('dm-channel', true).id,
    roleId: interaction.options.getRole('role', true).id,
    dmDiscordId: interaction.options.getUser('dm', true).id,
  }
  const campaign = deps.campaigns.upsert(input)

  // The row is saved before the mint, and deliberately not rolled back if the mint fails:
  // re-running setup with the same options is the retry, and losing the channel mapping to
  // a game server that happened to be down would make that retry harder, not safer.
  try {
    const [dm, player] = await Promise.all([
      deps.goblin.mintServiceToken(deps.goblinAdminPass, campaign.goblinCampaignId, 'dm'),
      deps.goblin.mintServiceToken(deps.goblinAdminPass, campaign.goblinCampaignId, 'player'),
    ])
    deps.campaigns.setTokens(campaign.goblinCampaignId, dm.token, player.token)
  } catch {
    throw internal(campaignSetupTokenFailure(campaign))
  }

  await interaction.editReply(campaignSetupConfirmation(campaign))
}

async function campaignStatusCmd(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const status = campaignStatus({
    campaign,
    characters: deps.characters.byCampaign(campaign.goblinCampaignId),
    quests: deps.quests.byCampaign(campaign.goblinCampaignId),
    goldTotal: deps.ledger.goldTotal(campaign.goblinCampaignId),
    calendarState: deps.calendar.get(campaign.goblinCampaignId),
    rollStats: deps.rolls.statsByCampaign(campaign.goblinCampaignId),
    sessionStats: deps.sessions.stats(campaign.goblinCampaignId),
  })
  await interaction.editReply({ components: [container(status)], flags: MessageFlags.IsComponentsV2 })
}

/** One button per candidate date. Anyone may click (shared owner-stamp) — the schedule
 * component handler checks campaign membership itself. */
function scheduleVoteRow(pollId: number, options: string[]): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>()
  options.forEach((label, index) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(build('schedule', 'vote', SHARED_OWNER, String(pollId), String(index)))
        .setLabel(label.slice(0, 80))
        .setStyle(ButtonStyle.Secondary),
    )
  })
  return row
}

/** Owner-stamped to the DM — only they can click it, enforced by the router before the
 * schedule component handler even runs (plus its own re-check, belt and suspenders). */
function scheduleCloseRow(pollId: number, dmDiscordId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(build('schedule', 'close', dmDiscordId, String(pollId)))
      .setLabel('Close poll')
      .setStyle(ButtonStyle.Danger),
  )
}

async function lfgOpen(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const blurb = interaction.options.getString('blurb', true)
  const applyRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(build('apply', 'apply', SHARED_OWNER, campaign.goblinCampaignId))
      .setLabel('Apply')
      .setStyle(ButtonStyle.Primary),
  )
  const sent = await deps.announce(deps.lfgChannelId, { ...lfgBoardPost(campaign.name, blurb), rows: [applyRow] })
  deps.lfgPosts.create(campaign.goblinCampaignId, blurb, deps.lfgChannelId, sent?.messageId ?? '')
  await interaction.editReply(lfgOpenConfirmation(campaign.name))
}

async function lfgClose(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  deps.lfgPosts.close(campaign.goblinCampaignId)
  // "Replaces the board post" (plan §11 M4): a fresh closed-notice supersedes the open one
  // rather than editing it in place — announce only ever posts, matching every other CBAC seam.
  await deps.announce(deps.lfgChannelId, lfgClosedNotice(campaign.name))
  await interaction.editReply(lfgCloseConfirmation(campaign.name))
}

/** Shared by /apply and the board's Apply button. Throws user_input if the campaign isn't
 * (or is no longer) recruiting, not_found if it doesn't exist at all. */
async function submitApplication(
  deps: Deps,
  campaignId: string,
  applicantId: string,
  message: string | null,
): Promise<Campaign> {
  const campaign = deps.campaigns.byId(campaignId)
  if (!campaign) throw notFound("That campaign isn't recruiting.")
  if (!deps.lfgPosts.openForCampaign(campaignId)) throw userInput("That campaign isn't recruiting right now.")
  deps.lfgApplications.add(campaignId, applicantId, message)
  await deps.announce(campaign.dmChannelId, applicationCard(campaign.name, campaign.dmDiscordId, applicantId, message))
  return campaign
}
