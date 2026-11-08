import { Caption, FloatBox } from '@dnd/ui';
import { useSessionStore } from '../session/store';
import { seatColour } from './seatColour';
import { withoutSupersededSeats } from './top/roster';

/** A player at a table with no live scene yet: who else is here, while the DM sets up. */
export function WaitingCard() {
  const role = useSessionStore((s) => s.you?.role);
  const session = useSessionStore((s) => s.session);
  if (role !== 'player' || !session || session.activeSceneId) return null;
  const party = withoutSupersededSeats(session.players).filter((p) => p.role === 'player');
  return (
    <FloatBox className="absolute top-1/2 left-1/2 z-30 flex w-80 -translate-x-1/2 -translate-y-1/2 flex-col gap-3 p-5" data-testid="waiting-card" role="status">
      <h2 className="text-base font-medium text-text">Waiting for the DM</h2>
      <p className="text-xs text-text-2">The map opens here as soon as the DM picks a scene.</p>
      <Caption>At the table</Caption>
      <ul className="flex flex-col gap-1" data-testid="waiting-party">
        {party.map((p) => (
          <li key={p.identityId} className="flex items-center gap-2 text-xs text-text-2">
            <span aria-hidden className="size-2 rounded-pill" style={{ backgroundColor: seatColour(p.identityId) }} />
            {p.name}
            {!p.connected && <span className="text-text-3">away</span>}
          </li>
        ))}
      </ul>
    </FloatBox>
  );
}
