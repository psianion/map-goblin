// Pure model -> container mapping for characters (plan §8's model/builder split) plus the
// autocomplete filter. No discord.js import here — command-registry.ts wires this to Discord.

import type { Character } from '../db/stores'
import type { ContainerSpec } from '../lib/ui'

/** Whether an update crossed a level up — the trigger for the player-channel announce. */
export function leveledUp(oldLevel: number, newLevel: number): boolean {
  return newLevel > oldLevel
}

export function levelUpAnnouncement(character: Character): ContainerSpec {
  return {
    header: `${character.name} reached level ${character.level}!`,
    blocks: [`${character.className}, now level **${character.level}**.`],
  }
}

export function myCharactersList(campaignName: string, characters: Character[]): ContainerSpec {
  if (characters.length === 0) {
    return { header: `Your characters — ${campaignName}`, blocks: ["You haven't created a character here yet."] }
  }
  return {
    header: `Your characters — ${campaignName}`,
    blocks: [characters.map((c) => `**${c.name}** — ${c.className} ${c.level}`).join('\n')],
  }
}

export function characterCreatedReply(character: Character): string {
  return `**${character.name}** created — ${character.className} ${character.level}.`
}

export function characterUpdatedReply(character: Character): string {
  return `Updated **${character.name}** — ${character.className} ${character.level}.`
}

/** Discord caps autocomplete choices at 25. Case-insensitive "contains" over an empty query. */
export function filterAutocomplete(names: string[], query: string): string[] {
  const q = query.toLowerCase()
  return names.filter((name) => name.toLowerCase().includes(q)).slice(0, 25)
}
