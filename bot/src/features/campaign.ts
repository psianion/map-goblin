// Pure reply formatting for `/campaign setup`. The upsert itself is one store call in
// command-registry.ts — nothing here touches the DB or discord.js.

import type { CampaignInput } from '../db/stores'
import { userInput } from '../lib/errors'
import { type ContainerSpec } from '../lib/card'

/** Long enough for a campaign name, short enough to head a card. */
export const MAX_CAMPAIGN_NAME = 60

/** The two typed fields of the `/campaign setup` modal, checked at the trust boundary. The id
 * ends up inside an owner-stamped custom id, where `:` is the separator and 100 characters is
 * the whole budget — so its shape is settled here rather than at the send that would fail. */
export function readCampaignDraft(fields: Record<string, string>): { name: string; goblinCampaignId: string } {
  const name = (fields.name ?? '').trim()
  const goblinCampaignId = (fields.id ?? '').trim()
  if (!name) throw userInput('A campaign needs a name.')
  if (name.length > MAX_CAMPAIGN_NAME)
    throw userInput(`That name is ${name.length} characters — keep it to ${MAX_CAMPAIGN_NAME}.`)
  if (!/^[^\s:]{1,60}$/.test(goblinCampaignId))
    throw userInput(
      `"${goblinCampaignId}" isn't a game-server campaign id — it looks like 18358431-cfeb-46c8-b72b-9a9ac33f0eb8.`,
    )
  return { name, goblinCampaignId }
}

/** The registration landed; the game-server token mint did not (plan §11 M5). Says so
 * plainly, because the fix is to run the same command again — not to undo anything. */
export function campaignSetupTokenFailure(campaign: CampaignInput): string {
  return [
    `**${campaign.name}** is registered, but I couldn't get service tokens from the game server.`,
    'Everything else is saved — run `/campaign setup` again with the same options once the server is reachable.',
  ].join('\n')
}

/** The registration, read back — one labelled line per thing the bot will now route by, so
 * a typo in the wrong channel is visible before anyone plays on it. */
export function campaignSetupConfirmation(campaign: CampaignInput, thumb?: string, headline?: string): ContainerSpec {
  return {
    eyebrow: 'Campaign',
    header: headline ?? `${campaign.name} is registered`,
    subhead: `Game server id · \`${campaign.goblinCampaignId}\``,
    ...(thumb ? { thumb, thumbAlt: 'Campaign banner' } : {}),
    blocks: [
      [
        '### Where it lives',
        `**Players** · <#${campaign.channelId}>`,
        `**DM only** · <#${campaign.dmChannelId}>`,
        `**Role** · <@&${campaign.roleId}>`,
        `**DM** · <@${campaign.dmDiscordId}>`,
        ...(campaign.ddbUrl ? [`**D&D Beyond** · [the campaign page](${campaign.ddbUrl})`] : []),
      ].join('\n'),
    ],
    footer: '`/campaign settings` · `/campaign status` · `/session start`',
  }
}
