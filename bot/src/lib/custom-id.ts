// Component ids are namespaced and owner-stamped: `map:refresh:<userId>[:extra...]`.
// The router rejects a click whose stamp is not the clicker, so one player cannot drive
// another player's buttons.

/** Discord's hard cap on custom_id. Overflowing it fails at send time, in production. */
export const MAX_CUSTOM_ID = 100

/** Owner-stamp sentinel for a control the whole party may click (poll votes, LFG apply).
 * The router skips the owner check for this stamp; the component handler is responsible
 * for its own auth (campaign membership, DM identity, etc). Everything else keeps the
 * strict "only the stamped user" default. */
export const SHARED_OWNER = '*'

export interface CustomId {
  namespace: string
  action: string
  userId: string
  extra: string[]
}

/** Builds an owner-stamped id. Throws rather than shipping one Discord will reject. */
export function build(namespace: string, action: string, userId: string, ...extra: string[]): string {
  const parts = [namespace, action, userId, ...extra]
  for (const part of parts) {
    if (part === '') throw new Error('custom id parts must be non-empty')
    if (part.includes(':')) throw new Error(`custom id part contains the separator: ${part}`)
  }
  const id = parts.join(':')
  if (id.length > MAX_CUSTOM_ID) throw new Error(`custom id is ${id.length} chars, max ${MAX_CUSTOM_ID}`)
  return id
}

/** Parses an id built by `build`. Returns undefined for anything else. */
export function parse(id: string): CustomId | undefined {
  const [namespace, action, userId, ...extra] = id.split(':')
  if (!namespace || !action || !userId) return undefined
  return { namespace, action, userId, extra }
}
