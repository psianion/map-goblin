// §2.4.2 / D11 — the fog tool. A mode, not a dialog: arming it changes what a click on the
// map means, and the bar below the switch is the rest of the tool. Nothing here ever
// covers the map, and nothing here asks a question mid-play.
//
// The room list is not decoration. It is the keyboard path to every room the canvas hover
// reaches with a pointer, and it is where the fog state is spelled out in words rather than
// tint — the same reason the "explored" glyph exists.

import { useEffect, useMemo } from 'react';
import type { FogState, RoomFog } from '@dnd/mechanics/fog';
import { registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';
import { UNDO_TOAST_MS, showToast } from '../../session/toasts';
import { useActiveTool } from '../../session/tools';
import {
  FOG_STATUS_LABEL,
  fogActionFor,
  hideAllRooms,
  revealAllRooms,
  roomFog,
  sceneFog,
  serverRooms,
} from './fog';
import { mountFogOverlayWhenReady } from './FogOverlay';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('fog', action, payload);

export function FogTool() {
  const fogState = useModuleState<FogState>('fog');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const mapData = useSessionStore((s) => s.mapData);
  const activeTool = useActiveTool((s) => s.activeTool);
  const setActiveTool = useActiveTool((s) => s.setActiveTool);

  // Mount for as long as the table is on screen; the helper handles the engine appearing
  // late and going away again.
  useEffect(() => mountFogOverlayWhenReady(), []);

  // The server's rooms, not core's re-detected ones — same rule as FogOverlay/FogRenderer:
  // core invents rooms on unzoned maps that no fog command can name.
  const rooms = useMemo(() => serverRooms(mapData), [mapData]);
  const fog = sceneFog(fogState, sceneId);
  const armed = activeTool === 'fog';

  /**
   * D9 — the bulk ops land instantly and hand back a way out, instead of stopping to ask.
   * The record captured here is the scene's fog *before* the change, and undo replays it
   * verbatim through `set-bulk`: whatever mixture of revealed and explored rooms the DM
   * had, they get back, not an approximation of it.
   */
  const bulk = (next: Record<string, RoomFog>, message: string) => {
    const before = fog.rooms;
    send('set-bulk', { rooms: next });
    showToast({
      message,
      durationMs: UNDO_TOAST_MS,
      action: { label: 'Undo', onAction: () => send('set-bulk', { rooms: before }) },
    });
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      <button
        type="button"
        data-testid="fog-tool-toggle"
        aria-pressed={armed}
        onClick={() => setActiveTool(armed ? null : 'fog')}
        className={`rounded border px-2 py-1 text-left font-medium transition-colors duration-150 ease-out-quart focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none ${
          armed
            ? 'border-border-focus bg-surface-3 text-text-primary'
            : 'border-border-default bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary active:bg-surface-1'
        }`}
      >
        {armed ? 'Fog tool — on' : 'Fog tool'}
      </button>

      {armed && (
        <div data-testid="fog-bar" className="flex flex-col gap-2">
          <p className="text-xs text-text-secondary">
            Click a room to reveal or hide it. Esc leaves the tool.
          </p>

          <div className="flex gap-1">
            <button
              type="button"
              data-testid="fog-reveal-all"
              disabled={rooms.length === 0}
              onClick={() => bulk(revealAllRooms(rooms), 'Revealed every room.')}
              className="flex-1 rounded border border-border-default bg-surface-2 px-2 py-1 text-xs text-text-primary transition-colors duration-150 ease-out-quart hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:bg-surface-1 disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-surface-2 motion-reduce:transition-none"
            >
              Reveal all
            </button>
            <button
              type="button"
              data-testid="fog-hide-all"
              disabled={rooms.length === 0}
              onClick={() => bulk(hideAllRooms(fog.rooms), 'Hid every explored room.')}
              className="flex-1 rounded border border-border-default bg-surface-2 px-2 py-1 text-xs text-text-primary transition-colors duration-150 ease-out-quart hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:bg-surface-1 disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-surface-2 motion-reduce:transition-none"
            >
              Hide all
            </button>
          </div>

          <button
            type="button"
            role="switch"
            data-testid="fog-conceal"
            aria-checked={fog.concealBehindDoors}
            onClick={() => send('set-conceal', { concealBehindDoors: !fog.concealBehindDoors })}
            className="flex items-center gap-2 rounded px-1 py-1 text-left text-xs text-text-secondary transition-colors duration-150 ease-out-quart hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none"
          >
            <span
              aria-hidden
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-chip border ${
                fog.concealBehindDoors
                  ? 'border-border-focus bg-surface-3 text-text-primary'
                  : 'border-border-default'
              }`}
            >
              {fog.concealBehindDoors ? '✓' : ''}
            </span>
            Conceal behind doors
          </button>

          {rooms.length === 0 ? (
            <p className="text-xs text-text-secondary">This map has no rooms zoned yet.</p>
          ) : (
            <ul data-testid="fog-rooms" className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {rooms.map((room) => {
                const status = roomFog(fog, room.id).status;
                return (
                  <li key={room.id} data-room-id={room.id} data-fog-status={status}>
                    <button
                      type="button"
                      onClick={() => send(fogActionFor(status), { roomId: room.id })}
                      aria-label={`${fogActionFor(status) === 'reveal' ? 'Reveal' : 'Hide'} ${room.name} · ${FOG_STATUS_LABEL[status]}`}
                      className="flex w-full items-baseline gap-2 rounded px-2 py-0.5 text-left text-xs transition-colors duration-150 ease-out-quart hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:bg-surface-1 motion-reduce:transition-none"
                    >
                      <span title={room.name} className="min-w-0 flex-1 truncate text-text-primary">
                        {room.name}
                      </span>
                      <span className="shrink-0 text-text-secondary">
                        {FOG_STATUS_LABEL[status]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

registerPanel({ id: 'fog', title: 'Fog', roles: ['dm'], order: 25, component: FogTool });
