import { useSessionStore } from '../../session/store';
import { InitiativePromptCard, PlayerRollBar, RollChips, RollPromptCard } from './PlayerRolls';

/** The on-map roll surfaces: result chips for every seat; for players the roll bar, the DM's roll prompt and the initiative prompt. */
export function PlayOverlays() {
  const player = useSessionStore((s) => s.you?.role === 'player');
  return (
    <>
      <RollChips />
      {player && (
        <>
          <PlayerRollBar />
          <RollPromptCard />
          <InitiativePromptCard />
        </>
      )}
    </>
  );
}
