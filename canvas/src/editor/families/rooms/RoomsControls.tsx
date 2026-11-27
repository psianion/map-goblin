// The Rooms tools' panel: Suggest rooms, and while proposals are up their count with Accept
// all and Dismiss; the Room outlines switch; the way to the rooms list. Proposals belong to
// the layer they were made on, so picking another layer dismisses them. A pending Outline it
// (the room card's) ends when the Outline tool leaves the hand.

import { useEffect, useState } from 'react';
import { List, Sparkles } from 'lucide-react';
import { useStore } from '@/store/store';
import { Caption, PrimaryButton, SecondaryButton, SwitchRow } from '@dnd/ui';
import { acceptAllSuggestions, activeDungeon, clearOutlineTarget, dismissSuggestions, suggestOnActiveLayer } from '@/editor/models/roomActions';
import { levelDungeons, roomCountText, SUGGEST_NOTHING } from '@/editor/models/roomModel';

/** Suggest, the outlines switch, and the way to the rooms list without a room's card. */
export function RoomsPanel() {
  const outlines = useStore((s) => s.ui.roomOverlayVisible);
  const outlining = useStore((s) => s.tools.activeTool === 'outline');
  // Outline it holds only while the Outline tool does.
  useEffect(() => {
    if (!outlining) clearOutlineTarget();
  }, [outlining]);
  useEffect(() => () => clearOutlineTarget(), []);
  return (
    <>
      <SuggestPanel />
      <div className="flex flex-col gap-px px-3 pb-1.5" data-section="Show">
        <SwitchRow label="Room outlines" checked={outlines} onCheckedChange={(v) => useStore.getState().setRoomOverlayVisible(v)} />
      </div>
      <div className="px-3 pb-2.5">
        <SecondaryButton icon={List} onClick={() => useStore.getState().setRoomsSheetOpen(true)}>
          Rooms list
        </SecondaryButton>
      </div>
    </>
  );
}

export function SuggestPanel() {
  const suggested = useStore((s) => s.ui.roomSuggestions?.rooms.length ?? 0);
  const lines = useStore((s) => s.ui.roomSuggestions?.divides?.length ?? 0);
  const existing = useStore((s) => activeDungeon(s)?.rooms?.length ?? 0);
  const onLevel = useStore((s) => levelDungeons(s.layers, s.levels, s.ui.activeLevelId).reduce((n, l) => n + (l.rooms?.length ?? 0), 0));
  const hasLayer = useStore((s) => activeDungeon(s) !== null);
  const activeLayerId = useStore((s) => s.ui.activeLayerId);
  // The last Suggest found nothing: its words stay until the map or the layer changes. Kept
  // with the layers array and layer it was found for, so either changing clears it.
  const [nothingFor, setNothingFor] = useState<{ layers: unknown; layerId: typeof activeLayerId } | null>(null);
  const layers = useStore((s) => s.layers);
  const nothing = nothingFor !== null && nothingFor.layers === layers && nothingFor.layerId === activeLayerId;
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
          <p className="m-0 text-[12px] text-text-2" data-testid="rooms-suggest-count">
            {suggested} room{suggested === 1 ? '' : 's'} suggested
            {existing > 0 ? `; your ${existing} stay as they are` : ''}
          </p>
          {lines > 0 && (
            <p className="m-0 text-[11px] text-text-3" data-testid="rooms-suggest-lines">
              {lines} dividing line{lines === 1 ? '' : 's'}. Take one away with its ✕ to join the spaces either side.
            </p>
          )}
          <span className="flex gap-1.5">
            <SecondaryButton onClick={dismissSuggestions}>Dismiss</SecondaryButton>
            <PrimaryButton onClick={acceptAllSuggestions}>Accept all</PrimaryButton>
          </span>
        </>
      ) : (
        <>
          <p className="m-0 text-[11px] text-text-3">{roomCountText(onLevel, 0)}</p>
          {nothing && (
            <p className="m-0 text-[12px] text-text-2" data-testid="rooms-suggest-nothing">
              {SUGGEST_NOTHING}
            </p>
          )}
          <SecondaryButton
            icon={Sparkles}
            className="self-start"
            disabled={!hasLayer}
            data-testid="rooms-suggest-button"
            onClick={() => {
              const found = suggestOnActiveLayer();
              const s = useStore.getState();
              setNothingFor(found === 0 ? { layers: s.layers, layerId: s.ui.activeLayerId } : null);
            }}
          >
            Suggest rooms
          </SecondaryButton>
        </>
      )}
    </div>
  );
}
