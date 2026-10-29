// src/store/migration.ts
import type { SerializedMapData } from './types'
import type { Level } from '../shared/types'
import { levelOf } from '../shared/lookScope'

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

/**
 * What the cave-band cleanup asks the pack catalog. Passed in rather than imported: the
 * session server reads this module and has neither a catalog nor Pixi, which the catalog
 * pulls in. Without it the cleanup is skipped.
 */
export interface CaveKitLookup {
  /** True when a wall texture set id names a cave band kit (packCatalog's `isBandSet`). */
  isBandSet: (setId: string | undefined) => boolean
  /** True when a placed asset is one of a band kit's rock pieces (caveWallKit's `isCaveBandAsset`). */
  isCaveBandAsset: (assetId: string) => boolean
}

export function migrateToLatest(data: V2Data | SerializedMapData, caveKit?: CaveKitLookup): SerializedMapData {
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

  const migrated = neutralizeLegacyTint(dropRetiredFields(result as SerializedMapData))
  if (!caveKit) return migrated
  const layers = dropPlacedCaveBand(migrated.layers, migrated.levels ?? [], caveKit)
  return layers === migrated.layers ? migrated : { ...migrated, layers }
}

/**
 * A layer whose wall set is a band kit has its cave band drawn live, from the wall texture,
 * so the same kit's rock placed as ordinary asset children is a second copy of the wall
 * that the wall settings never reach. Dropped on load. Every other
 * prop stays, kit dressing such as ledges included, and so does a piece on a layer drawn
 * with anything else: there it is the only rock the layer has.
 *
 * The wall set is the one the layer draws with: its own, else its level's, the same
 * fallback `levelStyle` applies. Reads the catalog through `caveKit`, so the editor runs it
 * again once packs land (see CanvasHost) for a map that opened before they did. Hands back
 * `layers` itself when there is nothing to drop.
 */
export function dropPlacedCaveBand(
  layers: SerializedMapData['layers'],
  levels: readonly Level[],
  caveKit: CaveKitLookup,
): SerializedMapData['layers'] {
  const drops = (layer: unknown): boolean => hasPlacedCaveBand(layer, levels, caveKit)
  if (!Array.isArray(layers) || !layers.some(drops)) return layers
  return layers.map((layer) => {
    if (!drops(layer)) return layer
    const children = (layer as unknown as { children: unknown[] }).children
    return {
      ...layer,
      children: children.filter((child) => !isPlacedCaveBandPiece(child, caveKit)),
    } as unknown as typeof layer
  })
}

function isPlacedCaveBandPiece(child: unknown, caveKit: CaveKitLookup): boolean {
  if (!child || typeof child !== 'object') return false
  const c = child as { childType?: unknown; assetId?: unknown }
  return c.childType === 'asset' && typeof c.assetId === 'string' && caveKit.isCaveBandAsset(c.assetId)
}

function hasPlacedCaveBand(layer: unknown, levels: readonly Level[], caveKit: CaveKitLookup): boolean {
  const l = layer as
    | { type?: unknown; levelId?: string; style?: { wallTextureSetId?: unknown }; children?: unknown }
    | null
  if (l?.type !== 'dungeon' || !Array.isArray(l.children)) return false
  const own = l.style?.wallTextureSetId
  const setId = own === undefined ? levelOf(levels, { levelId: l.levelId ?? '' }).look?.wallTextureSetId : own
  if (typeof setId !== 'string' || !caveKit.isBandSet(setId)) return false
  return l.children.some((child) => isPlacedCaveBandPiece(child, caveKit))
}

/** The mood tint that changes nothing: the world in neutral daylight (`shared/world`). */
export const NEUTRAL_TINT = '#ffffff'

/**
 * Whether a map's mood tint is a legacy one: darker than Rec. 709 luma 0.75. Before the tint
 * meant "this world in neutral daylight" it was the darkness itself (the v1 presets Dungeon
 * `#2d2d44`, Night `#1a1a2e`, Moonless `#0a0a0f`, Dusk `#6b5a7a`, Overcast `#9a9a9a`), so a
 * noon preview read the art at a third. The hour, the sky and the environment carry the dark
 * now. Day (`#e8e4d8`) and lighter tints are tints and stay. Unparseable reads as legacy.
 */
export function isLegacyTint(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return true
  const v = parseInt(m[1]!, 16)
  const luma = (0.2126 * ((v >> 16) & 0xff) + 0.7152 * ((v >> 8) & 0xff) + 0.0722 * (v & 0xff)) / 255
  return luma < 0.75
}

/** Every load (saved maps, imports, the table) replaces a legacy mood tint with white. */
function neutralizeLegacyTint(data: SerializedMapData): SerializedMapData {
  const settings = data.mapSettings
  if (!settings || typeof settings.ambientLight !== 'string' || !isLegacyTint(settings.ambientLight)) return data
  return { ...data, mapSettings: { ...settings, ambientLight: NEUTRAL_TINT } }
}

/** Layer style keys nothing ever drew: the drop shadow under floors and the rough-edge amplitude. */
const RETIRED_STYLE_KEYS = [
  'shadowEnabled',
  'shadowColor',
  'shadowOffset',
  'shadowIntensity',
  'roughnessAmplitude',
] as const

/**
 * Fields the format no longer carries, stripped from every version on load (no version
 * bump: dropping them changes nothing a reader acts on). `mapSettings.gridType` was a
 * square/hex/isometric switch nothing ever drew; every save up to 3.1 still writes it.
 * The dungeon layer style's shadow and roughness keys (`RETIRED_STYLE_KEYS`) are the
 * same story. So is a standalone wall's draw-time width copy (see `hasDrawTimeWidth`).
 */
function dropRetiredFields(data: SerializedMapData): SerializedMapData {
  let result = data
  const settings = data.mapSettings as (SerializedMapData['mapSettings'] & { gridType?: unknown }) | undefined
  if (settings && 'gridType' in settings) {
    const mapSettings = { ...settings }
    delete mapSettings.gridType
    result = { ...result, mapSettings }
  }
  const layers = result.layers
  if (Array.isArray(layers) && layers.some(hasRetiredStyleKey)) {
    result = {
      ...result,
      layers: layers.map((layer) => {
        if (!hasRetiredStyleKey(layer)) return layer
        const style: Record<string, unknown> = { ...(layer as unknown as { style: Record<string, unknown> }).style }
        for (const key of RETIRED_STYLE_KEYS) delete style[key]
        return { ...layer, style } as unknown as typeof layer
      }),
    }
  }
  if (Array.isArray(result.layers) && result.layers.some(hasDrawTimeWidths)) {
    result = {
      ...result,
      layers: result.layers.map((layer) => {
        if (!hasDrawTimeWidths(layer)) return layer
        const walls = (layer as unknown as { standaloneWalls: Record<string, unknown>[] }).standaloneWalls
        return {
          ...layer,
          standaloneWalls: walls.map((wall) => {
            if (!hasDrawTimeWidth(wall)) return wall
            const rest = { ...wall }
            delete rest.width
            return rest
          }),
        } as unknown as typeof layer
      }),
    }
  }
  // A light's pack mask texture: read by the old renderer, written by nothing, retired with
  // the Lighting pass.
  if (Array.isArray(result.layers) && result.layers.some(hasMaskedLight)) {
    result = {
      ...result,
      layers: result.layers.map((layer) => {
        if (!hasMaskedLight(layer)) return layer
        const children = (layer as unknown as { children: Record<string, unknown>[] }).children
        return {
          ...layer,
          children: children.map((child) => {
            if (!isMaskedLight(child)) return child
            const rest = { ...child }
            delete rest.maskTextureId
            return rest
          }),
        } as unknown as typeof layer
      }),
    }
  }
  return result
}

function isMaskedLight(child: unknown): boolean {
  return !!child && typeof child === 'object' && (child as { childType?: unknown }).childType === 'light' && 'maskTextureId' in child
}

function hasMaskedLight(layer: unknown): boolean {
  const children = (layer as { children?: unknown } | null)?.children
  return Array.isArray(children) && children.some(isMaskedLight)
}

/**
 * Walls used to copy the layer's `style.wallWidth` when drawn or imported, so the Width
 * control never reached them. A width is now only ever written as a preset pin, and a
 * preset pins the tint beside it, so a width with no look pin next to it is one of those
 * copies: dropped, the wall follows its layer again.
 */
function hasDrawTimeWidth(wall: unknown): boolean {
  if (!wall || typeof wall !== 'object') return false
  const w = wall as { width?: unknown; textureSetId?: unknown; textureTint?: unknown }
  return w.width !== undefined && w.textureSetId === undefined && w.textureTint === undefined
}

function hasDrawTimeWidths(layer: unknown): boolean {
  const walls = (layer as { standaloneWalls?: unknown } | null)?.standaloneWalls
  return Array.isArray(walls) && walls.some(hasDrawTimeWidth)
}

function hasRetiredStyleKey(layer: unknown): boolean {
  const style = (layer as { style?: unknown } | null)?.style
  if (!style || typeof style !== 'object') return false
  return RETIRED_STYLE_KEYS.some((key) => key in style)
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
