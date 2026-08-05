// Bridge from pointer handling (outside React) into the canvas context menu.
// Same module-ref pattern as importImageRef / zoomToFitRef. Lives in its own
// file so CanvasContextMenu.tsx exports only the component (fast refresh).

export interface CanvasMenuPayload {
  /** Viewport position of the click, for the menu's top-left. */
  x: number
  y: number
  /** Where the click landed in world squares. */
  world: { x: number; y: number }
  target:
    | { kind: 'child'; childId: string }
    | { kind: 'multi'; count: number }
    | { kind: 'canvas' }
}

/** Set by CanvasContextMenu on mount; useCanvasInput calls it on button-2. */
export const openCanvasMenuRef: { current: ((payload: CanvasMenuPayload) => void) | null } = {
  current: null,
}
