import type { LightChild, DungeonLayer } from '@/store/types'
import type { VisibilityVertex } from './ClockwiseSweep'
import { clockwiseSweep } from './ClockwiseSweep'
import { SegmentQuadtree } from './SegmentQuadtree'
import { extractWallSegments } from './raycaster'
import type { Segment } from './raycaster'

export class LightManager {
  private lights: LightChild[] = []
  private shadowCache = new Map<string, VisibilityVertex[]>()
  private dirtySet = new Set<string>()
  private wallSegments: Segment[] = []
  private quadtree = new SegmentQuadtree()
  private wallsDirty = true

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
      }
    }

    for (const light of newLights) {
      const prev = prevMap.get(light.id)
      if (!prev) {
        this.dirtySet.add(light.id)
      } else {
        const posChanged =
          prev.position.x !== light.position.x ||
          prev.position.y !== light.position.y
        const radChanged = prev.radius !== light.radius
        const falloffChanged = prev.falloff !== light.falloff
        if (posChanged || radChanged || falloffChanged) {
          this.dirtySet.add(light.id)
        }
      }
    }

    this.lights = newLights
  }

  invalidate(lightId: string): void {
    this.dirtySet.add(lightId)
  }

  invalidateAll(): void {
    for (const light of this.lights) {
      this.dirtySet.add(light.id)
    }
    this.wallsDirty = true
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
    const nearSegments = this.quadtree.query(
      light.position.x - light.radius,
      light.position.y - light.radius,
      light.position.x + light.radius,
      light.position.y + light.radius,
    )
    const polygon = clockwiseSweep(
      [light.position.x, light.position.y],
      light.radius,
      nearSegments,
    )
    this.shadowCache.set(light.id, polygon)
    this.dirtySet.delete(light.id)
    return polygon
  }
}
