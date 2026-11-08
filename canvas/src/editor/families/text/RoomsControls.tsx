// The Rooms tools' panel extra: Suggest rooms, and while proposals are up their count with
// Accept all and Dismiss. Proposals belong to the layer they were made on, so picking
// another layer dismisses them.

import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { useStore } from '@/store/store';
import { Caption, PrimaryButton, SecondaryButton } from '@/editor/components';
import { acceptAllSuggestions, activeDungeon, dismissSuggestions, suggestOnActiveLayer } from '@/editor/models/roomActions';
import { levelDungeons, roomCountText } from '@/editor/models/roomModel';

export function SuggestPanel() {
  const suggested = useStore((s) => s.ui.roomSuggestions?.rooms.length ?? 0);
  const existing = useStore((s) => activeDungeon(s)?.rooms?.length ?? 0);
  const onLevel = useStore((s) => levelDungeons(s.layers, s.levels, s.ui.activeLevelId).reduce((n, l) => n + (l.rooms?.length ?? 0), 0));
  const hasLayer = useStore((s) => activeDungeon(s) !== null);
  const activeLayerId = useStore((s) => s.ui.activeLayerId);
  // Per-ghost accept and reject can empty the list; an empty list is no proposal at all.
  useEffect(() => {
    const list = useStore.getState().ui.roomSuggestions;
    if (list && list.rooms.length === 0) dismissSuggestions();
  }, [suggested]);
  useEffect(() => {
    const list = useStore.getState().ui.roomSuggestions;
    if (list && list.layerId !== activeLayerId) dismissSuggestions();
  }, [activeLayerId]);
  return (
    <div className="flex flex-col gap-1.5 px-3 pb-2.5" data-section="Suggest" data-testid="rooms-suggest">
      <Caption>Suggest</Caption>
      {suggested > 0 ? (
        <>
          <p className="text-[12px] text-text-2">
            {suggested} room{suggested === 1 ? '' : 's'} suggested
            {existing > 0 ? `; your ${existing} stay as they are` : ''}
          </p>
          <span className="flex gap-1.5">
            <SecondaryButton onClick={dismissSuggestions}>Dismiss</SecondaryButton>
            <PrimaryButton onClick={acceptAllSuggestions}>Accept all</PrimaryButton>
          </span>
        </>
      ) : (
        <>
          <p className="text-[11px] text-text-3">{roomCountText(onLevel, 0)}</p>
          <SecondaryButton icon={Sparkles} className="self-start" disabled={!hasLayer} onClick={() => suggestOnActiveLayer()}>
            Suggest rooms
          </SecondaryButton>
        </>
      )}
    </div>
  );
}
