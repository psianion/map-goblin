// Group / merge verbs over the current canvas selection.
//
// The context menus, the Ctrl+G shortcuts and the layers panel all call these,
// so the same-layer guard and the "Group 3" naming counter exist once.

import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import { createGroupChildrenCommand, createDissolveGroupCommand } from '@/store/commands'
import { childGroupOf, selectLayerForChild } from '@/store/selectors'
import type { ChildGroupInfo, DungeonLayer } from '@/store/types'
import { notify } from '@/lib/toast'

/** The one unlocked dungeon layer owning every selected child, or null. */
function selectionLayer(): DungeonLayer | null {
  const store = useStore.getState()
  const ids = store.selection.selectedIds
  if (ids.length === 0) return null
  let layer: DungeonLayer | null = null
  for (const id of ids) {
    const owner = selectLayerForChild(store, id)
    if (!owner || (layer && owner.id !== layer.id)) return null
    layer = owner
  }
  return layer && !layer.locked ? layer : null
}

/** The one group every selected child belongs to, or null. */
export function selectionGroup(): { layer: DungeonLayer; group: ChildGroupInfo } | null {
  const layer = selectionLayer()
  const ids = useStore.getState().selection.selectedIds
  if (!layer || ids.length === 0) return null
  const first = childGroupOf(layer, ids[0])
  if (!first) return null
  for (const id of ids) if (childGroupOf(layer, id)?.id !== first.id) return null
  return { layer, group: first }
}

export function canGroupSelection(): boolean {
  return useStore.getState().selection.selectedIds.length >= 2 && selectionLayer() !== null
}

function group(base: 'Group' | 'Merged', merged: boolean): void {
  const layer = selectionLayer()
  const store = useStore.getState()
  const ids = store.selection.selectedIds
  if (!layer || ids.length < 2) return
  const cmd = createGroupChildrenCommand(store.layers, layer.id, ids, nextGroupName(layer, base), merged)
  if (!cmd) return
  undoManager.execute(cmd)
  store.setSelectedIds(ids)
  notify.subtle(`${merged ? 'Merged' : 'Grouped'} ${ids.length} objects`, { icon: 'layers' })
}

/** "Group 3" — one past the highest existing suffix of the same base name. */
function nextGroupName(layer: DungeonLayer, base: 'Group' | 'Merged'): string {
  const pattern = new RegExp(`^${base} (\\d+)$`)
  let highest = 0
  for (const g of layer.groups ?? []) {
    const m = pattern.exec(g.name)
    if (m) highest = Math.max(highest, Number(m[1]))
  }
  return `${base} ${highest + 1}`
}

export function groupSelection(): void {
  group('Group', false)
}

export function mergeSelection(): void {
  group('Merged', true)
}

export function ungroupSelection(): void {
  const found = selectionGroup()
  if (!found) return
  const cmd = createDissolveGroupCommand(useStore.getState().layers, found.layer.id, found.group.id)
  if (!cmd) return
  undoManager.execute(cmd)
  notify.subtle(
    `${found.group.merged ? 'Unmerged' : 'Ungrouped'} “${found.group.name}”`,
    { icon: 'layers' },
  )
}
