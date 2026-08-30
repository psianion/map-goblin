// Group / merge verbs over the current canvas selection.
//
// The context menus, the Ctrl+G shortcuts and the layers panel all call these,
// so the same-layer guard and the "Group 3" naming counter exist once.

import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import {
  createGroupChildrenCommand,
  createDissolveGroupCommand,
  soleGroupOfChildren,
} from '@/store/commands'
import { childGroupOf, namedGroupKey, selectLayerForChild } from '@/store/selectors'
import type { ChildGroupInfo, DungeonLayer } from '@/store/types'
import { notify } from '@/lib/toast'

const NEED_TWO = 'Select 2+ objects on one unlocked layer to group'

/**
 * The one unlocked dungeon layer owning every selected child, or the reason it
 * cannot be grouped — Ctrl+G used to fail in total silence.
 */
function selectionLayerOrReason(): DungeonLayer | string {
  const store = useStore.getState()
  const ids = store.selection.selectedIds
  if (ids.length < 2) return NEED_TWO
  let layer: DungeonLayer | null = null
  for (const id of ids) {
    const owner = selectLayerForChild(store, id)
    if (!owner) return NEED_TWO
    if (layer && owner.id !== layer.id) return 'Objects must be on one layer to group'
    layer = owner
  }
  if (!layer) return NEED_TWO
  if (layer.locked) return `“${layer.name}” is locked — unlock it to group`
  return layer
}

/** The one unlocked dungeon layer owning every selected child, or null. */
function selectionLayer(): DungeonLayer | null {
  const res = selectionLayerOrReason()
  return typeof res === 'string' ? null : res
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

// One-shot "start this group's name in edit mode" marker, set when a group is
// created and consumed by the GroupRow that mounts for it. Same tier as
// ui.revealChildId: view convenience, never undoable, never serialized — but a
// plain module ref, because only the row that mounts next can consume it.
let pendingNameEdit: string | null = null
export function consumePendingGroupNameEdit(groupId: string): boolean {
  if (pendingNameEdit !== groupId) return false
  pendingNameEdit = null
  return true
}

function group(base: 'Group' | 'Merged', merged: boolean): void {
  const res = selectionLayerOrReason()
  if (typeof res === 'string') {
    notify.warning(res)
    return
  }
  const layer = res
  const store = useStore.getState()
  const ids = store.selection.selectedIds
  const existing = soleGroupOfChildren(store.layers, layer.id, ids)
  const cmd = createGroupChildrenCommand(store.layers, layer.id, ids, nextGroupName(layer, base), merged)
  if (!cmd) return
  undoManager.execute(cmd)
  store.setSelectedIds(ids)

  if (existing) {
    const added = ids.filter((id) => childGroupOf(layer, id)?.id !== existing.id).length
    notify.subtle(`Added ${added} ${added === 1 ? 'object' : 'objects'} to “${existing.name}”`, {
      icon: 'layers',
    })
    return
  }

  // Created: find the fresh group through a member, then open it, scroll to it
  // and hand the DM the name field — an anonymous collapsed "Group 4" is a
  // folder nobody names.
  const after = useStore.getState()
  const created = childGroupOf(after.layers.find((l) => l.id === layer.id) as DungeonLayer, ids[0])
  if (created) {
    pendingNameEdit = created.id
    // A merged group renders no member rows, so there is nothing to expand or
    // scroll to — only the name field applies.
    if (!merged) {
      after.toggleChildGroup(namedGroupKey(layer.id, created.id))
      after.setRevealChildId(ids[0])
    }
  }
  if (merged) {
    notify.action(
      `Merged ${ids.length} objects into “${created?.name ?? base}” — members edit as one`,
      { label: 'Undo', onClick: () => undoManager.undo(), icon: 'layers' },
    )
  } else {
    notify.subtle(`Grouped ${ids.length} objects`, { icon: 'layers' })
  }
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
