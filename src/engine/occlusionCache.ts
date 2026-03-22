import type { OcclusionSegment } from '@/shared/occlusion';
import type { WallSegment, DoorChild } from '@/shared/types';
import { buildOcclusionSegments } from '@/shared/occlusion';

export class OcclusionCache {
  cache = new Map<string, OcclusionSegment[]>();
  dirty = new Set<string>();

  invalidate(layerId: string): void {
    this.dirty.add(layerId);
  }

  invalidateAll(): void {
    for (const key of this.cache.keys()) {
      this.dirty.add(key);
    }
  }

  get(layerId: string, walls: WallSegment[], doors: DoorChild[]): OcclusionSegment[] {
    if (!this.dirty.has(layerId) && this.cache.has(layerId)) {
      return this.cache.get(layerId)!;
    }
    const segments = buildOcclusionSegments(walls, doors);
    this.cache.set(layerId, segments);
    this.dirty.delete(layerId);
    return segments;
  }

  clear(): void {
    this.cache.clear();
    this.dirty.clear();
  }
}
