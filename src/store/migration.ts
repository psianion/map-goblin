// src/store/migration.ts
import type { SerializedMapData, Light, PlacedObject } from './types.ts'

export const CURRENT_VERSION = '1.2' as const

export function migrateToLatest(data: SerializedMapData): SerializedMapData {
  let current = data

  if (current.version === '1.0') {
    current = migrateV10ToV11(current)
  }

  if (current.version === '1.1') {
    current = migrateV11ToV12(current)
  }

  if (current.version === CURRENT_VERSION) {
    return current
  }

  throw new Error(`Unsupported version: "${data.version}" — cannot migrate to ${CURRENT_VERSION}`)
}

// v1.0 had no placedObjects or customImages fields
type V10Data = Omit<SerializedMapData, 'placedObjects' | 'customImages'> & {
  placedObjects?: PlacedObject[]
  customImages?: Record<string, string>
}

// v1.1 → v1.2: lights gain featherRadius (defaults to half of radius for a soft look)
function migrateV11ToV12(data: SerializedMapData): SerializedMapData {
  const lights: Light[] = data.lights.map((light) => {
    const l = light as Light & { featherRadius?: number }
    return {
      ...light,
      featherRadius: l.featherRadius ?? light.radius * 0.5,
    }
  })

  return { ...data, version: '1.2', lights }
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
