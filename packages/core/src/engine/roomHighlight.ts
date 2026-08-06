import type { Graphics } from 'pixi.js';
import { useStore } from '../store/store';
import type { DungeonLayer } from '../store/types';
import { OVERLAY_INK, OVERLAY_WHITE } from './overlayPalette';

let highlight: Graphics | null = null;
let lastRoomId: string | null = null;

/** Wire the world-space Graphics the highlight is drawn into (see sceneGraph). */
export function initRoomHighlight(graphics: Graphics): void {
  highlight = graphics;
  highlight.label = 'roomHighlight';
  lastRoomId = null;
}

/**
 * Outline the room the RoomPanel is pointing at. Called every frame but
 * redraws only when the highlighted room changes.
 *
 * ponytail: keyed on the room ID alone, so a boundary that moves under a held
 * highlight goes stale until the pointer moves. Key on the boundary too if
 * that ever shows.
 */
export function renderRoomHighlight(): void {
  if (!highlight) return;
  const state = useStore.getState();
  const roomId = state.ui.highlightedRoomId;
  if (roomId === lastRoomId) return;
  lastRoomId = roomId;

  highlight.clear();
  if (!roomId) return;

  const layer = state.layers.find(
    (l): l is DungeonLayer => l.type === 'dungeon' && l.id === state.ui.activeLayerId,
  );
  const room = layer?.rooms?.find((r) => r.id === roomId);
  if (!room || room.boundary.length < 3) return;

  // White over ink, like every canvas overlay — sky-blue disappeared on water.
  highlight.poly(room.boundary.flat());
  highlight.fill({ color: OVERLAY_WHITE, alpha: 0.12 });
  highlight.stroke({ color: OVERLAY_INK, width: 0.12, alpha: 0.7 });
  highlight.poly(room.boundary.flat());
  highlight.stroke({ color: OVERLAY_WHITE, width: 0.05, alpha: 1 });
}
