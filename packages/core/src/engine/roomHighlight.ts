import type { Graphics } from 'pixi.js';
import { useStore } from '../store/store';
import type { DungeonLayer } from '../store/types';

const HIGHLIGHT_COLOR = 0x38bdf8;

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

  highlight.poly(room.boundary.flat());
  highlight.fill({ color: HIGHLIGHT_COLOR, alpha: 0.18 });
  highlight.stroke({ color: HIGHLIGHT_COLOR, width: 0.08, alpha: 0.9 });
}
