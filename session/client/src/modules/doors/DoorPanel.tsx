// §2.4.3 — the doors popover: every door in the scene, grouped by what needs attention, plus
// the DM's lock / unlock / reveal-secret affordances beside whichever one is selected. No
// modal — a dialog to unlock a door is a dialog nobody at the table asked for.
//
// Selecting a door here does two things a click on the map also does (`DoorRenderer`'s own
// pointerdown handler sets the same selection): it is the keyboard/overview route to a door
// that is off-screen or buried in a long list, and it is what puts `DoorActions` on screen —
// shared with the on-map `DoorMenu`, so the rule for what a door's buttons do lives once.

import { useEffect, useMemo } from 'react';
import { useStore } from '@dnd/core/src/store/store';
import type { DoorChild } from '@dnd/core/src/shared/types';
import type { DoorsState } from '@dnd/mechanics/doors';
import { frameWorldPoint } from '../../renderer/camera';
import { Icon } from '../../shell/icons';
import { ALL_ROLES, registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';
import { showToast } from '../../session/toasts';
import {
  DOOR_CHIP_CEILING,
  DOOR_FILTER_THRESHOLD,
  doorLabel,
  doorRefusal,
  doorStatusLabel,
  filterDoors,
  groupDoors,
  liveDoors,
  type LiveDoor,
} from './doors';
import { liveSceneDoors, mountDoorLayerWhenReady } from './DoorRenderer';
import { useDoorSelection } from './selection';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('doors', action, payload);

/** Reactive version of `liveSceneDoors` — shared by the panel, its footer, and `DoorMenu` so
 *  none of them repeats the store-reading wiring. */
export function useLiveDoors(): LiveDoor[] {
  const doorsState = useModuleState<DoorsState>('doors');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const layers = useStore((s) => s.layers);
  return useMemo(() => liveDoors(layers, doorsState, sceneId), [layers, doorsState, sceneId]);
}

/** Turns the server's refusal into the one toast the table has, naming the door it names. */
function useDoorFeedback(doors: readonly LiveDoor[]): void {
  const lastError = useSessionStore((s) => s.lastError);
  useEffect(() => {
    if (!lastError) return;
    const message = doorRefusal(lastError.message, doors);
    if (message) showToast({ message });
    // The doors are read for the name only: a door list arriving a beat later must not
    // re-toast a refusal the player has already been given.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastError]);
}

const BTN =
  'flex h-7 shrink-0 items-center gap-1 rounded border border-border-default bg-surface-2 px-2.5 text-xs text-text-primary transition-colors duration-150 ease-settle hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-surface-2 motion-reduce:transition-none';
const GHOST_BTN =
  'flex h-7 shrink-0 items-center gap-1 rounded border border-transparent px-2.5 text-xs text-text-secondary transition-colors duration-150 ease-settle hover:bg-surface-2 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none';

/**
 * A door's own controls — the DM's lock/reveal affordances beside the toggle every seat
 * gets. One component so the panel footer and the on-map menu can never say two different
 * things about the same door (M3 §Doors).
 */
export function DoorActions({ entry }: { entry: LiveDoor }) {
  const isDm = useSessionStore((s) => s.you?.role === 'dm');
  const { door, live } = entry;

  return (
    <div data-testid="door-actions" className="flex flex-wrap items-center gap-1.5">
      {/*
        The DM only. A locked door refuses every toggle, and the DM is the one holding the
        key — `door-lock` is the next control along — so Open spending a round trip to be
        told "locked" is a no-op they can see coming. It says the state instead.

        A player keeps a live button on purpose: rattling a locked door and being told it is
        locked is the discovery, not a mis-click. That refusal is the server's and arrives as
        a toast (`useDoorFeedback`).
      */}
      <button
        type="button"
        data-testid="door-toggle"
        disabled={isDm && live.locked}
        onClick={() => send('toggle', { id: door.id })}
        className={BTN}
      >
        {isDm && live.locked ? 'Locked' : live.open ? 'Close' : 'Open'}
      </button>
      {isDm && (
        <button
          type="button"
          data-testid="door-lock"
          onClick={() => send(live.locked ? 'unlock' : 'lock', { id: door.id })}
          className={BTN}
        >
          <Icon name={live.locked ? 'unlock' : 'lock'} size={12} />
          {live.locked ? 'Unlock' : 'Lock'}
        </button>
      )}
      {isDm && door.isSecret && (
        <button
          type="button"
          data-testid="door-reveal-secret"
          disabled={live.revealed}
          onClick={() => send('reveal-secret', { id: door.id })}
          className={BTN}
        >
          {live.revealed ? 'Secret revealed' : 'Reveal secret'}
        </button>
      )}
      <button
        type="button"
        data-testid="door-frame"
        onClick={() => frameWorldPoint(door.position[0], door.position[1])}
        className={GHOST_BTN}
      >
        Frame
      </button>
    </div>
  );
}

function DoorChip({
  label,
  entry,
  selected,
  onSelect,
}: {
  label: string;
  entry: LiveDoor;
  selected: boolean;
  onSelect: () => void;
}) {
  const { door, live } = entry;
  return (
    <div
      data-door-id={door.id}
      data-open={live.open}
      data-locked={live.locked}
      data-secret={door.isSecret ? 'true' : undefined}
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Select ${label} · ${doorStatusLabel(door, live)}`}
        onClick={onSelect}
        className={`flex h-7 w-full items-center gap-1 rounded border px-2 text-xs transition-colors duration-150 ease-settle hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none ${
          selected ? 'border-border-structure bg-surface-3' : 'border-border-default bg-surface-2'
        }`}
      >
        <span className="min-w-0 flex-1 truncate text-left text-text-primary">{label}</span>
        {live.locked && <Icon name="lock" size={12} className="shrink-0 text-text-muted" />}
        {door.isSecret && <Icon name="secret" size={12} className="shrink-0 text-text-muted" />}
      </button>
    </div>
  );
}

function DoorGroup({
  title,
  entries,
  labels,
  selectedId,
  onPick,
}: {
  title: string;
  entries: LiveDoor[];
  labels: Map<string, string>;
  selectedId: string | null;
  onPick: (door: DoorChild) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-text-muted">
        {title} · {entries.length}
      </span>
      <div className="grid grid-cols-2 gap-1">
        {entries.map((entry) => (
          <DoorChip
            key={entry.door.id}
            label={labels.get(entry.door.id) ?? entry.door.name ?? ''}
            entry={entry}
            selected={entry.door.id === selectedId}
            onSelect={() => onPick(entry.door)}
          />
        ))}
      </div>
    </div>
  );
}

export function DoorPanel() {
  const doors = useLiveDoors();
  const selectedId = useDoorSelection((s) => s.selectedId);
  const select = useDoorSelection((s) => s.select);
  const filter = useDoorSelection((s) => s.filter);
  const setFilter = useDoorSelection((s) => s.setFilter);

  useEffect(() => mountDoorLayerWhenReady(), []);
  useDoorFeedback(doors);

  // Selecting a door also brings it into view — the panel is the keyboard/overview route to
  // a door (D8) and hunting for the mark by hand was the standing complaint from every walk.
  // Per-client by construction: `frameWorldPoint` moves this stage, never the table's.
  const pick = (door: DoorChild): void => {
    select(door.id);
    frameWorldPoint(door.position[0], door.position[1]);
  };

  if (doors.length === 0) {
    return <p className="text-sm text-text-secondary">No doors on this scene.</p>;
  }

  const labels = new Map(doors.map((d, i) => [d.door.id, doorLabel(d.door, i)]));
  const showFilter = doors.length >= DOOR_FILTER_THRESHOLD;
  const matched = filterDoors(doors, filter);
  const groups = groupDoors(matched);
  const ordered = [...groups.closed, ...groups.secret, ...groups.open];
  const visible = showFilter ? ordered.slice(0, DOOR_CHIP_CEILING) : ordered;
  const overflow = matched.length - visible.length;
  const shown = groupDoors(visible);

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <Icon name="frame" size={15} className="shrink-0" />
        <span>Click a door on the map to act on it.</span>
      </div>

      {showFilter && (
        <input
          type="text"
          data-testid="door-filter"
          placeholder="Filter doors"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-7 shrink-0 rounded border border-border-default bg-surface-0 px-2 text-[13px] text-text-primary placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        />
      )}

      <div data-testid="door-list" className="flex min-h-0 flex-col gap-2 overflow-hidden">
        <DoorGroup title="Closed" entries={shown.closed} labels={labels} selectedId={selectedId} onPick={pick} />
        <DoorGroup title="Secret" entries={shown.secret} labels={labels} selectedId={selectedId} onPick={pick} />
        <DoorGroup title="Open" entries={shown.open} labels={labels} selectedId={selectedId} onPick={pick} />
        {matched.length === 0 && (
          <p className="text-xs text-text-muted">No doors match &ldquo;{filter}&rdquo;.</p>
        )}
      </div>

      {overflow > 0 && <p className="text-[11px] text-text-muted">+{overflow} more</p>}
    </div>
  );
}

export function DoorFooter() {
  const doors = useLiveDoors();
  const selectedId = useDoorSelection((s) => s.selectedId);
  const index = doors.findIndex((d) => d.door.id === selectedId);
  const selected = index >= 0 ? doors[index] : undefined;

  if (!selected) {
    return <p className="text-xs text-text-muted">Select a door, or click one on the map.</p>;
  }

  return (
    <>
      <span className="min-w-0 truncate text-[12.5px] text-text-primary">
        {doorLabel(selected.door, index)}{' '}
        <span className="text-text-muted">· {selected.live.open ? 'Open' : 'Closed'}</span>
      </span>
      <span className="flex-1" />
      <DoorActions entry={selected} />
    </>
  );
}

/** `${n} on this scene` — plain function, not a hook: `Popover` calls it outside React. */
function doorsSubtitle(): string {
  return `${liveSceneDoors().length} on this scene`;
}

registerPanel({
  id: 'doors',
  title: 'Doors',
  icon: 'doors',
  key: 'D',
  group: 'play',
  roles: ALL_ROLES,
  order: 30,
  component: DoorPanel,
  footer: DoorFooter,
  subtitle: doorsSubtitle,
});
