// src/store/migration.ts
import type { SerializedMapData, Light, PlacedObject, DungeonLayer } from './types.ts'

export const CURRENT_VERSION = '1.4' as const

export function migrateToLatest(data: SerializedMapData): SerializedMapData {
  let current = data

  if (current.version === '1.0') {
    current = migrateV10ToV11(current)
  }

  if (current.version === '1.1') {
    current = migrateV11ToV12(current)
  }

  if (current.version === '1.2') {
    current = migrateV12ToV13(current)
  }

  if (current.version === '1.3') {
    current = migrateV13ToV14(current)
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

// v1.3 → v1.4: dungeon layer styles gain wallTextureTint
function migrateV13ToV14(data: SerializedMapData): SerializedMapData {
  for (const layer of data.layers) {
    if (layer.type === 'dungeon') {
      const style = layer.style as unknown as Record<string, unknown>;
      style.wallTextureTint ??= '#ffffff';
    }
  }
  data.version = '1.4';
  return data;
}

// v1.2 → v1.3: shapes gain texture fields, dungeon layers gain paths[], style gains edge transition fields
function migrateV12ToV13(data: SerializedMapData): SerializedMapData {
  const layers = data.layers.map((layer) => {
    if (layer.type !== 'dungeon') return layer
    const raw = layer as unknown as Record<string, unknown>
    const rawStyle = layer.style as unknown as Record<string, unknown>
    return {
      ...layer,
      paths: (raw.paths as DungeonLayer['paths']) ?? [],
      shapes: layer.shapes.map((shape) => {
        const rs = shape as unknown as Record<string, unknown>
        return {
          ...shape,
          textureScale: (rs.textureScale as number) ?? 0.25,
          textureOffsetX: (rs.textureOffsetX as number) ?? 0,
          textureOffsetY: (rs.textureOffsetY as number) ?? 0,
          textureFillRotation: (rs.textureFillRotation as number) ?? 0,
          textureTint: (rs.textureTint as string) ?? '#ffffff',
        }
      }),
      style: {
        ...layer.style,
        edgeTransitionWidth: (rawStyle.edgeTransitionWidth as number) ?? 0.5,
        showEdgeTransitions: (rawStyle.showEdgeTransitions as boolean) ?? true,
      },
    } satisfies DungeonLayer
  })

  return { ...data, version: '1.3', layers }
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
