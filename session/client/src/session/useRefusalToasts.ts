// The table's ear for a refused command, mounted once from GameTable.
//
// It used to live inside the panels — `useTokenFeedback` in TokenPanel, `useDoorFeedback` in
// DoorPanel — and a popover only renders while it is open. A player at the table normally has
// no panel open at all (the tokens rail icon is DM-only, `railRoles`), so nothing was
// subscribed to `lastError` when their move came back refused: the server sent the frame, the
// store recorded it, and no component was mounted to say it out loud. The move answered with a
// 600ms rubber-band and nothing else, which reads as a dropped frame rather than as a "no".
//
// So it is hoisted here for the same reason `useTriggerToasts` and the turn ring are: this has
// to run whether or not any panel is open. One ear for both lanes, because both read the same
// `lastError` and a move stopped *by a door* is the doors lane's sentence arriving through the
// tokens command.

import { useEffect } from 'react';
import { doorRefusal } from '../modules/doors/doors';
import { liveSceneDoors } from '../modules/doors/DoorRenderer';
import { tokenRefusal } from '../modules/tokens/drag';
import { showToast } from './toasts';
import { useSessionStore } from './store';

/**
 * The words for one refusal, or null when it is not something to interrupt a player for
 * (a malformed payload, an id the client never showed them). Pure, so the table's copy is
 * testable without mounting the shell.
 */
export function refusalToast(message: string, doors = liveSceneDoors()): string | null {
  return tokenRefusal(message, doors) ?? doorRefusal(message, doors);
}

export function useRefusalToasts(): void {
  const lastError = useSessionStore((s) => s.lastError);
  useEffect(() => {
    if (!lastError) return;
    // Doors are read for the *name* only, and off the store rather than as a subscription: a
    // door list arriving a beat later must not re-toast a refusal already given.
    const message = refusalToast(lastError.message);
    if (message) showToast({ message });
  }, [lastError]);
}
