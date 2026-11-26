// Undo for the DM: the diff, putting either side back, grouping, the cap and the redo list.
import { describe, expect, it } from 'vitest'

import { fogHistory, getCell, regionOf, setCells, type RegionMask } from '@dnd/mechanics/fog'
import {
  HISTORY_MAX,
  History,
  applyChanges,
  diff,
  mergeChanges,
  type Change,
  type DiffStats,
  type Step,
} from './history'

const step = (changes: Change[], extra: Partial<Step> = {}): Step => ({
  name: { module: 'tokens', action: 'move' },
  seat: 'dm-1',
  sceneId: 's1',
  changes: { tokens: changes },
  ...extra,
})

describe('diff', () => {
  it('finds the changed leaves and skips unchanged subtrees by reference', () => {
    const shared = { a: 1 }
    const before = { keep: shared, t: { x: 1, y: 2 }, list: [1, 2] }
    const after = { keep: shared, t: { x: 5, y: 2 }, list: [1, 2, 3], added: true }
    expect(diff(before, after)).toEqual([
      { path: ['t', 'x'], before: 1, after: 5 },
      { path: ['list'], before: [1, 2], after: [1, 2, 3] },
      { path: ['added'], before: undefined, after: true },
    ])
  })

  it('reports a removed key with an absent after, and nothing for equal states', () => {
    expect(diff({ a: { b: 1 } }, {})).toEqual([{ path: ['a'], before: { b: 1 }, after: undefined }])
    const same = { a: 1 }
    expect(diff(same, same)).toEqual([])
  })

  it('treats arrays and other values as leaves', () => {
    expect(diff({ a: [{ x: 1 }] }, { a: [{ x: 2 }] })).toEqual([
      { path: ['a'], before: [{ x: 1 }], after: [{ x: 2 }] },
    ])
  })

  it('visits one scene key per token and the moved token only', () => {
    const tokens: Record<string, { x: number; y: number }> = {}
    for (let i = 0; i < 200; i++) tokens[`t${i}`] = { x: i, y: 0 }
    const before = { library: {}, byScene: { s1: tokens } }
    const after = { ...before, byScene: { s1: { ...tokens, t7: { ...tokens.t7, x: 99 } } } }
    const stats: DiffStats = { visited: 0 }
    expect(diff(before, after, undefined, stats)).toEqual([{ path: ['byScene', 's1', 't7', 'x'], before: 7, after: 99 }])
    expect(stats.visited).toBeLessThan(1000)
  })
})

describe('applyChanges', () => {
  it('puts the before values back and keeps what changed elsewhere since', () => {
    const before = { byScene: { s1: { a: { x: 1 }, b: { x: 1 } } } }
    const after = { byScene: { s1: { a: { x: 2 }, b: { x: 1 } } } }
    const changes = diff(before, after)
    // A player moved b after the DM moved a.
    const now = { byScene: { s1: { a: { x: 2 }, b: { x: 9 } } } }
    const undone = applyChanges(now, changes, 'before')
    expect(undone).toEqual({ byScene: { s1: { a: { x: 1 }, b: { x: 9 } } } })
    expect(applyChanges(undone, changes, 'after')).toEqual(now)
  })

  it('deletes a key that was absent and brings back a deleted one', () => {
    const changes = diff({ m: { a: 1 } }, { m: { b: 2 } })
    expect(applyChanges({ m: { b: 2, c: 3 } }, changes, 'before')).toEqual({ m: { a: 1, c: 3 } })
  })

  it('keeps unchanged subtrees by reference', () => {
    const other = { y: 1 }
    const state = { a: { x: 1 }, other }
    const next = applyChanges(state, [{ path: ['a', 'x'], before: 0, after: 1 }], 'before') as typeof state
    expect(next.other).toBe(other)
  })

  it('rebuilds the parents a step names when they are gone', () => {
    const changes: Change[] = [{ path: ['byScene', 'gone', 't1'], before: { x: 1 }, after: undefined }]
    expect(applyChanges({ byScene: {} }, changes, 'before')).toEqual({ byScene: { gone: { t1: { x: 1 } } } })
  })
})

describe('mergeChanges', () => {
  it('keeps the first before and the last after of a leaf', () => {
    const merged = mergeChanges([{ path: ['t', 'x'], before: 1, after: 2 }], [{ path: ['t', 'x'], before: 2, after: 3 }])
    expect(merged).toEqual([{ path: ['t', 'x'], before: 1, after: 3 }])
  })

  it('folds a later change inside an earlier subtree into its after', () => {
    const merged = mergeChanges(
      [{ path: ['t'], before: undefined, after: { x: 1 } }],
      [{ path: ['t', 'x'], before: 1, after: 4 }],
    )
    expect(merged).toEqual([{ path: ['t'], before: undefined, after: { x: 4 } }])
  })

  it('gives a later change over an earlier subtree the earlier before', () => {
    const merged = mergeChanges(
      [{ path: ['t', 'x'], before: 1, after: 2 }],
      [{ path: ['t'], before: { x: 2, y: 0 }, after: undefined }],
    )
    expect(merged).toEqual([{ path: ['t'], before: { x: 1, y: 0 }, after: undefined }])
  })
})

describe('History', () => {
  it('undoes and redoes the top step', () => {
    const h = new History()
    h.record(step([{ path: ['a'], before: 1, after: 2 }]))
    expect(h.names()).toEqual({ undo: { module: 'tokens', action: 'move' }, redo: null })
    expect(h.undo()?.changes.tokens[0].before).toBe(1)
    expect(h.names()).toEqual({ undo: null, redo: { module: 'tokens', action: 'move' } })
    expect(h.redo()?.changes.tokens[0].after).toBe(2)
    expect(h.undo()).toBeDefined()
    expect(h.undo()).toBeUndefined()
  })

  it('records nothing for an empty step and keeps the redo list', () => {
    const h = new History()
    h.record(step([{ path: ['a'], before: 1, after: 2 }]))
    h.undo()
    h.record(step([]))
    expect(h.names()).toEqual({ undo: null, redo: { module: 'tokens', action: 'move' } })
  })

  it('empties the redo list on a new step', () => {
    const h = new History()
    h.record(step([{ path: ['a'], before: 1, after: 2 }]))
    h.undo()
    h.record(step([{ path: ['b'], before: 1, after: 2 }]))
    expect(h.names().redo).toBeNull()
  })

  it('merges steps of one group from one seat into one', () => {
    const h = new History()
    h.record(step([{ path: ['t', 'x'], before: 0, after: 1 }], { group: 'drag-1' }))
    h.record(step([{ path: ['t', 'x'], before: 1, after: 2 }], { group: 'drag-1' }))
    h.record(step([{ path: ['t', 'x'], before: 2, after: 3 }], { group: 'drag-1', changes: { tokens: [{ path: ['t', 'x'], before: 2, after: 3 }], triggers: [{ path: ['fired'], before: undefined, after: true }] } }))
    const undone = h.undo()!
    expect(undone.changes.tokens).toEqual([{ path: ['t', 'x'], before: 0, after: 3 }])
    expect(undone.changes.triggers).toEqual([{ path: ['fired'], before: undefined, after: true }])
    expect(h.undo()).toBeUndefined()
  })

  it('does not merge another group or another seat', () => {
    const h = new History()
    h.record(step([{ path: ['a'], before: 0, after: 1 }], { group: 'g1' }))
    h.record(step([{ path: ['a'], before: 1, after: 2 }], { group: 'g2' }))
    h.record(step([{ path: ['a'], before: 2, after: 3 }], { group: 'g2', seat: 'dm-2' }))
    h.record(step([{ path: ['a'], before: 3, after: 4 }]))
    h.record(step([{ path: ['a'], before: 4, after: 5 }]))
    let count = 0
    while (h.undo()) count++
    expect(count).toBe(5)
  })

  it('keeps the newest hundred steps', () => {
    const h = new History()
    for (let i = 0; i < HISTORY_MAX + 5; i++) h.record(step([{ path: ['a'], before: i, after: i + 1 }]))
    let last: Step | undefined
    let count = 0
    for (let s = h.undo(); s; s = h.undo()) {
      last = s
      count++
    }
    expect(count).toBe(HISTORY_MAX)
    expect(last?.changes.tokens[0].before).toBe(5)
  })
})

describe('the fog rule', () => {
  const FRAME = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
  const empty = regionOf(FRAME)!
  const fogOf = (mask: RegionMask | undefined) => ({
    byScene: { s1: { on: true, ...(mask ? { cleared: { L: mask } } : {}) } },
  })

  it('diffs each level record whole, even where the scene had none', () => {
    const changes = diff({ byScene: {} }, fogOf(setCells(empty, [[1, 1]])), fogHistory)
    expect(changes.map((c) => c.path)).toEqual([
      ['byScene', 's1', 'on'],
      ['byScene', 's1', 'cleared', 'L'],
    ])
  })

  it('undoing a stroke fogs only the cells it cleared and keeps cells cleared since', () => {
    const before = fogOf(setCells(empty, [[0, 0]]))
    const after = fogOf(setCells(empty, [[0, 0], [1, 1], [2, 2]]))
    const changes = diff(before, after, fogHistory)
    // The party explored (5, 5) after the stroke.
    const now = fogOf(setCells(empty, [[0, 0], [1, 1], [2, 2], [5, 5]]))
    const undone = applyChanges(now, changes, 'before', fogHistory) as ReturnType<typeof fogOf>
    const mask = undone.byScene.s1.cleared!.L
    expect([getCell(mask, 0, 0), getCell(mask, 1, 1), getCell(mask, 2, 2), getCell(mask, 5, 5)]).toEqual([
      true,
      false,
      false,
      true,
    ])
    const redone = applyChanges(undone, changes, 'after', fogHistory) as ReturnType<typeof fogOf>
    expect(getCell(redone.byScene.s1.cleared!.L, 1, 1)).toBe(true)
    expect(getCell(redone.byScene.s1.cleared!.L, 5, 5)).toBe(true)
  })

  it('undoing Fog all clears what it fogged and keeps what was explored since', () => {
    const before = fogOf(setCells(empty, [[1, 1]]))
    const after = fogOf(undefined)
    const changes = diff(before, after, fogHistory)
    const now = fogOf(setCells(empty, [[4, 4]]))
    const undone = applyChanges(now, changes, 'before', fogHistory) as ReturnType<typeof fogOf>
    const mask = undone.byScene.s1.cleared!.L
    expect([getCell(mask, 1, 1), getCell(mask, 4, 4)]).toEqual([true, true])
  })

  it('lands cells where they are on the map after a republish moved the frame', () => {
    const before = fogOf(undefined)
    const after = fogOf(setCells(empty, [[3, 3]]))
    const changes = diff(before, after, fogHistory)
    // The map grew by two cells to the west and north: world (3, 3) is now (5, 5).
    const moved = regionOf({ minX: -2, minY: -2, maxX: 10, maxY: 10 })!
    const now = fogOf(setCells(moved, [[5, 5], [0, 0]]))
    const undone = applyChanges(now, changes, 'before', fogHistory) as ReturnType<typeof fogOf>
    const mask = undone.byScene.s1.cleared!.L
    expect(mask.minX).toBe(-2)
    expect([getCell(mask, 5, 5), getCell(mask, 0, 0)]).toEqual([false, true])
  })
})
