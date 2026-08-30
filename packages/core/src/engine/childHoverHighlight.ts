import type { Graphics } from 'pixi.js';
import { useStore } from '../store/store';
import { getChildBounds } from './hitTest';
import { OVERLAY_INK, OVERLAY_WHITE } from './overlayPalette';
import type { AnyChild } from '../store/types';

let highlight: Graphics | null = null;
let lastChildId: string | null = null;

/** Wire the world-space Graphics the highlight is drawn into (see sceneGraph). */
export function initChildHoverHighlight(graphics: Graphics): void {
  highlight = graphics;
  highlight.label = 'childHoverHighlight';
  lastChildId = null;
}

function findChild(childId: string): AnyChild | null {
  for (const layer of useStore.getState().layers) {
    if (layer.type !== 'dungeon') continue;
    const child = layer.children.find((c) => c.id === childId);
    if (child) return child;
  }
  return null;
}

/**
 * Outline the child whose layer-panel row is hovered. Called every frame but
 * redraws only when the hovered child changes — same contract as
 * renderRoomHighlight.
 *
 * ponytail: a plain AABB, not the per-type trace SelectTool's own hover
 * draws — the panel just needs "it's THAT one over there", and a box does
 * that for every child type including the ones SelectTool skips.
 */
export function renderChildHoverHighlight(): void {
  if (!highlight) return;
  const childId = useStore.getState().ui.panelHoverChildId;
  if (childId === lastChildId) return;
  lastChildId = childId;

  highlight.clear();
  if (!childId) return;
  const child = findChild(childId);
  if (!child) return;

  const b = getChildBounds(child);
  // White over ink, like every canvas overlay.
  highlight.rect(b.x, b.y, b.width, b.height);
  highlight.stroke({ color: OVERLAY_INK, width: 0.12, alpha: 0.7 });
  highlight.rect(b.x, b.y, b.width, b.height);
  highlight.stroke({ color: OVERLAY_WHITE, width: 0.05, alpha: 1 });
}
