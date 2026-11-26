// Token shapes (§2.2). Two levels: a campaign-scoped library of defs (D12) and the
// scene-scoped instances placed from them (D5). An instance copies the def's fields at
// place time and keeps `defId` only as provenance, so deleting a def never orphans a
// token that is already on the table.

import type { Viewer } from '../contract'

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

/** Table v2: what a token stands for. A `pc` belongs to a seat; npc and monster to the DM. */
export type TokenKind = 'pc' | 'npc' | 'monster'
/** When a token's name shows on the map. */
export type Nameplate = 'hover' | 'always' | 'never'
/** Who is sent a token's hit points: the DM alone, the DM and the owner, or everyone. */
export type HpVisibility = 'dm' | 'owner' | 'all'

/** A timed effect (Bless, Hold Person): ticks down once per round, dropped at zero. */
export interface TokenEffect {
  name: string
  roundsLeft: number
}

/** Library entry (campaign-scoped). */
export interface TokenDef {
  id: string
  /** ≤ 60 chars. */
  name: string
  imageAssetId: string | null
  size: TokenSize
  disposition: Disposition
  /**
   * Null is a token that is not looking at anything. `range` is how far this token's line of
   * sight is swept; unlit ground within it is seen only with `visionMode: 'darkvision'`.
   * `angle` is schema only — cones are a v1 non-goal.
   */
  sight: { range: number; angle: number; visionMode: 'normal' | 'darkvision' } | null
  /** Schema only until S3. */
  light: { dim: number; bright: number; color: string; angle: number } | null
  /**
   * Pack-sourced art (PR3 of the prep layer): resolved client-side from the installed
   * pack's atlas. Wins over `imageAssetId` when both are somehow present. Optional so
   * every row written before it existed reads unchanged.
   */
  packAsset?: { packId: string; assetId: string }
  /*
   * Table v2 (plan 4.3). Every field below is optional on the type so a row written before
   * them reads unchanged; `normalizeTokenDef` fills the defaults, and every write through
   * `parseDefFields` stores them.
   */
  /** Default `npc`. */
  kind?: TokenKind
  /** Absent = no hit points tracked. `current` is clamped to `0..max`. */
  hp?: { current: number; max: number }
  ac?: number
  /** Feet per round. */
  speed?: number
  /** Passive Perception, for the Character sheet (board 5). */
  passive?: number
  /** Default `hover`. */
  nameplate?: Nameplate
  /** Default `dm`. */
  showHp?: HpVisibility
  /** Members of the initiative module's CONDITIONS, each at most once. Default none. */
  conditions?: string[]
  /** Default none. */
  effects?: TokenEffect[]
  /** A PC def's player: placing the def hands the token to this seat. */
  ownerIdentityId?: string
  /** The player's name, so a rejoin under the same name re-attaches the PC (plan 4.3). */
  ownerName?: string
  /** The token's ring: `#rrggbb`, or `none` for no ring. Absent draws the disposition ring. */
  ring?: string
}

/** Placed instance (scene-scoped). */
export interface Token extends TokenDef {
  /** Provenance; the def's fields are already copied onto the instance. */
  defId: string | null
  /** World units == grid cells. */
  x: number
  y: number
  /**
   * Height above the map's ground, in cells (1 world unit == 1 cell, D13): the plateau, pit,
   * stairs or ramp the token stands on, set by the server on every place and move.
   */
  elevation: number
  /** The DM set `elevation` by hand on the token card: moves leave it alone until unpinned. */
  elevationPinned?: boolean
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
  /**
   * The player's D&D Beyond character sheet, captured off a Beyond20 payload and linked by
   * player confirmation (never silent auto-bind). Display/link data only — untrusted, never
   * re-derived from or used for anything but showing a name and a link. Scene-scoped like the
   * rest of the instance: a sheet is claimed once per placed token, never on the def.
   */
  sheet?: { name: string; id?: string; url?: string; avatar?: string }
  /**
   * The map level the token stands on (`set-token-level`). Absent = the map's first level.
   * A seat sees the level its token stands on, and only the tokens on that level.
   */
  levelId?: string
}

/** Where the party appears when the table starts: a rectangle of cells, corners inclusive. */
export interface PartyStartArea {
  x0: number
  y0: number
  x1: number
  y1: number
  levelId?: string
}

export interface TokensState {
  library: Record<string, TokenDef>
  byScene: Record<string, Record<string, Token>>
  /** The DM's party start area per scene. Absent on rows written before it; never sent to players. */
  partyStart?: Record<string, PartyStartArea>
}

/** Why a player's character command was refused, at the head of the message. */
export const PC_TAKEN = 'pc-taken'
export const PC_ALREADY_OWNED = 'pc-already-owned'
export const PLAYER_PCS_OFF = 'player-pcs-off'
export const NO_OWN_PC = 'no-own-pc'

/**
 * What the fog rules say about one scene (S3 D3/D6/D8). The sets are the server's — it
 * owns the map geometry and the fog/door state, computes these once per mutation and
 * caches them; this module only asks. Room membership is decided by the point, so a token
 * straddling a boundary belongs to whichever room holds its centre.
 */
export interface SceneVision {
  /** The room whose polygon contains the point; `null` outside every room (D6). */
  roomAt(x: number, y: number): string | null
  /**
   * Table fix pass §2.3 — solid things decide. Why a player's token may not stand at `to`, or
   * walk there from `from` (null = a place, no walk), on the walk grid of its level; null when
   * it may. Present wherever the scene has a map frame; it is the whole move rule there, the
   * straight-line crossing test included.
   */
  walkRefusal?(token: Token, to: { x: number; y: number }, from: { x: number; y: number } | null): string | null
  /**
   * Fog rework — is this spot ground the players have, on this level (absent = the map's first)?
   * With fog off it answers true everywhere; on, only for cleared cells. It is the whole of the
   * token rule (a token is sent when it stands on known ground, or is the seat's own) and the
   * move rule where the scene has no walk grid.
   */
  known(levelId: string | undefined, x: number, y: number): boolean
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
/** The spot is ground, but rock or a wall fills the cell. */
export const SOLID_GROUND = 'solid-ground'

/** Internal: the server clears every effect timer on a scene when its encounter ends. */
export const CLEAR_EFFECTS = 'clear-effects'

/**
 * `null` = no map to judge the scene by, which hides nothing — also the default when no
 * lookup is wired at all. `redact` passes the viewer it is redacting for; the command
 * callers omit it.
 */
export type VisionOf = (sceneId: string, viewer?: Viewer) => SceneVision | null

/**
 * Which tokens a seat's level shows: a predicate over a token's `levelId`, or null when the
 * scene has one level (or no map), which shows every token. The server answers it from the
 * seat's viewed level (`viewedLevel`, triggers).
 */
/**
 * The ground a scene's tokens stand on (plateaus, plan §7): how high a point is, and whether a
 * straight move from one point to another crosses a raised edge whose crossing kind refuses
 * it. The server answers it from the scene's map and the live crossing rules; null on a scene
 * with no map, where every point is level ground and nothing refuses.
 */
export interface SceneTerrain {
  elevationAt(x: number, y: number, levelId?: string): number
  /** The refusal message for a player's move, or null when it may go. */
  crossingRefusal(from: { x: number; y: number }, to: { x: number; y: number }, levelId?: string): string | null
}
export type TerrainOf = (sceneId: string) => SceneTerrain | null

export type LevelFilterOf = (sceneId: string, viewer: Viewer) => ((levelId: string | undefined) => boolean) | null

/**
 * Table v2 — the DM's pause and movement lock (the `table` module). A player's `move` is
 * refused while either is on; the DM's never is. Null when nothing is wired, which is "off".
 *
 * Table lobby pass: `started` (players are on the map; false is the lobby), `playersMakePcs`
 * (a player may make their own character) and `lobbyShowsScene` (the lobby shows the scene's
 * name and picture), all on the session's row beside the other two.
 */
export interface TableFlags {
  paused: boolean
  movementLocked: boolean
  started: boolean
  playersMakePcs: boolean
  lobbyShowsScene: boolean
}
export type TableOf = (scope: { campaignId: string; sessionId: string }) => TableFlags | null
