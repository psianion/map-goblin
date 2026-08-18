// Pure declarations — no handlers, no side effects. sync-commands.ts and the registry both
// read these, so what is deployed and what is dispatched cannot drift.

import { InteractionContextType, SlashCommandBuilder } from 'discord.js'

/**
 * Guild-scoped only (plan §6): no global registration path exists, so the bot cannot be
 * accidentally exposed to another guild.
 */
function guildOnly(builder: SlashCommandBuilder): SlashCommandBuilder {
  return builder.setContexts(InteractionContextType.Guild)
}

export const ping = guildOnly(
  new SlashCommandBuilder().setName('ping').setDescription('Check gateway latency and database health'),
)
