import { create } from 'zustand';
import type { Audience } from '@dnd/mechanics/story';

/** Who the DM's next Show goes to: everyone, or the players picked. Local to the DM's seat. */
export const useStoryAudience = create<{ mode: 'all' | 'chosen'; chosen: string[] }>()(() => ({ mode: 'all', chosen: [] }));

export function currentAudience(): Audience {
  const { mode, chosen } = useStoryAudience.getState();
  return mode === 'chosen' && chosen.length > 0 ? [...chosen] : 'all';
}
