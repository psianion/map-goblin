import { useEffect } from 'react';
import { useStore } from '@/store/store';
import type { ToolType, UISlice } from '@/store/types';
import { editSessionActive } from '@/canvas/editSessionKeys';
import { cn } from '@/lib/utils';
import { Seg, Switch } from './controls';
import { RoomsListIcon, SuggestIcon } from './roomIcons';
import { acceptAllSuggestions, activeDungeon, dismissSuggestions, suggestOnActiveLayer } from './roomActions';
import { levelDungeons, roomCountText } from './roomModel';
import './rooms.css';

/* The Rooms tab of the dock (board 1): view settings for the overlay and what the room
 * tools write, then Suggest, the room count and the rooms list. */

const LABEL_CHOICES: { value: UISlice['roomLabels']; label: string; tip: string }[] = [
  { value: 'off', label: 'Off', tip: 'Outlines only' },
  { value: 'numbers', label: 'Numbers', tip: 'Number badges' },
  { value: 'both', label: 'Both', tip: 'Number badges and names' },
];

const WALL_CHOICES: { value: UISlice['roomWalls']; label: string; tip: string }[] = [
  { value: 'with', label: 'With room', tip: 'A drawn room gets walls round its floor' },
  { value: 'none', label: 'None', tip: 'A drawn room gets a floor only' },
];

const DIVIDER_CHOICES: { value: UISlice['dividerMode']; label: string; tip: string }[] = [
  { value: 'threshold', label: 'Threshold', tip: 'Splits the room, blocks nothing' },
  { value: 'wall', label: 'Wall', tip: 'A real wall: blocks movement and sight' },
];

/** The settings for the room tool in hand: Divider (Divide only), Outlines, Labels, Walls (drawing only). */
export function RoomSettings({ tool }: { tool: ToolType }) {
  const outlines = useStore((s) => s.ui.roomOverlayVisible);
  const labels = useStore((s) => s.ui.roomLabels);
  const walls = useStore((s) => s.ui.roomWalls);
  const divider = useStore((s) => s.ui.dividerMode);
  const s = useStore.getState();
  const dividing = tool === 'divide';
  return (
    <>
      {dividing && <Seg label="Divider" value={divider} options={DIVIDER_CHOICES} onChange={s.setDividerMode} />}
      <Switch label="Outlines" checked={outlines} onChange={s.setRoomOverlayVisible} />
      <Seg label="Labels" value={labels} options={LABEL_CHOICES} onChange={s.setRoomLabels} />
      {!dividing && <Seg label="Walls" value={walls} options={WALL_CHOICES} onChange={s.setRoomWalls} />}
    </>
  );
}

/** Suggest, the count of the level's rooms, and the rooms list toggle: the right end of the Rooms tab. */
export function RoomsDockTail() {
  const rooms = useStore((s) =>
    levelDungeons(s.layers, s.levels, s.ui.activeLevelId).reduce((n, l) => n + (l.rooms?.length ?? 0), 0),
  );
  const suggested = useStore((s) => s.ui.roomSuggestions?.rooms.length ?? 0);
  const sheetOpen = useStore((s) => s.ui.roomsSheetOpen);
  const hasLayer = useStore((s) => activeDungeon(s) !== null);
  return (
    <>
      <span className="v2-vr" role="presentation" />
      <button
        type="button"
        className="v2-rbtn"
        data-testid="v2-suggest-rooms"
        data-tip={hasLayer ? 'Propose a room for every enclosed floor without one' : 'Pick a map layer first'}
        disabled={!hasLayer}
        onClick={() => suggestOnActiveLayer()}
      >
        <SuggestIcon size={14} />
        Suggest rooms
      </button>
      <span className="v2-dock__spacer" />
      <span className="v2-dock__note v2-rooms-count" data-testid="v2-room-count">
        {roomCountText(rooms, suggested)}
      </span>
      <button
        type="button"
        className={cn('v2-ib', sheetOpen && 'v2-ib--on')}
        aria-label={sheetOpen ? 'Close rooms list' : 'Open rooms list'}
        aria-pressed={sheetOpen}
        data-tip="Rooms list"
        data-testid="v2-rooms-list-toggle"
        onClick={() => {
          const st = useStore.getState();
          st.setRoomsSheetOpen(!sheetOpen);
          if (sheetOpen) st.setRoomsSheetRoomId(null);
        }}
      >
        <RoomsListIcon size={15} />
      </button>
    </>
  );
}

/** Keys typed into a field are not the bar's Enter and Escape. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]');
}

/**
 * The Suggest bar (board 3), over the dock while proposals are up: how many, that the
 * rooms already there stay, Dismiss and Accept all. Enter accepts all, Escape dismisses.
 * Picking another layer dismisses: proposals belong to the layer they were made on.
 */
export function SuggestBar() {
  const suggested = useStore((s) => s.ui.roomSuggestions?.rooms.length ?? 0);
  const existing = useStore((s) => activeDungeon(s)?.rooms?.length ?? 0);
  const activeLayerId = useStore((s) => s.ui.activeLayerId);
  const up = suggested > 0;

  // Per-ghost accept and reject can empty the list; an empty list is no proposal at all.
  useEffect(() => {
    const list = useStore.getState().ui.roomSuggestions;
    if (list && list.rooms.length === 0) dismissSuggestions();
  }, [suggested]);

  // The proposals know their layer, so picking another one dismisses them.
  useEffect(() => {
    const list = useStore.getState().ui.roomSuggestions;
    if (list && list.layerId !== activeLayerId) dismissSuggestions();
  }, [activeLayerId]);

  useEffect(() => {
    if (!up) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || typing(e.target)) return;
      if (editSessionActive(useStore.getState().tools)) return;
      if (e.key === 'Enter') acceptAllSuggestions();
      else if (e.key === 'Escape') dismissSuggestions();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [up]);

  if (!up) return null;
  return (
    <div className="v2-suggest v2-float" data-testid="v2-suggest-bar" role="region" aria-label="Suggested rooms" data-chrome>
      <span className="v2-suggest__count">
        {suggested} room{suggested === 1 ? '' : 's'} suggested
      </span>
      {existing > 0 && (
        <span className="v2-suggest__note">
          Your {existing} room{existing === 1 ? '' : 's'} stay{existing === 1 ? 's' : ''} as {existing === 1 ? 'it is' : 'they are'}
        </span>
      )}
      <button type="button" className="v2-rbtn v2-rbtn--ghost" onClick={dismissSuggestions}>
        Dismiss
      </button>
      <button type="button" className="v2-primary" data-testid="v2-suggest-accept" onClick={acceptAllSuggestions}>
        Accept all
      </button>
    </div>
  );
}
