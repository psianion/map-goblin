import { getEngineSingleton } from '@/engine/engineSingleton'
import { getChildBounds } from '@dnd/core/src/engine/hitTest'
import { useStore } from '@/store/store'
import { viewportInsetsRef } from '@/editor/zoomToFitRef'
import { MIN_ZOOM, MAX_ZOOM, animateCamera } from '@/editor/zoomControl'
import type { AnyChild } from '@/store/types'

function findChild(childId: string): AnyChild | null {
  for (const layer of useStore.getState().layers) {
    if (layer.type !== 'dungeon') continue
    const child = layer.children.find((c) => c.id === childId)
    if (child) return child
  }
  return null
}

/**
 * The screen-space rect the overlaid chrome leaves visible: right of the rail, under the
 * title card, above the dock, and above `clearBottom` px from the window's foot when a bar
 * floats over the dock (the grid line-up's).
 */
function visibleRect(clearBottom = 0) {
  const singleton = getEngineSingleton()
  if (!singleton) return null
  const vp = singleton.engine.viewport()
  const insets = viewportInsetsRef.current
  return {
    left: insets.left,
    top: insets.top ?? 0,
    right: vp.width - insets.right,
    bottom: vp.height - Math.max(insets.bottom, clearBottom),
    stage: singleton.engine.stage(),
  }
}

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Pan (never zoom) so the world-space box is inside the visible gap between
 * the panels. No-op when it already is — clicking rows of on-screen objects
 * must not nudge the camera.
 */
export function panBoundsIntoView(b: Bounds): void {
  const rect = visibleRect()
  if (!rect) return
  const { stage } = rect
  const zoom = stage.scale.x
  const sx1 = b.x * zoom + stage.position.x
  const sy1 = b.y * zoom + stage.position.y
  const sx2 = (b.x + b.width) * zoom + stage.position.x
  const sy2 = (b.y + b.height) * zoom + stage.position.y

  // Asymmetric margins: the bottom zoom HUD floats over the canvas and isn't in
  // viewportInsetsRef — "technically on screen" parked objects under the HUD.
  // The top toolbar is in it once the shell has measured it.
  const mx = 24
  const mTop = rect.top > 0 ? mx : 56
  const mBot = 72
  let dx = 0
  let dy = 0
  if (sx1 < rect.left + mx) dx = rect.left + mx - sx1
  else if (sx2 > rect.right - mx) dx = rect.right - mx - sx2
  if (sy1 < rect.top + mTop) dy = rect.top + mTop - sy1
  else if (sy2 > rect.bottom - mBot) dy = rect.bottom - mBot - sy2
  // An object larger than the gap can trip both edges; centring beats
  // ping-ponging between them.
  if (sx2 - sx1 > rect.right - rect.left - 2 * mx) dx = (rect.left + rect.right) / 2 - (sx1 + sx2) / 2
  if (sy2 - sy1 > rect.bottom - rect.top - mTop - mBot) dy = (rect.top + rect.bottom) / 2 - (sy1 + sy2) / 2
  if (dx === 0 && dy === 0) return

  animateCamera(stage.position.x + dx, stage.position.y + dy, zoom)
}

/**
 * Centre the world-space box in the visible gap, zoomed so it fills `fill` of it.
 * The default picks a box out of its surroundings; pass a bigger fraction when the
 * box is the thing being worked on rather than merely located.
 */
export function zoomToBounds(b: Bounds, fill = 0.4, clearBottom = 0): void {
  const rect = visibleRect(clearBottom)
  if (!rect) return
  const worldW = Math.max(b.width, 1)
  const worldH = Math.max(b.height, 1)
  const gapW = Math.max(1, rect.right - rect.left)
  const gapH = Math.max(1, rect.bottom - rect.top)
  const zoom = Math.min(Math.max(Math.min(gapW / worldW, gapH / worldH) * fill, MIN_ZOOM), MAX_ZOOM)
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  animateCamera(
    rect.left + gapW / 2 - cx * zoom,
    rect.top + gapH / 2 - cy * zoom,
    zoom,
  )
}

export function panChildIntoView(childId: string): void {
  const child = findChild(childId)
  if (child) panBoundsIntoView(getChildBounds(child))
}

export function zoomToChild(childId: string, fill?: number): void {
  const child = findChild(childId)
  if (child) zoomToBounds(getChildBounds(child), fill)
}
