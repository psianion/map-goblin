import type { Layer } from '@/store/types'

export type ReorderResult =
  | { blocked: true }
  | { blocked: false; fromActual: number; toActual: number }
  | null // no-op: same id, or the dragged id isn't a user layer

/**
 * Pure drag-end → command-args resolution, split out of LayerPanel so the
 * index math and the locked-layer guard (D2) have a plain function to test
 * without fighting @dnd-kit's pointer-sensor simulation in RTL. Own module
 * (not just exported from LayerPanel.tsx) because a non-component export
 * alongside a component breaks React Fast Refresh for that file.
 */
export function resolveReorder(layers: Layer[], activeId: string, overId: string): ReorderResult {
  if (activeId === overId) return null

  const draggedLayer = layers.find((l) => l.id === activeId)
  if (draggedLayer?.locked) return { blocked: true }

  const userLayerIds = layers.filter((l) => l.type !== 'background').map((l) => l.id)
  const userLayers = layers.filter((l) => l.type !== 'background').reverse()
  // Layers pinned ahead of the user stack in the underlying array —
  // currently just the background, always at index 0 — computed from the
  // actual count rather than a hardcoded +1, so this keeps working if
  // another pinned layer type is ever added ahead of it.
  const pinnedCount = layers.length - userLayerIds.length
  // Convert from reversed visual order to actual array index
  const fromVisual = userLayers.findIndex((l) => l.id === activeId)
  const toVisual = userLayers.findIndex((l) => l.id === overId)
  if (fromVisual === -1 || toVisual === -1) return null

  // Convert visual indices to actual array indices (reverse the reversal)
  return {
    blocked: false,
    fromActual: userLayerIds.length - 1 - fromVisual + pinnedCount,
    toActual: userLayerIds.length - 1 - toVisual + pinnedCount,
  }
}
