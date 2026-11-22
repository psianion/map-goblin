// The fog rework's one model in the fog module: the switch, the brush on a level, Clear all,
// Fog all and their restore, and the party's own sight write.
import { describe, expect, it } from 'vitest'

import { DEFAULT_FOG_LOOK } from '@dnd/core/src/shared/fogLook'
import type { Viewer } from '../contract'
import { fogModule } from './module'
import { fillRegion, getCell, regionOf, setCells, type Frame, type RegionMask } from './region'
import type { FogState, SceneFog } from './types'

const DM: Viewer = { role: 'dm', identityId: 'dm-1' }
const P1: Viewer = { role: 'player', identityId: 'p-1' }
const SCENE = 'map-1'
const LEVELS = ['lvl-a', 'lvl-b']
const FRAME: Frame = { minX: 0, minY: 0, maxX: 10, maxY: 10 }

/** lvl-a has floor west of x = 6 only; lvl-b is floor everywhere. */
function moduleWith(frame: () => Frame | null = () => FRAME) {
  return fogModule(
    () => [],
    () => frame(),
    () => null,
    () => null,
    () => false,
    () => null,
    () => LEVELS,
    (_c, _s, levelId, x) => levelId === 'lvl-b' || x < 6,
  )
}

const ROSTER = [{ identityId: 'dm-1', name: 'Ayla', role: 'dm' as const, connected: true }]

function runOn(fog: ReturnType<typeof fogModule>, state: FogState, sender: Viewer, action: string, payload: unknown) {
  const roles = fog.commands[action]
  if (!roles) return { error: { code: 'invalid-command', message: 'not a command' }, next: state }
  if (!roles.includes(sender.role)) return { error: { code: 'unauthorized', message: '' }, next: state }
  let next = state
  const error = fog.handler(action, payload, {
    campaignId: 'c-1',
    sessionId: 's-1',
    activeSceneId: SCENE,
    sender,
    players: ROSTER,
    state,
    setState: (s) => {
      next = s
    },
    broadcast: () => {},
  })
  return { error: error ?? null, next }
}

/** The server's own path: no role gate, straight to the handler (`dispatchInternal`). */
function internal(fog: ReturnType<typeof fogModule>, state: FogState, action: string, payload: unknown) {
  let next = state
  const error = fog.handler(action, payload, {
    campaignId: 'c-1',
    sessionId: 's-1',
    activeSceneId: SCENE,
    sender: { role: 'dm', identityId: 'server' },
    players: [],
    state,
    setState: (s) => {
      next = s
    },
    broadcast: () => {},
  })
  return { error: error ?? null, next }
}

const fog = moduleWith()
const run = (state: FogState, sender: Viewer, action: string, payload: unknown) => runOn(fog, state, sender, action, payload)
const empty: FogState = { byScene: {} }
const sceneOf = (state: FogState): SceneFog => state.byScene[SCENE]
const on = (state: FogState, levelId: string, col: number, row: number) => getCell(sceneOf(state).cleared?.[levelId], col, row)

describe('who may send the new fog commands', () => {
  it.each([
    ['set-on', { on: true }],
    ['region-set', { levelId: 'lvl-a', op: 'clear', cells: [] }],
    ['clear-all', {}],
    ['fog-all', {}],
    ['restore', { cleared: {} }],
    ['set-auto-explore', { autoExplore: false }],
    ['set-fog-look', { look: null }],
  ])('%s is the DM’s alone', (action, payload) => {
    expect(run(empty, P1, action, payload).error).toMatchObject({ code: 'unauthorized' })
    expect(run(empty, DM, action, payload).error).toBeNull()
  })

  it('auto-explore is no seat’s command, not even the DM’s (row 18)', () => {
    expect(fog.commands['auto-explore']).toBeUndefined()
    expect(run(empty, P1, 'auto-explore', { byLevel: { 'lvl-a': [[0, 0]] } }).error).toMatchObject({ code: 'invalid-command' })
    expect(run(empty, DM, 'auto-explore', { byLevel: { 'lvl-a': [[0, 0]] } }).error).toMatchObject({ code: 'invalid-command' })
  })
})

describe('set-on', () => {
  it('switches fog and logs which way', () => {
    const lit = run(empty, DM, 'set-on', { on: true })
    expect(lit.error).toBeNull()
    expect(sceneOf(lit.next).on).toBe(true)
    expect(lit.next.log?.at(-1)).toMatchObject({ action: 'turned-fog-on', actor: 'Ayla', sceneId: SCENE })
    const off = run(lit.next, DM, 'set-on', { on: false })
    expect(sceneOf(off.next).on).toBe(false)
    expect(off.next.log?.at(-1)).toMatchObject({ action: 'turned-fog-off' })
  })

  it('keeps the cleared record across a switch', () => {
    const brushed = run(empty, DM, 'region-set', { levelId: 'lvl-a', op: 'clear', cells: [[1, 1]] }).next
    const off = run(run(brushed, DM, 'set-on', { on: true }).next, DM, 'set-on', { on: false }).next
    expect(on(off, 'lvl-a', 1, 1)).toBe(true)
  })

  it('is refused on a scene past 512 by 512 cells, which keeps no cell record (row 17)', () => {
    const huge = moduleWith(() => ({ minX: 0, minY: 0, maxX: 600, maxY: 600 }))
    const { error, next } = runOn(huge, empty, DM, 'set-on', { on: true })
    expect(error).toMatchObject({ code: 'invalid-command' })
    expect(error?.message).toMatch(/512 by 512/)
    expect(next).toBe(empty)
    // Off is never refused.
    expect(runOn(huge, empty, DM, 'set-on', { on: false }).error).toBeNull()
  })

  it('needs a boolean', () => {
    expect(run(empty, DM, 'set-on', { on: 'yes' }).error).toMatchObject({ code: 'invalid-command' })
  })
})

describe('the brush', () => {
  it('clears cells on the named level only (row 3)', () => {
    const { next, error } = run(empty, DM, 'region-set', { levelId: 'lvl-a', op: 'clear', cells: [[1, 1], [2, 1]] })
    expect(error).toBeNull()
    expect(on(next, 'lvl-a', 1, 1)).toBe(true)
    expect(on(next, 'lvl-a', 2, 1)).toBe(true)
    expect(sceneOf(next).cleared?.['lvl-b']).toBeUndefined()
    expect(next.log?.at(-1)).toMatchObject({ action: 'changed-fog' })
    expect(next.log?.at(-1)?.targetId).toBeUndefined()
  })

  it('never clears ground the level has no floor on; fog covers anything (row 4)', () => {
    const cleared = run(empty, DM, 'region-set', { levelId: 'lvl-a', op: 'clear', cells: [[5, 0], [6, 0], [9, 9]] }).next
    expect(on(cleared, 'lvl-a', 5, 0)).toBe(true)
    expect(on(cleared, 'lvl-a', 6, 0)).toBe(false)
    expect(on(cleared, 'lvl-a', 9, 9)).toBe(false)
    // Clear all fills off-floor cells too; the fog stroke takes them back all the same.
    const all = run(empty, DM, 'clear-all', {}).next
    const fogged = run(all, DM, 'region-set', { levelId: 'lvl-a', op: 'fog', cells: [[9, 9], [1, 1]] }).next
    expect(on(fogged, 'lvl-a', 9, 9)).toBe(false)
    expect(on(fogged, 'lvl-a', 1, 1)).toBe(false)
    expect(on(fogged, 'lvl-a', 2, 2)).toBe(true)
    expect(on(fogged, 'lvl-b', 9, 9)).toBe(true)
  })

  it('refuses a level the map does not have, and a cell outside the scene', () => {
    expect(run(empty, DM, 'region-set', { levelId: 'lvl-z', op: 'clear', cells: [] }).error).toMatchObject({ code: 'invalid-command' })
    expect(run(empty, DM, 'region-set', { levelId: 'lvl-a', op: 'clear', cells: [[10, 0]] }).error).toMatchObject({ code: 'invalid-command' })
  })

  it('leaves the old reveal stroke to the old record', () => {
    const { next, error } = run(empty, DM, 'region-set', { op: 'reveal', cells: [[1, 1]] })
    expect(error).toBeNull()
    expect(sceneOf(next).cleared).toBeUndefined()
  })
})

describe('Clear all, Fog all and restore (row 6)', () => {
  it('round-trips the record', () => {
    const before = run(empty, DM, 'region-set', { levelId: 'lvl-b', op: 'clear', cells: [[3, 4], [7, 7]] }).next
    const record = sceneOf(before).cleared!

    const all = run(before, DM, 'clear-all', {})
    expect(all.error).toBeNull()
    for (const level of LEVELS) expect(sceneOf(all.next).cleared?.[level]).toEqual(fillRegion(regionOf(FRAME)!))
    expect(all.next.log?.at(-1)).toMatchObject({ action: 'cleared-all' })
    const undoAll = run(all.next, DM, 'restore', { cleared: record })
    expect(undoAll.error).toBeNull()
    expect(sceneOf(undoAll.next).cleared).toEqual(record)

    const none = run(before, DM, 'fog-all', {})
    expect(sceneOf(none.next).cleared).toBeUndefined()
    expect(none.next.log?.at(-1)).toMatchObject({ action: 'fogged-all' })
    expect(sceneOf(run(none.next, DM, 'restore', { cleared: record }).next).cleared).toEqual(record)
    // An empty record restores to nothing cleared.
    expect(sceneOf(run(before, DM, 'restore', { cleared: {} }).next).cleared).toBeUndefined()
  })

  it('refuses a record that does not hold together', () => {
    const good = regionOf(FRAME)!
    const bad = (cleared: unknown) => run(empty, DM, 'restore', { cleared }).error
    expect(bad({ 'lvl-z': good })).toMatchObject({ code: 'invalid-command' })
    expect(bad({ 'lvl-a': { ...good, bits: 'AAAA' } })).toMatchObject({ code: 'invalid-command' })
    expect(bad({ 'lvl-a': { ...good, cols: 1.5 } })).toMatchObject({ code: 'invalid-command' })
    expect(bad({ 'lvl-a': { ...good, bits: '%%%' } })).toMatchObject({ code: 'invalid-command' })
    expect(bad(null)).toMatchObject({ code: 'invalid-command' })
  })
})

describe('the party’s sight write', () => {
  it('ORs each level’s cells in, as one write with no log line', () => {
    const start = run(empty, DM, 'region-set', { levelId: 'lvl-a', op: 'clear', cells: [[0, 0]] }).next
    const { error, next } = internal(fog, start, 'auto-explore', { sceneId: SCENE, byLevel: { 'lvl-a': [[1, 0]], 'lvl-b': [[2, 2]] } })
    expect(error).toBeNull()
    expect(on(next, 'lvl-a', 0, 0)).toBe(true)
    expect(on(next, 'lvl-a', 1, 0)).toBe(true)
    expect(on(next, 'lvl-b', 2, 2)).toBe(true)
    expect(next.log).toEqual(start.log)
  })

  it('refuses a level the map does not have', () => {
    expect(internal(fog, empty, 'auto-explore', { byLevel: { 'lvl-z': [] } }).error).toMatchObject({ code: 'invalid-command' })
  })
})

describe('a republish that moves the frame (row 14)', () => {
  it('keeps cleared cells in place on the map and drops those outside it', () => {
    let frame: Frame = FRAME
    const moving = moduleWith(() => frame)
    // (1, 1) and (9, 9) on the 0..10 frame.
    const start = runOn(moving, empty, DM, 'region-set', { levelId: 'lvl-b', op: 'clear', cells: [[1, 1], [9, 9]] }).next
    // The map grows west by two cells and loses its east edge.
    frame = { minX: -2, minY: 0, maxX: 8, maxY: 10 }
    const next = runOn(moving, start, DM, 'region-set', { levelId: 'lvl-b', op: 'clear', cells: [[0, 0]] }).next
    const mask: RegionMask = sceneOf(next).cleared!['lvl-b']
    expect([mask.minX, mask.cols]).toEqual([-2, 10])
    // World (1, 1) is column 3 now.
    expect(getCell(mask, 3, 1)).toBe(true)
    expect(getCell(mask, 1, 1)).toBe(false)
    expect(getCell(mask, 0, 0)).toBe(true)
    // World (9, 9) is past the new east edge.
    expect(setCells(regionOf(frame)!, [[0, 0], [3, 1]]).bits).toBe(mask.bits)
  })
})

describe('the default look (fog rework §2.8)', () => {
  it('is three billow layers with a narrow edge and no veil, and the validator takes it whole', () => {
    expect(DEFAULT_FOG_LOOK.layers.map((l) => [l.type, l.tint])).toEqual([
      ['billow', '#aab2ba'],
      ['billow', '#d5dade'],
      ['billow', '#f2f4f6'],
    ])
    expect([DEFAULT_FOG_LOOK.fade, DEFAULT_FOG_LOOK.veil, DEFAULT_FOG_LOOK.preset]).toEqual([2, 0, undefined])
    const { next, error } = run(empty, DM, 'set-fog-look', { look: DEFAULT_FOG_LOOK })
    expect(error).toBeNull()
    expect(sceneOf(next).look).toEqual(DEFAULT_FOG_LOOK)
  })
})
