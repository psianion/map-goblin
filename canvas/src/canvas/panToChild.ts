import { getEngineSingleton } from '@/engine/engineSingleton'
import { getChildBounds } from '@dnd/core/src/engine/hitTest'
import { useStore } from '@/store/store'
import { cancelZoomAnimationRef, viewportInsetsRef } from '@/components/toolbar/zoomToFitRef'
import type { AnyChild } from '@/store/types'

const MIN_ZOOM = 10
const MAX_ZOOM = 100
const DURATION_MS = 150

let rafId = 0

function findChild(childId: string): AnyChild | null {
  for (const layer of useStore.getState().layers) {
    if (layer.type !== 'dungeon') continue
    const child = layer.children.find((c) => c.id === childId)
    if (child) return child
  }
  return null
}

// Same ease-out rAF pattern as ZoomSlider's fit-to-content, sharing its
// cancel ref so a wheel/pan interrupt kills this animation too.
function animateTo(targetX: number, targetY: number, targetZoom: number): void {
  const singleton = getEngineSingleton()
  if (!singleton) return
  const stage = singleton.engine.stage()
  cancelZoomAnimationRef.current?.()
  cancelAnimationFrame(rafId)
  const startX = stage.position.x
  const startY = stage.position.y
  const startZoom = stage.scale.x
  const startTime = performance.now()
  function tick(): void {
    const t = Math.min((performance.now() - startTime) / DURATION_MS, 1)
    const ease = 1 - Math.pow(1 - t, 3)
    stage.position.x = startX + (targetX - startX) * ease
    stage.position.y = startY + (targetY - startY) * ease
    stage.scale.set(startZoom + (targetZoom - startZoom) * ease)
    if (t < 1) rafId = requestAnimationFrame(tick)
    else rafId = 0
  }
  rafId = requestAnimationFrame(tick)
}

/** The screen-space rect the overlaid chrome leaves visible. */
function visibleRect() {
  const singleton = getEngineSingleton()
  if (!singleton) return null
  const vp = singleton.engine.viewport()
  const insets = viewportInsetsRef.current
  return {
    left: insets.left,
    top: 0,
    right: vp.width - insets.right,
    bottom: vp.height - insets.bottom,
    stage: singleton.engine.stage(),
  }
}

/**
 * Pan (never zoom) so the child is inside the visible gap between the
 * panels. No-op when it already is — clicking rows of on-screen objects
 * must not nudge the camera.
 */
export function panChildIntoView(childId: string): void {
  const child = findChild(childId)
  const rect = visibleRect()
  if (!child || !rect) return
  const { stage } = rect
  const zoom = stage.scale.x
  const b = getChildBounds(child)
  const sx1 = b.x * zoom + stage.position.x
  const sy1 = b.y * zoom + stage.position.y
  const sx2 = (b.x + b.width) * zoom + stage.position.x
  const sy2 = (b.y + b.height) * zoom + stage.position.y

  const margin = 24
  let dx = 0
  let dy = 0
  if (sx1 < rect.left + margin) dx = rect.left + margin - sx1
  else if (sx2 > rect.right - margin) dx = rect.right - margin - sx2
  if (sy1 < rect.top + margin) dy = rect.top + margin - sy1
  else if (sy2 > rect.bottom - margin) dy = rect.bottom - margin - sy2
  // An object larger than the gap can trip both edges; centring beats
  // ping-ponging between them.
  if (sx2 - sx1 > rect.right - rect.left - 2 * margin) dx = (rect.left + rect.right) / 2 - (sx1 + sx2) / 2
  if (sy2 - sy1 > rect.bottom - rect.top - 2 * margin) dy = (rect.top + rect.bottom) / 2 - (sy1 + sy2) / 2
  if (dx === 0 && dy === 0) return

  animateTo(stage.position.x + dx, stage.position.y + dy, zoom)
}

/** Centre the child in the visible gap and zoom so it fills ~40% of it. */
export function zoomToChild(childId: string): void {
  const child = findChild(childId)
  const rect = visibleRect()
  if (!child || !rect) return
  const b = getChildBounds(child)
  const worldW = Math.max(b.width, 1)
  const worldH = Math.max(b.height, 1)
  const gapW = Math.max(1, rect.right - rect.left)
  const gapH = Math.max(1, rect.bottom - rect.top)
  const zoom = Math.min(Math.max(Math.min(gapW / worldW, gapH / worldH) * 0.4, MIN_ZOOM), MAX_ZOOM)
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  animateTo(
    rect.left + gapW / 2 - cx * zoom,
    rect.top + gapH / 2 - cy * zoom,
    zoom,
  )
}
