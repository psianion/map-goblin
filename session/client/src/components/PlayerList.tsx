import type { PlayerInfo } from '@dnd/core/src/shared/protocol';
import { useSessionStore } from '../session/store';

/**
 * The seat a player left behind on their way back in.
 *
 * `POST /api/join` mints a fresh identity every time, deliberately: identityIds are public
 * roster data, so honouring a caller-supplied one would let anyone read the DM's id off the
 * table and mint themselves a DM token. A reconnect from a new tab is therefore a genuinely
 * new identity, and the old one stays on the roster because §2.5 keeps disconnected players
 * visible rather than deleting them. The two together are what put "Borin" greyed out next
 * to "Borin (you)".
 *
 * Dropped here rather than server-side: a name is not a credential, and the server treating
 * two identities as one on the strength of a matching name is the trust boundary the join
 * route refuses to cross. This is the roster admitting the obvious instead.
 *
 * ponytail: two different people who are both called Borin will hide one row while one of
 * them is away. Key it on something a player actually owns the day seats get names of their
 * own — a claimed token, or a seat id the client keeps across tabs.
 */
function withoutSupersededSeats(players: readonly PlayerInfo[]): PlayerInfo[] {
  const here = new Set(players.filter((p) => p.connected).map((p) => p.name));
  return players.filter((p) => p.connected || !here.has(p.name));
}

/** Roster from the session snapshot. Disconnected players dim but never vanish (§2.5). */
export function PlayerList() {
  const roster = useSessionStore((s) => s.session?.players);
  const youId = useSessionStore((s) => s.you?.identityId);

  if (!roster || roster.length === 0) {
    return <p className="text-sm text-neutral-500">No one at the table yet.</p>;
  }
  const players = withoutSupersededSeats(roster);

  return (
    <ul className="flex flex-col gap-1" data-testid="player-list">
      {players.map((p) => (
        <li
          key={p.identityId}
          data-connected={p.connected}
          className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${
            p.connected ? 'text-neutral-200' : 'text-neutral-500 opacity-60'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              p.connected ? 'bg-emerald-400' : 'bg-neutral-600'
            }`}
            aria-hidden
          />
          <span className="truncate">{p.name}</span>
          {p.identityId === youId && <span className="text-xs text-neutral-500">(you)</span>}
          {p.role === 'dm' && (
            <span
              title="Dungeon Master"
              className="ml-auto rounded bg-amber-500/15 px-1.5 text-xs font-medium text-amber-400"
            >
              DM
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
