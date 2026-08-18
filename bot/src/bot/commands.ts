// Pure declarations — no handlers, no side effects. sync-commands.ts and the registry both
// read these, so what is deployed and what is dispatched cannot drift.

import { ChannelType, InteractionContextType, SlashCommandBuilder } from 'discord.js'

/**
 * Guild-scoped only (plan §6): no global registration path exists, so the bot cannot be
 * accidentally exposed to another guild. Generic because a builder with subcommands attached
 * is a different type (SlashCommandSubcommandsOnlyBuilder) than a bare SlashCommandBuilder.
 */
function guildOnly<T extends { setContexts: (...contexts: InteractionContextType[]) => T }>(builder: T): T {
  return builder.setContexts(InteractionContextType.Guild)
}

export const ping = guildOnly(
  new SlashCommandBuilder().setName('ping').setDescription('Check gateway latency and database health'),
)

const LEVEL_MIN = 1
const LEVEL_MAX = 20

export const campaign = guildOnly(
  new SlashCommandBuilder()
    .setName('campaign')
    .setDescription('Campaign administration')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Register a goblin campaign to this guild')
        .addStringOption((o) => o.setName('id').setDescription('Goblin campaign id').setRequired(true))
        .addStringOption((o) => o.setName('name').setDescription('Campaign name').setRequired(true))
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Player channel')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addChannelOption((o) =>
          o
            .setName('dm-channel')
            .setDescription('DM-only channel')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addRoleOption((o) => o.setName('role').setDescription('Campaign member role').setRequired(true))
        .addUserOption((o) => o.setName('dm').setDescription('The DM').setRequired(true)),
    ),
)

export const character = guildOnly(
  new SlashCommandBuilder()
    .setName('character')
    .setDescription('Manage your characters')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a character in this campaign')
        .addStringOption((o) => o.setName('name').setDescription('Character name').setRequired(true))
        .addStringOption((o) => o.setName('class').setDescription('Class').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('level').setDescription('Level').setMinValue(LEVEL_MIN).setMaxValue(LEVEL_MAX).setRequired(true),
        )
        .addAttachmentOption((o) => o.setName('portrait').setDescription('Portrait image').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('update')
        .setDescription('Update one of your characters')
        .addStringOption((o) =>
          o.setName('name').setDescription('Character name').setRequired(true).setAutocomplete(true),
        )
        .addStringOption((o) => o.setName('class').setDescription('New class').setRequired(false))
        .addIntegerOption((o) =>
          o.setName('level').setDescription('New level').setMinValue(LEVEL_MIN).setMaxValue(LEVEL_MAX).setRequired(false),
        )
        .addAttachmentOption((o) => o.setName('portrait').setDescription('New portrait').setRequired(false))
        .addStringOption((o) => o.setName('rename').setDescription('New name').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('show')
        .setDescription('Show a character card')
        .addStringOption((o) =>
          o.setName('name').setDescription('Character name').setRequired(true).setAutocomplete(true),
        ),
    ),
)

export const mycharacters = guildOnly(
  new SlashCommandBuilder().setName('mycharacters').setDescription('List your characters in this campaign'),
)
