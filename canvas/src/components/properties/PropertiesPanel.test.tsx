import { describe, it, expect, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
import { PropertiesPanel } from './PropertiesPanel'
import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import type { DungeonLayer, LightChild } from '@/store/types'

function dungeon(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon')
  if (!l) throw new Error('no dungeon layer')
  return l
}

function selectLight(): LightChild {
  const light: LightChild = {
    id: crypto.randomUUID(),
    name: 'Torch',
    childType: 'light',
    visible: true,
    color: '#ffcc66',
    radius: 4,
    featherRadius: 2,
    intensity: 0.8,
    falloff: 'linear',
    position: { x: 3, y: 3 },
  }
  useStore.getState().addChild(dungeon().id, light)
  useStore.getState().setActiveLayerId(dungeon().id)
  useStore.getState().setSelectedIds([light.id])
  return light
}

// A child on a locked layer stays selectable in the layers panel on purpose —
// you can read its numbers — but the panel's inputs used to still write.
describe('PropertiesPanel — locked owning layer', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  it('leaves the inputs live when the owning layer is unlocked', () => {
    selectLight()
    render(<PropertiesPanel />)

    expect(screen.queryByText('Layer is locked')).not.toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Intensity' })).getByRole('slider')).toBeEnabled()
    expect(screen.getByDisplayValue('Torch')).toBeEnabled()
  })

  it('disables the inputs and says why when the owning layer is locked', () => {
    selectLight()
    useStore.getState().updateLayer(dungeon().id, { locked: true })
    render(<PropertiesPanel />)

    expect(screen.getByText('Layer is locked')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Intensity' })).getByRole('slider')).toBeDisabled()
    expect(screen.getByDisplayValue('Torch')).toBeDisabled()
    // Inspection survives the lock: the section header still opens and closes.
    expect(screen.getByRole('button', { name: /LIGHT/ })).toBeEnabled()
  })

  it('says hidden when the owning layer is hidden', () => {
    selectLight()
    useStore.getState().updateLayer(dungeon().id, { visible: false })
    render(<PropertiesPanel />)

    expect(screen.getByText('Layer is hidden')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Torch')).toBeDisabled()
  })
})
