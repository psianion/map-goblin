// src/engine/packManifest.ts
//
// The pack manifest's shape, on its own: the store and the session server read it
// without pulling in AssetPackManager (Pixi, IndexedDB, the DOM).

// SYNC: mirrors vault-engine's PackManifestSchema (packages/vault-engine/src/schemas/pack-manifest.ts)
export interface FileRef {
  checksum: string
  size: number
}

export interface EntryRect {
  x: number
  y: number
  w: number
  h: number
}

export interface ManifestEntry {
  type: string
  material: string
  gridSize: string
  pieceType: string
  variant: string
  atlas?: string
  frame?: EntryRect
  /** Opaque-content bounds within the entry's cell — renderer trims to this. */
  contentRect?: EntryRect
  set?: string
  /** Variant family within `set` ('storage_barrel_dark'); absent = a family of one. */
  family?: string
  tags: string[]
  /** A band kit piece's own measurements (see caveWallKit's bandPiecesFor). */
  band?: BandMeasure
  /** A prop that blocks on a round footprint rather than its square frame. */
  footprint?: { radius: number }
  /** One piece of a door kit the pack declares (see doorKits' `packDoorKits`). */
  door?: DoorMeasure
  /** One straight piece of a stair kit the pack declares (see stairKits' `packStairKits`). */
  stairs?: StairsMeasure
}

/**
 * A straight flight of steps a pack ships, painted with its high end at the top of the tile. A
 * kit is every piece sharing `kit`: pieces one cell wide and two, running one cell and two.
 */
export interface StairsMeasure {
  kit: string
  /** The kit's name, as its tile shows it. */
  label: string
  /** Cells across the flight. */
  wide: number
  /** Cells down the flight its steps run, from the tile's top edge. */
  run: number
  /** The steps as painted, cells from the tile's top-left: x0, y0, x1, y1. What is laid on the span; the tile's spill and padding are not. */
  painted: [number, number, number, number]
  /** The pack's own default stair kit. */
  default?: boolean
  /** A stone kit's colour, matched against a cliff kit's name. */
  colour?: string
}

/**
 * A door kit piece a pack ships: a whole leaf, painted along the tile's width with its hinge
 * at the right, or a frame whose two posts close the opening's edges. A kit is every piece
 * sharing `kit`; it is the default door of each wall set in `walls`.
 */
export interface DoorMeasure {
  kit: string
  /** The kit's name, as the door card shows it. */
  label: string
  part: 'leaf' | 'frame' | 'frame-double'
  walls?: string[]
  /** A frame's posts: their inner and outer faces, cells out from the tile's centre along its width. */
  post?: [number, number]
}

/** Where a band kit piece's joints are, as `CaveKitPiece` measures them. */
export interface BandMeasure {
  /** The two butt joints, in cells from the tile's centre (x right, y down). */
  joints: [[number, number], [number, number]]
  /** Signed turn across the piece in degrees, positive clockwise on screen. */
  turnDeg: number
  /** An open run's tip. Never laid inside a run. */
  end?: boolean
  /**
   * A round lump of the kit's rock, laid over a joint where two pieces meet at an angle. Never
   * laid inside a run. Its two joints are both the middle of its solid body.
   */
  connector?: boolean
  /** A connector's solid body: its radius in cells. */
  radius?: number
  /** How wide the kit's rock is across, in cells, as measured across its straights. */
  rockWidth?: number
  /** How far the wall's shadow reaches onto the floor past the rock, in cells. */
  shadowReach?: number
  /** How dark the wall's shadow is against the rock, 0 to 1. */
  shadowStrength?: number
  /** The pieces' art carries a shadow of its own on the floor side. */
  shadowBaked?: boolean
  /** The middle of the rock's solid body, joint 0 end to joint 1 end, in the joints' frame. */
  spine?: [number, number][]
  /** The middle of the fully solid rock across the piece, sampled along it, joint 0 end to joint 1 end, in cells from the tile's centre. */
  middle?: [number, number][]
  /** A straight whose rock steps sideways between its ends: laid only where an outline jogs as far. Never inside a run. */
  step?: boolean
  /** A dead end (an end turning 180 degrees): how far past its joints' chord the floor line round its cap lies, in cells. */
  reach?: number
  /** A piece with an opening through its face, laid across a doorway in the run. Never inside a run. */
  entrance?: boolean
  /** An entrance dark inside, for an opening onto unlit ground. */
  shadow?: boolean
  /** Rock turning into a cut-stone wall: laid where the two meet, in line or at a right angle. Never inside a run. */
  transition?: 'straight' | 'corner'
  /** Which of a transition's joints lies on the wall's centre line. */
  wallJoint?: 0 | 1
  /**
   * The side the art's face looks at, as the kit was measured: a cliff's at its void side (the
   * low ground, the default), a cave wall's at its floor side (the rock mass behind it is its void).
   */
  faces?: 'void' | 'floor'
}

export interface PackManifest {
  name: string
  description: string
  version: string
  bundleSize: number
  entries: Record<string, ManifestEntry>
  atlases: Record<string, FileRef>
  files: Record<string, FileRef>
  theme?: string[]
  /** Set ids the pack has renamed, old to new: maps saved with the old id draw with the new set. */
  setAliases?: Record<string, string>
}
