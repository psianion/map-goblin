// src/store/migration.ts
import type { SerializedMapData } from './types'

export const CURRENT_VERSION = '3.0' as const

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

  if (result.version !== CURRENT_VERSION) {
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
