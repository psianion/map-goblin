// Pure reply formatting for `/campaign setup`. The upsert itself is one store call in
// command-registry.ts — nothing here touches the DB or discord.js.

import type { CampaignInput } from '../db/stores'

export function campaignSetupConfirmation(campaign: CampaignInput): string {
  return [
    `**${campaign.name}** (\`${campaign.goblinCampaignId}\`) is registered.`,
    `Player channel: <#${campaign.channelId}>`,
    `DM channel: <#${campaign.dmChannelId}>`,
    `Role: <@&${campaign.roleId}>`,
    `DM: <@${campaign.dmDiscordId}>`,
  ].join('\n')
}
