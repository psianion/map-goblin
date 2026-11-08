import { cn } from '@dnd/ui';
import { useSessionStore } from '../../session/store';
import { seatColour } from '../seatColour';
import { initials, withoutSupersededSeats } from './roster';

/**
 * Who is at the table: one avatar per person in their seat colour, a filled dot while
 * online and a hollow one while away.
 */
export function Presence() {
  const roster = useSessionStore((s) => s.session?.players);
  const youId = useSessionStore((s) => s.you?.identityId);
  if (!roster || roster.length === 0) return null;
  const people = withoutSupersededSeats(roster);
  return (
    <ul className="flex items-center -space-x-1" data-testid="presence" aria-label="At the table">
      {people.map((p) => (
        <li
          key={p.identityId}
          data-testid="presence-avatar"
          data-connected={p.connected ? 'true' : 'false'}
          title={`${p.name}${p.identityId === youId ? ' (you)' : ''}${p.role === 'dm' ? ' · DM' : ''}${p.connected ? '' : ' · away'}`}
          className={cn('relative', !p.connected && 'opacity-60')}
        >
          <span
            className="flex size-7 items-center justify-center rounded-pill border-2 border-panel text-xs font-medium text-white"
            style={{ backgroundColor: seatColour(p.identityId) }}
          >
            {initials(p.name)}
          </span>
          <span
            aria-hidden
            className={cn(
              'absolute right-0 bottom-0 size-2.5 rounded-pill border-2 border-panel',
              p.connected ? 'bg-ink' : 'bg-panel ring-1 ring-inset ring-text-3',
            )}
          />
        </li>
      ))}
    </ul>
  );
}
