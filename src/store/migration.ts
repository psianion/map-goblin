// src/store/migration.ts
import type { SerializedMapData, Light, PlacedObject } from './types.ts'

export const CURRENT_VERSION = '1.1' as const

export function migrateToLatest(data: SerializedMapData): SerializedMapData {
  if (data.version === CURRENT_VERSION) {
    return data
  }

  if (data.version === '1.0') {
    return migrateV10ToV11(data)
  }

  throw new Error(`Unsupported version: "${data.version}" — cannot migrate to ${CURRENT_VERSION}`)
}

// v1.0 had no placedObjects or customImages fields
type V10Data = Omit<SerializedMapData, 'placedObjects' | 'customImages'> & {
  placedObjects?: PlacedObject[]
  customImages?: Record<string, string>
}

function migrateV10ToV11(raw: SerializedMapData): SerializedMapData {
  const data = raw as unknown as V10Data

  const placedObjects: PlacedObject[] = data.placedObjects ?? []
  const customImages: Record<string, string> = data.customImages ?? {}

  const lights: Light[] = data.lights.map((light) => {
    const l = light as Light & { name?: string; visible?: boolean }
    return {
      ...light,
      name: l.name ?? 'Light',
      visible: l.visible ?? true,
    }
  })

  return {
    ...data,
    version: '1.1',
    placedObjects,
    customImages,
    lights,
  }
}
