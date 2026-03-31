import { describe, it, expect, beforeEach } from 'vitest'
import { LightManager } from './LightManager'
import type { LightChild } from '../../store/types'

const mockLight = (overrides?: Partial<LightChild>): LightChild => ({
  id: 'l1',
  childType: 'light',
  name: 'Test Light',
  visible: true,
  position: { x: 100, y: 100 },
  color: '#ffffff',
  radius: 200,
  featherRadius: 100,
  intensity: 1,
  falloff: 'linear',
  ...overrides,
})

describe('LightManager', () => {
  let manager: LightManager

  beforeEach(() => {
    manager = new LightManager()
  })

  it('starts with empty light list', () => {
    expect(manager.getLights()).toHaveLength(0)
  })

  it('syncFromStore updates lights list', () => {
    manager.syncFromStore([mockLight()])
    expect(manager.getLights()).toHaveLength(1)
    expect(manager.getLights()[0].id).toBe('l1')
  })

  it('invalidate marks specific light dirty', () => {
    manager.syncFromStore([mockLight()])
    expect(manager.isDirty('l1')).toBe(true)
  })

  it('invalidateAll marks all lights dirty and sets wallsDirty', () => {
    manager.syncFromStore([mockLight({ id: 'l1' }), mockLight({ id: 'l2' })])
    manager.invalidateAll()
    expect(manager.isDirty('l1')).toBe(true)
    expect(manager.isDirty('l2')).toBe(true)
    expect(manager.isWallsDirty()).toBe(true)
  })

  it('syncFromStore invalidates lights whose position changed', () => {
    manager.syncFromStore([mockLight()])
    manager.getOrComputePolygon(mockLight())
    manager.syncFromStore([mockLight({ position: { x: 200, y: 200 } })])
    expect(manager.isDirty('l1')).toBe(true)
  })

  it('syncFromStore invalidates lights whose radius changed', () => {
    manager.syncFromStore([mockLight()])
    manager.getOrComputePolygon(mockLight())
    manager.syncFromStore([mockLight({ radius: 400 })])
    expect(manager.isDirty('l1')).toBe(true)
  })

  it('syncFromStore does not invalidate unchanged lights', () => {
    manager.syncFromStore([mockLight()])
    manager.getOrComputePolygon(mockLight())
    manager.syncFromStore([mockLight()])
    expect(manager.isDirty('l1')).toBe(false)
  })

  it('invisible lights are not in getVisibleLights()', () => {
    manager.syncFromStore([mockLight({ visible: false })])
    expect(manager.getVisibleLights()).toHaveLength(0)
  })

  it('wallsDirty is true initially', () => {
    expect(manager.isWallsDirty()).toBe(true)
  })

  it('removing a light clears its cache entry', () => {
    manager.syncFromStore([mockLight()])
    manager.getOrComputePolygon(mockLight())
    expect(manager.isDirty('l1')).toBe(false)
    manager.syncFromStore([])
    manager.syncFromStore([mockLight()])
    expect(manager.isDirty('l1')).toBe(true)
  })

  it('rebuildIfDirty clears wallsDirty flag', () => {
    expect(manager.isWallsDirty()).toBe(true)
    manager.rebuildIfDirty([] as unknown as import('../../store/types').DungeonLayer[])
    expect(manager.isWallsDirty()).toBe(false)
  })

  it('getOrComputePolygon returns cached result on second call', () => {
    manager.syncFromStore([mockLight()])
    const first = manager.getOrComputePolygon(mockLight())
    expect(manager.isDirty('l1')).toBe(false)
    const second = manager.getOrComputePolygon(mockLight())
    expect(second).toBe(first)
  })
})
