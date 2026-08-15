// Token shapes (§2.2). Two levels: a campaign-scoped library of defs (D12) and the
// scene-scoped instances placed from them (D5). An instance copies the def's fields at
// place time and keeps `defId` only as provenance, so deleting a def never orphans a
// token that is already on the table.

import type { Viewer } from '../contract'
import type { BlockedEdge } from '../doors/types'

export type TokenSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan'

/** Width in grid cells — 1 world unit == 1 cell (D13). */
export const SIZE_CELLS: Record<TokenSize, number> = {
  tiny: 0.5,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4,
}

export type Disposition = 'friendly' | 'neutral' | 'hostile'

/** Library entry (campaign-scoped). */
export interface TokenDef {
  id: string
  /** ≤ 60 chars. */
  name: string
  imageAssetId: string | null
  size: TokenSize
  disposition: Disposition
  /** Schema only until S3 fog/vision lands. */
  sight: { range: number; angle: number; visionMode: 'normal' | 'darkvision' } | null
  /** Schema only until S3. */
  light: { dim: number; bright: number; color: string; angle: number } | null
}

/** Placed instance (scene-scoped). */
export interface Token extends TokenDef {
  /** Provenance; the def's fields are already copied onto the instance. */
  defId: string | null
  /** World units == grid cells. */
  x: number
  y: number
  elevation: number
  /** Draw order within the token overlay. */
  z: number
  /** DM-only visibility — redacted out of every non-DM view (D4). */
  hidden: boolean
  /** identityId of the claiming player. */
  ownerId: string | null
  /**
   * S3 P4 §4 — the other tokens in this scene whose sight is shared with this one. Symmetric
   * and maintained by `set-sight-link` on both ends; absent ≡ no links. Scene-scoped, so it
   * lives on the instance and never on the def a token was placed from.
   */
  sharesSightWith?: string[]
}

export interface TokensState {
  library: Record<string, TokenDef>
  byScene: Record<string, Record<string, Token>>
}

/**
 * What the fog rules say about one scene (S3 D3/D6/D8). The sets are the server's — it
 * owns the map geometry and the fog/door state, computes these once per mutation and
 * caches them; this module only asks. Room membership is decided by the point, so a token
 * straddling a boundary belongs to whichever room holds its centre.
 */
export interface SceneVision {
  /** The room whose polygon contains the point; `null` outside every room (D6). */
  roomAt(x: number, y: number): string | null
  /** Rooms the player role may see right now (D3). */
  readonly visible: ReadonlySet<string>
  /** Rooms a player token may stand in (D8): reachable, and not never-revealed. */
  readonly occupiable: ReadonlySet<string>
  /**
   * Which door shut `room` off from the party, when one did — `fog/visibility`'s
   * `blockedEdge`, which the reachability BFS is in a position to answer and the
   * `occupiable` boolean throws away.
   *
   * Optional because a caller that has not wired it still gets a correct refusal, just a
   * coarser one: without it a blocked room reports as `MOVE_BLOCKED` rather than naming
   * the locked door.
   */
  blockedEdge?(room: string): BlockedEdge | null
  /**
   * S3 P1 — token vision, at point resolution: is this spot inside the party's live sight
   * (range + line of sight through walls and closed doors)?
   *
   * Present only when the scene's fog is in `'vision'` mode; the server builds it from the
   * same sweep union it renders with. Absent — every `'rooms'`-mode scene, which is the
   * default — leaves the room-granular rule below exactly as it was.
   */
  canSee?(x: number, y: number): boolean
}

/**
 * Why a space refused a token, as a stable prefix on the refusal message.
 *
 * The wire's `code` is `invalid-command` for every rejection, so — exactly as the doors
 * module already does with `door-locked` — the discriminator is a constant at the head of
 * the text. The sentence after it still reads as English and still contains "cannot be
 * occupied", which is what the shipped client gates on, so an old client keeps working and
 * a new one can match the prefix.
 */
export const MOVE_BLOCKED = 'move-blocked'
export const ROOM_UNEXPLORED = 'room-unexplored'
export const OUTSIDE_MAP = 'outside-map'

/**
 * `null` = that scene's map authors no rooms. Fog is room-granular, so a map nobody zoned
 * has no fog and hides nothing — the S2 behaviour, which is also the default when no
 * lookup is wired at all.
 *
 * S3 P5 — the seam is viewer-aware, because `visionShare: 'individual'` makes "what can be
 * seen" a different answer per seat: `redact` passes the viewer it is redacting for and gets
 * that seat's own `canSee` back. Optional, and omitting it asks the party question — which is
 * what the *command* callers want (`canOccupy` is party-global, D8) and what every party-share
 * table answers anyway.
 */
export type VisionOf = (sceneId: string, viewer?: Viewer) => SceneVision | null
