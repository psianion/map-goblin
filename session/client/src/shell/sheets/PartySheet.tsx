import { useSessionStore } from '../../session/store';
import { seatColour } from '../seatColour';
import { withoutSupersededSeats } from '../top/roster';
import { closeSheet } from './registry';
import { SheetFrame } from './SheetFrame';

/** The Party sheet until the play side's own lands: who is at the table, here or away. */
export function PartySheet() {
  const roster = useSessionStore((s) => s.session?.players ?? []);
  const party = withoutSupersededSeats(roster).filter((p) => p.role === 'player');
  return (
    <SheetFrame title="Party" onClose={closeSheet} testId="party-sheet">
      <ul className="flex flex-col gap-1 px-3 py-2">
        {party.length === 0 && <li className="text-xs text-text-3">No players yet.</li>}
        {party.map((p) => (
          <li key={p.identityId} className="flex h-8 items-center gap-2 text-xs text-text-2">
            <span aria-hidden className="size-2 rounded-pill" style={{ backgroundColor: seatColour(p.identityId) }} />
            <span className="text-text">{p.name}</span>
            {!p.connected && <span className="text-text-3">away</span>}
          </li>
        ))}
      </ul>
    </SheetFrame>
  );
}
