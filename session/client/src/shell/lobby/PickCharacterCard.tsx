import { createPortal } from 'react-dom';
import { FloatBox, SecondaryButton } from '@dnd/ui';
import { CharacterPicker } from './CharacterPicker';
import { useNeedsCharacter, usePickCard } from './pickCharacter';

/**
 * A seat with no character on a started table (a late joiner, or one who never picked): the
 * map behind, and the lobby's picker in a card. It sits above the pause overlay, which leaves
 * anything marked `data-above-pause` reachable, so a pause never locks a newcomer out of it.
 */
export function PickCharacterCard() {
  const needed = useNeedsCharacter();
  const away = usePickCard((s) => s.away);
  if (!needed || away) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[2147483001] grid place-items-center p-4" data-above-pause>
      <FloatBox
        className="pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-[min(100%,480px)] flex-col gap-4 overflow-y-auto p-5"
        role="dialog"
        aria-labelledby="pick-character-title"
        data-testid="pick-character"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="pick-character-title" className="text-base font-medium text-text">
              Pick your character
            </h2>
            <p className="text-xs text-text-2">The table has started. Choose who you play and you join the party on the map.</p>
          </div>
          <SecondaryButton className="shrink-0" data-testid="pick-character-later" onClick={() => usePickCard.setState({ away: true })}>
            Not now
          </SecondaryButton>
        </div>
        <CharacterPicker />
      </FloatBox>
    </div>,
    document.body,
  );
}
