import type { ToolsSlice } from '@/store/types';

/**
 * Keys a wall or cave-band node edit answers: rotate, size, gap, piece / re-lay,
 * insert, remove. Shifted spellings are listed too, since `e.key` arrives shifted.
 */
const WALL_SESSION_KEYS = new Set([
  '[', ']', '-', '_', '=', '+', ',', '<', '.', '>', 'Tab', '{', '}', 'Delete', 'Backspace',
]);

/** Keys a floor outline edit answers. Tab has no job there yet, but it is still the session's. */
const OUTLINE_SESSION_KEYS = new Set(['Tab', 'Delete', 'Backspace']);

type SessionTools = Pick<ToolsSlice, 'nodeEditWallId' | 'shapeNodeEditId'>;

/** A wall, cave-band or outline node edit is open. */
export function editSessionActive(tools: SessionTools): boolean {
  return tools.nodeEditWallId !== null || tools.shapeNodeEditId !== null;
}

/**
 * Whether the open edit session owns this key, selection or not.
 *
 * With nothing picked the session has nothing to apply the key to, but it still
 * claims it: let through, Tab folds the dock (which re-fits the map, so the zoom
 * jumps under the DM's hands) and Delete takes the whole shape selection with it.
 * Ctrl and Cmd combos are never the session's, so undo and save keep working.
 */
export function editSessionOwnsKey(
  tools: SessionTools,
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>,
): boolean {
  if (e.ctrlKey || e.metaKey) return false;
  if (tools.nodeEditWallId !== null) return WALL_SESSION_KEYS.has(e.key);
  if (tools.shapeNodeEditId !== null) return OUTLINE_SESSION_KEYS.has(e.key);
  return false;
}
