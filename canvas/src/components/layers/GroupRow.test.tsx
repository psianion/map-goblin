import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { ChildGroups } from './ChildGroups'
import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import { createDungeonLayer } from '@/store/factories'
import { isNamedGroupExpanded } from '@/store/selectors'
import { notify } from '@/lib/toast'
import type { AssetChild, DungeonLayer } from '@/store/types'

function asset(id: string, groupId?: string): AssetChild {
  return {
    id,
    name: id,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'tree-a',
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
    ...(groupId ? { groupId } : {}),
  }
}

function layerWithGroup(merged = false, extra: AssetChild[] = []): DungeonLayer {
  const layer = createDungeonLayer('Layer 1')
  layer.children = [asset('a', 'g1'), asset('b', 'g1'), ...extra]
  // "Ridge" deliberately shares no letter with the member names, so a filter
  // test can hit a member without also hitting the group name.
  layer.groups = [{ id: 'g1', name: 'Ridge', merged }]
  useStore.getState().addLayer(layer)
  return useStore.getState().layers.find((l) => l.id === layer.id) as DungeonLayer
}

function renderGroups(layer: DungeonLayer, filter = '') {
  return render(
    <DndContext>
      <ChildGroups layer={layer} filter={filter} />
    </DndContext>,
  )
}

function current(id: string): DungeonLayer {
  return useStore.getState().layers.find((l) => l.id === id) as DungeonLayer
}

describe('GroupRow', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  it('renders a plain group above the type buckets, collapsed by default', () => {
    const layer = layerWithGroup(false, [asset('loose')])
    renderGroups(layer)

    const header = screen.getByTestId('named-group-header')
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(header.getAttribute('aria-level')).toBe('2')
    expect(screen.getByText('Ridge')).toBeTruthy()
    // Members hidden while collapsed; the ungrouped child keeps its bucket.
    expect(screen.queryByText('a')).toBeNull()
    expect(screen.getByTestId('child-group-header').getAttribute('data-group-type')).toBe('asset')
    // Folder sits above the Assets bucket.
    const rows = screen.getAllByRole('treeitem')
    expect(rows[0]).toBe(header)
  })

  it('expands members on the chevron and keeps them out of the type bucket', () => {
    const layer = layerWithGroup()
    renderGroups(layer)

    fireEvent.click(screen.getByLabelText('Expand Ridge'))
    expect(screen.getByText('a')).toBeTruthy()
    expect(screen.getByText('b')).toBeTruthy()
    expect(isNamedGroupExpanded(useStore.getState(), layer.id, 'g1')).toBe(true)
    // Assets bucket is gone — both assets are in the folder.
    expect(screen.queryByTestId('child-group-header')).toBeNull()
  })

  // The chevron shipped as a bare 12px glyph while LayerRow's, one column
  // over, already had the 24px WCAG 2.5.8 hit area.
  it('gives the chevron the same 24px hit area as the layer row', () => {
    renderGroups(layerWithGroup())
    expect(screen.getByLabelText('Expand Ridge').className).toContain('w-6 h-6 -m-1')
  })

  it('renders a merged group as one row with no chevron and no member rows', () => {
    const layer = layerWithGroup(true)
    renderGroups(layer)

    const header = screen.getByTestId('named-group-header')
    expect(header.getAttribute('data-merged')).toBe('true')
    expect(header.getAttribute('aria-expanded')).toBeNull()
    expect(screen.queryByLabelText('Expand Ridge')).toBeNull()
    expect(screen.queryByText('a')).toBeNull()
    expect(screen.getByText('(2)')).toBeTruthy()
  })

  // A 300-member folder used to mount 300 rows; the asset bucket's windowed
  // list is now shared (VirtualChildList).
  it('windows a big group instead of mounting every member', () => {
    const layer = createDungeonLayer('Layer 1')
    layer.children = Array.from({ length: 100 }, (_, i) => asset(`m${i}`, 'g1'))
    layer.groups = [{ id: 'g1', name: 'Ridge' }]
    useStore.getState().addLayer(layer)
    const { container } = renderGroups(current(layer.id))

    fireEvent.click(screen.getByLabelText('Expand Ridge'))
    // jsdom reports a zero-height scroller, so the window is empty — the point
    // is that it is a WINDOW: a sized spacer stands in for all 100 rows.
    expect(screen.queryAllByTestId('child-row').length).toBeLessThan(100)
    expect(
      container.querySelector<HTMLElement>('[style*="height: 2600px"]'),
    ).toBeTruthy()
    expect(screen.getByText('(100)')).toBeTruthy()
  })

  it('still maps a small group directly, keeping keyboard drag-reorder', () => {
    renderGroups(layerWithGroup())
    fireEvent.click(screen.getByLabelText('Expand Ridge'))
    expect(screen.getAllByTestId('child-row')).toHaveLength(2)
  })

  it('announces the kind and count, since the folder icon is decorative', () => {
    renderGroups(layerWithGroup())
    expect(screen.getByTestId('named-group-header').getAttribute('aria-label')).toBe(
      'Ridge, group, 2 objects',
    )
    useStore.getState().resetToDefault()
    renderGroups(layerWithGroup(true))
    expect(screen.getAllByTestId('named-group-header')[1].getAttribute('aria-label')).toBe(
      'Ridge, merged group, 2 objects',
    )
  })

  // text-muted on the dimmed row measured 3.55:1 — under the 4.5:1 floor.
  it('darkens the badge and eye on a fully hidden group', () => {
    const layer = createDungeonLayer('Layer 1')
    layer.children = [
      { ...asset('a', 'g1'), visible: false },
      { ...asset('b', 'g1'), visible: false },
    ]
    layer.groups = [{ id: 'g1', name: 'Ridge' }]
    useStore.getState().addLayer(layer)
    renderGroups(current(layer.id))

    expect(screen.getByText('(2)').className).toContain('text-text-dim')
    expect(screen.getByLabelText('Show Ridge').className).toContain('text-text-dim')
  })

  it('selects every member on click', () => {
    const layer = layerWithGroup()
    renderGroups(layer)

    fireEvent.click(screen.getByTestId('named-group-header'))
    expect([...useStore.getState().selection.selectedIds].sort()).toEqual(['a', 'b'])
  })

  it('marks the header selected only when every member is selected', () => {
    const layer = layerWithGroup()
    useStore.getState().setSelectedIds(['a'])
    const { rerender } = renderGroups(layer)
    expect(screen.getByTestId('named-group-header').getAttribute('aria-selected')).toBe('false')

    useStore.getState().setSelectedIds(['a', 'b'])
    rerender(
      <DndContext>
        <ChildGroups layer={current(layer.id)} filter="" />
      </DndContext>,
    )
    expect(screen.getByTestId('named-group-header').getAttribute('aria-selected')).toBe('true')
  })

  it('commits a rename through the group rename command', () => {
    const layer = layerWithGroup()
    renderGroups(layer)

    fireEvent.contextMenu(screen.getByTestId('named-group-header'))
    fireEvent.click(screen.getByText('Rename'))
    const input = screen.getByDisplayValue('Ridge')
    fireEvent.change(input, { target: { value: 'Bandit Camp' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(current(layer.id).groups?.[0].name).toBe('Bandit Camp')
  })

  it('ungroups from the menu and leaves the members in place', () => {
    const layer = layerWithGroup()
    renderGroups(layer)

    fireEvent.contextMenu(screen.getByTestId('named-group-header'))
    fireEvent.click(screen.getByText('Ungroup'))

    const after = current(layer.id)
    expect(after.children.map((c) => c.groupId)).toEqual([undefined, undefined])
    expect(after.groups ?? []).toHaveLength(0)
  })

  it('offers Unmerge (not Ungroup) on a merged group', () => {
    const layer = layerWithGroup(true)
    renderGroups(layer)

    fireEvent.contextMenu(screen.getByTestId('named-group-header'))
    expect(screen.getByText('Unmerge')).toBeTruthy()
    expect(screen.queryByText('Ungroup')).toBeNull()
  })

  it('deletes the group and names it with its member count in the toast', () => {
    const layer = layerWithGroup()
    const action = vi.spyOn(notify, 'action').mockImplementation(() => {})
    renderGroups(layer)

    fireEvent.contextMenu(screen.getByTestId('named-group-header'))
    fireEvent.click(screen.getByText('Delete group'))

    expect(current(layer.id).children).toHaveLength(0)
    expect(action.mock.calls[0][0]).toBe('Deleted “Ridge” — 2 objects')
    action.mockRestore()
  })

  it('hides every member in one undoable step', () => {
    const layer = layerWithGroup()
    renderGroups(layer)

    fireEvent.contextMenu(screen.getByTestId('named-group-header'))
    fireEvent.click(screen.getByText('Hide'))
    expect(current(layer.id).children.every((c) => !c.visible)).toBe(true)

    undoManager.undo()
    expect(current(layer.id).children.every((c) => c.visible)).toBe(true)
  })

  it('forces a collapsed group open when a member matches the filter', () => {
    renderGroups(layerWithGroup(), 'a')
    expect(screen.getByText('a')).toBeTruthy()
    expect(screen.queryByText('b')).toBeNull()
    expect(screen.getByText('1 / 2')).toBeTruthy()
  })

  it('reveals the whole group when the filter matches the group name', () => {
    renderGroups(layerWithGroup(), 'ridge')
    expect(screen.getByText('a')).toBeTruthy()
    expect(screen.getByText('b')).toBeTruthy()
    expect(screen.getByText('(2)')).toBeTruthy()
  })

  it('hides a group whose name and members all miss the filter', () => {
    const layer = layerWithGroup(false, [asset('loose')])
    renderGroups(layer, 'loose')
    expect(screen.queryByTestId('named-group-header')).toBeNull()
    // …and its members do not fall back into the Assets bucket.
    expect(screen.queryByText('a')).toBeNull()
  })
})

describe('ChildRow — group menu items', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  it('removes a single child from its group', () => {
    const layer = layerWithGroup()
    useStore.getState().toggleChildGroup(`${layer.id}:group:g1`)
    renderGroups(current(layer.id))

    fireEvent.contextMenu(screen.getAllByTestId('child-row')[0])
    fireEvent.click(screen.getByText('Remove from group'))

    const after = current(layer.id)
    expect(after.children.filter((c) => c.groupId === 'g1')).toHaveLength(1)
    expect(after.groups).toHaveLength(1)
  })

  it('offers Group selection only with two or more selected', () => {
    const layer = createDungeonLayer('Layer 1')
    layer.children = [asset('a'), asset('b')]
    useStore.getState().addLayer(layer)
    useStore.getState().toggleChildGroup(`${layer.id}:asset`) // assets bucket starts collapsed
    useStore.getState().setSelectedIds(['a'])
    const { rerender } = renderGroups(current(layer.id))

    fireEvent.contextMenu(screen.getAllByTestId('child-row')[0])
    expect(screen.queryByText('Group selection')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })

    useStore.getState().setSelectedIds(['a', 'b'])
    rerender(
      <DndContext>
        <ChildGroups layer={current(layer.id)} filter="" />
      </DndContext>,
    )
    fireEvent.contextMenu(screen.getAllByTestId('child-row')[0])
    expect(screen.getByText('Group selection')).toBeTruthy()
    expect(screen.getByText('Merge selection')).toBeTruthy()
  })
})
