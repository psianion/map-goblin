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
          {/* F23: one prompt stack, bottom-right, so a check card and the initiative prompt
              never land on each other. Initiative on top: the whole table waits on it. */}
          <div
            className="absolute right-3 bottom-20 z-30 flex max-w-[calc(100%-1.5rem)] flex-col items-end gap-2"
            data-testid="prompt-stack"
          >
            <InitiativePromptCard />
            <RollPromptCard />
          </div>
        </>
      )}
    </>
  );
}
