import { memo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Combine, Eye, EyeOff, Folder } from 'lucide-react'
import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import { selectSelectedIds, isNamedGroupExpanded, namedGroupKey } from '@/store/selectors'
import { undoManager } from '@/store/undoManager'
import {
  CompositeCommand,
  PropertyCommand,
  createDeleteGroupCommand,
  createDissolveGroupCommand,
  createDuplicateGroupCommand,
  createRenameGroupCommand,
} from '@/store/commands'
import type { AnyChild, ChildGroupInfo, DungeonLayer } from '@/store/types'
import { unionChildBounds } from '@dnd/core/src/engine/hitTest'
import { panBoundsIntoView, zoomToBounds } from '@/canvas/panToChild'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { InlineEditableName } from './InlineEditableName'
import { notify } from '@/lib/toast'
import { ContextMenu, useContextMenu, type ContextMenuItem } from '@/components/ui/context-menu'
import { markPanelSelection } from './treeFocus'
import { ChildRow } from './ChildRow'

interface GroupRowProps {
  layer: DungeonLayer
  group: ChildGroupInfo
  /** Members to render, already filtered (display order, topmost first). */
  members: AnyChild[]
  /** Total member count, ignoring the filter — the badge's denominator. */
  totalMembers: number
  filtering: boolean
  posInSet?: number
  setSize?: number
}

export const GroupRow = memo(function GroupRow({
  layer,
  group,
  members,
  totalMembers,
  filtering,
  posInSet = 1,
  setSize = 1,
}: GroupRowProps) {
  const layerId = layer.id
  const key = namedGroupKey(layerId, group.id)
  const selectedIds = useStore(useShallow(selectSelectedIds))
  const setSelectedIds = useStore((s) => s.setSelectedIds)
  const setActiveTool = useStore((s) => s.setActiveTool)
  const setActiveLayerId = useStore((s) => s.setActiveLayerId)
  const toggleChildGroup = useStore((s) => s.toggleChildGroup)
  const storedExpanded = useStore((s) => isNamedGroupExpanded(s, layerId, group.id))
  // A live filter overrides collapse, same as the type buckets.
  const isExpanded = !group.merged && (filtering || storedExpanded)

  const menu = useContextMenu()
  const [editingName, setEditingName] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)

  // Every member in the current selection — the group reads as "the selected
  // object" only when it is wholly selected.
  const allMemberIds = layer.children.filter((c) => c.groupId === group.id).map((c) => c.id)
  const isSelected =
    allMemberIds.length > 0 && allMemberIds.every((id) => selectedIds.includes(id))
  const anyVisible = layer.children.some((c) => c.groupId === group.id && c.visible)

  const bounds = () => unionChildBounds(layer.children.filter((c) => c.groupId === group.id))

  const selectGroup = (zoom = false) => {
    markPanelSelection()
    setActiveTool('select')
    setActiveLayerId(layerId)
    setSelectedIds(allMemberIds)
    const box = bounds()
    if (!box) return
    if (zoom) zoomToBounds(box)
    else panBoundsIntoView(box)
  }

  const commitRename = (name: string) => {
    const cmd = createRenameGroupCommand(useStore.getState().layers, layerId, group.id, name)
    if (cmd) undoManager.execute(cmd)
    setEditingName(false)
  }

  // Fan-out: one undo entry for the whole group, like the layer eye.
  const toggleVisibility = () => {
    const targets = layer.children.filter((c) => c.groupId === group.id)
    if (targets.length === 0) return
    const next = !anyVisible
    undoManager.execute(
      new CompositeCommand(
        anyVisible ? 'Hide group' : 'Show group',
        targets.map(
          (c) =>
            new PropertyCommand(
              anyVisible ? 'Hide child' : 'Show child',
              { type: 'child', layerId, childId: c.id },
              { visible: c.visible },
              { visible: next },
            ),
        ),
      ),
    )
    notify.subtle(anyVisible ? `Hid “${group.name}”` : `“${group.name}” visible`, {
      icon: anyVisible ? 'eyeOff' : 'eye',
    })
  }

  const dissolve = () => {
    const cmd = createDissolveGroupCommand(useStore.getState().layers, layerId, group.id)
    if (!cmd) return
    undoManager.execute(cmd)
    notify.action(group.merged ? `Unmerged “${group.name}”` : `Ungrouped “${group.name}”`, {
      label: 'Undo',
      onClick: () => undoManager.undo(),
    })
  }

  const duplicate = () => {
    if (layer.locked) {
      notify.warning('Layer is locked')
      return
    }
    const cmd = createDuplicateGroupCommand(useStore.getState().layers, layerId, group.id)
    if (!cmd) return
    undoManager.execute(cmd)
    notify.action('Duplicated', { label: 'Undo', onClick: () => undoManager.undo(), icon: 'copy' })
  }

  const remove = () => {
    if (layer.locked) {
      notify.warning('Layer is locked')
      return
    }
    const count = allMemberIds.length
    const cmd = createDeleteGroupCommand(useStore.getState().layers, layerId, group.id)
    if (!cmd) return
    undoManager.execute(cmd)
    notify.action(
      `Deleted “${group.name}” — ${count} ${count === 1 ? 'object' : 'objects'}`,
      { label: 'Undo', onClick: () => undoManager.undo(), icon: 'trash' },
    )
    markPanelSelection()
    setSelectedIds(selectedIds.filter((id) => !allMemberIds.includes(id)))
  }

  const menuItems: ContextMenuItem[] = [
    { label: 'Rename', onSelect: () => setEditingName(true) },
    { label: group.merged ? 'Unmerge' : 'Ungroup', onSelect: dissolve },
    { label: 'Duplicate group', onSelect: duplicate },
    { label: anyVisible ? 'Hide' : 'Show', onSelect: toggleVisibility },
    { label: 'Delete group', onSelect: remove, danger: true, separatorBefore: true },
  ]

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    switch (e.key) {
      case 'Enter':
        e.preventDefault()
        selectGroup()
        break
      case 'F2':
        e.preventDefault()
        setEditingName(true)
        break
      case ' ':
        e.preventDefault()
        toggleVisibility()
        break
      case 'Delete':
        e.preventDefault()
        remove()
        break
      case 'ArrowRight':
        if (!group.merged && !isExpanded) {
          e.preventDefault()
          toggleChildGroup(key)
        }
        break
      case 'ArrowLeft':
        e.preventDefault()
        if (!group.merged && isExpanded && !filtering) {
          toggleChildGroup(key)
        } else {
          const root = e.currentTarget.closest('[role="group"]')
          const parentRow = root?.previousElementSibling as HTMLElement | null
          parentRow?.focus()
        }
        break
      case 'ContextMenu':
        e.preventDefault()
        menu.openAt(e.currentTarget.getBoundingClientRect().left + 8, e.currentTarget.getBoundingClientRect().bottom)
        break
      case 'F10':
        if (e.shiftKey) {
          e.preventDefault()
          menu.openAt(e.currentTarget.getBoundingClientRect().left + 8, e.currentTarget.getBoundingClientRect().bottom)
        }
        break
      default:
        break
    }
  }

  return (
    <div>
      <div
        ref={rowRef}
        role="treeitem"
        aria-level={2}
        aria-selected={isSelected}
        aria-expanded={group.merged ? undefined : isExpanded}
        aria-label={group.name}
        aria-posinset={posInSet}
        aria-setsize={setSize}
        tabIndex={-1}
        data-testid="named-group-header"
        data-group-header=""
        data-group-id={group.id}
        data-merged={group.merged ? 'true' : undefined}
        className={cn(
          'gg-row group flex items-center gap-1 pl-4 pr-1 py-1 cursor-pointer select-none',
          'border border-transparent focus-visible:outline-none focus-visible:border-border-focus focus-visible:ring-3 focus-visible:ring-border-focus/50',
          isSelected && 'bg-surface-3 border-border-default',
          !anyVisible && 'opacity-80',
        )}
        onClick={() => selectGroup()}
        onDoubleClick={() => selectGroup(true)}
        onContextMenu={menu.open}
        onKeyDown={handleKeyDown}
      >
        {/* Chevron only for plain groups — a merged group has no member rows
            to reveal, so a disclosure control there would open nothing. */}
        {group.merged ? (
          // w-4: the chevron's LAYOUT width below (w-6 minus its -m-1 bleed),
          // so a merged row's icon lines up with a plain group's.
          <span className="w-4 shrink-0" />
        ) : (
          <span
            role="button"
            tabIndex={-1}
            aria-label={isExpanded ? `Collapse ${group.name}` : `Expand ${group.name}`}
            // w-6/h-6/-m-1: same 24px hit area (WCAG 2.5.8) in a 16px slot as
            // LayerRow's chevron — these two sit in the same column.
            className="flex items-center justify-center w-6 h-6 -m-1 shrink-0 transition-colors text-text-muted hover:text-text-primary"
            onClick={(e) => {
              e.stopPropagation()
              toggleChildGroup(key)
            }}
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}

        <span className="text-text-muted shrink-0">
          {group.merged ? <Combine size={12} /> : <Folder size={12} />}
        </span>

        <InlineEditableName
          value={group.name}
          editing={editingName}
          onStartEdit={() => setEditingName(true)}
          onCommit={commitRename}
          onCancel={() => setEditingName(false)}
          displayClassName={cn('text-panel-body text-text-secondary', !anyVisible && 'line-through')}
          restoreFocusRef={rowRef}
        />

        {/* Count badge — matches / total while filtering, so the badge and the
            visible rows can't disagree (same contract as LayerRow's). */}
        <span className="shrink-0 text-panel-small text-text-muted tabular-nums">
          {filtering && members.length !== totalMembers
            ? `${members.length} / ${totalMembers}`
            : `(${totalMembers})`}
        </span>

        <Button
          variant="ghost"
          size="icon-xs"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation()
            toggleVisibility()
          }}
          className={cn(
            'text-text-muted hover:text-text-primary',
            anyVisible && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
          )}
          title={anyVisible ? 'Hide' : 'Show'}
          aria-label={anyVisible ? `Hide ${group.name}` : `Show ${group.name}`}
          aria-pressed={anyVisible}
        >
          {anyVisible ? <Eye size={12} /> : <EyeOff size={12} />}
        </Button>

        <ContextMenu pos={menu.pos} onClose={menu.close} items={menuItems} />
      </div>

      {isExpanded &&
        members.map((child, i) => (
          <ChildRow
            key={child.id}
            child={child}
            layer={layer}
            posInSet={i + 1}
            setSize={members.length}
          />
        ))}
    </div>
  )
})
