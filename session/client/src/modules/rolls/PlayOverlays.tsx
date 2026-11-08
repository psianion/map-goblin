import { useSessionStore } from '../../session/store';
import { PlayerRollBar, RollChips, RollPromptCard } from './PlayerRolls';

/** The on-map roll surfaces: result chips for every seat; the roll bar and prompt card for players. */
export function PlayOverlays() {
  const player = useSessionStore((s) => s.you?.role === 'player');
  return (
    <>
      <RollChips />
      {player && (
        <>
          <PlayerRollBar />
          <RollPromptCard />
        </>
      )}
    </>
  );
}
