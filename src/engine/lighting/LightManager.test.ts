import { describe, it, expect, beforeEach } from 'vitest'
import { LightManager } from './LightManager'
import type { Light } from '@/store/types'

const mockLight = (overrides?: Partial<Light>): Light => ({
  id: 'l1',
  position: { x: 100, y: 100 },
  color: '#ffffff',
  radius: 200,
  intensity: 1,
  falloff: 'linear',
  name: 'Test Light',
  visible: true,
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
    const lights = [mockLight()]
    manager.syncFromStore(lights)
    expect(manager.getLights()).toHaveLength(1)
    expect(manager.getLights()[0].id).toBe('l1')
  })

  it('invalidate marks specific light dirty', () => {
    manager.syncFromStore([mockLight()])
    manager.invalidate('l1')
    expect(manager.isDirty('l1')).toBe(true)
  })

  it('invalidateAll marks all lights dirty', () => {
    manager.syncFromStore([mockLight({ id: 'l1' }), mockLight({ id: 'l2' })])
    // clear first
    manager.clearDirty('l1')
    manager.clearDirty('l2')
    manager.invalidateAll()
    expect(manager.isDirty('l1')).toBe(true)
    expect(manager.isDirty('l2')).toBe(true)
  })

  it('removing a light clears its shadow cache entry', () => {
    manager.syncFromStore([mockLight()])
    manager.setCachedPolygon('l1', [[0,0],[100,0],[100,100]])
    manager.syncFromStore([]) // light removed
    expect(manager.getCachedPolygon('l1')).toBeNull()
  })

  it('syncFromStore invalidates lights whose position changed', () => {
    manager.syncFromStore([mockLight()])
    manager.clearDirty('l1')
    manager.syncFromStore([mockLight({ position: { x: 200, y: 200 } })])
    expect(manager.isDirty('l1')).toBe(true)
  })

  it('syncFromStore invalidates lights whose radius changed', () => {
    manager.syncFromStore([mockLight()])
    manager.clearDirty('l1')
    manager.syncFromStore([mockLight({ radius: 400 })])
    expect(manager.isDirty('l1')).toBe(true)
  })

  it('syncFromStore does not invalidate unchanged lights', () => {
    manager.syncFromStore([mockLight()])
    manager.clearDirty('l1')
    manager.syncFromStore([mockLight()]) // same data
    expect(manager.isDirty('l1')).toBe(false)
  })

  it('invisible lights are not in getVisibleLights()', () => {
    manager.syncFromStore([mockLight({ visible: false })])
    expect(manager.getVisibleLights()).toHaveLength(0)
  })
})
