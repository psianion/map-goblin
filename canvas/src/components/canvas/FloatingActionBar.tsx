import { useEffect, useRef } from 'react'
import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import { getEngineSingleton } from '@/engine/engineSingleton'
import { unionChildBounds } from '@dnd/core/src/engine/hitTest'
import type { SelectTool } from '@dnd/core/src/engine/tools/SelectTool'
import type { AnyChild, DungeonLayer } from '@/store/types'
import { handleShortcut, rotateSelection90 } from '@/shortcuts/defaultShortcuts'
import { FlipHorizontal2, FlipVertical2, RotateCw, Copy, Trash2 } from 'lucide-react'

const BAR_GAP = 12

/**
 * Quick verbs pinned above the current selection: flip, rotate 90°, duplicate,
 * delete. Chrome, not canvas overlay — it keeps the theme accent and DOM focus
 * semantics. Position follows the selection every frame (the camera moves
 * without a store update, so this can't be plain reactive state), and the bar
 * gets out of the way while a gizmo drag is in flight.
 */
export function FloatingActionBar() {
  const activeTool = useStore((s) => s.tools.activeTool)
  const selectedIds = useStore(useShallow((s) => s.selection.selectedIds))
  // Child kinds in the selection, as a stable string — the verb list derives
  // from it, so a light never sees a Rotate button that would silently no-op.
  const kinds = useStore((s) => {
    const ids = new Set(s.selection.selectedIds)
    const found = new Set<string>()
    for (const l of s.layers) {
      if (l.type !== 'dungeon') continue
      for (const c of l.children) if (ids.has(c.id)) found.add(c.childType)
    }
    return [...found].sort().join(',')
  })
  const ref = useRef<HTMLDivElement>(null)

  const visible = activeTool === 'select' && selectedIds.length > 0

  useEffect(() => {
    if (!visible) return
    const el = ref.current
    if (!el) return
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const singleton = getEngineSingleton()
      if (!singleton) {
        el.style.visibility = 'hidden'
        return
      }
      const { engine, sceneGraph } = singleton
      const state = useStore.getState()
      const ids = new Set(state.selection.selectedIds)
      const children: AnyChild[] = state.layers
        .filter((l): l is DungeonLayer => l.type === 'dungeon')
        .flatMap((l) => l.children)
        .filter((c) => ids.has(c.id) && c.childType !== 'door')
      const box = unionChildBounds(children)
      const selectTool = sceneGraph.toolManager.getTool('select') as SelectTool | undefined
      if (!box || selectTool?.isGizmoDragging()) {
        el.style.visibility = 'hidden'
        return
      }
      const topLeft = engine.worldToScreen(box.x, box.y)
      const topRight = engine.worldToScreen(box.x + box.width, box.y)
      const cx = (topLeft.x + topRight.x) / 2
      const barW = el.offsetWidth
      const barH = el.offsetHeight
      // Above the box; below it when that would leave the viewport. The extra
      // room above accounts for the gizmo's rotate stem.
      let top = topLeft.y - barH - BAR_GAP - 28
      if (top < 4) {
        const bottomLeft = engine.worldToScreen(box.x, box.y + box.height)
        top = bottomLeft.y + BAR_GAP + 24
      }
      const left = Math.max(4, Math.min(cx - barW / 2, window.innerWidth - barW - 4))
      el.style.visibility = 'visible'
      el.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.min(top, window.innerHeight - barH - 4))}px)`
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [visible])

  if (!visible) return null

  // Verbs that would silently no-op for the selection are omitted, matching
  // how the gizmo already drops the rotate stem for lights: flips apply to
  // props/shapes/water, rotation to everything except lights.
  const kindSet = new Set(kinds.split(',').filter(Boolean))
  const has = (...ks: string[]) => ks.some((k) => kindSet.has(k))
  const actions: { label: string; icon: typeof Copy; run: () => void }[] = [
    ...(has('asset', 'shape', 'water')
      ? [
          { label: 'Flip horizontal', icon: FlipHorizontal2, run: () => handleShortcut('shift+h') },
          { label: 'Flip vertical', icon: FlipVertical2, run: () => handleShortcut('shift+v') },
        ]
      : []),
    ...(has('asset', 'text', 'shape', 'water')
      ? [{ label: 'Rotate 90°', icon: RotateCw, run: () => rotateSelection90() }]
      : []),
    { label: 'Duplicate', icon: Copy, run: () => handleShortcut('ctrl+d') },
  ]

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Selection actions"
      style={{ visibility: 'hidden' }}
      className="gg-grain fixed left-0 top-0 z-30 flex items-center gap-0.5 rounded-md border border-border-structure bg-surface-1 px-1 py-0.5 shadow-panel"
    >
      {actions.map(({ label, icon: Icon, run }) => (
        <button
          key={label}
          type="button"
          title={label}
          aria-label={label}
          // Keep focus where it is — stealing it from the canvas would drop
          // keyboard shortcuts mid-flow.
          onMouseDown={(e) => e.preventDefault()}
          onClick={run}
          className="gg-row rounded-sm p-1.5 text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-border-focus/50"
        >
          <Icon size={14} />
        </button>
      ))}
      {/* Delete is destructive: fenced off and coloured like the menu's danger
          slot, not a fifth identical button 2px from Duplicate. */}
      <div aria-hidden className="mx-0.5 h-4 w-px bg-border-default" />
      <button
        type="button"
        title="Delete (Del)"
        aria-label="Delete"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => handleShortcut('delete')}
        className="gg-row rounded-sm p-1.5 text-danger/80 hover:text-danger focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-border-focus/50"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}
