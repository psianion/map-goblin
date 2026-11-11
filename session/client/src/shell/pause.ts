import { useSessionStore } from '../session/store';
import type { TableSwitches } from './top/sessionActions';

type SessionSlice = Pick<ReturnType<typeof useSessionStore.getState>, 'you' | 'session'>;

/**
 * A player's seat while the DM holds the table: the whole shell greyed and taking no input
 * (PauseOverlay), and the hotkeys and the camera answering nothing. The DM's seat never
 * freezes, Player view and Preview as included: it is still the DM's seat.
 */
export function isFrozen(s: SessionSlice): boolean {
  if (s.you?.role !== 'player') return false;
  return (s.session?.modules.table as TableSwitches | undefined)?.paused === true;
}

/** For event handlers: whether this seat is frozen right now. */
export const frozenNow = (): boolean => isFrozen(useSessionStore.getState());

export const useFrozen = (): boolean => useSessionStore(isFrozen);
