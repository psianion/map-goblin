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
  /**
   * A light prop: the preset its light takes and, when its picture follows the light, the
   * entry keys of its pictures by state (bare keys, within this pack). Absent = no light.
   */
  light?: {
    preset: 'torch' | 'lantern' | 'candle' | 'brazier' | 'magical' | 'darkness'
    states?: { off?: string; embers?: string; on?: string }
  }
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
