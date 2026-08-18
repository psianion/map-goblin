// Pure reply formatting for `/campaign setup`. The upsert itself is one store call in
// command-registry.ts — nothing here touches the DB or discord.js.

import type { CampaignInput } from '../db/stores'

/** The registration landed; the game-server token mint did not (plan §11 M5). Says so
 * plainly, because the fix is to run the same command again — not to undo anything. */
export function campaignSetupTokenFailure(campaign: CampaignInput): string {
  return [
    `**${campaign.name}** is registered, but I couldn't get service tokens from the game server.`,
    'Everything else is saved — run `/campaign setup` again with the same options once the server is reachable.',
  ].join('\n')
}

export function campaignSetupConfirmation(campaign: CampaignInput): string {
  return [
    `**${campaign.name}** (\`${campaign.goblinCampaignId}\`) is registered.`,
    `Player channel: <#${campaign.channelId}>`,
    `DM channel: <#${campaign.dmChannelId}>`,
    `Role: <@&${campaign.roleId}>`,
    `DM: <@${campaign.dmDiscordId}>`,
  ].join('\n')
}
