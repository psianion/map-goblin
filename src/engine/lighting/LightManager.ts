import type { Light } from '@/store/types'

type WorldPoint = [number, number]

export class LightManager {
  private lights: Light[] = []
  private shadowCache = new Map<string, WorldPoint[]>()
  private dirtySet = new Set<string>()

  getLights(): Light[] {
    return this.lights
  }

  getVisibleLights(): Light[] {
    return this.lights.filter((l) => l.visible !== false)
  }

  /**
   * Called from subscribeToStore whenever state.lights changes.
   * Detects which lights changed position/radius/falloff and marks them dirty.
   * New lights are marked dirty. Removed lights are evicted from cache.
   */
  syncFromStore(newLights: Light[]): void {
    const prevMap = new Map(this.lights.map((l) => [l.id, l]))
    const newIds = new Set(newLights.map((l) => l.id))

    // Evict removed lights
    for (const [id] of prevMap) {
      if (!newIds.has(id)) {
        this.shadowCache.delete(id)
        this.dirtySet.delete(id)
      }
    }

    // Check for new or changed lights
    for (const light of newLights) {
      const prev = prevMap.get(light.id)
      if (!prev) {
        // New light — mark dirty
        this.dirtySet.add(light.id)
      } else {
        // Changed position, radius, or falloff invalidates visibility polygon
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
  }

  isDirty(lightId: string): boolean {
    return this.dirtySet.has(lightId)
  }

  clearDirty(lightId: string): void {
    this.dirtySet.delete(lightId)
  }

  getDirtyCount(): number {
    return this.dirtySet.size
  }

  getCachedPolygon(lightId: string): WorldPoint[] | null {
    return this.shadowCache.get(lightId) ?? null
  }

  setCachedPolygon(lightId: string, polygon: WorldPoint[]): void {
    this.shadowCache.set(lightId, polygon)
  }
}
