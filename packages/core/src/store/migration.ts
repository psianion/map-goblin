// src/store/migration.ts
import type { SerializedMapData } from './types'

export const CURRENT_VERSION = '3.1' as const

/**
 * Every file version a reader must accept, oldest first. THE one list — the
 * editor's load gate, the autosave gate, the `.mapbuilder` decoder and the
 * session server's upload validation all consume it, so widening the format is
 * a one-line change here plus a migration below when the shape actually moved.
 * ('3.0' → '3.1' is purely additive — optional `prep` — so no migration step.)
 */
export const SUPPORTED_VERSIONS: readonly SerializedMapData['version'][] = ['2.0', '3.0', '3.1']

export function isSupportedVersion(version: unknown): version is SerializedMapData['version'] {
  return typeof version === 'string' && (SUPPORTED_VERSIONS as readonly string[]).includes(version)
}

interface WallSegmentV2 {
  id: string
  points: [number, number][]
  blocksLight: boolean
  color: string
  width: number
  roughness: number
}

interface V2Data {
  version: string
  layers: V2Layer[]
  [key: string]: unknown
}

interface V2Layer {
  type: string
  standaloneWalls?: WallSegmentV2[]
  [key: string]: unknown
}

export function migrateToLatest(data: V2Data | SerializedMapData): SerializedMapData {
  let result: V2Data | SerializedMapData = data

  if (result.version === '2.0') {
    result = migrateV2ToV3(result as V2Data)
  }

  // '3.0' loads as-is: '3.1' only added the optional `prep` block, and the
  // version stamp is rewritten to CURRENT_VERSION on the next save.
  if (result.version !== '3.0' && result.version !== CURRENT_VERSION) {
    throw new Error(
      `Unknown map format version: ${result.version}. Expected ${CURRENT_VERSION}.`,
    )
  }

  return result as SerializedMapData
}

function migrateV2ToV3(data: V2Data): SerializedMapData {
  return {
    ...data,
    version: '3.0',
    layers: data.layers.map((layer: V2Layer) => {
      if (layer.type !== 'dungeon') return layer
      return {
        ...layer,
        standaloneWalls: (layer.standaloneWalls ?? []).map((wall: WallSegmentV2) => {
          const { blocksLight, ...rest } = wall
          return {
            ...rest,
            wallType: blocksLight ? 'normal' : 'terrain',
            direction: 'both',
          }
        }),
      }
    }),
  } as unknown as SerializedMapData
}
