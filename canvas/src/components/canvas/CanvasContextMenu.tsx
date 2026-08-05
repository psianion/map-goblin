import { useState, useCallback, useEffect } from 'react'
import { ContextMenu } from '@/components/ui/context-menu'
import { useStore } from '@/store/store'
import { selectLayerForChild } from '@/store/selectors'
import {
  buildChildMenu,
  buildMultiMenu,
  buildCanvasMenu,
} from '@/canvas/menuRegistry'
import { openCanvasMenuRef, type CanvasMenuPayload } from './canvasMenuRef'

export function CanvasContextMenu() {
  const [payload, setPayload] = useState<CanvasMenuPayload | null>(null)

  // Stable identity so useCanvasInput's listener never goes stale.
  const openFn = useCallback((p: CanvasMenuPayload) => setPayload(p), [])
  useEffect(() => {
    openCanvasMenuRef.current = openFn
    return () => {
      openCanvasMenuRef.current = null
    }
  }, [openFn])

  // Live child lookup: slider/toggle rows patch the store and the menu must
  // re-render with the new values, so rows rebuild from the current child on
  // every store change rather than being frozen at open time.
  const childId = payload?.target.kind === 'child' ? payload.target.childId : null
  const child = useStore((s) =>
    childId
      ? s.layers
          .flatMap((l) => (l.type === 'dungeon' ? l.children : []))
          .find((c) => c.id === childId)
      : undefined,
  )
  const layer = useStore((s) => (childId ? selectLayerForChild(s, childId) : undefined))
  const selectedIds = useStore((s) => s.selection.selectedIds)

  if (!payload) return null

  let rows
  if (payload.target.kind === 'canvas') {
    rows = buildCanvasMenu(payload.world)
  } else if (payload.target.kind === 'multi') {
    rows = buildMultiMenu(payload.target.count)
  } else if (child && layer) {
    rows = buildChildMenu({ layer, child, selectedIds, world: payload.world })
  } else {
    // The child vanished (deleted from the menu itself, or an undo) — close.
    rows = null
  }

  if (!rows) {
    if (payload) setPayload(null)
    return null
  }

  return (
    <ContextMenu
      pos={{ x: payload.x, y: payload.y }}
      onClose={() => setPayload(null)}
      items={rows}
    />
  )
}
