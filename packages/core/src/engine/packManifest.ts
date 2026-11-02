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
  /** A `kit` entry's manifest: how its path material is built from the pack's pieces. */
  kit?: KitManifest
}

// SYNC: mirrors vault-engine's KitManifest (packages/vault-engine/src/types.ts)
/**
 * A unit walked along an outline: picked by weight, `spacing` cells apart, turned up to
 * `jitter` radians, laid at `scale` times its painted size (the kit's `scale` when absent).
 */
export interface KitEdgeUnit {
  key: string
  weight: number
  spacing: number
  jitter: number
  scale?: number
}

/**
 * How a path material is built from pieces; every key names another entry of the same pack.
 * surface: the outline filled with `fill`, `edge` units walked along it. planks: `cross`
 * units across the centreline, `railPost` units both sides with a `rope` between, `end`
 * pieces at cut ends. band: the cave walk with `band.straight` pieces, bends drawn in code.
 */
export interface KitManifest {
  kind: 'surface' | 'planks' | 'band'
  fill?: string
  edge?: KitEdgeUnit[]
  cross?: { key: string; weight: number }[]
  railPost?: string
  rope?: { color: string; width: number }
  /** The band's straights, laid at `scale` times their painted size (1 when absent). */
  band?: { straight: string[]; bendDrawn: true; scale?: number }
  end?: string
  /** Liquids: the piece that hangs where the path runs off a cliff. */
  fall?: string
  /** What edge units naming no scale of their own are laid at against their painted size: 0.5 when absent. */
  scale?: number
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
