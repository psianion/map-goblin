// Token shapes (§2.2). Two levels: a campaign-scoped library of defs (D12) and the
// scene-scoped instances placed from them (D5). An instance copies the def's fields at
// place time and keeps `defId` only as provenance, so deleting a def never orphans a
// token that is already on the table.

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
}

/**
 * `null` = that scene's map authors no rooms. Fog is room-granular, so a map nobody zoned
 * has no fog and hides nothing — the S2 behaviour, which is also the default when no
 * lookup is wired at all.
 */
export type VisionOf = (sceneId: string) => SceneVision | null
