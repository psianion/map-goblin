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
  /** The middle of the rock's solid body, joint 0 end to joint 1 end, in the joints' frame. */
  spine?: [number, number][]
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
}
