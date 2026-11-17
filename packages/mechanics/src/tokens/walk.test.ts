import { describe, expect, it } from 'vitest'
import {
  NO_GROUND,
  SOLID,
  STANDABLE,
  buildWalkGrid,
  cellAt,
  floodPath,
  walkRefusal,
  type WalkBlocker,
  type WalkView,
} from './walk'

const frame = (w: number, h: number) => ({ minX: 0, minY: 0, maxX: w, maxY: h })
const all = () => true

function view(blockers: WalkBlocker[], w = 10, h = 10, ground: (x: number, y: number) => boolean = all): WalkView {
  return {
    grid: buildWalkGrid(frame(w, h), ground, blockers),
    known: () => true,
    heldDoor: () => true,
    doorLocked: () => false,
  }
}

describe('the walk grid', () => {
  it('marks ground, and a cell solid only when a wall comes within its reach of the centre', () => {
    const grid = buildWalkGrid(frame(4, 1), (x) => x < 3, [{ x1: 1, y1: 0, x2: 1, y2: 1, reach: 0.25 }])
    expect([...grid.cell]).toEqual([STANDABLE, STANDABLE, STANDABLE, NO_GROUND])
    const thick = buildWalkGrid(frame(4, 1), all, [{ x1: 1, y1: 0, x2: 1, y2: 1, reach: 0.6 }])
    expect([...thick.cell]).toEqual([SOLID, SOLID, STANDABLE, STANDABLE])
  })

  it('reaches further on a rock’s outer side', () => {
    const outside = (x: number) => x < 1
    const grid = buildWalkGrid(frame(3, 1), all, [{ x1: 1, y1: 0, x2: 1, y2: 1, reach: 0.25, outerReach: 0.6, outside }])
    expect([...grid.cell]).toEqual([SOLID, STANDABLE, STANDABLE])
  })

  describe('floor under a cave’s rock (T12)', () => {
    // A speck of rock beside the middle cell's centre: inside its reach, cutting no step.
    const rock = (over: Partial<WalkBlocker>): WalkBlocker[] => [
      { x1: 1.4, y1: 0.3, x2: 1.6, y2: 0.3, reach: 0.45, outerReach: 0.45, outside: () => false, open: () => false, ...over },
    ]

    it('stays solid where the floor goes round it', () => {
      const grid = buildWalkGrid(frame(3, 2), all, rock({}))
      expect([...grid.cell]).toEqual([STANDABLE, SOLID, STANDABLE, STANDABLE, STANDABLE, STANDABLE])
    })

    it('stands where it is the only way between two stretches of floor', () => {
      const grid = buildWalkGrid(frame(3, 1), all, rock({}))
      expect([...grid.cell]).toEqual([STANDABLE, STANDABLE, STANDABLE])
    })

    it('stands where the tunnel is too narrow for the grid (`open`)', () => {
      const grid = buildWalkGrid(frame(3, 2), all, rock({ open: () => true }))
      expect([...grid.cell]).toEqual([STANDABLE, STANDABLE, STANDABLE, STANDABLE, STANDABLE, STANDABLE])
    })

    it('never gives way on the rock’s outer side', () => {
      const grid = buildWalkGrid(frame(3, 1), all, rock({ outside: () => true, open: () => true }))
      expect([...grid.cell]).toEqual([STANDABLE, SOLID, STANDABLE])
    })
  })

  it('stops a step that touches a wall, diagonals at a corner included', () => {
    const wall: WalkBlocker[] = [
      { x1: 2, y1: 0, x2: 2, y2: 2, reach: 0.25 },
      { x1: 2, y1: 2, x2: 4, y2: 2, reach: 0.25 },
    ]
    const v = view(wall, 4, 4)
    // The pocket the two walls close off with the frame is not reached; round the corner is, the long way.
    expect(floodPath(v.grid, cellAt(v.grid, 1.5, 0.5), cellAt(v.grid, 2.5, 0.5), v.known)).toBeNull()
    expect(floodPath(v.grid, cellAt(v.grid, 1.5, 1.5), cellAt(v.grid, 2.5, 2.5), v.known)!.length).toBeGreaterThan(1)
  })

  it('names the shut door on the way, and a refusing crossing when no door opens it', () => {
    const door: WalkBlocker[] = [
      { x1: 2, y1: 0, x2: 2, y2: 2, reach: 0.25 },
      { x1: 2, y1: 2, x2: 2, y2: 3, doorId: 'd1' },
      { x1: 2, y1: 3, x2: 2, y2: 5, reach: 0.25 },
    ]
    expect(walkRefusal(view(door, 5, 5), { x: 0.5, y: 0.5 }, { x: 4.5, y: 0.5 }, 1)).toBe(
      'door-closed d1: that space cannot be occupied',
    )
    const cliff: WalkBlocker[] = [{ x1: 2, y1: 0, x2: 2, y2: 5, crossing: 'CROSSING_BLOCKED impassable: Impassable' }]
    expect(walkRefusal(view(cliff, 5, 5), { x: 0.5, y: 0.5 }, { x: 4.5, y: 0.5 }, 1)).toBe(
      'CROSSING_BLOCKED impassable: Impassable',
    )
    expect(walkRefusal(view(cliff, 5, 5), { x: 0.5, y: 0.5 }, { x: 1.5, y: 4.5 }, 1)).toBeNull()
  })

  it('names a held door on the way to unknown ground, else calls it unexplored', () => {
    const door: WalkBlocker[] = [
      { x1: 2, y1: 0, x2: 2, y2: 2, reach: 0.25 },
      { x1: 2, y1: 2, x2: 2, y2: 3, doorId: 'd1' },
      { x1: 2, y1: 3, x2: 2, y2: 5, reach: 0.25 },
    ]
    // Only the near side of the wall is known.
    const v: WalkView = { ...view(door, 5, 5), known: (i) => i % 5 < 2 }
    expect(walkRefusal(v, { x: 0.5, y: 0.5 }, { x: 4.5, y: 0.5 }, 1)).toBe('door-closed d1: that space cannot be occupied')
    expect(walkRefusal({ ...v, doorLocked: () => true }, { x: 0.5, y: 0.5 }, { x: 4.5, y: 0.5 }, 1)).toMatch(/^door-locked d1/)
    // A door the seat does not hold is not named, and no start means no way to look for one.
    expect(walkRefusal({ ...v, heldDoor: () => false }, { x: 0.5, y: 0.5 }, { x: 4.5, y: 0.5 }, 1)).toMatch(/^room-unexplored/)
    expect(walkRefusal(v, null, { x: 4.5, y: 0.5 }, 1)).toMatch(/^room-unexplored/)
    // Unknown ground with no door on the way is unexplored.
    const open: WalkView = { ...view([], 5, 5), known: (i) => i % 5 < 2 }
    expect(walkRefusal(open, { x: 0.5, y: 0.5 }, { x: 4.5, y: 0.5 }, 1)).toMatch(/^room-unexplored/)
  })

  it('lets a token caught in rock walk out', () => {
    const v = view([{ x1: 2, y1: 0, x2: 2, y2: 3, reach: 0.6 }], 4, 3)
    expect(v.grid.cell[cellAt(v.grid, 1.5, 1.5)]).toBe(SOLID)
    expect(walkRefusal(v, { x: 0.5, y: 1.5 }, { x: 1.5, y: 1.5 }, 1)).toMatch(/^solid-ground/)
    expect(walkRefusal(v, { x: 1.5, y: 1.5 }, { x: 0.5, y: 0.5 }, 1)).toBeNull()
  })

  it('asks every covered cell of an even-sized token', () => {
    const v = view([{ x1: 0, y1: 2, x2: 4, y2: 2.2, reach: 0.45 }], 4, 4)
    // A large token at the intersection (2, 2) covers the four cells around it, two of them solid.
    expect(walkRefusal(v, null, { x: 2, y: 2 }, 2)).toMatch(/^solid-ground/)
    expect(walkRefusal(v, null, { x: 2, y: 4 }, 2)).toMatch(/^outside-map/)
  })

  it('floods a 512 by 512 map in well under a second', () => {
    const walls: WalkBlocker[] = []
    // A maze of long walls with one gap each, alternating ends, so the flood walks the whole map.
    for (let x = 16; x < 512; x += 16) {
      const gapAtTop = (x / 16) % 2 === 0
      walls.push(gapAtTop ? { x1: x, y1: 2, x2: x, y2: 512, reach: 0.25 } : { x1: x, y1: 0, x2: x, y2: 510, reach: 0.25 })
    }
    const built = Date.now()
    const v = view(walls, 512, 512)
    const flooded = Date.now()
    const path = floodPath(v.grid, cellAt(v.grid, 0.5, 0.5), cellAt(v.grid, 511.5, 511.5), v.known)
    const done = Date.now()
    expect(path).not.toBeNull()
    expect(flooded - built).toBeLessThan(1000)
    expect(done - flooded).toBeLessThan(500)
  })
})
