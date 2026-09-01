import type { PlayerInfo } from '@dnd/core/src/shared/protocol';
import type { TokensState } from '@dnd/mechanics/tokens';
import { tokensOf } from '../modules/tokens/TokenRenderer';
import { useModuleState, useSessionStore } from '../session/store';

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
  const activeSceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const tokensState = useModuleState<TokensState>('tokens');

  if (!roster || roster.length === 0) {
    return <p className="text-sm text-text-muted">No one at the table yet.</p>;
  }
  const players = withoutSupersededSeats(roster);
  // M3 review finding 16: the claimed token's name, so the roster reads "Willow — Karlach"
  // instead of the account name alone — the same `ownerId` link `MePanel`'s title reads.
  const claimed = tokensOf(tokensState, activeSceneId);

  return (
    <ul className="flex flex-col gap-1" data-testid="player-list">
      {players.map((p) => {
        const token = claimed.find((t) => t.ownerId === p.identityId);
        const character = token?.name;
        return (
          <li
            key={p.identityId}
            data-connected={p.connected}
            className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${
              p.connected ? 'text-text-secondary' : 'text-text-muted opacity-60'
            }`}
          >
            {/* Presence as shape (chrome-style-guide.md "State encoding"), not colour: a
                filled disc reads as "here" without leaning on green meaning "fine" elsewhere
                (the ring glyph carries "away" on its own — the muted label beside it is what
                names it, not a colour). */}
            <span
              aria-hidden
              className={
                p.connected
                  ? 'h-1.5 w-1.5 shrink-0 rounded-full bg-text-secondary'
                  : 'h-1.5 w-1.5 shrink-0 rounded-full border border-text-muted'
              }
            />
            <span className="truncate">{p.name}</span>
            {p.identityId === youId && <span className="text-xs text-text-muted">(you)</span>}
            {character && p.connected && (
              <span className="min-w-0 truncate text-xs text-text-muted">
                {'— '}
                {token?.sheet?.url ? (
                  <a
                    href={token.sheet.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-active hover:underline"
                  >
                    {character}
                  </a>
                ) : (
                  character
                )}
              </span>
            )}
            {p.role === 'dm' ? (
              <span
                title="Dungeon Master"
                className="ml-auto shrink-0 rounded border border-border-default px-1.5 text-xs font-medium text-text-dim"
              >
                DM
              </span>
            ) : (
              !p.connected && <span className="ml-auto shrink-0 text-xs text-text-muted">away</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
