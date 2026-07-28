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
