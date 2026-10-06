// Game-server seats expire. The server mints every token with a 7-day life (TOKEN_TTL_MS in
// session/server/src/auth.ts) and `/campaign setup` mints the bot's pair exactly once, so a
// campaign registered last week has two dead seats and every server-facing command comes back
// 401 — which the DM reads as "internal error" and can do nothing about.
//
// So nothing reads campaign.serviceToken / campaign.playerToken for a server call directly:
// it goes through freshSeats() first.

import type { Campaign, Campaigns } from '../db/stores'
import type { GoblinRest } from './rest'

/** Re-mint this far ahead of expiry, so a seat cannot die in the middle of a table. */
export const SEAT_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000

/**
 * When this seat stops working, epoch ms — 0 for anything unreadable, which counts as expired.
 * The server signs `base64url(claims).base64url(hmac)`, so a token that does not decode is
 * either from an older build or not a token at all, and re-minting answers both.
 *
 * The signature is deliberately not checked: only the server holds the secret, and it is the
 * one that decides. This is a "should I bother asking" test, not an authorization one.
 */
export function seatExpiresAt(token: string | null | undefined): number {
  const payload = (token ?? '').split('.')[0]
  if (!payload) return 0
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }
    return typeof claims.exp === 'number' ? claims.exp : 0
  } catch {
    return 0
  }
}

export interface SeatDeps {
  goblin: GoblinRest
  /** GOBLIN_ADMIN_PASS — the one credential that mints service tokens. */
  goblinAdminPass: string
  campaigns: Campaigns
}

/**
 * The campaign, holding seats that will still be alive a day from now. Seats that are already
 * fresh are handed straight back — no server call — so this can sit in front of every command
 * that talks to the game server.
 */
export async function freshSeats(campaign: Campaign, deps: SeatDeps): Promise<Campaign> {
  const deadline = Date.now() + SEAT_REFRESH_MARGIN_MS
  if (seatExpiresAt(campaign.serviceToken) > deadline && seatExpiresAt(campaign.playerToken) > deadline)
    return campaign
  // Both seats, whichever one was due: they were minted together, they expire together, and
  // one round trip saved is not worth two code paths.
  //
  // ponytail: no in-flight de-dup — two commands in the same second both mint, and the second
  // write wins. Costs one extra pair of round trips a week; add a per-campaign promise cache
  // here if the server's logs ever show it mattering.
  const [dm, player] = await Promise.all([
    deps.goblin.mintServiceToken(deps.goblinAdminPass, campaign.goblinCampaignId, 'dm'),
    deps.goblin.mintServiceToken(deps.goblinAdminPass, campaign.goblinCampaignId, 'player'),
  ])
  return deps.campaigns.setTokens(campaign.goblinCampaignId, dm.token, player.token)
}
