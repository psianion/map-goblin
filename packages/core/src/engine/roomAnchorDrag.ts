/**
 * A room badge being dragged: where the room's anchor would land if the pointer
 * were released now. The Select tool writes it per pointermove and the room
 * overlay moves the badge to it; nothing touches the store until release, when
 * one `SetRoomAnchorCommand` lands. Null when no badge is being dragged.
 */
export interface AnchorPreview {
  layerId: string;
  roomId: string;
  point: [number, number];
}

let current: AnchorPreview | null = null;
const listeners = new Set<(preview: AnchorPreview | null) => void>();

export function setAnchorPreview(preview: AnchorPreview | null): void {
  current = preview;
  for (const listener of listeners) listener(preview);
}

export function getAnchorPreview(): AnchorPreview | null {
  return current;
}

/** Listen for badge drag moves. Returns the unsubscribe. */
export function onAnchorPreview(listener: (preview: AnchorPreview | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
