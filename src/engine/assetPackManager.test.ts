import { describe, it, expect, beforeEach } from 'vitest'
import { AssetPackManager } from './assetPackManager'

describe('AssetPackManager', () => {
  let manager: AssetPackManager

  beforeEach(() => {
    manager = new AssetPackManager({ cdnBaseUrl: 'https://cdn.example.com' })
  })

  it('starts with no installed packs', () => {
    expect(manager.getInstalledPacks()).toEqual([])
  })

  it('getTexture returns null for unknown entry', () => {
    expect(manager.getTexture('nonexistent')).toBeNull()
  })

  it('getFrame returns null for unknown entry', () => {
    expect(manager.getFrame('nonexistent')).toBeNull()
  })
})
