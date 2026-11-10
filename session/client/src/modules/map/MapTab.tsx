import { useMemo } from 'react';
import { useStore } from '@dnd/core/src/store/store';
import type { FogState } from '@dnd/mechanics/fog';
import { sceneTriggersOf, type TriggersState } from '@dnd/mechanics/triggers';
import type { TriggerCondition } from '@dnd/core/src/shared/prep';
import { Button, Caption, Seg, SliderRow, Switch, SwitchRow } from '@dnd/ui';
import { frameWorldPoint } from '../../renderer/camera';
import { openSheet } from '../../shell/sheets/registry';
import { useModuleState, useSessionStore } from '../../session/store';
import { CrossingsFold } from '../crossings/CrossingsFold';
import { DoorActions } from '../doors/DoorActions';
import { doorLabel, doorStatusLabel } from '../doors/doors';
import { useDoorSelection } from '../doors/selection';
import { useLiveDoors } from '../doors/useLiveDoors';
import { FOG_STATUS_LABEL, roomFog, sceneFog, serverRooms } from '../fog/fog';
import { useLightCommit } from '../lights/lightCommit';
import { mapLights, type LightHit } from '../lights/lights';
import { useLightSelection } from '../lights/selection';
import { useScenePrep } from '../triggers/scenePrep';
import { useMapFamily, type MapFamily } from './family';

const FAMILIES: { value: MapFamily; label: string }[] = [
  { value: 'rooms', label: 'Rooms' },
  { value: 'doors', label: 'Doors' },
  { value: 'lights', label: 'Lights' },
  { value: 'triggers', label: 'Triggers' },
  { value: 'levels', label: 'Levels' },
  { value: 'labels', label: 'Labels' },
];

const triggers = (action: string, payload: unknown): void => useSessionStore.getState().sendCommand('triggers', action, payload);
const fog = (action: string, payload: unknown): void => useSessionStore.getState().sendCommand('fog', action, payload);

const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

const CONDITION: Record<TriggerCondition['kind'], string> = {
  'room-revealed': 'When a room is revealed',
  'enter-region': 'When a token enters',
  'within-radius': 'When a token comes near',
};

const card = 'flex w-36 shrink-0 flex-col gap-1 rounded-control border border-line p-1.5';

/** Board 11, left: the family picker and what applies to the whole family. */
export function MapBody() {
  const family = useMapFamily((s) => s.family);
  const labelsHidden = useStore((s) => s.ui.labelsHidden);
  const lightsCount = useStore((s) => mapLights(s.layers).length);
  const doors = useLiveDoors();
  return (
    <div className="flex flex-col gap-2" data-testid="map-body">
      <Seg aria-label="Map family" options={FAMILIES.map((f) => ({ ...f, testId: `map-family-${f.value}` }))} value={family} onValueChange={(v) => useMapFamily.setState({ family: v as MapFamily })} />
      {family === 'rooms' && <p className="text-xs text-text-3">Pick a room's Key for its read-aloud, encounter and notes.</p>}
      {family === 'doors' && (
        <p className="text-xs text-text-3">
          {doors.length} doors · {doors.filter((d) => d.live.locked).length} locked. Click a door on the map for its card.
        </p>
      )}
      {family === 'lights' && (
        <>
          <p className="text-xs text-text-3">{lightsCount} lights. Click a light's icon on the map for its card.</p>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => triggers('set-lights-all', { on: true })}>
              All on
            </Button>
            <Button variant="outline" size="sm" onClick={() => triggers('set-lights-all', { on: false })}>
              All off
            </Button>
          </div>
        </>
      )}
      {family === 'triggers' && <p className="text-xs text-text-3">Fired triggers narrate into the log.</p>}
      {family === 'levels' && <p className="text-xs text-text-3">Go shows you a level. Seats follow their tokens unless pinned in World.</p>}
      {family === 'rooms' && <CrossingsFold />}
      {family === 'labels' && (
        <SwitchRow label="Show map labels" className="w-full" checked={!labelsHidden} onCheckedChange={(on) => useStore.getState().setLabelsHidden(!on)} />
      )}
    </div>
  );
}

function RoomsStrip() {
  const mapData = useSessionStore((s) => s.mapData);
  const fogState = useModuleState<FogState>('fog');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const rooms = useMemo(() => serverRooms(mapData), [mapData]);
  const sceneFogNow = sceneFog(fogState, sceneId);
  if (rooms.length === 0) return <p className="text-xs text-text-3">No rooms on this map.</p>;
  return (
    <ul className="flex gap-2" data-testid="map-rooms">
      {rooms.map((r) => {
        const status = roomFog(sceneFogNow, r.id).status;
        return (
          <li key={r.id} className={card} data-room-id={r.id} data-fog-status={status}>
            <span className="truncate text-xs text-text" title={r.name}>
              {r.name}
            </span>
            <Caption>{FOG_STATUS_LABEL[status]}</Caption>
            <div className="flex flex-wrap gap-1">
              {status === 'revealed' ? (
                <Button variant="outline" size="xs" onClick={() => fog('hide', { roomId: r.id })}>
                  Hide
                </Button>
              ) : (
                <Button variant="outline" size="xs" onClick={() => fog('reveal', { roomId: r.id })}>
                  Reveal
                </Button>
              )}
              <Button variant="outline" size="xs" data-testid="room-key" onClick={() => openSheet('room-key', { roomId: r.id })}>
                Key
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DoorsStrip() {
  const doors = useLiveDoors();
  if (doors.length === 0) return <p className="text-xs text-text-3">No doors on this scene.</p>;
  return (
    <ul className="flex gap-2" data-testid="map-doors">
      {doors.map((d, i) => (
        <li key={d.door.id} className={`${card} w-44`} data-door-id={d.door.id} data-open={d.live.open} data-locked={d.live.locked}>
          <button
            type="button"
            className="truncate text-left text-xs text-text hover:underline"
            onClick={() => {
              useDoorSelection.getState().select(d.door.id);
              frameWorldPoint(d.door.position[0], d.door.position[1]);
            }}
          >
            {doorLabel(d.door, i)}
          </button>
          <Caption>{doorStatusLabel(d.door, d.live)}</Caption>
          <DoorActions entry={d} frame={false} />
        </li>
      ))}
    </ul>
  );
}

function LightTile({ hit }: { hit: LightHit }) {
  const commit = useLightCommit(hit.light.id);
  const { light } = hit;
  return (
    <li className={`${card} w-44`} data-light-id={light.id}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-xs text-text hover:underline"
          onClick={() => {
            useLightSelection.getState().select(light.id);
            frameWorldPoint(light.position.x, light.position.y);
          }}
        >
          {light.name || 'Light'}
        </button>
        <Switch aria-label={`${light.name || 'Light'} on`} checked={light.visible !== false} onCheckedChange={(visible: boolean) => commit({ visible }, true)} />
      </div>
      <SliderRow label="Brightness" className="w-full" value={Math.round(light.intensity * 100)} min={0} max={100} format={(v) => `${v}%`} onValueChange={(v) => commit({ intensity: v / 100 })} />
    </li>
  );
}

function LightsStrip() {
  const layers = useStore((s) => s.layers);
  const lights = useMemo(() => mapLights(layers), [layers]);
  if (lights.length === 0) return <p className="text-xs text-text-3">No lights on this map.</p>;
  return (
    <ul className="flex gap-2" data-testid="map-lights">
      {lights.map((hit) => (
        <LightTile key={hit.light.id} hit={hit} />
      ))}
    </ul>
  );
}

function TriggersStrip() {
  const { prep } = useScenePrep();
  const state = useModuleState<TriggersState>('triggers');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const scene = state && sceneId ? sceneTriggersOf(state, sceneId) : undefined;
  const list = prep?.triggers ?? [];
  if (list.length === 0) return <p className="text-xs text-text-3">No triggers on this scene.</p>;
  return (
    <ul className="flex gap-2" data-testid="map-triggers">
      {list.map((t) => {
        const firedAt = scene?.fired[t.id];
        const enabled = t.enabled && !scene?.disabled[t.id];
        return (
          <li key={t.id} className={`${card} w-44`} data-trigger-id={t.id} data-fired={firedAt !== undefined || undefined}>
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-xs text-text">{t.name}</span>
              <Switch
                aria-label={`${t.name}: enabled`}
                checked={enabled}
                disabled={!t.enabled}
                onCheckedChange={(on: boolean) => triggers('set-enabled', { triggerId: t.id, enabled: on })}
              />
            </div>
            <Caption>{firedAt !== undefined ? `Fired ${clock(firedAt)}` : CONDITION[t.when.kind]}</Caption>
            <div className="flex gap-1">
              <Button variant="outline" size="xs" data-testid="trigger-fire" disabled={firedAt !== undefined} onClick={() => triggers('fire', { triggerId: t.id })}>
                Fire
              </Button>
              <Button variant="ghost" size="xs" data-testid="trigger-rearm" disabled={firedAt === undefined} onClick={() => triggers('rearm', { triggerId: t.id })}>
                Re-arm
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function LevelsStrip() {
  const levels = useStore((s) => s.levels);
  const state = useModuleState<TriggersState>('triggers');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const roster = useSessionStore((s) => s.session?.players ?? []);
  if (levels.length < 2) return <p className="text-xs text-text-3">This map has one level.</p>;
  const scene = state && sceneId ? sceneTriggersOf(state, sceneId) : undefined;
  const mine = scene?.dmLevelId ?? levels[0]!.id;
  return (
    <ul className="flex gap-2" data-testid="map-levels">
      {levels.map((l) => {
        const seats = roster.filter((p) => p.role !== 'dm' && scene?.seatLevel?.[p.identityId] === l.id).map((p) => p.name);
        return (
          <li key={l.id} className={card} data-level-id={l.id}>
            <span className="truncate text-xs text-text">{l.name}</span>
            <Caption>{seats.length ? `Seats see: ${seats.join(', ')}` : 'No seat pinned'}</Caption>
            <Button variant="outline" size="xs" disabled={l.id === mine} data-testid="level-go" onClick={() => triggers('set-dm-level', { levelId: l.id })}>
              {l.id === mine ? 'Showing' : 'Go'}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/** Board 11, right: the chosen family's things. */
export function MapStrip() {
  const family = useMapFamily((s) => s.family);
  switch (family) {
    case 'rooms':
      return <RoomsStrip />;
    case 'doors':
      return <DoorsStrip />;
    case 'lights':
      return <LightsStrip />;
    case 'triggers':
      return <TriggersStrip />;
    case 'levels':
      return <LevelsStrip />;
    case 'labels':
      return <p className="text-xs text-text-3">Labels show as the map authored them.</p>;
  }
}
