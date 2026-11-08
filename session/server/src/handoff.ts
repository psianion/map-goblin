// Decision 13: the canvas hands the DM to the table without the token ever riding in a URL.
// The canvas asks for a code with its DM token; the table redeems the code, once, for a
// token of its own. Only the code's hash is kept, in this process, for a minute.

import { createHash, randomBytes } from 'node:crypto'

/** How long a minted code waits to be redeemed: the time it takes a new tab to load. */
export const HANDOFF_TTL_MS = 60_000

export interface Handoff {
  campaignId: string
  identityId: string
  /** Expiry, epoch ms. */
  exp: number
}

export interface HandoffStore {
  /** A fresh 32-byte code for this DM seat; the plaintext is returned and never stored. */
  mint(campaignId: string, identityId: string, now?: number): string
  /** The handoff a live code names, consumed on the way out; null for anything else. */
  redeem(code: string, now?: number): Handoff | null
}

const hash = (code: string): string => createHash('sha256').update(code).digest('hex')

export function createHandoffStore(ttlMs = HANDOFF_TTL_MS): HandoffStore {
  const pending = new Map<string, Handoff>()
  const sweep = (now: number) => {
    for (const [key, entry] of pending) if (entry.exp <= now) pending.delete(key)
  }
  return {
    mint(campaignId, identityId, now = Date.now()) {
      sweep(now)
      const code = randomBytes(32).toString('base64url')
      pending.set(hash(code), { campaignId, identityId, exp: now + ttlMs })
      return code
    },
    redeem(code, now = Date.now()) {
      const key = hash(code)
      const entry = pending.get(key)
      // Single use: a code is gone after its first redeem, whether it was still live or not.
      pending.delete(key)
      if (!entry || entry.exp <= now) return null
      return entry
    },
  }
}
