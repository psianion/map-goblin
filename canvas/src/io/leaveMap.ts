// src/io/leaveMap.ts
// Leaving a map for the home page: the save finishes first, so a reload straight after
// going home never loses it and the card shows the map as it was left.

import { notify } from '@dnd/ui/toast';

/** How long the save may take before the DM is told it is still saving. */
export const SAVING_NOTICE_MS = 300;

/**
 * Run `save`, then `leave`, whether the save worked or not (a failure is said in a toast).
 * A save slower than {@link SAVING_NOTICE_MS} shows "Saving…" while it finishes.
 */
export async function saveThenLeave(save: () => Promise<void>, leave: () => void): Promise<void> {
  const slow = setTimeout(() => notify.subtle('Saving…', { icon: 'save' }), SAVING_NOTICE_MS);
  try {
    await save();
  } catch (err) {
    console.error('[leaveMap] save failed:', err);
    notify.error("Couldn't save the map before leaving it. Your last autosave is kept.");
  } finally {
    clearTimeout(slow);
  }
  leave();
}
