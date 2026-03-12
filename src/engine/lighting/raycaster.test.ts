import { describe, it, expect } from 'vitest'
import { extractWallSegments } from './raycaster'
import type { DungeonLayer } from '@/store/types'

describe('extractWallSegments', () => {
  it('extracts segments from standalone walls with blocksLight', () => {
    const layer = {
      type: 'dungeon' as const,
      standaloneWalls: [
        { points: [[0, 0], [100, 0], [100, 100]] as [number, number][], blocksLight: true },
      ],
      mergedFloor: null,
    } as unknown as DungeonLayer

    const segs = extractWallSegments([layer])
    expect(segs).toHaveLength(2)
  })

  it('skips walls with blocksLight=false', () => {
    const layer = {
      type: 'dungeon' as const,
      standaloneWalls: [
        { points: [[0, 0], [100, 0]] as [number, number][], blocksLight: false },
      ],
      mergedFloor: null,
    } as unknown as DungeonLayer

    const segs = extractWallSegments([layer])
    expect(segs).toHaveLength(0)
  })
})
