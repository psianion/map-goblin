import { useMemo, useState } from 'react';
import { autoExploreOn, containedSightOn, fogModeOf, sightRangeLimitOn, type FogMode, type FogState, type RoomFog, type RoomFogStatus } from '@dnd/mechanics/fog';
import { useStore } from '@dnd/core/src/store/store';
import { FOG_LOOK_PRESETS } from '@dnd/core/src/shared/fogLook';
import { Button, Caption, Chip, Fold, KeyHint, Seg, SecondaryButton, SliderRow, SwitchRow } from '@dnd/ui';
import { useModuleState, useSessionStore } from '../../session/store';
import { UNDO_TOAST_MS, showToast } from '../../session/toasts';
import { useActiveTool } from '../../session/tools';
import { armFogBrush, armFogHide, armFogReveal, brushAvailable, useFogBrush } from './brush';
import { FOG_STATUS_LABEL, hideAllRooms, revealAllRooms, roomFog, sceneFog, serverRooms } from './fog';
import { setHighlightedRoom } from './FogOverlay';
import { FOG_PRESETS } from './livingFog';

const send = (action: string, payload: unknown): void => useSessionStore.getState().sendCommand('fog', action, payload);

const MODES: { value: FogMode; label: string }[] = [
  { value: 'rooms', label: 'Rooms' },
  { value: 'vision', label: 'Vision' },
];

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function useSceneFog() {
  const fogState = useModuleState<FogState>('fog');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  return sceneFog(fogState, sceneId);
}

/** Board 4 and 10, left: Reveal R, Hide H, Brush W, Rect Shift+R, size, mode, look, settings, bulk. */
export function FogBody() {
  const fog = useSceneFog();
  const mapData = useSessionStore((s) => s.mapData);
  const rooms = useMemo(() => serverRooms(mapData), [mapData]);
  const activeTool = useActiveTool((s) => s.activeTool);
  const detail = useActiveTool((s) => s.toolDetail);
  const brushOn = useFogBrush((s) => s.on);
  const shape = useFogBrush((s) => s.shape);
  const size = useFogBrush((s) => s.size);
  const authoredLook = useStore((s) => s.mapSettings.fogLook);
  const [confirmReset, setConfirmReset] = useState(false);
  const mode = fogModeOf(fog);
  const armed = activeTool === 'fog';
  const canBrush = mode === 'vision' && brushAvailable();
  const lookPreset = fog.look?.preset ?? authoredLook?.preset ?? null;

  const bulk = (next: Record<string, RoomFog>, message: string): void => {
    const before = fog.rooms;
    send('set-bulk', { rooms: next });
    showToast({ message, durationMs: UNDO_TOAST_MS, action: { label: 'Undo', onAction: () => send('set-bulk', { rooms: before }) } });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="fog-body">
      <div className="grid grid-cols-2 gap-1">
        <SecondaryButton active={armed && !brushOn && detail === 'Reveal'} onClick={armFogReveal} data-testid="fog-reveal">
          <KeyHint keys="R">Reveal</KeyHint>
        </SecondaryButton>
        <SecondaryButton active={armed && !brushOn && detail === 'Hide'} onClick={armFogHide} data-testid="fog-hide">
          <KeyHint keys="H">Hide</KeyHint>
        </SecondaryButton>
        <SecondaryButton
          active={armed && brushOn && shape === 'stroke'}
          disabled={!canBrush}
          data-testid="fog-brush"
          onClick={() => {
            useFogBrush.getState().setShape('stroke');
            armFogBrush();
          }}
        >
          <KeyHint keys="W">Brush</KeyHint>
        </SecondaryButton>
        <SecondaryButton
          active={armed && brushOn && shape === 'box'}
          disabled={!canBrush}
          data-testid="fog-rect"
          onClick={() => {
            useFogBrush.getState().setShape('box');
            armFogBrush();
          }}
        >
          <KeyHint keys="Shift+R">Rect</KeyHint>
        </SecondaryButton>
      </div>
      {mode === 'vision' && (
        <SliderRow label="Brush size" value={size} min={1} max={5} step={1} onValueChange={(v) => useFogBrush.getState().setSize(v)} className="w-full" />
      )}
      <Seg aria-label="Fog mode" options={MODES} value={mode} onValueChange={(v) => v !== mode && send('set-mode', { mode: v })} />
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={rooms.length === 0} data-testid="fog-reveal-all" onClick={() => bulk(revealAllRooms(rooms), 'Revealed every room.')}>
          Reveal all
        </Button>
        <Button variant="outline" size="sm" disabled={rooms.length === 0} data-testid="fog-hide-all" onClick={() => bulk(hideAllRooms(fog.rooms), 'Hid every explored room.')}>
          Hide all
        </Button>
      </div>
      <Fold title="Look" summary={lookPreset ? cap(lookPreset) : 'Custom mix'} className="w-full">
        <div className="flex flex-wrap gap-1 py-1" data-testid="fog-look">
          {FOG_LOOK_PRESETS.map((p) => (
            <Chip key={p} pressed={lookPreset === p} data-testid={`fog-look-${p}`} onPressedChange={() => send('set-fog-look', { look: { preset: p, layers: FOG_PRESETS[p] } })}>
              {cap(p)}
            </Chip>
          ))}
          <Chip pressed={false} data-testid="fog-look-map" onPressedChange={() => send('set-fog-look', { look: null })}>
            The map's own
          </Chip>
        </div>
      </Fold>
      <Fold title="Settings" className="w-full">
        <SwitchRow
          label="Conceal behind doors"
          className="w-full"
          checked={fog.concealBehindDoors}
          onCheckedChange={(v) => send('set-conceal', { concealBehindDoors: v })}
        />
        {mode === 'vision' && (
          <>
            <SwitchRow label="Auto-explore as the party moves" className="w-full" checked={autoExploreOn(fog)} onCheckedChange={(v) => send('set-auto-explore', { autoExplore: v })} />
            <SwitchRow label="Sight stops at token range" className="w-full" checked={sightRangeLimitOn(fog)} onCheckedChange={(v) => send('set-range-limit', { sightRangeLimit: v })} />
            <SwitchRow label="Sight stays inside revealed ground" className="w-full" checked={containedSightOn(fog)} onCheckedChange={(v) => send('set-containment', { containedSight: v })} />
            <Button variant="ghost" size="sm" className="self-start" onClick={() => send('open-map', {})}>
              Open whole map
            </Button>
          </>
        )}
        {confirmReset ? (
          <div className="flex items-center gap-1 py-1">
            <Button variant="destructive" size="sm" data-testid="fog-reset-confirm" onClick={() => { send('reset', {}); setConfirmReset(false); }}>
              Reset fog for everyone
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="destructive" size="sm" className="self-start" data-testid="fog-reset" onClick={() => setConfirmReset(true)}>
            Reset fog
          </Button>
        )}
      </Fold>
    </div>
  );
}

const STATUS_RANK: Record<RoomFogStatus, number> = { never_revealed: 0, re_hidden: 1, revealed: 2 } as Record<RoomFogStatus, number>;

/** Board 4, right: every room with its state and its own Reveal and Hide. */
export function FogStrip() {
  const fog = useSceneFog();
  const mapData = useSessionStore((s) => s.mapData);
  const rooms = useMemo(() => serverRooms(mapData), [mapData]);
  if (rooms.length === 0) {
    return (
      <p className="text-xs text-text-3" data-testid="fog-no-rooms">
        {fogModeOf(fog) === 'vision'
          ? 'No rooms on this map. Reveal ground with the brush.'
          : 'No rooms on this map, so players see all of it. Switch to Vision to fog it.'}
      </p>
    );
  }
  const sorted = [...rooms].sort((a, b) => (STATUS_RANK[roomFog(fog, a.id).status] ?? 3) - (STATUS_RANK[roomFog(fog, b.id).status] ?? 3));
  return (
    <ul className="flex gap-2" data-testid="fog-rooms">
      {sorted.map((room) => {
        const status = roomFog(fog, room.id).status;
        return (
          <li
            key={room.id}
            data-room-id={room.id}
            data-fog-status={status}
            className="flex w-28 shrink-0 flex-col gap-1 rounded-control border border-line p-1.5"
            onMouseEnter={() => setHighlightedRoom(room.id)}
            onMouseLeave={() => setHighlightedRoom(null)}
          >
            <span className="truncate text-xs text-text" title={room.name}>
              {room.name}
            </span>
            <Caption>{FOG_STATUS_LABEL[status]}</Caption>
            <div className="flex gap-1">
              <Button variant="outline" size="xs" disabled={status === 'revealed'} data-testid="room-reveal" onClick={() => send('reveal', { roomId: room.id })}>
                Reveal
              </Button>
              <Button variant="outline" size="xs" disabled={status !== 'revealed'} data-testid="room-hide" onClick={() => send('hide', { roomId: room.id })}>
                Hide
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
