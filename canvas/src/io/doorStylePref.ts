// The Door tool's Style (a door style, Opening or Stairs) kept for the browser session, so a
// reload or a new map hands back the style last used rather than Single.

import { useStore } from '@/store/store';
import type { ToolSettings } from '@/store/types';

export const DOOR_STYLE_PREF_KEY = 'mapbuilder-door-style';

type DoorStylePref = Pick<ToolSettings, 'doorStyle' | 'doorBare' | 'doorStairs'>;

const pick = ({ doorStyle, doorBare, doorStairs }: ToolSettings): DoorStylePref => ({ doorStyle, doorBare, doorStairs });
const same = (a: ToolSettings, b: ToolSettings): boolean =>
  a.doorStyle === b.doorStyle && a.doorBare === b.doorBare && a.doorStairs === b.doorStairs;

function load(): DoorStylePref | null {
  try {
    const raw = sessionStorage.getItem(DOOR_STYLE_PREF_KEY);
    return raw ? (JSON.parse(raw) as DoorStylePref) : null;
  } catch {
    return null;
  }
}

function save(pref: DoorStylePref): void {
  try {
    sessionStorage.setItem(DOOR_STYLE_PREF_KEY, JSON.stringify(pref));
  } catch {
    /* storage blocked: the style lasts until the page goes */
  }
}

/** Applies the session's door style to the store, then keeps it. Returns the unsubscribe. */
export function initDoorStylePref(store: typeof useStore = useStore): () => void {
  let kept = load();
  if (kept) store.getState().updateToolSettings(kept);
  return store.subscribe((s, prev) => {
    if (same(s.tools.settings, prev.tools.settings)) return;
    // A new map puts the tools back to their defaults: the session's style comes back.
    if (kept && s.layers !== prev.layers && s.tools !== prev.tools) {
      store.getState().updateToolSettings(kept);
      return;
    }
    kept = pick(s.tools.settings);
    save(kept);
  });
}
