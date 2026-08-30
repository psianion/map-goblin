import { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { Mountain, Eye, EyeOff, Search, X } from 'lucide-react'
import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import { TERRAIN_PANEL_ID, type Layer } from '@/store/types'
import { LayerHeader } from './LayerHeader'
import { LayerRow } from './LayerRow'
import { ReorderLayerCommand, TerrainAppearanceCommand } from '@/store/commands'
import { undoManager } from '@/store/undoManager'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { notify } from '@/lib/toast'
import { priorActiveLayerRef } from '@/components/toolbar/toolConstants'
import { ContextMenu, useContextMenu, type ContextMenuItem } from '@/components/ui/context-menu'
import { resolveReorder } from './resolveReorder'
import { TreeScrollContext } from './treeScroll'
import { panelSelectionOrigin } from './treeFocus'
import { selectSelectedIds, isChildGroupExpanded, isNamedGroupExpanded, namedGroupKey } from '@/store/selectors'

const selectLayers = (s: { layers: Layer[] }) => s.layers
const selectActiveLayerId = (s: { ui: { activeLayerId: string } }) => s.ui.activeLayerId

/**
 * Pinned row for the map's global terrain paint — not a Layer, so it can't
 * reuse LayerRow (no drag, no lock, no children, no delete). Same visual
 * shape as the pinned Background row below it: name column padded out to the
 * same width the drag-handle/chevron/lock spacers give every other row.
 */
function TerrainRow({ isActive, posInSet, setSize }: { isActive: boolean; posInSet: number; setSize: number }) {
  const setActiveLayerId = useStore((s) => s.setActiveLayerId)
  const setSelectedIds = useStore((s) => s.setSelectedIds)
  const terrainVisible = useStore((s) => s.mapSettings.terrain?.visible ?? true)
  const terrainOpacity = useStore((s) => s.mapSettings.terrain?.opacity ?? 1)
  const menu = useContextMenu()

  const setTerrainVisible = (next: boolean) => {
    undoManager.execute(new TerrainAppearanceCommand(
      { visible: terrainVisible },
      { visible: next },
    ))
  }

  const selectTerrain = () => {
    // Remember what was active so Escape can put it back (D5b) — only on
    // the transition into terrain, so re-clicking terrain while already
    // on it doesn't overwrite the layer to restore to with itself.
    const current = useStore.getState().ui.activeLayerId
    if (current !== TERRAIN_PANEL_ID) priorActiveLayerRef.current = current
    setActiveLayerId(TERRAIN_PANEL_ID)
    setSelectedIds([])
  }

  const resetOpacity = () => {
    if (terrainOpacity === 1) return
    undoManager.execute(new TerrainAppearanceCommand(
      { opacity: terrainOpacity },
      { opacity: 1 },
    ))
  }

  const menuItems: ContextMenuItem[] = [
    { label: terrainVisible ? 'Hide' : 'Show', onSelect: () => setTerrainVisible(!terrainVisible) },
    { label: 'Reset opacity', onSelect: resetOpacity, disabled: terrainOpacity === 1 },
  ]

  // K1/K3: same row keyboard contract as LayerRow (see its handleRowKeyDown
  // for the target-vs-currentTarget guard rationale) — Terrain has no
  // rename/delete/expand, just select, toggle, and the row menu opener.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter') {
      e.preventDefault()
      selectTerrain()
    } else if (e.key === ' ') {
      e.preventDefault()
      setTerrainVisible(!terrainVisible)
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault()
      const rect = e.currentTarget.getBoundingClientRect()
      menu.openAt(rect.left + 8, rect.bottom)
    }
  }

  return (
    <div
      data-testid="terrain-row"
      role="treeitem"
      aria-selected={isActive}
      aria-label="Terrain"
      aria-level={1}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      tabIndex={isActive ? 0 : -1}
      className={cn(
        'gg-row group flex items-center gap-1 px-1 py-1.5 cursor-pointer',
        'border border-transparent focus-visible:outline-none focus-visible:border-border-focus focus-visible:ring-3 focus-visible:ring-border-focus/50',
        // Selected = raised surface PLUS a visible border: surface-3 on
        // surface-1 alone measures 1.37:1, below the perceptual floor in a
        // dim room. The border rides the always-present transparent slot,
        // so no layout shift; focus-visible still wins when focused.
        isActive && 'bg-surface-3 border-border-default',
        // opacity-80, matching LayerRow — see index.css's --text-dim comment.
        !terrainVisible && 'opacity-80',
      )}
      onClick={selectTerrain}
      onKeyDown={handleKeyDown}
      onContextMenu={menu.open}
    >
      <span className="w-[14px]" />
      {/* Mountain sits in the chevron slot so the name column lines up with
          the layer rows above (which have grip + chevron in these widths). */}
      <span className="w-4 flex items-center justify-center shrink-0">
        <Mountain size={12} className="text-text-muted" />
      </span>
      {/* line-through: the opacity nudge alone was imperceptible on the dark
          chrome — hidden needs a non-color channel. */}
      <span className={cn('flex-1 min-w-0 truncate text-panel-body text-text-primary', !terrainVisible && 'line-through')}>
        Terrain
      </span>
      <span className="w-6" />
      <Button
        variant="ghost"
        size="icon-xs"
        tabIndex={-1}
        data-testid="layer-visibility-toggle"
        data-visible={terrainVisible}
        onClick={(e) => {
          e.stopPropagation()
          setTerrainVisible(!terrainVisible)
        }}
        className={cn(
          'text-text-muted hover:text-text-primary',
          // Revealed on hover/focus, persistent while hidden — same contract
          // as the layer rows' eyes.
          terrainVisible && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
        )}
        title={terrainVisible ? 'Hide terrain' : 'Show terrain'}
        aria-label={terrainVisible ? 'Hide terrain' : 'Show terrain'}
        aria-pressed={terrainVisible}
      >
        {terrainVisible ? <Eye size={14} /> : <EyeOff size={14} />}
      </Button>
      <ContextMenu pos={menu.pos} onClose={menu.close} items={menuItems} />
    </div>
  )
}

// Standard roving-tabindex arrow navigation for the tree (WAI-ARIA APG
// treeview "Managing Focus"): query the rendered treeitems in DOM order —
// this naturally reflects only VISIBLE rows, since a collapsed layer's
// children simply aren't in the DOM — and move native focus directly.
// tabIndex on each row is derived from its own active/selected state
// (see LayerRow/ChildRow/TerrainRow), so this only ever has to move focus,
// never track "last focused" itself.
function handleTreeKeyDown(e: React.KeyboardEvent<HTMLDivElement>, container: HTMLDivElement | null) {
  if (!container) return
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  const items = Array.from(container.querySelectorAll<HTMLElement>('[role="treeitem"]'))
  if (items.length === 0) return
  const current = items.indexOf(document.activeElement as HTMLElement)
  // Focus isn't on a row (e.g. the rename <input> is focused) — don't steal
  // it, arrow keys belong to whatever's actually focused in that case.
  if (current < 0) return
  e.preventDefault()
  if (e.key === 'ArrowDown') items[Math.min(current + 1, items.length - 1)]?.focus()
  else if (e.key === 'ArrowUp') items[Math.max(current - 1, 0)]?.focus()
  else if (e.key === 'Home') items[0]?.focus()
  else if (e.key === 'End') items[items.length - 1]?.focus()
}

export function LayerPanel() {
  const layers = useStore(useShallow(selectLayers))
  const activeLayerId = useStore(selectActiveLayerId)
  const treeRef = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState('')

  // Canvas-originated selection reveals its row: expand the owning layer and
  // type group, then hand off to the row's own reveal effect via the marker.
  // Panel-originated selection (panelSelectionOrigin) must not move scroll.
  const selectedIds = useStore(useShallow(selectSelectedIds))
  useEffect(() => {
    if (panelSelectionOrigin.current) {
      panelSelectionOrigin.current = false
      return
    }
    const id = selectedIds[0]
    if (!id) return
    const s = useStore.getState()
    for (const layer of s.layers) {
      if (layer.type !== 'dungeon') continue
      const child = layer.children.find((c) => c.id === id)
      if (!child) continue
      if (!s.ui.expandedLayerIds.includes(layer.id)) s.toggleExpandedLayerId(layer.id)
      if (child.groupId) {
        // A grouped child lives under its folder, not its type bucket.
        if (!isNamedGroupExpanded(s, layer.id, child.groupId)) {
          s.toggleChildGroup(namedGroupKey(layer.id, child.groupId))
        }
      } else if (!isChildGroupExpanded(s, layer.id, child.childType)) {
        s.toggleChildGroup(`${layer.id}:${child.childType}`)
      }
      s.setRevealChildId(id)
      break
    }
  }, [selectedIds])

  // Background is pinned at index 0 — separate it
  const backgroundLayer = layers.find((l) => l.type === 'background')
  // User layers in reverse (top = last in array = first visually)
  const userLayers = layers.filter((l) => l.type !== 'background').reverse()

  // H3: level-1 siblings are the user layers, the pinned Terrain row, and the
  // pinned Background row (in that DOM/visual order) — aria-posinset/setsize
  // cover the whole set, not just the draggable layers.
  const topLevelCount = userLayers.length + 1 + (backgroundLayer ? 1 : 0)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const layerName = (id: string) => layers.find((l) => l.id === id)?.name ?? 'layer'
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${layerName(String(active.id))}.`,
    onDragOver: ({ active, over }) =>
      over ? `${layerName(String(active.id))} is over ${layerName(String(over.id))}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${layerName(String(active.id))} was moved next to ${layerName(String(over.id))}.`
        : `${layerName(String(active.id))} was dropped.`,
    onDragCancel: ({ active }) => `Reordering ${layerName(String(active.id))} was cancelled.`,
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const result = resolveReorder(layers, active.id as string, over.id as string)
    if (!result) return
    if (result.blocked) {
      notify.warning('Layer is locked')
      return
    }
    undoManager.execute(new ReorderLayerCommand('Reorder layers', result.fromActual, result.toActual))
  }

  return (
    <div className="flex flex-col min-h-0">
      <LayerHeader />
      {/* Child filter — matches child names across every layer and forces
          matching layers/groups open while active. */}
      <div className="px-2 pb-2 shrink-0">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            // type="text", not "search": the native webkit cancel button is a
            // second (blue) clear control next to ours, and native
            // Escape-clear shadows the app's Escape chain.
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                if (filter !== '') setFilter('')
                else e.currentTarget.blur()
              }
            }}
            placeholder="Filter objects…"
            aria-label="Filter objects by name"
            data-testid="layer-filter"
            className="w-full rounded-sm border border-border-subtle bg-surface-0 pl-7 pr-6 py-1 text-panel-body text-text-primary placeholder:text-text-muted outline-none focus-visible:border-border-focus"
          />
          {filter !== '' && (
            <button
              type="button"
              aria-label="Clear filter"
              onClick={() => setFilter('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      <hr className="border-border-subtle mx-2" />

      <TreeScrollContext.Provider value={treeRef}>
        <div
          ref={treeRef}
          role="tree"
          aria-label="Layers"
          className="flex-1 min-h-0 overflow-y-auto"
          onKeyDown={(e) => handleTreeKeyDown(e, treeRef.current)}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
            accessibility={{ announcements }}
          >
            <SortableContext
              items={userLayers.map((l) => l.id)}
              strategy={verticalListSortingStrategy}
            >
              {userLayers.map((layer, i) => (
                <LayerRow
                  key={layer.id}
                  layer={layer}
                  isActive={layer.id === activeLayerId}
                  posInSet={i + 1}
                  setSize={topLevelCount}
                  filter={filter}
                />
              ))}
            </SortableContext>
          </DndContext>

          {userLayers.length === 0 && (
            // M2: an empty-state message, not a tree node — role="presentation"
            // keeps it out of the accessibility tree's child list for role="tree".
            <p role="presentation" className="px-3 py-2 text-panel-body text-text-muted">
              No layers yet — add one to start drawing.
            </p>
          )}

          {/* Zero-match filter state — silence here read exactly like a
              collapsed layer ("did I break it?"). aria-live so the change is
              announced without a focus move. */}
          {filter.trim() !== '' &&
            !userLayers.some(
              (l) =>
                l.type === 'dungeon' &&
                // Group names are matchable too, so a hit on a folder name
                // alone must not read as "nothing matched".
                (l.children.some((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase())) ||
                  (l.groups ?? []).some((g) => g.name.toLowerCase().includes(filter.trim().toLowerCase()))),
            ) && (
              <p role="presentation" aria-live="polite" className="px-3 py-2 text-panel-body text-text-muted">
                No objects match “{filter.trim()}”.{' '}
                <button
                  type="button"
                  className="underline hover:text-text-primary"
                  onClick={() => setFilter('')}
                >
                  Clear filter
                </button>
              </p>
            )}

          {/* Pinned block sticks to the bottom of the tree scroll so Terrain
              and Background never leave reach under a long child list.
              border-default, not subtle: at subtle strength the break
              vanished and Terrain read as a child of the layer above it. */}
          <div className="sticky bottom-0 z-10 bg-surface-1">
            <hr role="presentation" className="border-border-default mx-2" />
            <TerrainRow
              isActive={activeLayerId === TERRAIN_PANEL_ID}
              posInSet={userLayers.length + 1}
              setSize={topLevelCount}
            />

            {backgroundLayer && (
              <>
                <hr role="presentation" className="border-border-default mx-2" />
                <LayerRow
                  layer={backgroundLayer}
                  isActive={backgroundLayer.id === activeLayerId}
                  posInSet={userLayers.length + 2}
                  setSize={topLevelCount}
                />
              </>
            )}
          </div>
        </div>
      </TreeScrollContext.Provider>
    </div>
  )
}
