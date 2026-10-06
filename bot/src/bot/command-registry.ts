// The dispatch table: name → { authorize, execute }. `authorize` is a plain function of a
// context object and the deps, never of a live interaction, so every rule in plan §6 is
// unit-testable and runs before deferReply (see interaction-router.ts).

import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction, type GuildMember, type MessageComponentInteraction, type ModalBuilder, type ModalSubmitInteraction } from 'discord.js'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Database } from '../db/db'
import type {
  Calendar,
  Campaign,
  Campaigns,
  Character,
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
import type { WireInitiativeEntry } from '../goblin/observer'
import type { GoblinRest } from '../goblin/rest'
import { calendarAdvanceAnnouncement, calendarSetConfirmation, calendarShow } from '../features/calendar'
import { campaignSetupConfirmation, campaignSetupTokenFailure, readCampaignDraft } from '../features/campaign'
import {
  characterCreatedReply,
  characterSubhead,
  characterUpdatedReply,
  deleteLocalPortrait,
  downloadPortrait,
  filterAutocomplete,
  isLocalPortraitPath,
  leveledUp,
  levelUpAnnouncement,
  myCharactersList,
  readCharacterDraft,
  writePortraitFile,
} from '../features/character'
import { rollExpression, rollReply, summarizeFaces } from '../features/dice'
import { goldSplitAnnouncement, goldSplitConfirmation, lootAddedReply, lootLedger, splitNote, splitShares } from '../features/economy'
import { feedbackCard, feedbackThanks, readFeedbackDraft } from '../features/feedback'
import {
  assetFileName,
  fetchAttachment,
  handoutConfirmation,
  handoutPost,
  isImage,
  readHandoutDraft,
  safeFileName,
} from '../features/handout'
import { initiativeReceipt } from '../features/initiative'
import { noteSavedReply, recallResults, sanitizeFtsQuery } from '../features/journal'
import {
  applicationCard,
  applyConfirmation,
  lfgBoardPost,
  lfgCloseConfirmation,
  lfgClosedNotice,
  lfgOpenConfirmation,
  readApplicationDraft,
  readRecruitDraft,
  type ApplicationDraft,
} from '../features/lfg'
import { trySyncNickname } from '../features/nickname'
import { questAddedReply, questCompletedReply, questLog } from '../features/quests'
import {
  parseCandidateDate,
  pollAnnouncement,
  pollCreatedConfirmation,
  pollResultAnnouncement,
  slotSuggestions,
  toggleVote,
  voteConfirmation,
  winningOption,
} from '../features/schedule'
import { sessionEndedReply, sessionStartedReply } from '../features/session'
import { healthBoard } from '../features/health'
import { campaignStatus } from '../features/status'
import { build, SHARED_OWNER, type CustomId } from '../lib/custom-id'
import { internal, notAuthorized, notFound, userInput, wrongChannel } from '../lib/errors'
import { notice } from '../lib/card'
import { container, type AttachedFile, type ContainerSpec } from '../lib/ui'
import { freshSeats, seatExpiresAt } from '../goblin/seat'
import { BOOT_AT, COMMIT } from '../lib/build-info'
import { fetchPortraitDataUri, renderCharacterCard } from '../render/card-kit'
import { placeholderThumb } from '../render/placeholder'
import {
  apply as applyCommand,
  calendar as calendarCommand,
  campaign as campaignCommand,
  character as characterCommand,
  feedback as feedbackCommand,
  gold as goldCommand,
  handout as handoutCommand,
  initiative as initiativeCommand,
  recruit as recruitCommand,
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
import {
  APPLY_FIELDS,
  campaignSettingsFields,
  CAMPAIGN_SETUP_FIELDS,
  characterFields,
  FEEDBACK_FIELDS,
  HANDOUT_FIELDS,
  modal,
  modalValues,
  RECRUIT_FIELDS,
} from './modals'

/** Every reply is a card — nothing the bot says goes out as bare text. */
const card = (spec: ContainerSpec, files: AttachedFile[] = []) => ({
  components: [container(spec)],
  flags: MessageFlags.IsComponentsV2 as const,
  allowedMentions: { parse: [] },
  files: files.map((file) => new AttachmentBuilder(file.data, { name: file.name })),
})

/** A card only the person who pressed the button sees. */
const whisper = (spec: ContainerSpec) => ({
  components: [container(spec)],
  flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral] as const,
})

/**
 * Saved portraits as files a thumbnail can point at, keyed by character id. Only portraits on
 * disk: a legacy CDN link expires, and one dead url fails the whole message.
 */
function portraitThumbs(botData: string, characters: Character[]): { files: AttachedFile[]; thumbs: Map<number, string> } {
  const files: AttachedFile[] = []
  const thumbs = new Map<number, string>()
  for (const character of characters) {
    const saved = character.portraitUrl
    if (!saved || !isLocalPortraitPath(saved) || !existsSync(join(botData, saved))) continue
    const name = `portrait-${character.id}${extname(saved)}`
    files.push({ name, data: readFileSync(join(botData, saved)) })
    thumbs.set(character.id, `attachment://${name}`)
  }
  return { files, thumbs }
}

export interface Deps {
  /** DISCORD_OWNER_ID — the bot operator. */
  ownerId: string
  /** BOT_DATA — portraits are saved under `<botData>/portraits/` (see features/character.ts). */
  botData: string
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
  announce: (
    channelId: string,
    spec: ContainerSpec,
    files?: AttachedFile[],
  ) => Promise<{ messageId: string } | undefined>
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
  /** True for a subcommand whose execute calls showModal — the router then skips the defer,
   * since a modal can only be a command's first response. */
  opensModal?: (interaction: ChatInputCommandInteraction) => boolean
  authorize: Authorize
  execute: (interaction: ChatInputCommandInteraction, deps: Deps) => Promise<void>
  autocomplete?: (interaction: AutocompleteInteraction, deps: Deps) => Promise<void>
  /** Buttons/selects whose custom-id namespace is this command's name. */
  component?: (interaction: MessageComponentInteraction, id: CustomId, deps: Deps) => Promise<void>
  /** Modal submits whose custom-id namespace is this command's name. Already deferred
   * ephemerally by the router, so the body edits its reply as an execute would. */
  modal?: (interaction: ModalSubmitInteraction, id: CustomId, deps: Deps) => Promise<void>
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
function requireCampaign(interaction: { channelId: string | null }, deps: Deps): Campaign {
  const campaign = interaction.channelId ? deps.campaigns.byChannel(interaction.channelId) : undefined
  if (!campaign) throw wrongChannel("This isn't a campaign channel.")
  return campaign
}

/** Discord draws this in each reader's own timezone and keeps it counting. Store times are ms. */
const stampR = (ms: number): string => `<t:${Math.floor(ms / 1000)}:R>`

/** Fetches a full GuildMember (not the partial the gateway sometimes hands the interaction)
 * so `.manageable` and `.setNickname` are reliably available. Never throws. */
async function guildMemberOf(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
): Promise<GuildMember | undefined> {
  if (!interaction.guild) return undefined
  return interaction.guild.members.fetch(interaction.user.id).catch(() => undefined)
}

/**
 * Who a Discord member is speaking as: the explicit `character:` option, else the single
 * character they own here. Undefined when they own none, or several and did not say which —
 * `/roll` then rolls under their Discord name, `/initiative` has to ask.
 */
function speakingAs(
  interaction: ChatInputCommandInteraction,
  deps: Deps,
  campaign: Campaign,
): Character | undefined {
  const explicitName = interaction.options.getString('character')
  if (explicitName) {
    const char = deps.characters.byCampaignAndName(campaign.goblinCampaignId, explicitName)
    if (!char) throw notFound(`No character named "${explicitName}" here.`)
    return char
  }
  const mine = deps.characters.byOwner(campaign.goblinCampaignId, interaction.user.id)
  return mine.length === 1 ? mine[0] : undefined
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
      const board = healthBoard({
        botTag: interaction.client.user.tag,
        commit: COMMIT,
        bootAt: BOOT_AT,
        gatewayMs: Math.round(interaction.client.ws.ping),
        commandCount: Object.keys(registry).length,
        guildName: interaction.guild?.name ?? null,
        serverMs: await deps.goblin.ping(),
        serverUrl: deps.goblin.baseUrl,
        seats: deps.campaigns
          .all()
          .map((c) => ({ campaignName: c.name, expiresAt: seatExpiresAt(c.serviceToken) })),
        tables: deps.sessionRunner.health(),
        dbOk,
        rssBytes: process.memoryUsage().rss,
        nodeVersion: process.version,
      })
      await interaction.editReply(card(board))
    },
  },

  campaign: {
    data: campaignCommand,
    ephemeral: true,
    // Every other subcommand is owner-only registration; status is a member-level read.
    authorize: (ctx, deps) => (ctx.subcommand === 'status' ? memberOnly(ctx, deps) : ownerOnly(ctx, deps)),
    opensModal: (interaction) => interaction.options.getSubcommand() !== 'status',
    execute: async (interaction, deps) => {
      const sub = interaction.options.getSubcommand()
      if (sub === 'setup') {
        await interaction.showModal(
          modal(build('campaign', 'setup', interaction.user.id), 'Register a campaign', CAMPAIGN_SETUP_FIELDS),
        )
        return
      }
      if (sub === 'settings') {
        const campaign = requireCampaign(interaction, deps)
        await interaction.showModal(
          modal(
            build('campaign', 'settings', interaction.user.id),
            'Campaign settings',
            campaignSettingsFields(campaign.ddbUrl),
          ),
        )
        return
      }
      if (sub === 'status') return campaignStatusCmd(interaction, deps)
      throw notFound("I don't have that campaign subcommand.")
    },
    // The only control under this namespace is the status card's Share button.
    component: async (interaction, _id, deps) => {
      const { spec, files } = campaignStatusCard(deps, requireCampaign(interaction, deps))
      await shareToChannel(interaction, deps, spec, files)
    },
    modal: async (interaction, id, deps) => {
      if (id.action === 'setup') return campaignSetup(interaction, deps)
      if (id.action === 'settings') return campaignSettings(interaction, deps)
      throw notFound("I don't have that campaign form any more.")
    },
  },

  character: {
    data: characterCommand,
    ephemeral: true,
    authorize: memberOnly,
    opensModal: (interaction) => interaction.options.getSubcommand() !== 'show',
    execute: async (interaction, deps) => {
      const sub = interaction.options.getSubcommand()
      if (sub === 'create') {
        await interaction.showModal(
          modal(build('character', 'create', interaction.user.id), 'New character', characterFields()),
        )
        return
      }
      if (sub === 'update') return openCharacterUpdate(interaction, deps)
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
    // Two controls: the Share button, which carries the character id so the public copy is
    // rendered again rather than copied, and the switch select, which carries the id it picked.
    component: async (interaction, id, deps) => {
      const campaign = requireCampaign(interaction, deps)
      const character = deps.characters.byId(Number(id.action === 'switch' ? selectedValue(interaction) : id.extra[0]))
      // Campaign-checked, not just id-checked: a button from another campaign's channel must
      // not pull that campaign's character into this one.
      if (!character || character.campaignId !== campaign.goblinCampaignId)
        throw notFound('That character is gone.')
      const { spec, files } = await characterShowCard(deps, campaign, character)
      if (id.action === 'switch') {
        // The same private message, a different character — the old picture goes with it.
        const rows = showCharacterRows(deps, campaign, interaction.user.id, character)
        await interaction.update({ ...card({ ...spec, rows }, files), attachments: [] })
        return
      }
      await shareToChannel(interaction, deps, spec, files)
    },
    modal: async (interaction, id, deps) => {
      if (id.action === 'create') return createCharacter(interaction, deps)
      if (id.action === 'update') return updateCharacter(interaction, deps, Number(id.extra[0]))
      throw notFound("I don't have that character form any more.")
    },
  },

  mycharacters: {
    data: mycharactersCommand,
    ephemeral: true,
    authorize: memberOnly,
    execute: async (interaction, deps) => {
      const { spec, files } = myCharactersCard(deps, requireCampaign(interaction, deps), interaction.user.id)
      await interaction.editReply(card({ ...spec, rows: [shareRow('mycharacters', interaction.user.id)] }, files))
    },
    component: async (interaction, id, deps) => {
      const campaign = requireCampaign(interaction, deps)
      // A row's own button: the full card for that one character, still only they can see it.
      if (id.action === 'show') {
        const character = deps.characters.byId(Number(id.extra[0]))
        if (!character || character.campaignId !== campaign.goblinCampaignId) throw notFound('That character is gone.')
        const { spec, files } = await characterShowCard(deps, campaign, character)
        await interaction.reply({ ...card(spec, files), flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral] })
        return
      }
      const { spec, files } = myCharactersCard(deps, campaign, interaction.user.id, interaction.user.displayName)
      await shareToChannel(interaction, deps, spec, files)
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
    component: async (interaction, id, deps) => {
      const campaign = requireCampaign(interaction, deps)
      // The select is owner-stamped to the DM already; proved again here, as the poll's close
      // button does — the stamp is on the id, and the id is on a message anyone can see.
      if (id.action === 'complete') {
        if (interaction.user.id !== campaign.dmDiscordId) throw notAuthorized("Only this campaign's DM can do that.")
        const quest = deps.quests.active(campaign.goblinCampaignId).find((q) => q.id === Number(selectedValue(interaction)))
        if (!quest) throw notFound('That quest is already closed.')
        deps.quests.complete(campaign.goblinCampaignId, quest.title)
        const { spec, files } = questLogCard(deps, campaign)
        const rows = questLogRows(deps, campaign, interaction.user.id)
        await interaction.update({ ...card({ ...spec, rows }, files), attachments: [] })
        return
      }
      const { spec, files } = questLogCard(deps, campaign)
      await shareToChannel(interaction, deps, spec, files)
    },
  },

  note: {
    data: noteCommand,
    ephemeral: true,
    authorize: memberOnly,
    execute: async (interaction, deps) => {
      const campaign = requireCampaign(interaction, deps)
      const text = interaction.options.getString('text', true)
      deps.notes.add(campaign.goblinCampaignId, interaction.user.id, text)
      await interaction.editReply(card(noteSavedReply(text)))
    },
  },

  recall: {
    data: recallCommand,
    ephemeral: true,
    authorize: memberOnly,
    execute: async (interaction, deps) => {
      const query = interaction.options.getString('query', true)
      const { spec, files } = recallCard(deps, requireCampaign(interaction, deps), query)
      await interaction.editReply(card({ ...spec, rows: recallShareRows(interaction.user.id, query) }, files))
    },
    // The only control under this namespace is the results card's Share button, which carries
    // the query — percent-encoded, see recallShareRows — so the public copy is searched again
    // rather than copied.
    component: async (interaction, id, deps) => {
      const { spec, files } = recallCard(deps, requireCampaign(interaction, deps), decodeURIComponent(id.extra[0] ?? ''))
      await shareToChannel(interaction, deps, spec, files)
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

      const char = speakingAs(interaction, deps, campaign)
      const faces = summarizeFaces(result)

      deps.rolls.record({
        campaignId: campaign.goblinCampaignId,
        characterId: char?.id ?? null,
        discordId: interaction.user.id,
        expr,
        total: result.total,
        faces,
        isCrit: result.isCrit,
        isFail: result.isFail,
      })
      if (char) deps.characters.touchLastPlayed([char.id], Date.now())

      // Onto the table's own log, and from there into the session thread — so a player rolling
      // from their phone shows up where everyone else's dice do. Best-effort by design: a
      // campaign with no live table still rolls dice in Discord.
      deps.sessionRunner.command(campaign.goblinCampaignId, 'rolls', 'post', {
        source: 'discord',
        characterName: char && cap(char.name, 60),
        title: 'rolled in Discord',
        formula: cap(expr, 100),
        total: result.total,
        text: cap(faces, 200),
        visibility: 'public',
      })

      const die = placeholderThumb('dice')
      await interaction.editReply(card(rollReply(char?.name ?? interaction.user.username, result, die.url), [die.file]))
    },
    autocomplete: characterAutocomplete,
  },

  initiative: {
    data: initiativeCommand,
    // The number's real home is the table's tracker and the session thread; this is a receipt,
    // and every way it can fail is something only the player needs to read.
    ephemeral: true,
    authorize: memberOnly,
    execute: async (interaction, deps) => {
      const campaign = requireCampaign(interaction, deps)
      const value = interaction.options.getInteger('value', true)
      const entries = deps.sessionRunner.encounter(campaign.goblinCampaignId)?.entries ?? []
      if (entries.length === 0) throw notFound("There's no encounter running at the table right now.")

      // The seat wins when there is one: a claimed token says which combatant is this person's,
      // and no name has to agree with any other name for that to be true.
      const seat = tableIdentityOf(interaction.user.id)
      // A `character:` picked off the autocomplete carries an entry key, which names one
      // combatant and nothing else — so it answers before any name has to agree with a name.
      const chosen = interaction.options.getString('character')
      const entry =
        entries.find((e) => seat !== undefined && e.identityId === seat) ??
        entries.find((e) => e.key === chosen) ??
        namedBy(entries, interaction, deps, campaign)
      if (!deps.sessionRunner.command(campaign.goblinCampaignId, 'initiative', 'set', { key: entry.key, value }))
        throw internal("I couldn't reach the table — say the number out loud and try again.")

      const die = placeholderThumb('dice')
      await interaction.editReply(
        card(
          initiativeReceipt({ campaignName: campaign.name, entry, value, entries, thumb: die.url }),
          [die.file],
        ),
      )
    },
    autocomplete: initiativeAutocomplete,
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
    // The only control under this namespace is the ledger card's Share button.
    component: async (interaction, _id, deps) => {
      const { spec, files } = lootLedgerCard(deps, requireCampaign(interaction, deps))
      await shareToChannel(interaction, deps, spec, files)
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
      const purse = placeholderThumb('purse')
      await deps.announce(campaign.channelId, goldSplitAnnouncement(total, partySize, split, purse.url), [purse.file])
      await interaction.editReply(card(notice(goldSplitConfirmation(total, partySize, split), 'Party purse')))
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
    // The only control under this namespace is the day card's Share button.
    component: async (interaction, _id, deps) => {
      const { spec, files } = calendarCard(deps, requireCampaign(interaction, deps))
      await shareToChannel(interaction, deps, spec, files)
    },
  },

  schedule: {
    data: scheduleCommand,
    ephemeral: true,
    authorize: dmOnly,
    // The next fortnight of evenings, narrowed by whatever is typed; a full date is offered as typed.
    autocomplete: async (interaction) => {
      await interaction.respond(slotSuggestions(interaction.options.getFocused(), Date.now()))
    },
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
      const glass = placeholderThumb('schedule')
      const sent = await deps.announce(
        campaign.channelId,
        {
          ...pollAnnouncement(campaign.name, campaign.roleId, options, glass.url),
          rows: [scheduleVoteRow(poll.id, options), scheduleCloseRow(poll.id, campaign.dmDiscordId)],
        },
        [glass.file],
      )
      if (sent) deps.schedulePolls.setMessageRef(poll.id, campaign.channelId, sent.messageId)
      await interaction.editReply(card(notice(pollCreatedConfirmation(), 'Session poll')))
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
        await interaction.reply(whisper(notice(voteConfirmation(updated, interaction.user.id), 'Session poll')))
        return
      }

      if (id.action === 'close') {
        // Belt and suspenders: the button is owner-stamped to the DM already (the router
        // rejects anyone else before this runs), but the handler proves it again per plan §11.
        if (interaction.user.id !== campaign.dmDiscordId) throw notAuthorized("Only this campaign's DM can do that.")
        const closed = deps.schedulePolls.close(poll.id)
        const winner = winningOption(closed)
        if (winner) deps.campaigns.setNextSession(campaign.goblinCampaignId, parseCandidateDate(winner.label))
        const glass = placeholderThumb('schedule')
        await deps.announce(campaign.channelId, pollResultAnnouncement(winner, glass.url), [glass.file])
        await interaction.reply(whisper(notice('Poll closed.', 'Session poll')))
      }
    },
  },

  session: {
    data: sessionCommand,
    ephemeral: true,
    authorize: dmOnly,
    execute: async (interaction, deps) => {
      // Both halves open a socket that lives as long as the table does, so the runner is handed
      // seats that will outlast the evening.
      const campaign = await freshSeats(requireCampaign(interaction, deps), deps)
      const sub = interaction.options.getSubcommand()
      if (sub === 'start') {
        const { joinLink } = await deps.sessionRunner.start(
          campaign,
          interaction.options.getString('scene') ?? undefined,
        )
        await interaction.editReply(card(sessionStartedReply(joinLink, campaign.channelId)))
        return
      }
      if (sub === 'end') {
        await interaction.editReply(card(sessionEndedReply(await deps.sessionRunner.end(campaign), campaign.channelId)))
        return
      }
      throw notFound("I don't have that session subcommand.")
    },
    autocomplete: sceneAutocomplete,
  },

  handout: {
    data: handoutCommand,
    ephemeral: true,
    authorize: dmOnly,
    opensModal: () => true,
    execute: async (interaction) => {
      await interaction.showModal(
        modal(build('handout', 'send', interaction.user.id), 'Hand something to the party', HANDOUT_FIELDS),
      )
    },
    modal: async (interaction, _id, deps) => sendHandout(interaction, deps),
  },

  recruit: {
    data: recruitCommand,
    ephemeral: true,
    authorize: dmOnly,
    opensModal: (interaction) => interaction.options.getSubcommand() === 'open',
    execute: async (interaction, deps) => {
      const sub = interaction.options.getSubcommand()
      if (sub === 'open') {
        await interaction.showModal(
          modal(build('recruit', 'open', interaction.user.id), 'Recruit for this table', RECRUIT_FIELDS),
        )
        return
      }
      if (sub === 'close') return recruitClose(interaction, deps)
      throw notFound("I don't have that recruit subcommand.")
    },
    modal: async (interaction, id, deps) => {
      if (id.action === 'open') return recruitOpen(interaction, deps)
      throw notFound("I don't have that recruiting form any more.")
    },
  },

  apply: {
    data: applyCommand,
    ephemeral: true,
    authorize: everyone,
    opensModal: () => true,
    execute: async (interaction) => {
      await interaction.showModal(applyModal(interaction.user.id, interaction.options.getString('campaign', true)))
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
    // The board's Apply button opens the same form the slash command does — it just already
    // knows which campaign, so that id travels on through the modal's own custom id.
    component: async (interaction, id) => {
      await interaction.showModal(applyModal(interaction.user.id, id.extra[0] ?? ''))
    },
    modal: async (interaction, id, deps) => {
      const draft = readApplicationDraft(modalValues(interaction, APPLY_FIELDS))
      const campaign = await submitApplication(deps, id.extra[0], interaction.user, draft)
      await interaction.editReply(card(notice(applyConfirmation(campaign.name), 'Application sent')))
    },
  },

  feedback: {
    data: feedbackCommand,
    ephemeral: true,
    authorize: memberOnly,
    opensModal: () => true,
    execute: async (interaction) => {
      await interaction.showModal(
        modal(build('feedback', 'send', interaction.user.id), 'Tell the DM', FEEDBACK_FIELDS),
      )
    },
    modal: async (interaction, _id, deps) => {
      const campaign = requireCampaign(interaction, deps)
      const { text, category } = readFeedbackDraft(modalValues(interaction, FEEDBACK_FIELDS))
      // No discord_id stored anywhere (plan §7) — the category is about the message, not who sent it.
      const entry = deps.feedback.add(campaign.goblinCampaignId, text, category)
      // The seal, not the party banner: the one thing this card must not carry is a campaign
      // face anyone could read an author off.
      const seal = placeholderThumb('handout')
      await deps.announce(
        campaign.dmChannelId,
        feedbackCard(campaign.name, text, entry.createdAt, seal.url, category),
        [seal.file],
      )
      await interaction.editReply(card(notice(feedbackThanks(), 'Feedback')))
    },
  },
}

/** One form for `/apply` and the board button alike. The campaign id rides in the custom id
 * because the applicant never types it — the slash option or the button already said it. */
function applyModal(userId: string, campaignId: string): ModalBuilder {
  if (!campaignId) throw notFound("That campaign isn't recruiting.")
  return modal(build('apply', 'submit', userId, campaignId), 'Apply for a seat', APPLY_FIELDS)
}

/** Every character in the campaign, for the commands that take a `character:` — anyone may
 * roll or answer initiative for a party member who is away from their phone. */
async function characterAutocomplete(interaction: AutocompleteInteraction, deps: Deps): Promise<void> {
  const campaign = deps.campaigns.byChannel(interaction.channelId)
  if (!campaign) return interaction.respond([])
  const names = filterAutocomplete(
    deps.characters.byCampaign(campaign.goblinCampaignId).map((c) => c.name),
    interaction.options.getFocused(),
  )
  await interaction.respond(names.map((name) => ({ name, value: name })))
}

/** `/initiative` picks a combatant, not a character: while an encounter runs its own roster
 * comes first (value = the entry key, which is exact), then the campaign's characters as
 * everywhere else. Same-named entries are told apart by their key, the only handle the bot
 * has for them until a seat carries a Discord id. */
async function initiativeAutocomplete(interaction: AutocompleteInteraction, deps: Deps): Promise<void> {
  const campaign = deps.campaigns.byChannel(interaction.channelId)
  if (!campaign) return interaction.respond([])
  const query = interaction.options.getFocused()
  const entries = deps.sessionRunner.encounter(campaign.goblinCampaignId)?.entries ?? []
  const seen = new Map<string, number>()
  for (const e of entries) seen.set(e.name.toLowerCase(), (seen.get(e.name.toLowerCase()) ?? 0) + 1)
  const combatants = entries
    .filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
    .map((e) => ({ name: (seen.get(e.name.toLowerCase()) ?? 0) > 1 ? `${e.name} (${e.key})` : e.name, value: e.key }))
  const characters = filterAutocomplete(
    deps.characters.byCampaign(campaign.goblinCampaignId).map((c) => c.name),
    query,
  ).map((name) => ({ name, value: name }))
  await interaction.respond([...combatants, ...characters].slice(0, 25))
}

/** The rolls module rejects an over-cap string outright rather than trimming it, so anything
 * the bot forwards is cut to fit here — a long roll is worth showing shortened, not losing. */
const cap = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

/**
 * The table identity a Discord member holds, if any — the seam `/initiative` prefers over a
 * name match, because a claimed combatant is a fact and a matching name is a guess.
 *
 * ponytail: always undefined. Binding a Discord id to a table seat is a protocol change (the
 * id travels on the seat, or a bind command sets it) plus a client affordance — its own
 * workstream, not part of finishing the commands. Ceiling until then: the bot can only ask,
 * so same-named combatants are answered by picking a key off the autocomplete rather than
 * resolved for the player. When the seat carries the id, this becomes that lookup and returns
 * the seat's `identityId`; nothing else here changes.
 */
function tableIdentityOf(_discordId: string): string | undefined {
  return undefined
}

/** The combatant whose name is the member's character's. Throws saying which of the three
 * ways it failed — mid-fight, "no match" is not something a player can act on. */
function namedBy(
  entries: WireInitiativeEntry[],
  interaction: ChatInputCommandInteraction,
  deps: Deps,
  campaign: Campaign,
): WireInitiativeEntry {
  const char = speakingAs(interaction, deps, campaign)
  if (!char) {
    const mine = deps.characters.byOwner(campaign.goblinCampaignId, interaction.user.id)
    throw userInput(
      mine.length > 1
        ? `You have ${mine.length} characters here — add \`character:\` to say which one rolled.`
        : "You don't have a character in this campaign — make one with `/character create`.",
    )
  }
  const matches = entries.filter((e) => e.name.toLowerCase() === char.name.toLowerCase())
  if (matches.length === 0) throw notFound(`${char.name} isn't in this encounter — ask the DM to add them.`)
  // Two "Bob"s and no seat to tell them apart: guessing puts a number on the wrong row mid-fight,
  // so ask instead — the autocomplete lists them by key for exactly this.
  if (matches.length > 1)
    throw userInput(
      `${matches.length} combatants are named ${char.name}. Pick one with the \`character\` option.`,
    )
  return matches[0]
}

/** The scene library lives on the game server, not in the bot DB — the one autocomplete that
 * goes over the wire. A failure here is an empty list (see interaction-router.ts). */
async function sceneAutocomplete(interaction: AutocompleteInteraction, deps: Deps): Promise<void> {
  const registered = deps.campaigns.byChannel(interaction.channelId)
  if (!registered) return interaction.respond([])
  const campaign = await freshSeats(registered, deps)
  if (!campaign.serviceToken) return interaction.respond([])
  const query = interaction.options.getFocused().toLowerCase()
  const scenes = await deps.goblin.getScenes(campaign.serviceToken, campaign.goblinCampaignId)
  await interaction.respond(
    scenes
      .filter((scene) => scene.name.toLowerCase().includes(query))
      .slice(0, 25)
      .map((scene) => ({ name: scene.name, value: scene.id })),
  )
}

const NO_TOKEN = 'This campaign has no game-server seat yet — the DM needs to run `/campaign setup` again.'

async function sendHandout(interaction: ModalSubmitInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const uploads = [...(interaction.fields.getUploadedFiles('files')?.values() ?? [])]
  const draft = readHandoutDraft(modalValues(interaction, HANDOUT_FIELDS), uploads.length > 0)

  const files: AttachedFile[] = []
  const imageNames: string[] = []
  const fileNames: string[] = []
  const add = (name: string, data: Buffer, mime: string | null | undefined): void => {
    // Ten uploads can scrub down to the same name, and a gallery pointing twice at one
    // attachment name shows one picture twice and loses the other.
    let unique = name
    while (files.some((file) => file.name === unique)) unique = `_${unique}`
    files.push({ name: unique, data })
    ;(isImage(mime) ? imageNames : fileNames).push(unique)
  }

  if (draft.assetId) {
    // Only the asset branch talks to the server, so only it pays for a seat check.
    const token = (await freshSeats(campaign, deps)).serviceToken
    if (!token) throw userInput(NO_TOKEN)
    const asset = await deps.goblin.getAsset(token, draft.assetId)
    add(assetFileName(draft.assetId, asset.mime), asset.bytes, asset.mime)
  }
  for (const upload of uploads) {
    // Re-uploaded rather than linked: a Discord CDN url is signed and expires, and a handout
    // that 404s a month later is worse than no handout.
    const data = await fetchAttachment(upload.url)
    if (!data) throw userInput(`I couldn't fetch "${upload.name}" — try attaching it again.`)
    add(safeFileName(upload.name), data, upload.contentType)
  }

  // The seal rides along with the handout's own files: a thumbnail pointing at an attachment
  // this message doesn't carry renders as a broken image. An upload named like the seal would
  // take its place, so the seal steps aside until its name is its own.
  const seal = placeholderThumb('handout')
  let sealName = seal.file.name
  while (files.some((file) => file.name === sealName)) sealName = `_${sealName}`

  await deps.announce(
    campaign.channelId,
    handoutPost({
      campaignName: campaign.name,
      dmDiscordId: campaign.dmDiscordId,
      title: draft.title,
      note: draft.note,
      imageNames,
      fileNames,
      thumb: `attachment://${sealName}`,
      spoiler: draft.spoiler,
    }),
    [...files, { name: sealName, data: seal.file.data }],
  )
  await interaction.editReply(card(handoutConfirmation(campaign.channelId)))
}

async function createCharacter(interaction: ModalSubmitInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const draft = readCharacterDraft(modalValues(interaction, characterFields()))
  const portrait = interaction.fields.getUploadedFiles('portrait')?.first()
  // Downloaded and validated before the row exists: a bad upload (network failure, wrong
  // content-type, too large) must fail the submit with no character created — not create one
  // with a portrait link that never resolves.
  const download = portrait ? await downloadPortrait(portrait.url) : undefined

  const character = deps.characters.create({
    discordId: interaction.user.id,
    campaignId: campaign.goblinCampaignId,
    name: draft.name,
    className: draft.className,
    level: draft.level,
    portraitUrl: null,
  })

  if (download) {
    character.portraitUrl = writePortraitFile(deps.botData, character.id, download.bytes, download.ext)
    deps.characters.update(character.id, { portraitUrl: character.portraitUrl })
  }

  const member = await guildMemberOf(interaction)
  if (member) await trySyncNickname(member, character.name)

  // The card render rides along on a best-effort basis: the character row is already
  // committed, so a render/portrait hiccup degrades to the text confirmation.
  try {
    const portraitDataUri = await fetchPortraitDataUri(deps.botData, character.portraitUrl)
    const png = await renderCharacterCard({
      name: character.name,
      className: character.className,
      level: character.level,
      campaignName: campaign.name,
      portraitDataUri,
    })
    await interaction.editReply(
      card(
        {
          eyebrow: `New character · ${campaign.name}`,
          header: character.name,
          subhead: characterSubhead(character),
          noPing: true,
          blocks: [characterCreatedReply(character)],
          media: [{ url: 'attachment://character.png', alt: characterCardAlt(character) }],
          footer: '`/character show` · `/character update`',
        },
        [{ name: 'character.png', data: png }],
      ),
    )
  } catch {
    await interaction.editReply(card(notice(characterCreatedReply(character), 'New character')))
  }
}

/** `/character update` picks the character off the autocomplete, then opens the create form
 * filled in — so the same four fields do the rename, the level bump and the new portrait. */
async function openCharacterUpdate(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const currentName = interaction.options.getString('name', true)
  const existing = deps.characters.byCampaignAndName(campaign.goblinCampaignId, currentName)
  if (!existing) throw notFound(`No character named "${currentName}" here.`)
  if (existing.discordId !== interaction.user.id) throw notAuthorized("That's not your character.")
  await interaction.showModal(
    modal(
      // The id travels in the custom id: the name in the form is the *new* one, so it cannot
      // also be what finds the row.
      build('character', 'update', interaction.user.id, String(existing.id)),
      cap(`Update ${existing.name}`, 45),
      characterFields(existing),
    ),
  )
}

async function updateCharacter(interaction: ModalSubmitInteraction, deps: Deps, characterId: number): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const existing = deps.characters.byId(characterId)
  // Campaign-checked as well as id-checked, as the share button is: a form opened elsewhere
  // must not reach into this campaign's roster.
  if (!existing || existing.campaignId !== campaign.goblinCampaignId) throw notFound('That character is gone.')
  if (existing.discordId !== interaction.user.id) throw notAuthorized("That's not your character.")

  const draft = readCharacterDraft(modalValues(interaction, characterFields()))
  const portrait = interaction.fields.getUploadedFiles('portrait')?.first()
  // Downloaded before anything is patched — a bad upload leaves the existing row untouched.
  const download = portrait ? await downloadPortrait(portrait.url) : undefined

  const patch: CharacterPatch = { name: draft.name, className: draft.className, level: draft.level }
  if (download) patch.portraitUrl = writePortraitFile(deps.botData, existing.id, download.bytes, download.ext)
  const rename = draft.name !== existing.name

  const updated = deps.characters.update(existing.id, patch)

  // Best-effort cleanup of the file the new portrait replaced — skipped when the new file
  // overwrote the old one in place (same character id, same extension).
  if (download && existing.portraitUrl && existing.portraitUrl !== updated.portraitUrl) {
    deleteLocalPortrait(deps.botData, existing.portraitUrl)
  }

  if (rename) {
    const member = await guildMemberOf(interaction)
    if (member) await trySyncNickname(member, updated.name)
  }
  if (leveledUp(existing.level, draft.level)) {
    const { files, thumbs } = portraitThumbs(deps.botData, [updated])
    // The blank tile stands in for a character with no portrait saved, and rides along as this
    // message's own attachment — a thumbnail may only point at a file on the message it is on.
    const blank = placeholderThumb('character')
    const portrait = thumbs.get(updated.id)
    await deps.announce(
      campaign.channelId,
      levelUpAnnouncement(updated, portrait ?? blank.url),
      portrait ? files : [...files, blank.file],
    )
  }

  await interaction.editReply(card(notice(characterUpdatedReply(updated), 'Character updated')))
}

async function showCharacter(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const name = interaction.options.getString('name', true)
  const character = deps.characters.byCampaignAndName(campaign.goblinCampaignId, name)
  if (!character) throw notFound(`No character named "${name}" here.`)

  const { spec, files } = await characterShowCard(deps, campaign, character)
  await interaction.editReply(card({ ...spec, rows: showCharacterRows(deps, campaign, interaction.user.id, character) }, files))
}

/** The Share button, and — for someone who keeps more than one character here — a select that
 * swaps this same private card to another of theirs. Their own characters only: the card is
 * readable for anyone in the campaign, but "switch" means switch between yours. */
function showCharacterRows(
  deps: Deps,
  campaign: Campaign,
  userId: string,
  character: Character,
): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const mine = deps.characters.byOwner(campaign.goblinCampaignId, userId)
  const share = shareRow('character', userId, String(character.id))
  if (mine.length < 2) return [share]
  const select = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(build('character', 'switch', userId))
      .setPlaceholder('Show another of your characters')
      .addOptions(
        mine.slice(0, 25).map((c) => ({
          label: `${c.name}`.slice(0, 100),
          description: `${c.className} · Level ${c.level}`.slice(0, 100),
          value: String(c.id),
          default: c.id === character.id,
        })),
      ),
  )
  return [select, share]
}

async function questsLog(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const { spec, files } = questLogCard(deps, campaign)
  await interaction.editReply(card({ ...spec, rows: questLogRows(deps, campaign, interaction.user.id) }, files))
}

/** The Share button, and — for the DM alone — a select that closes one of the open quests
 * without retyping its title. Owner-stamped to them, so the router turns anyone else away
 * before the handler runs; a player's copy of the card simply has no select on it. */
function questLogRows(deps: Deps, campaign: Campaign, userId: string): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const share = shareRow('quests', userId)
  const open = userId === campaign.dmDiscordId ? deps.quests.active(campaign.goblinCampaignId) : []
  if (open.length === 0) return [share]
  // The id, not the title: an option value is capped at 100 characters and a quest title is not.
  const select = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(build('quests', 'complete', userId))
      .setPlaceholder('Mark complete')
      .addOptions(open.slice(0, 25).map((quest) => ({ label: quest.title.slice(0, 100), value: String(quest.id) }))),
  )
  return [select, share]
}

async function questsAdd(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const title = interaction.options.getString('title', true)
  const quest = deps.quests.add(campaign.goblinCampaignId, title, interaction.user.id)
  await interaction.editReply(card(notice(questAddedReply(quest), 'Quest log')))
}

async function questsComplete(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const title = interaction.options.getString('title', true)
  const quest = deps.quests.complete(campaign.goblinCampaignId, title)
  await interaction.editReply(card(notice(questCompletedReply(quest), 'Quest log')))
}

async function lootAdd(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const item = interaction.options.getString('item', true)
  const note = interaction.options.getString('note')
  deps.ledger.add({ campaignId: campaign.goblinCampaignId, kind: 'item', item, actor: interaction.user.id, note })
  await interaction.editReply(card(notice(lootAddedReply(item, note), 'Party purse')))
}

async function lootList(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const { spec, files } = lootLedgerCard(deps, requireCampaign(interaction, deps))
  await interaction.editReply(card({ ...spec, rows: [shareRow('loot', interaction.user.id)] }, files))
}

async function calendarShowCmd(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const { spec, files } = calendarCard(deps, requireCampaign(interaction, deps))
  await interaction.editReply(card({ ...spec, rows: [shareRow('calendar', interaction.user.id)] }, files))
}

async function calendarSet(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const day = interaction.options.getInteger('day', true)
  const epoch = interaction.options.getString('epoch')
  const state = deps.calendar.set(campaign.goblinCampaignId, day, epoch ?? undefined)
  await interaction.editReply(card(notice(calendarSetConfirmation(state), 'World calendar')))
}

async function calendarAdvance(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const days = interaction.options.getInteger('days', true)
  const state = deps.calendar.advance(campaign.goblinCampaignId, days)
  const page = placeholderThumb('calendar')
  await deps.announce(campaign.channelId, calendarAdvanceAnnouncement(state, days, page.url), [page.file])
  await interaction.editReply(card(notice(calendarSetConfirmation(state), 'World calendar')))
}

/** Only a real D&D Beyond address is kept: the link is shown to the whole party as-is. */
function readDdbUrl(raw: string | null): string | null {
  if (!raw) return null
  const url = URL.canParse(raw.trim()) ? new URL(raw.trim()) : undefined
  if (url?.protocol !== 'https:' || !/(^|\.)dndbeyond\.com$/.test(url.hostname))
    throw userInput('That D&D Beyond link should look like https://www.dndbeyond.com/campaigns/1234567.')
  return url.toString()
}

async function campaignSetup(interaction: ModalSubmitInteraction, deps: Deps): Promise<void> {
  const values = modalValues(interaction, CAMPAIGN_SETUP_FIELDS)
  const draft = readCampaignDraft(values)
  // Role and the D&D Beyond link are `/campaign settings` — five labels is a modal's cap, and
  // these five are the ones nothing routes without. Re-running setup keeps the role already
  // set; a brand-new campaign starts on @everyone, whose id is the guild's, so it is open to
  // the server until the settings form narrows it.
  const existing = deps.campaigns.byId(draft.goblinCampaignId)
  const campaign = deps.campaigns.upsert({
    goblinCampaignId: draft.goblinCampaignId,
    name: draft.name,
    channelId: values.channel,
    dmChannelId: values.dmChannel,
    dmDiscordId: values.dm,
    roleId: existing?.roleId ?? interaction.guildId ?? '',
  })

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

  const banner = placeholderThumb('campaign')
  await interaction.editReply(card(campaignSetupConfirmation(campaign, banner.url), [banner.file]))
}

/** The half `/campaign setup` had to leave behind. Same upsert, same read-back card — only
 * the headline differs, because nothing is being registered here. */
async function campaignSettings(interaction: ModalSubmitInteraction, deps: Deps): Promise<void> {
  const current = requireCampaign(interaction, deps)
  const values = modalValues(interaction, campaignSettingsFields())
  const campaign = deps.campaigns.upsert({
    goblinCampaignId: current.goblinCampaignId,
    name: current.name,
    channelId: current.channelId,
    dmChannelId: current.dmChannelId,
    dmDiscordId: current.dmDiscordId,
    roleId: values.role || current.roleId,
    // A blank link keeps the stored one (the upsert coalesces) rather than clearing it.
    ddbUrl: readDdbUrl(values.dndbeyond),
  })
  const banner = placeholderThumb('campaign')
  await interaction.editReply(
    card(campaignSetupConfirmation(campaign, banner.url, `${campaign.name} is set`), [banner.file]),
  )
}

/** A card and the files its thumbnails point at — built once for the private reply, and again
 * (fresh, not copied) when its owner shares it. */
interface BuiltCard {
  spec: ContainerSpec
  files: AttachedFile[]
}

function campaignStatusCard(deps: Deps, campaign: Campaign): BuiltCard {
  const banner = placeholderThumb('campaign')
  const spec = campaignStatus({
    campaign,
    characters: deps.characters.byCampaign(campaign.goblinCampaignId),
    sessionStats: deps.sessions.stats(campaign.goblinCampaignId),
    table: deps.sessionRunner.health().find((row) => row.campaignId === campaign.goblinCampaignId),
    thumb: banner.url,
  })
  return { spec, files: [banner.file] }
}

function questLogCard(deps: Deps, campaign: Campaign): BuiltCard {
  const scroll = placeholderThumb('quest')
  return {
    spec: questLog(campaign.name, deps.quests.byCampaign(campaign.goblinCampaignId), scroll.url),
    files: [scroll.file],
  }
}

function recallCard(deps: Deps, campaign: Campaign, query: string): BuiltCard {
  const book = placeholderThumb('journal')
  const matches = deps.notes.search(campaign.goblinCampaignId, sanitizeFtsQuery(query))
  return { spec: recallResults(campaign.name, query, matches, book.url), files: [book.file] }
}

function lootLedgerCard(deps: Deps, campaign: Campaign): BuiltCard {
  const purse = placeholderThumb('purse')
  const spec = lootLedger(
    campaign.name,
    deps.ledger.goldTotal(campaign.goblinCampaignId),
    deps.ledger.recent(campaign.goblinCampaignId),
    purse.url,
  )
  return { spec, files: [purse.file] }
}

function calendarCard(deps: Deps, campaign: Campaign): BuiltCard {
  const page = placeholderThumb('calendar')
  return { spec: calendarShow(deps.calendar.get(campaign.goblinCampaignId), campaign.name, page.url), files: [page.file] }
}

const characterCardAlt = (character: Character): string =>
  `${character.name}, ${character.className} level ${character.level}`

/** Re-rendered rather than copied when shared: the picture a card points at must be that
 * message's own attachment, and the public copy is its own message. */
async function characterShowCard(deps: Deps, campaign: Campaign, character: Character): Promise<BuiltCard> {
  const portraitDataUri = await fetchPortraitDataUri(deps.botData, character.portraitUrl)
  const png = await renderCharacterCard({
    name: character.name,
    className: character.className,
    level: character.level,
    campaignName: campaign.name,
    lastPlayed: character.lastPlayed ?? undefined,
    portraitDataUri,
  })
  return {
    spec: {
      eyebrow: campaign.name,
      header: character.name,
      subhead: characterSubhead(character),
      noPing: true,
      media: [{ url: 'attachment://character.png', alt: characterCardAlt(character) }],
      footer: character.lastPlayed ? `Last at the table ${stampR(character.lastPlayed)}` : 'Yet to sit at the table',
    },
    files: [{ name: 'character.png', data: png }],
  }
}

function myCharactersCard(deps: Deps, campaign: Campaign, userId: string, ownerName?: string): BuiltCard {
  const mine = deps.characters.byOwner(campaign.goblinCampaignId, userId)
  // The private card spends each row's one accessory slot on a button, so it needs no portrait
  // attachments at all; the shared copy, which nobody else may press, keeps the pictures.
  if (!ownerName) {
    const showId = (c: Character): string => build('mycharacters', 'show', userId, String(c.id))
    return { spec: myCharactersList(campaign.name, mine, undefined, undefined, undefined, showId), files: [] }
  }
  const { files, thumbs } = portraitThumbs(deps.botData, mine.slice(0, 8))
  const blank = placeholderThumb('character')
  const needsBlank = mine.slice(0, 8).some((c) => !thumbs.has(c.id))
  return {
    spec: myCharactersList(campaign.name, mine, thumbs, blank.url, ownerName),
    files: needsBlank ? [...files, blank.file] : files,
  }
}

/** The button under a private card. Owner-stamped: only the person who asked can share it.
 * `extra` is whatever the share handler needs to rebuild the card (see recallShareRows). */
function shareRow(namespace: string, userId: string, ...extra: string[]): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(build(namespace, 'share', userId, ...extra)).setLabel('Share to channel').setStyle(ButtonStyle.Secondary),
  )
}

/** /recall's button carries the query itself — the search runs again when it is pressed. Ids
 * are split on `:` and capped at 100 chars, so the query is percent-encoded (which escapes the
 * separator as %3A) and decoded again in the handler. Only the cap is left: a query too long to
 * encode into 100 chars gets no button at all, and a missing button beats a send Discord
 * rejects. */
function recallShareRows(userId: string, query: string): ActionRowBuilder<ButtonBuilder>[] {
  try {
    return [shareRow('recall', userId, encodeURIComponent(query))]
  } catch {
    return []
  }
}

/**
 * Posts a freshly built card to the channel the button was pressed in, says who shared it, and
 * swaps the private card for a one-line receipt so the button cannot be pressed twice. The
 * public card names people without notifying them.
 */
async function shareToChannel(
  interaction: MessageComponentInteraction,
  deps: Deps,
  spec: ContainerSpec,
  files: AttachedFile[],
): Promise<void> {
  const sent = await deps.announce(
    interaction.channelId,
    { ...spec, noPing: true, footer: [spec.footer, `Shared by <@${interaction.user.id}>`].filter(Boolean).join(' · ') },
    files,
  )
  if (!sent) throw internal("I can't post in this channel.")
  await interaction.update({ ...whisperless(notice('Shared to the channel.', 'Shared')), attachments: [] })
}

/** The one option a select carried. `component` is handed the whole component union, so the
 * narrowing lives here rather than in every handler that put a select on a card. */
function selectedValue(interaction: MessageComponentInteraction): string {
  const value = interaction.isStringSelectMenu() ? interaction.values[0] : undefined
  if (!value) throw userInput('Nothing was picked — try that again.')
  return value
}

/** A card for `interaction.update`, which keeps the message's ephemeral flag on its own. */
const whisperless = (spec: ContainerSpec) => ({ components: [container(spec)], flags: MessageFlags.IsComponentsV2 as const })

async function campaignStatusCmd(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const { spec, files } = campaignStatusCard(deps, requireCampaign(interaction, deps))
  await interaction.editReply(card({ ...spec, rows: [shareRow('campaign', interaction.user.id)] }, files))
}

/** One button per candidate date, numbered to match the card's list — a label can't carry a
 * Discord timestamp, so the number is what ties a button to the evening above it. Anyone may
 * click (shared owner-stamp); the schedule component handler checks campaign membership itself. */
function scheduleVoteRow(pollId: number, options: string[]): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>()
  options.forEach((label, index) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(build('schedule', 'vote', SHARED_OWNER, String(pollId), String(index)))
        .setLabel(`${index + 1}. ${label}`.slice(0, 80))
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

async function recruitOpen(interaction: ModalSubmitInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  const draft = readRecruitDraft(modalValues(interaction, RECRUIT_FIELDS))
  const applyRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(build('apply', 'apply', SHARED_OWNER, campaign.goblinCampaignId))
      .setLabel('Apply')
      .setStyle(ButtonStyle.Primary),
  )
  const banner = placeholderThumb('campaign')
  const sent = await deps.announce(
    deps.lfgChannelId,
    { ...lfgBoardPost(campaign, draft.blurb, banner.url, draft.seats, draft.tags), rows: [applyRow] },
    [banner.file],
  )
  deps.lfgPosts.create(
    campaign.goblinCampaignId,
    draft.blurb,
    deps.lfgChannelId,
    sent?.messageId ?? '',
    draft.seats,
    draft.tags,
  )
  await interaction.editReply(card(notice(lfgOpenConfirmation(campaign.name), 'Recruiting')))
}

async function recruitClose(interaction: ChatInputCommandInteraction, deps: Deps): Promise<void> {
  const campaign = requireCampaign(interaction, deps)
  deps.lfgPosts.close(campaign.goblinCampaignId)
  // "Replaces the board post" (plan §11 M4): a fresh closed-notice supersedes the open one
  // rather than editing it in place — announce only ever posts, matching every other CBAC seam.
  // Being its own message, it carries its own copy of the banner: the board's attachment is
  // the board's, and a thumbnail may only point at a file on the same message.
  const banner = placeholderThumb('campaign')
  await deps.announce(deps.lfgChannelId, lfgClosedNotice(campaign.name, banner.url), [banner.file])
  await interaction.editReply(card(notice(lfgCloseConfirmation(campaign.name), 'Recruiting')))
}

/** The one submit both routes into /apply reach — the slash form and the board button open
 * the same modal. Throws user_input if the campaign isn't (or is no longer) recruiting,
 * not_found if it doesn't exist at all. */
async function submitApplication(
  deps: Deps,
  campaignId: string,
  applicant: { id: string; displayAvatarURL: (options?: { size?: 128 }) => string },
  draft: ApplicationDraft,
): Promise<Campaign> {
  const campaign = deps.campaigns.byId(campaignId)
  if (!campaign) throw notFound("That campaign isn't recruiting.")
  if (!deps.lfgPosts.openForCampaign(campaignId)) throw userInput("That campaign isn't recruiting right now.")
  const application = deps.lfgApplications.add(
    campaignId,
    applicant.id,
    draft.message,
    draft.experience,
    draft.availability,
  )
  await deps.announce(
    campaign.dmChannelId,
    applicationCard(
      campaign.name,
      campaign.dmDiscordId,
      applicant.id,
      draft.message,
      application.createdAt,
      applicant.displayAvatarURL({ size: 128 }),
      draft.experience,
      draft.availability,
    ),
  )
  return campaign
}
