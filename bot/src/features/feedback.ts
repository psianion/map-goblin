// Pure model for /feedback (plan §11 M4 / §7). No discord.js import — command-registry.ts
// wires this to the feedback store, which has no discord_id column at all.

import type { ContainerSpec } from '../lib/ui'

export function feedbackCard(campaignName: string, text: string): ContainerSpec {
  return { header: `Anonymous feedback — ${campaignName}`, blocks: [text] }
}

export function feedbackThanks(): string {
  return 'Thanks — sent anonymously to the DM.'
}
