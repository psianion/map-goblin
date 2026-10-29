import { useState, useCallback, useEffect } from 'react'
import { ContextMenu } from '@/components/ui/context-menu'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@/store/store'
import { selectLayerForChild, selectWallById } from '@/store/selectors'
import {
  buildAreaMenu,
  buildChildMenu,
  buildMultiMenu,
  buildCanvasMenu,
  buildRoomMenu,
  buildWallMenu,
} from '@/canvas/menuRegistry'
import type { DungeonLayer } from '@/store/types'
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
  const wallId = payload?.target.kind === 'wall' ? payload.target.wallId : null
  const wallEntry = useStore(useShallow((s) => {
    const found = wallId ? selectWallById(s, wallId) : undefined
    return { wall: found?.wall, wallLayer: found?.layer }
  }))
  const selectedIds = useStore((s) => s.selection.selectedIds)
  // Rooms and areas live on their layer; the layer is read live so a rename or a merge
  // made from the menu re-renders it (or closes it, when the room is gone).
  const placeLayerId =
    payload?.target.kind === 'room' || payload?.target.kind === 'area' ? payload.target.layerId : null
  const placeLayer = useStore((s) =>
    placeLayerId ? (s.layers.find((l) => l.id === placeLayerId && l.type === 'dungeon') as DungeonLayer | undefined) : undefined,
  )

  if (!payload) return null

  let rows
  if (payload.target.kind === 'canvas') {
    rows = buildCanvasMenu(payload.world)
  } else if (payload.target.kind === 'multi') {
    rows = buildMultiMenu(payload.target.count)
  } else if (payload.target.kind === 'room') {
    const roomId = payload.target.roomId
    const room = placeLayer?.rooms?.find((r) => r.id === roomId)
    rows = placeLayer && room ? buildRoomMenu({ layer: placeLayer, room, selectedIds, world: payload.world }) : null
  } else if (payload.target.kind === 'area') {
    const areaId = payload.target.areaId
    const area = placeLayer?.areas?.find((a) => a.id === areaId)
    rows = placeLayer && area ? buildAreaMenu({ layer: placeLayer, area }) : null
  } else if (payload.target.kind === 'wall') {
    // Gone the same way a child can go (deleted from the menu, an undo): close.
    rows = wallEntry.wall && wallEntry.wallLayer ? buildWallMenu({ layer: wallEntry.wallLayer, wall: wallEntry.wall }) : null
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
