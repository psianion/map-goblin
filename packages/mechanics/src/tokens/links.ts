// Sight links (S3 P4 §4) — the one place that answers "whose eyes is the party looking
// through", so the three server call sites and the client's own mask cannot drift into four
// ideas of it.
//
// A link is a symmetric edge between two placed tokens (`Token.sharesSightWith`, maintained
// by `tokens set-sight-link`). The party's sight sources are then the *transitive closure* of
// the seed tokens over those edges: an unclaimed familiar linked to a claimed scout is looking
// for the party, and so is anything the familiar is itself linked to.

import type { Token } from './types'

/** The default seed: a claimed token is a player at the table (D7). */
export const claimed = (token: Token): boolean => token.ownerId !== null

/**
 * The tokens whose sight the party owns: `isSeed` widened along `sharesSightWith`.
 *
 * Hidden tokens are excluded outright, and that is deliberate on both halves — a token the DM
 * has taken off the board neither contributes its own sweep nor passes a link through itself.
 * Hidden trumps links, so hiding the familiar closes the link the same way removing it would.
 *
 * Callers keep their own extra filter (a sight range, a room) — this answers *whose* eyes,
 * never *what* they can see with them.
 *
 * ponytail: a fresh BFS per call, O(tokens + links) over one scene's record (≤ 500 tokens,
 * `SCENE_TOKENS_MAX`). It is called once per mutation beside a shadowcast that costs orders
 * more; memoize it on the token record's identity the day one shows up in a profile.
 */
export function sightParty(
  tokens: readonly Token[],
  isSeed: (token: Token) => boolean = claimed,
): Token[] {
  const byId = new Map<string, Token>()
  for (const token of tokens) if (!token.hidden) byId.set(token.id, token)

  const queue = [...byId.values()].filter(isSeed)
  const found = new Set(queue.map((token) => token.id))
  const party: Token[] = []
  for (let i = 0; i < queue.length; i++) {
    const token = queue[i]
    party.push(token)
    for (const id of token.sharesSightWith ?? []) {
      const linked = byId.get(id)
      if (!linked || found.has(id)) continue
      found.add(id)
      queue.push(linked)
    }
  }
  return party
}

/** The same closure as a set of ids — what a redactor asks ("is this token one of mine"). */
export const sightPartyIds = (
  tokens: readonly Token[],
  isSeed?: (token: Token) => boolean,
): Set<string> => new Set(sightParty(tokens, isSeed).map((token) => token.id))
