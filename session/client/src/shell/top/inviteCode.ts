import { useEffect } from 'react';
import { fetchActiveSession } from '../../session/auth';
import { useSessionStore } from '../../session/store';

/**
 * The table's invite code for the DM: the one the host flow handed over, else `?code=` on
 * the URL, else asked of the server once (a resumed or freshly minted DM seat never went
 * through the host flow). Null for a player and until it is known.
 */
export function useInviteCode(): string | null {
  const role = useSessionStore((s) => s.you?.role);
  const stored = useSessionStore((s) => s.inviteCode);
  const code = stored ?? new URLSearchParams(window.location.search).get('code');

  useEffect(() => {
    if (role !== 'dm' || stored) return;
    const { session, token } = useSessionStore.getState();
    if (!session || !token) return;
    let cancelled = false;
    fetchActiveSession(session.campaignId, token)
      .then((res) => {
        if (!cancelled) useSessionStore.getState().setInviteCode(res.inviteCode);
      })
      .catch(() => {
        // No open table, or the server is away: the card simply shows no code.
      });
    return () => {
      cancelled = true;
    };
  }, [role, stored]);

  return role === 'dm' ? code : null;
}

/** The link a player opens to join with this code. */
export const inviteLink = (code: string): string => `${window.location.origin}/join/${code}`;

/** True once any player has sat down at this table (the Invite card then shrinks to its button). */
export function usePlayersJoined(): boolean {
  return useSessionStore((s) => !!s.session?.players.some((p) => p.role === 'player'));
}
