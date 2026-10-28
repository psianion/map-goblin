import type { LightChild, DungeonLayer, AssetChild } from '../../store/types'
import type { RegionMood } from '../../shared/regionGrade'
import type { VisibilityVertex } from './ClockwiseSweep'
import { clockwiseSweep } from './ClockwiseSweep'
import { SegmentQuadtree } from './SegmentQuadtree'
import { extractWallSegments } from './raycaster'
import type { Segment } from './raycaster'

/** One room face of the shown level and the mood it resolves to (the grade mask's input). */
export interface RegionFace {
  id: string
  face: [number, number][]
  mood: RegionMood
}

/** The shown level's regions: its own mood for ground outside every room, then each room. */
export interface Regions {
  level: RegionMood
  rooms: RegionFace[]
  /** Changes whenever anything above does — the grade mask redraws on it. */
  key: string
}

/** A prop with Glows on, as the lighting pass draws it into the light buffer. */
export interface GlowProp {
  prop: AssetChild
  strength: number
  animation?: LightChild['animation']
}

export class LightManager {
  private lights: LightChild[] = []
  private shadowCache = new Map<string, VisibilityVertex[]>()
  private dirtySet = new Set<string>()
  /**
   * When each light was last declared stale, from one counter that only climbs. The lighting
   * composite keys its memo on this rather than on the dirty flag: a flag reads the same for
   * two invalidations a frame apart, so the second one matched the memo, the composite was
   * skipped, the polygon was never re-swept and the light stayed stale until the camera moved
   * (a door shut after its "Opens to" slider was nudged kept letting light through).
   */
  private staleStamps = new Map<string, number>()
  private staleSeq = 0
  private wallSegments: Segment[] = []
  private quadtree = new SegmentQuadtree()
  private wallsDirty = true
  /**
   * How many times the wall set has been declared stale — the wall-set half of a cache key,
   * for a pass that draws from the same geometry but does not sweep it (the P3 shadow pass).
   * Bumped by `invalidateAll`, which is fired by exactly one thing: subscribeToStore's
   * `lightingKey` change, whose terms are every input `extractWallSegments` reads.
   */
  private wallEpoch = 0
  private regions: Regions = { level: { mood: 'lit', moodTint: '#ffffff' }, rooms: [], key: '' }
  private glows: GlowProp[] = []
  private glowKey = ''

  /** The shown level's regions, for the grade mask. Set by the render loop. */
  setRegions(regions: Regions): void {
    this.regions = regions
  }

  getRegions(): Regions {
    return this.regions
  }

  /** The shown level's glowing props, and a key that changes with them. Set by the render loop. */
  setGlows(glows: GlowProp[], key: string): void {
    this.glows = glows
    this.glowKey = key
  }

  getGlows(): GlowProp[] {
    return this.glows
  }

  getGlowKey(): string {
    return this.glowKey
  }

  getLights(): LightChild[] {
    return this.lights
  }

  getVisibleLights(): LightChild[] {
    return this.lights.filter((l) => l.visible !== false)
  }

  syncFromStore(newLights: LightChild[]): void {
    const prevMap = new Map(this.lights.map((l) => [l.id, l]))
    const newIds = new Set(newLights.map((l) => l.id))

    for (const [id] of prevMap) {
      if (!newIds.has(id)) {
        this.shadowCache.delete(id)
        this.dirtySet.delete(id)
        this.staleStamps.delete(id)
      }
    }

    for (const light of newLights) {
      const prev = prevMap.get(light.id)
      if (!prev) {
        this.markStale(light.id)
      } else {
        const posChanged =
          prev.position.x !== light.position.x ||
          prev.position.y !== light.position.y
        const radChanged = prev.radius !== light.radius
        const falloffChanged = prev.falloff !== light.falloff
        // The sweep's own inputs beyond position and reach: the wedge, and whether walls cut it.
        const shapeChanged =
          prev.cone?.angle !== light.cone?.angle ||
          prev.cone?.direction !== light.cone?.direction ||
          !!prev.throughWalls !== !!light.throughWalls
        if (posChanged || radChanged || falloffChanged || shapeChanged) {
          this.markStale(light.id)
        }
      }
    }

    this.lights = newLights
  }

  invalidate(lightId: string): void {
    this.markStale(lightId)
  }

  invalidateAll(): void {
    for (const light of this.lights) {
      this.markStale(light.id)
    }
    this.wallsDirty = true
    this.wallEpoch++
  }

  /** See {@link wallEpoch}. */
  getWallEpoch(): number {
    return this.wallEpoch
  }

  /** Moves every time `lightId` is invalidated, and only then. 0 for a light never seen. */
  staleStamp(lightId: string): number {
    return this.staleStamps.get(lightId) ?? 0
  }

  private markStale(lightId: string): void {
    this.dirtySet.add(lightId)
    this.staleStamps.set(lightId, ++this.staleSeq)
  }

  isDirty(lightId: string): boolean {
    return this.dirtySet.has(lightId)
  }

  isWallsDirty(): boolean {
    return this.wallsDirty
  }

  getDirtyCount(): number {
    return this.dirtySet.size
  }

  rebuildIfDirty(dungeonLayers: DungeonLayer[]): void {
    if (!this.wallsDirty) return
    this.wallSegments = extractWallSegments(dungeonLayers)
    this.quadtree.build(this.wallSegments)
    this.wallsDirty = false
  }

  getOrComputePolygon(light: LightChild): VisibilityVertex[] {
    const cached = this.shadowCache.get(light.id)
    if (cached && !this.dirtySet.has(light.id)) {
      return cached
    }
    // A through-walls light sweeps against nothing: its pool is the full disc (or wedge).
    const nearSegments = light.throughWalls
      ? []
      : this.quadtree.query(
          light.position.x - light.radius,
          light.position.y - light.radius,
          light.position.x + light.radius,
          light.position.y + light.radius,
        )
    const polygon = clockwiseSweep(
      [light.position.x, light.position.y],
      light.radius,
      nearSegments,
      light.cone,
    )
    this.shadowCache.set(light.id, polygon)
    this.dirtySet.delete(light.id)
    return polygon
  }
}
