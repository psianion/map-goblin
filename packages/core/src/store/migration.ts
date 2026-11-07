// src/store/migration.ts
import type { SerializedMapData } from './types'
import type { Level } from '../shared/types'
import { levelOf } from '../shared/lookScope'
import { DEFAULT_SIGHT_DROP_CELLS, defaultCrossingKinds } from '../shared/crossingKinds'
import { dropRemovedFields } from './removedFields'

export const CURRENT_VERSION = '3.7' as const

/**
 * Every file version a reader must accept, oldest first. THE one list — the
 * editor's load gate, the autosave gate, the `.mapbuilder` decoder and the
 * session server's upload validation all consume it, so widening the format is
 * a one-line change here plus a migration below when the shape actually moved.
 * ('3.0' → '3.1' is purely additive — optional `prep` — so no migration step.
 * '3.1' → '3.2' drops the old water bodies, see `dropRetiredBodies`. '3.2' → '3.3' moves
 * height off floors onto plateau children, see `plateausFromShapes`. '3.3' → '3.4' drops
 * the Path tool's paths the same way, and the props its kits placed let go of their host.
 * '3.4' → '3.5' is additive: the terrain's smooth blending switch, a floor's own opacity and
 * edge band, curved floor edges; a field a 3.4 map lacks takes its default. '3.5' → '3.6'
 * is additive too: a wall's and a layer's corner style, a door's freestanding flag. '3.6' →
 * '3.7' adds the new terrain tools' data, all additive: a layer's water.)
 */
export const SUPPORTED_VERSIONS: readonly SerializedMapData['version'][] = ['2.0', '3.0', '3.1', '3.2', '3.3', '3.4', '3.5', '3.6', '3.7']

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

  // '3.0' and '3.1' load as-is: '3.1' only added the optional `prep` block, '3.2' takes
  // the water tool's bodies away and '3.4' the Path tool's paths (`dropRetiredBodies`), and
  // '3.2' adds the plateau settings (`withPlateauSettings`), all below on every load. The
  // version stamp is rewritten to CURRENT_VERSION on the next save.
  if (
    result.version !== '3.0' &&
    result.version !== '3.1' &&
    result.version !== '3.2' &&
    result.version !== '3.3' &&
    result.version !== '3.4' &&
    result.version !== '3.5' &&
    result.version !== '3.6' &&
    result.version !== CURRENT_VERSION
  ) {
    throw new Error(
      `Unknown map format version: ${result.version}. Expected ${CURRENT_VERSION}.`,
    )
  }

  const retired = dropRetiredBodies((result as SerializedMapData).layers)
  if (retired.removed > 0) result = { ...result, layers: retired.layers } as SerializedMapData
  const plateaus = plateausFromShapes((result as SerializedMapData).layers)
  if (plateaus !== (result as SerializedMapData).layers) result = { ...result, layers: plateaus } as SerializedMapData
  // The settings dropped in the editor rework go too (removedFields.ts).
  const migrated = withPlateauSettings(neutralizeLegacyTint(dropRetiredFields(dropRemovedFields(result as SerializedMapData))))
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

/** A child of a retired tool: the old water tool's bodies, or the Path tool's roads, rivers and lakes. */
function isRetiredBody(child: unknown): boolean {
  if (!child || typeof child !== 'object') return false
  const type = (child as { childType?: unknown }).childType
  return type === 'water' || type === 'path'
}

/**
 * The bodies the retired water and Path tools drew (`childType: 'water'` and `'path'`) in a
 * document's layers. Read before migrating, so a loader can say how many it lost.
 */
export function countRetiredBodies(layers: unknown): number {
  if (!Array.isArray(layers)) return 0
  let n = 0
  for (const layer of layers) {
    const children = (layer as { children?: unknown } | null)?.children
    if (Array.isArray(children)) n += children.filter(isRetiredBody).length
  }
  return n
}

/**
 * Every layer without its retired bodies: 3.2 drops the old water tool's, 3.4 the Path tool's,
 * on load; the editor and the session server both come through here. Hands back `layers`
 * itself when there is none.
 */
export function dropRetiredBodies(layers: SerializedMapData['layers']): {
  layers: SerializedMapData['layers']
  removed: number
} {
  const removed = countRetiredBodies(layers)
  if (removed === 0) return { layers, removed }
  return {
    layers: layers.map((layer) => {
      const children = (layer as unknown as { children?: unknown }).children
      if (!Array.isArray(children) || !children.some(isRetiredBody)) return layer
      return { ...layer, children: children.filter((c) => !isRetiredBody(c)) } as unknown as typeof layer
    }),
    removed,
  }
}

/** The toast a loader shows when `countRetiredBodies` found some. */
export function retiredRemovedMessage(n: number): string {
  const bodies = n === 1 ? '1 path or water body' : `${n} paths and water bodies`
  return `${bodies} from a retired tool ${n === 1 ? 'was' : 'were'} removed.`
}

/** The plateau fields a 3.2 floor shape carried. */
const SHAPE_PLATEAU_KEYS = ['height', 'edge', 'edgeArt', 'slopeWidth', 'contourLines', 'sightOverride', 'crossingId'] as const

type Loose = Record<string, unknown>

function hasShapePlateauKey(child: unknown): boolean {
  if (!child || typeof child !== 'object' || (child as Loose).childType !== 'shape') return false
  return SHAPE_PLATEAU_KEYS.some((key) => key in (child as Loose))
}

/** The id a 3.2 floor's height moves to. */
export const plateauIdFor = (shapeId: string): string => `${shapeId}-plateau`

/**
 * 3.2 → 3.3: height lived on floor shapes; it lives on plateau children now. Every shape with a
 * height stays where it is, at ground, and gains a plateau child right after it with its rings,
 * height and edge (`wall` and absent read as `cliff`; a plateau never makes walls). Every shape
 * loses the plateau fields. Hands back `layers` itself when nothing moved.
 */
export function plateausFromShapes(layers: SerializedMapData['layers']): SerializedMapData['layers'] {
  const moves = (layer: unknown): boolean => {
    const children = (layer as { children?: unknown } | null)?.children
    return (
      Array.isArray(children) &&
      children.some(hasShapePlateauKey)
    )
  }
  if (!Array.isArray(layers) || !layers.some(moves)) return layers
  return layers.map((layer) => {
    if (!moves(layer)) return layer
    const children = (layer as unknown as { children: Loose[] }).children
    const raised = new Set(
      children
        .filter((c) => c.childType === 'shape' && typeof c.height === 'number' && Math.round(c.height) !== 0)
        .map((c) => c.id as string),
    )
    const out: Loose[] = []
    for (const child of children) {
      if (child.childType === 'shape' && hasShapePlateauKey(child)) {
        const shape: Loose = { ...child }
        for (const key of SHAPE_PLATEAU_KEYS) delete shape[key]
        out.push(shape)
        if (!raised.has(child.id as string)) continue
        const plateau: Loose = {
          id: plateauIdFor(child.id as string),
          name: child.name ?? 'Plateau',
          childType: 'plateau',
          visible: child.visible ?? true,
          contours: child.contours,
          height: Math.round(child.height as number),
          edge: child.edge === 'slope' || child.edge === 'none' ? child.edge : 'cliff',
        }
        if (child.locked) plateau.locked = true
        if (child.tangents) plateau.tangents = child.tangents
        if (child.transform) plateau.transform = child.transform
        for (const key of ['edgeArt', 'slopeWidth', 'contourLines', 'sightOverride', 'crossingId'] as const) {
          if (child[key] !== undefined) plateau[key] = child[key]
        }
        out.push(plateau)
        continue
      }
      out.push(child)
    }
    return { ...layer, children: out } as unknown as typeof layer
  })
}

/** A map from before plateaus gets the sight threshold and the seeded crossing kinds. */
function withPlateauSettings(data: SerializedMapData): SerializedMapData {
  const settings = data.mapSettings as Partial<SerializedMapData['mapSettings']> | undefined
  if (!settings || (typeof settings.sightDropCells === 'number' && Array.isArray(settings.crossingKinds))) return data
  return {
    ...data,
    mapSettings: {
      ...data.mapSettings,
      sightDropCells: typeof settings.sightDropCells === 'number' ? settings.sightDropCells : DEFAULT_SIGHT_DROP_CELLS,
      crossingKinds: Array.isArray(settings.crossingKinds) ? settings.crossingKinds : defaultCrossingKinds(),
    },
  }
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
  // A prop a path's or a plot's kit placed (`attachedTo`), retired with the Path tool: a
  // plain prop where it stands.
  if (Array.isArray(result.layers) && result.layers.some(hasAttachedProp)) {
    result = {
      ...result,
      layers: result.layers.map((layer) => {
        if (!hasAttachedProp(layer)) return layer
        const children = (layer as unknown as { children: Record<string, unknown>[] }).children
        return {
          ...layer,
          children: children.map((child) => {
            if (!isAttachedProp(child)) return child
            const rest = { ...child }
            delete rest.attachedTo
            return rest
          }),
        } as unknown as typeof layer
      }),
    }
  }
  return result
}

function isAttachedProp(child: unknown): boolean {
  return !!child && typeof child === 'object' && (child as { childType?: unknown }).childType === 'asset' && 'attachedTo' in child
}

function hasAttachedProp(layer: unknown): boolean {
  const children = (layer as { children?: unknown } | null)?.children
  return Array.isArray(children) && children.some(isAttachedProp)
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
