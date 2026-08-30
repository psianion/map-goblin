import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { NewMapDialog } from './NewMapDialog'
import { useStore } from '@/store/store'
import type { DungeonLayer } from '@/store/types'

/** Put a 10×6-ish floor on the open map so `measureGridSize` has something to report. */
function drawSomething() {
  const dl = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!
  useStore.setState({
    layers: useStore
      .getState()
      .layers.map((l) =>
        l.id === dl.id ? { ...dl, mergedFloor: [[[2, 2], [12, 2], [12, 8], [2, 8]]] } : l,
      ) as DungeonLayer[],
  })
}

const noop = async () => ''

/** jsdom implements neither half of the object-URL pair the thumbnail needs. */
function stubObjectUrls() {
  const created: string[] = []
  const revoked: string[] = []
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:mock/${created.length}`
    created.push(url)
    return url
  })
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url))
  return { created, revoked }
}

describe('NewMapDialog', () => {
  beforeEach(() => {
    cleanup()
    useStore.getState().resetToDefault()
    useStore.setState({ activeMapId: 'm1', mapIndex: [] })
    stubObjectUrls()
  })

  it('opens on the blank path: name, start-from and an expanding size', () => {
    render(<NewMapDialog open onOpenChange={() => {}} />)

    expect(screen.getByText('New map')).toBeTruthy()
    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(screen.getByText('Start from')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Expanding' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('new-map-submit').textContent).toBe('Create map')
  })

  it('“Map file” collapses name and size, and stays unsubmittable until a file is picked', () => {
    render(<NewMapDialog open onOpenChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Map file/ }))

    expect(screen.queryByLabelText('Name')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Expanding' })).toBeNull()
    expect(screen.getByText(/Both come from the file/)).toBeTruthy()

    const submit = screen.getByTestId('new-map-submit')
    expect(submit.textContent).toBe('Open map')
    expect(submit.hasAttribute('disabled')).toBe(true)
  })

  it('names the recovery when the dropped file is not a map file', () => {
    render(<NewMapDialog open onOpenChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Map file/ }))
    fireEvent.drop(screen.getByTestId('new-map-dropzone'), {
      dataTransfer: { files: [new File(['x'], 'battlemap.png', { type: 'image/png' })] },
    })

    expect(screen.getByRole('alert').textContent).toContain('start from an image instead')
    expect(screen.getByTestId('new-map-submit').hasAttribute('disabled')).toBe(true)
  })

  describe('drop zone', () => {
    const dropOn = (zone: Element, file: File) =>
      fireEvent.drop(zone, { dataTransfer: { files: [file] } })

    it('takes a dropped .mapbuilder file, not just a clicked one', () => {
      render(<NewMapDialog open onOpenChange={() => {}} />)
      fireEvent.click(screen.getByRole('button', { name: /Map file/ }))
      dropOn(
        screen.getByTestId('new-map-dropzone'),
        new File(['{}'], 'warren.mapbuilder', { type: '' }),
      )

      expect(screen.getByText('warren.mapbuilder')).toBeTruthy()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByTestId('new-map-submit').hasAttribute('disabled')).toBe(false)
    })

    // Accepting an image reads its first bytes, so these assertions land a microtask later.
    it('takes a dropped image and shows it back as a thumbnail', async () => {
      render(<NewMapDialog open onOpenChange={() => {}} />)
      fireEvent.click(screen.getByRole('button', { name: /Image/ }))
      dropOn(
        screen.getByTestId('new-map-dropzone'),
        new File(['x'], 'tavern.png', { type: 'image/png' }),
      )

      const thumb = await screen.findByTestId('new-map-thumbnail')
      expect(thumb.getAttribute('src')).toBe('blob:mock/0')
      expect(screen.getByText('tavern.png')).toBeTruthy()
    })

    it('names the same recovery for a dropped non-image as for a picked one', async () => {
      render(<NewMapDialog open onOpenChange={() => {}} />)
      fireEvent.click(screen.getByRole('button', { name: /Image/ }))
      dropOn(
        screen.getByTestId('new-map-dropzone'),
        new File(['x'], 'warren.mapbuilder', { type: '' }),
      )

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain('PNG, JPEG, SVG or WebP')
      expect(screen.getByTestId('new-map-submit').hasAttribute('disabled')).toBe(true)
    })

    it('shows the drag is landing here, and stops when it leaves', () => {
      render(<NewMapDialog open onOpenChange={() => {}} />)
      fireEvent.click(screen.getByRole('button', { name: /Image/ }))
      const zone = screen.getByTestId('new-map-dropzone')

      expect(zone.hasAttribute('data-drag-over')).toBe(false)
      fireEvent.dragOver(zone)
      expect(zone.hasAttribute('data-drag-over')).toBe(true)
      fireEvent.dragLeave(zone)
      expect(zone.hasAttribute('data-drag-over')).toBe(false)
    })

    it('hands the preview URL back when the pick is cleared', async () => {
      const urls = stubObjectUrls()
      render(<NewMapDialog open onOpenChange={() => {}} />)
      fireEvent.click(screen.getByRole('button', { name: /Image/ }))
      dropOn(
        screen.getByTestId('new-map-dropzone'),
        new File(['x'], 'tavern.png', { type: 'image/png' }),
      )
      const remove = await screen.findByRole('button', { name: 'Remove tavern.png' })
      expect(urls.revoked).toEqual([])

      fireEvent.click(remove)

      expect(urls.revoked).toEqual(urls.created)
      expect(screen.queryByTestId('new-map-thumbnail')).toBeNull()
    })
  })

  it('reads the fixed boundary back in feet, from the map’s own cell scale', () => {
    render(<NewMapDialog open onOpenChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fixed' }))

    fireEvent.change(screen.getByTestId('new-map-width'), { target: { value: '30' } })
    fireEvent.change(screen.getByTestId('new-map-height'), { target: { value: '20' } })
    expect(screen.getByText('150 × 100 ft')).toBeTruthy()
  })

  it('refuses a size that is not whole cells rather than letting it through', () => {
    render(<NewMapDialog open onOpenChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fixed' }))
    fireEvent.change(screen.getByTestId('new-map-width'), { target: { value: '12.5' } })

    expect(screen.getByRole('alert').textContent).toContain('whole numbers of cells')
    expect(screen.getByTestId('new-map-submit').hasAttribute('disabled')).toBe(true)
  })

  it('writes the fixed size onto the new map', async () => {
    const createNewMap = vi.fn(noop)
    const saveCurrentMap = vi.fn(async () => {})
    useStore.setState({ createNewMap, saveCurrentMap })
    const onOpenChange = vi.fn()
    render(<NewMapDialog open onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Sunken Chapel  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fixed' }))
    fireEvent.change(screen.getByTestId('new-map-width'), { target: { value: '30' } })
    fireEvent.change(screen.getByTestId('new-map-height'), { target: { value: '20' } })
    fireEvent.click(screen.getByTestId('new-map-submit'))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(createNewMap).toHaveBeenCalledWith('Sunken Chapel')
    expect(useStore.getState().mapSettings.fixedSize).toEqual({ width: 30, height: 20 })
  })

  it('a blank name falls back rather than blocking', async () => {
    const createNewMap = vi.fn(noop)
    useStore.setState({ createNewMap, saveCurrentMap: async () => {} })
    render(<NewMapDialog open onOpenChange={() => {}} />)

    fireEvent.click(screen.getByTestId('new-map-submit'))
    await waitFor(() => expect(createNewMap).toHaveBeenCalledWith('Untitled map'))
  })

  describe('settings mode', () => {
    it('drops “Start from” and saves instead of creating', () => {
      render(<NewMapDialog open mode="settings" onOpenChange={() => {}} />)

      expect(screen.getByText('Map settings')).toBeTruthy()
      expect(screen.queryByText('Start from')).toBeNull()
      expect(screen.getByTestId('new-map-submit').textContent).toBe('Save')
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Untitled Map')
    })

    it('switching Expanding → Fixed prefills the size the map already measures', () => {
      drawSomething()
      render(<NewMapDialog open mode="settings" onOpenChange={() => {}} />)

      expect(screen.getByText(/Currently measuring/)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Fixed' }))

      const w = Number((screen.getByTestId('new-map-width') as HTMLInputElement).value)
      const h = Number((screen.getByTestId('new-map-height') as HTMLInputElement).value)
      expect(w).toBeGreaterThanOrEqual(10)
      expect(h).toBeGreaterThanOrEqual(6)
      expect(w - h).toBe(4)
    })

    it('clearing Fixed puts the map back to measuring itself', async () => {
      useStore.setState({
        saveCurrentMap: async () => {},
        renameMap: async () => {},
      })
      useStore.getState().setFixedSize({ width: 30, height: 20 })
      render(<NewMapDialog open mode="settings" onOpenChange={() => {}} />)

      expect(screen.getByRole('button', { name: 'Fixed' }).getAttribute('aria-pressed')).toBe('true')
      fireEvent.click(screen.getByRole('button', { name: 'Expanding' }))
      fireEvent.click(screen.getByTestId('new-map-submit'))

      await waitFor(() => expect(useStore.getState().mapSettings.fixedSize).toBeNull())
    })
  })
})
