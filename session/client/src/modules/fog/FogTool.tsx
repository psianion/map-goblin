// §2.4.2 / D11 — the fog tool. A mode, not a dialog: arming it changes what a click on the
// map means, and the bar below the switch is the rest of the tool. Nothing here ever
// covers the map, and nothing here asks a question mid-play.
//
// The room list is not decoration. It is the keyboard path to every room the canvas hover
// reaches with a pointer, and it is where the fog state is spelled out in words rather than
// tint — which is the encoding that does not rely on colour, now that no mark is stamped on
// the map to do it (see `DM_FOG_LOOK`).
//
// P4 grows the panel by one structural thing — the mode — and everything the mode brings with
// it (auto-explore, the vision share, the brush) is a *vision-mode* control that a rooms-mode
// table never sees. The room list, the bulk ops, the conceal switch and the undo toasts are
// the ones that were already here, unchanged.

import { useEffect, useMemo } from 'react';
import {
  autoExploreOn,
  fogModeOf,
  regionOf,
  type FogMode,
  type FogState,
  type RoomFog,
  type VisionShare,
} from '@dnd/mechanics/fog';
import { Segmented, Switch } from '../../components/controls';
import { registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';
import { UNDO_TOAST_MS, showToast } from '../../session/toasts';
import { useActiveTool } from '../../session/tools';
import { useFogBrush, type BrushOp, type BrushShape } from './brush';
import {
  FOG_STATUS_LABEL,
  fogActionFor,
  fogFrame,
  hideAllRooms,
  lockedRooms,
  partlySeenRooms,
  revealAllRooms,
  roomFog,
  sceneFog,
  serverLayers,
  serverRooms,
} from './fog';
import { mountFogOverlayWhenReady } from './FogOverlay';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('fog', action, payload);

// ── The panel's own vocabulary ─────────────────────────────────────────────
// `Segmented` and `Switch` started here and now live in `components/controls.tsx`, because
// the World block reaches for the same two shapes (see that file's header).

const MODES: readonly { value: FogMode; label: string }[] = [
  { value: 'rooms', label: 'Rooms' },
  { value: 'vision', label: 'Token vision' },
];

// One word each. The mockup's "Party — shared sight" truncated to "Party — shared…" in the
// 256px sidebar, which is a label that has stopped being one; the field is called "Vision
// share", which is where the rest of that sentence went.
const SHARES: readonly { value: VisionShare; label: string }[] = [
  { value: 'party', label: 'Party' },
  { value: 'individual', label: 'Individual' },
];

const BRUSH_OPS: readonly { value: BrushOp; label: string }[] = [
  { value: 'reveal', label: 'Reveal' },
  { value: 'hide', label: 'Hide' },
];

// The reference build's two clearing tools: a radius eraser dragged along a path, and a
// selection box for an area or a room at once. Same op switch, same Alt modifier.
const BRUSH_SHAPES: readonly { value: BrushShape; label: string }[] = [
  { value: 'stroke', label: 'Stroke' },
  { value: 'box', label: 'Box' },
];

export function FogTool() {
  const fogState = useModuleState<FogState>('fog');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const mapData = useSessionStore((s) => s.mapData);
  const activeTool = useActiveTool((s) => s.activeTool);
  const setActiveTool = useActiveTool((s) => s.setActiveTool);
  const setToolDetail = useActiveTool((s) => s.setToolDetail);
  const brushOn = useFogBrush((s) => s.on);
  const brushOp = useFogBrush((s) => s.op);
  const brushSize = useFogBrush((s) => s.size);
  const brushShape = useFogBrush((s) => s.shape);
  const setBrushOn = useFogBrush((s) => s.setOn);
  const setBrushOp = useFogBrush((s) => s.setOp);
  const setBrushSize = useFogBrush((s) => s.setSize);
  const setBrushShape = useFogBrush((s) => s.setShape);

  // Mount for as long as the table is on screen; the helper handles the engine appearing
  // late and going away again.
  useEffect(() => mountFogOverlayWhenReady(), []);

  // The server's rooms, not core's re-detected ones — same rule as FogOverlay/FogRenderer:
  // core invents rooms on unzoned maps that no fog command can name.
  const rooms = useMemo(() => serverRooms(mapData), [mapData]);
  const fog = sceneFog(fogState, sceneId);
  const armed = activeTool === 'fog';
  const mode = fogModeOf(fog);
  const vision = mode === 'vision';

  // The indicator is the one piece of chrome that answers "what will this click do", so the
  // brush has to reach it. One effect in both directions rather than a write inside the brush
  // store: disarming the tool must clear the detail even though the brush flag is untouched.
  useEffect(() => {
    setToolDetail(armed && vision && brushOn ? (brushShape === 'box' ? 'Box' : 'Brush') : null);
  }, [armed, vision, brushOn, brushShape, setToolDetail]);

  /**
   * §1 — the two things the room list says that the fog record alone cannot.
   *
   * Derived here and nowhere else: neither is a state the referee keeps. "Partly seen" is the
   * region record read through the room (a brush stroke or a sightline that reached into it),
   * and "Locked" is an authored zone flag — a DM badge, never a player's, because zones are
   * stripped from every player-bound document.
   */
  const partly = useMemo(() => partlySeenRooms(rooms, fog.region), [rooms, fog.region]);
  const locked = useMemo(() => lockedRooms(rooms, serverLayers(mapData)), [rooms, mapData]);

  /**
   * Whether this scene keeps a region record at all — measured off the DM's own map with the
   * function the referee measures it with, so the answer here is the one `region-set` will
   * give. A frame past `REGION_CELL_MAX` keeps no cell memory, and every stroke a DM painted
   * on it would be refused after the fact; the button says so instead.
   */
  const brushable = useMemo(() => {
    const frame = fogFrame(mapData);
    return frame !== null && regionOf(frame) !== undefined;
  }, [mapData]);

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
      {/* Outside the armed bar on purpose: which fog the table plays is a table setting, not
          something a DM should have to take the map hostage to change. */}
      <Segmented
        label="Mode"
        testId="fog-mode"
        value={mode}
        options={MODES}
        onPick={(next) => next !== mode && send('set-mode', { mode: next })}
      />

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

          {vision && (
            <>
              <Switch
                testId="fog-auto-explore"
                checked={autoExploreOn(fog)}
                onToggle={() => send('set-auto-explore', { autoExplore: !autoExploreOn(fog) })}
              >
                Auto-explore as the party moves
              </Switch>

              <Segmented
                label="Vision share"
                testId="fog-share"
                value={fog.visionShare ?? 'party'}
                options={SHARES}
                onPick={(visionShare) => send('set-share', { visionShare })}
              />
            </>
          )}

          <Switch
            testId="fog-conceal"
            checked={fog.concealBehindDoors}
            onToggle={() => send('set-conceal', { concealBehindDoors: !fog.concealBehindDoors })}
          >
            Conceal behind doors
          </Switch>

          {vision && (
            <div className="flex flex-col gap-1 border-t border-border-default pt-2">
              <button
                type="button"
                data-testid="fog-brush"
                aria-pressed={brushOn}
                disabled={!brushable}
                onClick={() => setBrushOn(!brushOn)}
                className={`rounded border px-2 py-1 text-left text-xs transition-colors duration-150 ease-out-quart focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-surface-2 motion-reduce:transition-none ${
                  brushOn
                    ? 'border-border-focus bg-surface-3 font-medium text-text-primary'
                    : 'border-border-default bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary active:bg-surface-1'
                }`}
              >
                {brushOn ? `Fog brush — ${brushOp === 'reveal' ? 'revealing' : 'hiding'}` : 'Fog brush'}
              </button>
              {!brushable && (
                // Said once, where the click would have been: without it the brush paints into
                // a void and the referee refuses the stroke after the fact.
                <p data-testid="fog-brush-unavailable" className="text-xs text-text-secondary">
                  This map is too large to keep cell memory — reveal by room here.
                </p>
              )}
              {brushOn && brushable && (
                <>
                  <Segmented
                    label="Brush paints"
                    testId="fog-brush-op"
                    value={brushOp}
                    options={BRUSH_OPS}
                    onPick={setBrushOp}
                  />
                  <Segmented
                    label="Shape"
                    testId="fog-brush-shape"
                    value={brushShape}
                    options={BRUSH_SHAPES}
                    onPick={setBrushShape}
                  />
                  {brushShape === 'stroke' && (
                    <label className="flex items-center gap-2 text-xs text-text-secondary">
                      <span>Size</span>
                      <input
                        type="range"
                        min={1}
                        max={5}
                        step={1}
                        value={brushSize}
                        data-testid="fog-brush-size"
                        aria-label="Brush size in cells"
                        onChange={(e) => setBrushSize(Number(e.target.value))}
                        className="min-w-0 flex-1"
                      />
                      <span className="w-3 text-right tabular-nums text-text-primary">
                        {brushSize}
                      </span>
                    </label>
                  )}
                  <p className="text-xs text-text-secondary">
                    {brushShape === 'box'
                      ? 'Drag a box on the map to reveal the area at once. Alt paints the other way. Esc leaves the tool.'
                      : 'Paint on the map to reveal less than a room. Alt paints the other way. Esc leaves the tool.'}
                  </p>
                </>
              )}
            </div>
          )}

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

          {rooms.length === 0 ? (
            <p className="text-xs text-text-secondary">This map has no rooms zoned yet.</p>
          ) : (
            <ul data-testid="fog-rooms" className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {rooms.map((room) => {
                const status = roomFog(fog, room.id).status;
                // A room the DM lit is washed whole whatever the cells underneath say, so
                // "Partly seen" is only ever the answer for one the party has not been given.
                const label =
                  status === 're_hidden' && partly.has(room.id)
                    ? 'Partly seen'
                    : FOG_STATUS_LABEL[status];
                const isLocked = locked.has(room.id);
                return (
                  <li
                    key={room.id}
                    data-room-id={room.id}
                    data-fog-status={status}
                    data-fog-label={label}
                    data-locked={isLocked || undefined}
                  >
                    <button
                      type="button"
                      onClick={() => send(fogActionFor(status), { roomId: room.id })}
                      aria-label={`${fogActionFor(status) === 'reveal' ? 'Reveal' : 'Hide'} ${room.name} · ${label}${isLocked ? ' · locked against auto-explore' : ''}`}
                      className="flex w-full items-baseline gap-2 rounded px-2 py-0.5 text-left text-xs transition-colors duration-150 ease-out-quart hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:bg-surface-1 motion-reduce:transition-none"
                    >
                      <span title={room.name} className="min-w-0 flex-1 truncate text-text-primary">
                        {room.name}
                      </span>
                      {isLocked && (
                        // The lock is the DM's own note about a room, so it reads as a chip
                        // beside the state rather than replacing it: a locked room still has a
                        // fog status, and the click still does what the status says.
                        <span
                          title="The party's own sight will never open this room"
                          className="shrink-0 rounded-chip border border-border-default px-1 text-[11px] text-text-muted"
                        >
                          Locked
                        </span>
                      )}
                      {/* The one status the mockup tints: "partly seen" is a state the DM is
                          mid-way through, not a settled one, so it carries the chrome's own
                          warning token (never the theme accent — overlays stay neutral). */}
                      <span
                        className={`shrink-0 ${label === 'Partly seen' ? 'text-warning' : 'text-text-secondary'}`}
                      >
                        {label}
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
