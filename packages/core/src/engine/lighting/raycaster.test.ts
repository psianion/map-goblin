import { describe, it, expect } from 'vitest'
import { extractWallSegments } from './raycaster'
import type { DungeonLayer } from '../../store/types'

describe('extractWallSegments', () => {
  it('extracts segments from standalone walls with normal wallType', () => {
    const layer = {
      type: 'dungeon' as const,
      children: [],
      standaloneWalls: [
        { id: 'w1', points: [[0, 0], [100, 0]] as [number, number][], wallType: 'normal', direction: 'both', color: '#000', width: 2, roughness: 0 },
      ],
      mergedFloor: null,
    } as unknown as DungeonLayer

    const segs = extractWallSegments([layer])
    expect(segs).toHaveLength(1)
  })

  it('skips walls with terrain wallType', () => {
    const layer = {
      type: 'dungeon' as const,
      children: [],
      standaloneWalls: [
        { id: 'w1', points: [[0, 0], [100, 0]] as [number, number][], wallType: 'terrain', direction: 'both', color: '#000', width: 2, roughness: 0 },
      ],
      mergedFloor: null,
    } as unknown as DungeonLayer

    const segs = extractWallSegments([layer])
    expect(segs).toHaveLength(0)
  })

  it('open door creates gap — light passes through', () => {
    const layer = {
      type: 'dungeon' as const,
      children: [
        { id: 'd1', childType: 'door', visible: true, wallId: 'w1', position: [50, 0] as [number, number], angle: 0, width: 20, style: 'single', state: 'open', isSecret: false, name: 'Door 1' },
      ],
      standaloneWalls: [
        { id: 'w1', points: [[0, 0], [100, 0]] as [number, number][], wallType: 'normal', direction: 'both', color: '#000', width: 2, roughness: 0 },
      ],
      mergedFloor: null,
    } as unknown as DungeonLayer

    const segs = extractWallSegments([layer])
    // Wall split into 2 sub-segments (before and after door gap)
    // Open door segment is NOT included (blocksLight = false)
    expect(segs).toHaveLength(2)
    // Total wall length should be less than 100 (gap removed)
    const totalLen = segs.reduce((sum, s) => sum + Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1), 0)
    expect(totalLen).toBeLessThan(100)
  })

  it('closed door blocks light — no gap', () => {
    const layer = {
      type: 'dungeon' as const,
      children: [
        { id: 'd1', childType: 'door', visible: true, wallId: 'w1', position: [50, 0] as [number, number], angle: 0, width: 20, style: 'single', state: 'closed', isSecret: false, name: 'Door 1' },
      ],
      standaloneWalls: [
        { id: 'w1', points: [[0, 0], [100, 0]] as [number, number][], wallType: 'normal', direction: 'both', color: '#000', width: 2, roughness: 0 },
      ],
      mergedFloor: null,
    } as unknown as DungeonLayer

    const segs = extractWallSegments([layer])
    // 2 wall sub-segments + 1 closed door segment (all block light) = 3
    expect(segs).toHaveLength(3)
  })
})
