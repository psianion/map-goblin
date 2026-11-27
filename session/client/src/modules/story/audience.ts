import { create } from 'zustand';
import type { PlayerInfo } from '@dnd/core/src/shared/protocol';
import type { Audience, Dismissal } from '@dnd/mechanics/story';

/** Who the DM's next Show goes to: everyone, or the players picked. Local to the DM's seat. */
export const useStoryAudience = create<{ mode: 'all' | 'chosen'; chosen: string[] }>()(() => ({ mode: 'all', chosen: [] }));

export function currentAudience(): Audience {
  const { mode, chosen } = useStoryAudience.getState();
  return mode === 'chosen' && chosen.length > 0 ? [...chosen] : 'all';
}

/**
 * The DM's "showing" line: of the player seats a showing went to, how many still have it up,
 * the rest having hidden it for themselves. `players` is the roster without superseded seats.
 */
export function stillUp(
  showing: { audience?: Audience; dismissed?: Dismissal[] },
  players: readonly PlayerInfo[],
): { up: number; of: number } {
  const audience = showing.audience ?? 'all';
  const seats = players.filter((p) => p.role === 'player' && (audience === 'all' || audience.includes(p.identityId)));
  const gone = new Set((showing.dismissed ?? []).map((d) => d.id));
  return { up: seats.filter((p) => !gone.has(p.identityId)).length, of: seats.length };
}

export const stillUpText = ({ up, of }: { up: number; of: number }): string =>
  of === 0 ? 'No players at the table' : `Still up for ${up} of ${of}`;
