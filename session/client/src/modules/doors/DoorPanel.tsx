// §2.4.3 — the doors panel: every door in the scene, what it is doing, and the DM's
// lock / unlock / reveal-secret affordances inline beside the selected one. No modal —
// a dialog to unlock a door is a dialog nobody at the table asked for.
//
// The list is also the keyboard route to a door: the canvas marks answer a pointer, these
// answer a Tab. It is where the door layer gets mounted from, too, because a panel is this
// module's only React lifecycle (D8).

import { useEffect, useMemo } from 'react';
import { useStore } from '@dnd/core/src/store/store';
import type { DoorsState } from '@dnd/mechanics/doors';
import { ALL_ROLES, registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';
import { showToast } from '../../session/toasts';
import { doorLabel, doorRefusal, doorStatusLabel, liveDoors } from './doors';
import { mountDoorLayerWhenReady } from './DoorRenderer';
import { useDoorSelection } from './selection';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('doors', action, payload);

/** Turns the server's refusal into the one toast the table has. */
function useDoorFeedback(): void {
  const lastError = useSessionStore((s) => s.lastError);
  useEffect(() => {
    if (!lastError) return;
    const message = doorRefusal(lastError.message);
    if (message) showToast({ message });
  }, [lastError]);
}

export function DoorPanel() {
  const doorsState = useModuleState<DoorsState>('doors');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const isDm = useSessionStore((s) => s.you?.role === 'dm');
  const layers = useStore((s) => s.layers);
  const selectedId = useDoorSelection((s) => s.selectedId);
  const select = useDoorSelection((s) => s.select);

  useEffect(() => mountDoorLayerWhenReady(), []);
  useDoorFeedback();

  const doors = useMemo(
    () => liveDoors(layers, doorsState, sceneId),
    [layers, doorsState, sceneId],
  );
  const selected = doors.find((d) => d.door.id === selectedId);

  if (doors.length === 0) {
    return <p className="text-sm text-text-secondary">No doors on this scene.</p>;
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <ul data-testid="door-list" className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
        {doors.map(({ door, live }, i) => (
          <li
            key={door.id}
            data-door-id={door.id}
            data-open={live.open}
            data-locked={live.locked}
            data-secret={door.isSecret && !live.revealed ? 'true' : undefined}
          >
            <button
              type="button"
              aria-current={door.id === selectedId}
              aria-label={`Select ${doorLabel(door, i)} · ${doorStatusLabel(door, live)}`}
              onClick={() => select(door.id)}
              className={`flex w-full items-baseline gap-2 rounded px-2 py-0.5 text-left text-xs transition-colors duration-150 ease-out-quart hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:bg-surface-1 motion-reduce:transition-none ${
                door.id === selectedId ? 'bg-surface-3' : ''
              }`}
            >
              <span title={doorLabel(door, i)} className="min-w-0 flex-1 truncate text-text-primary">
                {doorLabel(door, i)}
              </span>
              <span className="shrink-0 text-text-secondary">{doorStatusLabel(door, live)}</span>
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <div
          data-testid="door-actions"
          className="flex flex-wrap gap-1 border-t border-border-default pt-2"
        >
          <button
            type="button"
            data-testid="door-toggle"
            onClick={() => send('toggle', { id: selected.door.id })}
            className="rounded border border-border-default bg-surface-2 px-2 py-0.5 text-xs text-text-primary transition-colors duration-150 ease-out-quart hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:bg-surface-1 motion-reduce:transition-none"
          >
            {selected.live.open ? 'Close' : 'Open'}
          </button>
          {isDm && (
            <button
              type="button"
              data-testid="door-lock"
              onClick={() =>
                send(selected.live.locked ? 'unlock' : 'lock', { id: selected.door.id })
              }
              className="rounded border border-border-default bg-surface-2 px-2 py-0.5 text-xs text-text-primary transition-colors duration-150 ease-out-quart hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:bg-surface-1 motion-reduce:transition-none"
            >
              {selected.live.locked ? 'Unlock' : 'Lock'}
            </button>
          )}
          {isDm && selected.door.isSecret && (
            <button
              type="button"
              data-testid="door-reveal-secret"
              disabled={selected.live.revealed}
              onClick={() => send('reveal-secret', { id: selected.door.id })}
              className="rounded border border-border-default bg-surface-2 px-2 py-0.5 text-xs text-text-primary transition-colors duration-150 ease-out-quart hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:bg-surface-1 disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-surface-2 motion-reduce:transition-none"
            >
              {selected.live.revealed ? 'Secret revealed' : 'Reveal secret'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

registerPanel({ id: 'doors', title: 'Doors', roles: ALL_ROLES, order: 30, component: DoorPanel });
