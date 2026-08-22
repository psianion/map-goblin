// Pure model -> container mapping for the quest log (plan §11 M3). No discord.js import —
// command-registry.ts wires this to the quests store.

import type { Quest } from '../db/stores'
import type { ContainerSpec } from '../lib/ui'

export function questLog(campaignName: string, quests: Quest[]): ContainerSpec {
  const active = quests.filter((q) => q.status === 'active')
  const done = quests.filter((q) => q.status === 'done')
  const blocks: string[] = []
  blocks.push(active.length ? active.map((q) => `• ${q.title}`).join('\n') : 'No active quests.')
  if (done.length) blocks.push(done.map((q) => `~~${q.title}~~`).join('\n'))
  return { header: `Quest log — ${campaignName}`, blocks }
}

export function questAddedReply(quest: Quest): string {
  return `Added quest **${quest.title}**.`
}

export function questCompletedReply(quest: Quest): string {
  return `Completed **${quest.title}**.`
}
