import type { AnyChild } from '@/store/types'

/**
 * Figures out what a child drag-end should do, or null for "do nothing".
 *
 * Panel-top = drawn-on-top, same convention LayerPanel uses for layers: the
 * children array order is ascending zIndex (index 0 draws first/bottom), so
 * the visual list is the array reversed and a visual index has to be flipped
 * back to an array index before it reaches the store.
 *
 * Cross-childType moves are also rejected here: reorder is only wired up for
 * assets and text (their own sprite pipelines honor array order) — doors,
 * lights, shapes and water draw from separate pipelines that ignore it, so a
 * move between different childTypes wouldn't change anything on screen. No
 * command, no undo entry, snap back.
 */
export function computeChildDragReorder(
  children: AnyChild[],
  activeId: string,
  overId: string,
): { fromIndex: number; toIndex: number } | null {
  if (activeId === overId) return null
  const activeChild = children.find((c) => c.id === activeId)
  const overChild = children.find((c) => c.id === overId)
  if (!activeChild || !overChild) return null
  if (activeChild.childType !== overChild.childType) return null

  const reversed = [...children].reverse()
  const fromVisual = reversed.findIndex((c) => c.id === activeId)
  const toVisual = reversed.findIndex((c) => c.id === overId)
  const fromIndex = children.length - 1 - fromVisual
  const toIndex = children.length - 1 - toVisual
  return { fromIndex, toIndex }
}
