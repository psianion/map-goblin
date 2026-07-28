import { useSessionStore } from '../session/store';

/** Roster from the session snapshot. Disconnected players dim but never vanish (§2.5). */
export function PlayerList() {
  const players = useSessionStore((s) => s.session?.players);
  const youId = useSessionStore((s) => s.you?.identityId);

  if (!players || players.length === 0) {
    return <p className="text-sm text-neutral-500">No one at the table yet.</p>;
  }

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
