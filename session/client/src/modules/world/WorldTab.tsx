import { useEffect, useMemo, useRef, useState } from 'react';
import { WEATHERS, vocabLabel, type Weather } from '@dnd/core/src/shared/prep';
import type { LightChild, Mood } from '@dnd/core/src/shared/types';
import { useStore } from '@dnd/core/src/store/store';
import { BUCKET_MINUTES, DAY_MINUTES, environmentOf, type NightSky, type TimeSpeed } from '@dnd/core/src/shared/world';
import { roomEditsOf, sceneTriggersOf, worldOf, worldSkyOf, type TriggersState, type WorldState } from '@dnd/mechanics/triggers';
import { Button, Caption, Chip, Seg, SettingRow, SliderRow, SwitchRow } from '@dnd/ui';
import { useModuleState, useSessionStore } from '../../session/store';
import { withoutSupersededSeats } from '../../shell/top/roster';
import { serverRooms } from '../fog/fog';
import { JUMPS, hhmm, nearestJump } from './world';
import { setDarknessPreview, setDmLit, useDarknessPreview, useDmLit } from './worldPrefs';

const send = (action: string, payload: unknown): void => useSessionStore.getState().sendCommand('triggers', action, payload);
const setWorld = (patch: Partial<WorldState>): void => send('set-world', patch);

/** Slider values go to the table this long after the hand stops. */
const COMMIT_MS = 300;

const SPEEDS: { value: TimeSpeed; label: string }[] = [
  { value: 'paused', label: 'Paused' },
  { value: 'real', label: 'Real' },
  { value: 'fast', label: 'Fast' },
];
const SKIES: { value: NightSky; label: string }[] = [
  { value: 'full-moon', label: 'Full moon' },
  { value: 'crescent', label: 'Crescent' },
  { value: 'moonless', label: 'Moonless' },
];
const MOODS: { value: '' | Mood; label: string }[] = [
  { value: '', label: 'Inherit' },
  { value: 'lit', label: 'Lit' },
  { value: 'dim', label: 'Dim' },
  { value: 'dark', label: 'Dark' },
];

const selectClass = 'h-7 max-w-36 rounded-control border border-line bg-panel px-1.5 text-xs text-text';

function useWorld(): { state: TriggersState; world: WorldState } {
  const triggers = useModuleState<TriggersState>('triggers');
  const state = triggers ?? { byScene: {} };
  return { state, world: worldOf(state) };
}

/** Every placed light's switch: 'on', 'off', or null while they differ (or there are none). */
function useAllLights(): 'on' | 'off' | null {
  return useStore((s) => {
    let on = 0;
    let total = 0;
    for (const layer of s.layers) {
      if (layer.type !== 'dungeon') continue;
      for (const c of layer.children) {
        if (c.childType !== 'light' || c.id.startsWith('token-light:')) continue;
        total++;
        if ((c as LightChild).visible !== false) on++;
      }
    }
    if (total === 0) return null;
    return on === total ? 'on' : on === 0 ? 'off' : null;
  });
}

/** A value that follows the wire, held at the hand's value while a slider is moving. */
function useDial(confirmed: number, commit: (v: number) => void): [number, (v: number) => void] {
  const [held, setHeld] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const move = (v: number): void => {
    setHeld(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      commit(v);
      setHeld(null);
    }, COMMIT_MS);
  };
  return [held ?? confirmed, move];
}

/** Board 18, left: the clock and its jumps, speed, sky, weather, darkness, every light. */
export function WorldBody() {
  const { state, world } = useWorld();
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const map = useStore((s) => s.mapSettings);
  const levels = useStore((s) => s.levels);
  const allLights = useAllLights();
  const dmLit = useDmLit();
  const preview = useDarknessPreview();
  const weather = world.weather ?? map.weather ?? 'clear';
  const [clock, moveClock] = useDial(world.clock, (v) => setWorld({ clock: v }));
  const skyDarkness = worldSkyOf(map, { ...state, world: { ...world, darkness: null } }).darkness;
  const following = (world.darkness ?? null) === null && preview === null;
  const darkness = preview ?? world.darkness ?? skyDarkness;
  const darkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(darkTimer.current), []);
  const outdoor = environmentOf(map) === 'outdoor';
  const scene = sceneId ? sceneTriggersOf(state, sceneId) : null;
  const plus = (minutes: number): void => setWorld({ clock: (world.clock + minutes) % DAY_MINUTES });

  return (
    <div className="flex flex-col gap-2" data-testid="world-body">
      <SliderRow
        label={`Time · ${hhmm(clock)}`}
        className="w-full"
        value={clock}
        min={0}
        max={DAY_MINUTES - BUCKET_MINUTES}
        step={BUCKET_MINUTES}
        format={hhmm}
        onValueChange={moveClock}
      />
      <div className="flex flex-wrap gap-1" data-testid="world-jumps">
        <Button variant="outline" size="xs" data-testid="world-plus-1h" onClick={() => plus(60)}>
          +1h
        </Button>
        <Button variant="outline" size="xs" data-testid="world-plus-6h" onClick={() => plus(360)}>
          +6h
        </Button>
        {JUMPS.map((j) => (
          <Button
            key={j.key}
            variant="outline"
            size="xs"
            aria-pressed={nearestJump(world.clock) === j.key}
            data-value={j.key}
            onClick={() => setWorld({ clock: j.minutes })}
          >
            {j.label}
          </Button>
        ))}
      </div>
      <Seg aria-label="Speed" options={SPEEDS} value={world.timeSpeed} onValueChange={(v) => setWorld({ timeSpeed: v as TimeSpeed })} />
      <Seg
        aria-label="Night sky"
        options={SKIES}
        value={world.nightSky}
        disabled={!outdoor}
        onValueChange={(v) => setWorld({ nightSky: v as NightSky })}
      />
      <div className="flex flex-wrap gap-1" data-testid="world-weather">
        {WEATHERS.map((w) => (
          <Chip key={w} pressed={weather === w} data-testid={`weather-${w}`} onPressedChange={() => w !== weather && setWorld({ weather: w as Weather })}>
            {vocabLabel(w)}
          </Chip>
        ))}
      </div>
      {sceneId && (
        <>
          <SliderRow
            label={following ? 'Darkness · follows the sky' : 'Darkness'}
            className="w-full"
            value={Math.round(darkness * 100)}
            min={0}
            max={100}
            format={(v) => (v / 100).toFixed(2)}
            onValueChange={(v) => {
              setDarknessPreview(v / 100);
              clearTimeout(darkTimer.current);
              darkTimer.current = setTimeout(() => setWorld({ darkness: v / 100 }), COMMIT_MS);
            }}
          />
          <Button
            variant="ghost"
            size="xs"
            className="self-start"
            disabled={following}
            data-testid="world-follow-sky"
            onClick={() => {
              setDarknessPreview(null);
              setWorld({ darkness: null });
            }}
          >
            Follow the sky
          </Button>
          <SettingRow label="All lights" className="w-full">
            <Seg
              aria-label="All lights"
              options={[
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
              value={allLights ?? ''}
              onValueChange={(v) => send('set-lights-all', { on: v === 'on' })}
            />
          </SettingRow>
          <SwitchRow label="Show me everything lit" className="w-full" checked={dmLit} onCheckedChange={setDmLit} />
          {levels.length > 1 && (
            <SettingRow label="My level" className="w-full">
              <select
                aria-label="Level you see"
                data-testid="world-dm-level"
                className={selectClass}
                value={scene?.dmLevelId ?? levels[0]?.id ?? ''}
                onChange={(e) => send('set-dm-level', { levelId: e.target.value })}
              >
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </SettingRow>
          )}
        </>
      )}
    </div>
  );
}

/** Board 18, right: which level each seat sees, and each room's mood. */
export function WorldStrip() {
  const { state } = useWorld();
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const roster = useSessionStore((s) => s.session?.players ?? []);
  const levels = useStore((s) => s.levels);
  const mapData = useSessionStore((s) => s.mapData);
  const rooms = useMemo(() => serverRooms(mapData), [mapData]);
  if (!sceneId) return <p className="text-xs text-text-3">Activate a scene to set its moods and levels.</p>;
  const scene = sceneTriggersOf(state, sceneId);
  const edits = roomEditsOf(scene);
  const seats = withoutSupersededSeats(roster).filter((p) => p.role !== 'dm');
  return (
    <div className="flex gap-4">
      {levels.length > 1 && seats.length > 0 && (
        <section className="flex shrink-0 flex-col gap-1" data-testid="world-seats">
          <Caption>Seats see</Caption>
          {seats.map((p) => (
            <SettingRow key={p.identityId} label={p.name} className="w-56">
              <select
                aria-label={`${p.name}'s level`}
                data-testid={`world-seat-${p.identityId}`}
                className={selectClass}
                value={scene.seatLevel?.[p.identityId] ?? ''}
                onChange={(e) => send('set-seat-level', { identity: p.identityId, levelId: e.target.value || null })}
              >
                <option value="">Auto</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </SettingRow>
          ))}
        </section>
      )}
      <section className="flex min-w-0 flex-col gap-1" data-testid="world-moods">
        <Caption>Room moods</Caption>
        {rooms.length === 0 && <p className="text-xs text-text-3">No rooms on this map.</p>}
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {rooms.map((r) => (
            <li key={r.id}>
              <SettingRow label={r.name} className="w-56">
                <select
                  aria-label={`Mood: ${r.name}`}
                  data-testid="room-mood"
                  className={selectClass}
                  value={edits[r.id]?.mood ?? ''}
                  onChange={(e) => send('set-room', { sceneId, roomId: r.id, patch: { mood: e.target.value || null } })}
                >
                  {MOODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </SettingRow>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
