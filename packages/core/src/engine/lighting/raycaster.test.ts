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

  it('blocks light along every floor-ring edge', () => {
    const layer = {
      id: 'floor-only',
      type: 'dungeon' as const,
      children: [],
      standaloneWalls: [],
      mergedFloor: [[[0, 0], [100, 0], [100, 100], [0, 100]] as [number, number][]],
    } as unknown as DungeonLayer

    expect(extractWallSegments([layer])).toHaveLength(4)
  })

  it('open door on a floor-ring edge passes light', () => {
    const layer = {
      id: 'floor-door',
      type: 'dungeon' as const,
      children: [
        { id: 'd1', childType: 'door', visible: true, wallId: '', position: [50, 0] as [number, number], angle: 0, width: 20, style: 'single', state: 'open', isSecret: false, name: 'Door 1' },
      ],
      standaloneWalls: [],
      mergedFloor: [[[0, 0], [100, 0], [100, 100], [0, 100]] as [number, number][]],
    } as unknown as DungeonLayer

    // 3 intact edges + 2 stubs either side of the gap; the open door blocks nothing.
    expect(extractWallSegments([layer])).toHaveLength(5)
  })

  describe('door mid-hallway (corridor edge produced by the union)', () => {
    // Two rooms joined by a corridor, unioned into one ring — the shared edges
    // between the touching shapes are gone, so the corridor's long side is a
    // single ring edge with no standalone wall anywhere near it. That edge is
    // what a hallway door has to anchor to.
    //          (0,0)──────(40,0)      (100,0)──────(140,0)
    //            │           │           │            │
    //            │        (40,40)────(100,40)         │   ← corridor top edge
    //            │                                    │
    //          (0,80)────(40,80)   (100,80)────(140,80)   ← corridor bottom edge
    const hallwayRing: [number, number][] = [
      [0, 0], [40, 0], [40, 40], [100, 40], [100, 0], [140, 0],
      [140, 80], [100, 80], [100, 60], [40, 60], [40, 80], [0, 80],
    ]

    function layerWithDoor(state: string | null) {
      return {
        id: 'hallway',
        type: 'dungeon' as const,
        children: state
          ? [{ id: 'd1', childType: 'door', visible: true, wallId: '', position: [70, 40] as [number, number], angle: 0, width: 20, style: 'single', state, isSecret: false, name: 'Hall door' }]
          : [],
        standaloneWalls: [],
        mergedFloor: [hallwayRing],
      } as unknown as DungeonLayer
    }

    it('closed door on the corridor edge occludes', () => {
      const bare = extractWallSegments([layerWithDoor(null)]).length
      // Corridor edge split into 2 stubs + the closed door itself.
      expect(extractWallSegments([layerWithDoor('closed')])).toHaveLength(bare + 2)
    })

    it('open door on the corridor edge passes light', () => {
      const bare = extractWallSegments([layerWithDoor(null)]).length
      const open = extractWallSegments([layerWithDoor('open')])
      // 2 stubs replace 1 edge, and the doorway contributes nothing.
      expect(open).toHaveLength(bare + 1)

      const length = (segs: typeof open) =>
        segs.reduce((sum, s) => sum + Math.hypot(s.x2 - s.x1, s.y2 - s.y1), 0)
      const bareLength = length(extractWallSegments([layerWithDoor(null)]))
      expect(length(open)).toBeCloseTo(bareLength - 20, 5)
    })
  })
})
