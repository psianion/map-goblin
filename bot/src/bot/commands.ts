// Pure declarations — no handlers, no side effects. sync-commands.ts and the registry both
// read these, so what is deployed and what is dispatched cannot drift.

import { InteractionContextType, SlashCommandBuilder } from 'discord.js'

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

// A command that opens a modal declares no options for what the form asks — the fields carry
// their own labels and descriptions (see bot/modals.ts). The exceptions are the two options
// that pick *which* thing the form is about, and those are autocompletes a modal cannot be:
// `/character update name` and `/apply campaign`.

export const campaign = guildOnly(
  new SlashCommandBuilder()
    .setName('campaign')
    .setDescription('Campaign administration')
    .addSubcommand((sub) => sub.setName('setup').setDescription('Register a goblin campaign to this guild'))
    .addSubcommand((sub) =>
      sub.setName('settings').setDescription('Set the member role and the D&D Beyond link'),
    )
    .addSubcommand((sub) => sub.setName('status').setDescription('Show the campaign status board')),
)

export const character = guildOnly(
  new SlashCommandBuilder()
    .setName('character')
    .setDescription('Manage your characters')
    .addSubcommand((sub) => sub.setName('create').setDescription('Create a character in this campaign'))
    .addSubcommand((sub) =>
      sub
        .setName('update')
        .setDescription('Update one of your characters')
        .addStringOption((o) =>
          o.setName('name').setDescription('Character name').setRequired(true).setAutocomplete(true),
        ),
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

export const quests = guildOnly(
  new SlashCommandBuilder()
    .setName('quests')
    .setDescription('The campaign quest log')
    .addSubcommand((sub) => sub.setName('log').setDescription('Show the quest log'))
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a quest (DM only)')
        .addStringOption((o) => o.setName('title').setDescription('Quest title').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('complete')
        .setDescription('Mark a quest done (DM only)')
        .addStringOption((o) =>
          o.setName('title').setDescription('Quest title').setRequired(true).setAutocomplete(true),
        ),
    ),
)

export const note = guildOnly(
  new SlashCommandBuilder()
    .setName('note')
    .setDescription('Save a party journal note')
    .addStringOption((o) => o.setName('text').setDescription('Note text').setRequired(true).setMaxLength(1000)),
)

export const recall = guildOnly(
  new SlashCommandBuilder()
    .setName('recall')
    .setDescription('Search the party journal')
    .addStringOption((o) => o.setName('query').setDescription('Search text').setRequired(true)),
)

export const roll = guildOnly(
  new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll dice, e.g. 2d6+3')
    .addStringOption((o) => o.setName('expr').setDescription('Roll expression').setRequired(true))
    .addStringOption((o) =>
      o.setName('character').setDescription('Roll as this character').setRequired(false).setAutocomplete(true),
    ),
)

/** The bounds are the initiative module's own (INITIATIVE_MIN/MAX), so a number Discord accepts
 * is a number the table accepts — the refusal happens in the client, not two hops away. */
export const initiative = guildOnly(
  new SlashCommandBuilder()
    .setName('initiative')
    .setDescription('Send your initiative roll to the table')
    .addIntegerOption((o) =>
      o.setName('value').setDescription('What you rolled').setMinValue(-99).setMaxValue(999).setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('character').setDescription('Which combatant').setRequired(false).setAutocomplete(true),
    ),
)

export const loot = guildOnly(
  new SlashCommandBuilder()
    .setName('loot')
    .setDescription('Party loot')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Log an item pickup')
        .addStringOption((o) => o.setName('item').setDescription('Item name').setRequired(true))
        .addStringOption((o) => o.setName('note').setDescription('Note').setRequired(false)),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Show gold total and recent entries')),
)

export const gold = guildOnly(
  new SlashCommandBuilder()
    .setName('gold')
    .setDescription('Party gold')
    .addSubcommand((sub) =>
      sub
        .setName('split')
        .setDescription('Split gold evenly across the party (DM only)')
        .addIntegerOption((o) => o.setName('total').setDescription('Total gold').setMinValue(1).setRequired(true)),
    ),
)

export const schedule = guildOnly(
  new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Poll the party for the next session time (DM only)')
    .addStringOption((o) => o.setName('option1').setDescription('Pick a slot or type one, e.g. sat 8pm').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('option2').setDescription('Second slot').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('option3').setDescription('Third slot').setRequired(false).setAutocomplete(true))
    .addStringOption((o) => o.setName('option4').setDescription('Fourth slot').setRequired(false).setAutocomplete(true)),
)

export const session = guildOnly(
  new SlashCommandBuilder()
    .setName('session')
    .setDescription('Run the table (DM only)')
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Open the table and post the live board')
        .addStringOption((o) =>
          o.setName('scene').setDescription('Scene to open on').setRequired(false).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('end').setDescription('Close the table and post the recap')),
)

export const handout = guildOnly(
  new SlashCommandBuilder()
    .setName('handout')
    .setDescription('Share an image, file or note with the players (DM only)'),
)

export const recruit = guildOnly(
  new SlashCommandBuilder()
    .setName('recruit')
    .setDescription('Recruit for this campaign (DM only)')
    .addSubcommand((sub) => sub.setName('open').setDescription('Post this campaign to the recruiting board'))
    .addSubcommand((sub) => sub.setName('close').setDescription('Take this campaign off the recruiting board')),
)

/** The campaign stays a slash option: it is an autocomplete over what is recruiting right
 * now, which a modal field cannot be. Everything the applicant types is in the form. */
export const apply = guildOnly(
  new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Apply to a recruiting campaign')
    .addStringOption((o) =>
      o.setName('campaign').setDescription('Campaign to apply to').setRequired(true).setAutocomplete(true),
    ),
)

export const feedback = guildOnly(
  new SlashCommandBuilder().setName('feedback').setDescription('Send anonymous session feedback to the DM'),
)

export const calendar = guildOnly(
  new SlashCommandBuilder()
    .setName('calendar')
    .setDescription('The in-game calendar')
    .addSubcommand((sub) => sub.setName('show').setDescription('Show the current day'))
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set the day (DM only)')
        .addIntegerOption((o) => o.setName('day').setDescription('Day number').setMinValue(0).setRequired(true))
        .addStringOption((o) => o.setName('epoch').setDescription('Epoch label').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('advance')
        .setDescription('Advance the day (DM only)')
        .addIntegerOption((o) => o.setName('days').setDescription('Days to advance').setRequired(true)),
    ),
)
