// Pure model/reply formatting for the LFG board + /apply (plan §11 M4). No discord.js
// import — command-registry.ts wires this to the lfg_posts/lfg_applications stores.

import type { ContainerSpec } from '../lib/ui'

export function lfgBoardPost(campaignName: string, blurb: string): ContainerSpec {
  return { header: `${campaignName} is recruiting!`, blocks: [blurb] }
}

export function lfgClosedNotice(campaignName: string): ContainerSpec {
  return { header: `${campaignName} is no longer recruiting`, blocks: ['Applications are closed for now.'] }
}

export function applicationCard(
  campaignName: string,
  dmDiscordId: string,
  applicantId: string,
  message: string | null,
): ContainerSpec {
  return {
    header: `New application — ${campaignName}`,
    blocks: [`<@${dmDiscordId}>`, message ? `<@${applicantId}> applied:\n${message}` : `<@${applicantId}> applied.`],
  }
}

export function applyConfirmation(campaignName: string): string {
  return `Application sent to **${campaignName}**'s DM.`
}

export function lfgOpenConfirmation(campaignName: string): string {
  return `**${campaignName}** is now recruiting in the LFG channel.`
}

export function lfgCloseConfirmation(campaignName: string): string {
  return `**${campaignName}** is no longer recruiting.`
}
