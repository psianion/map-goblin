// Nickname sync: on character create/rename, nick becomes `Name (Player)`. Never fails the
// command over this — a missing permission or an out-ranked bot just logs a warn and moves on.

import type { GuildMember } from 'discord.js'
import { log as defaultLog } from '../lib/log'

const MAX_NICKNAME = 32
const SUFFIX = ' (Player)'

/** Pure: truncates the character name, not the suffix, to fit Discord's 32-char cap. */
export function nicknameFor(characterName: string): string {
  const budget = MAX_NICKNAME - SUFFIX.length
  const name = characterName.length > budget ? characterName.slice(0, budget) : characterName
  return `${name}${SUFFIX}`
}

/** The subset of GuildMember this needs — real members satisfy it; tests pass a plain object. */
export interface NicknameTarget {
  id: string
  manageable: boolean
  setNickname: (nick: string) => Promise<unknown>
}

/**
 * Never throws. `member.manageable` is discord.js's own hierarchy/permission check (outranks
 * the bot, missing Manage Nicknames, etc.) — reused rather than re-derived from role positions.
 */
export async function trySyncNickname(
  member: NicknameTarget | GuildMember,
  characterName: string,
  log: Pick<typeof defaultLog, 'warn'> = defaultLog,
): Promise<void> {
  if (!member.manageable) {
    log.warn('nickname sync skipped: not manageable', { member: member.id })
    return
  }
  try {
    await member.setNickname(nicknameFor(characterName))
  } catch (err) {
    log.warn('nickname sync failed', { member: member.id, error: String(err) })
  }
}
