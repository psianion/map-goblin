// The World popover: one clock and one sky for the campaign, and everything else that sets the
// ambient at the table — the darkness slider, the weather, every light at once, the level the
// DM is looking at, and which floor each seat is shown (board 6 of the Lighting pass).
//
// The map authors the defaults (Sky & mood in the editor); this panel holds the live state the
// DM changes. Every dial echoes optimistically and commits one command; the darkness slider
// previews on the DM's own view while it is dragged and commits once, on release.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { WEATHERS, vocabLabel, type Weather } from '@dnd/core/src/shared/prep';
import { useStore } from '@dnd/core/src/store/store';
import { BUCKET_MINUTES, DAY_MINUTES, environmentOf, type NightSky, type TimeSpeed } from '@dnd/core/src/shared/world';
import type { LightChild } from '@dnd/core/src/shared/types';
import {
  sceneTriggersOf,
  worldLightOf,
  worldOf,
  worldSkyOf,
  type TriggersState,
  type WorldState,
} from '@dnd/mechanics/triggers';
import type { TokensState } from '@dnd/mechanics/tokens';
import { Segmented, Switch } from '../../components/controls';
import { registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';
import { tokensOf } from '../tokens/TokenRenderer';
import { JUMPS, hhmm, nearestJump, ribbonGradient } from './world';
import { setDarknessPreview, setDmLit, useDarknessPreview, useDmLit } from './worldPrefs';

/** A pick the module state never confirms (dropped command, disconnect) must not show
 *  forever — the same window and the same reason as the environment dials' echo. */
const PENDING_TIMEOUT_MS = 4000;

type Picks = Partial<Pick<WorldState, 'clock' | 'nightSky' | 'timeSpeed' | 'weather' | 'darkness'>>;

const SKY_OPTIONS: readonly { value: NightSky; label: string; glyph: ReactNode }[] = [
  { value: 'full-moon', label: 'Full', glyph: <Moon phase="full" /> },
  { value: 'crescent', label: 'Crescent', glyph: <Moon phase="crescent" /> },
  { value: 'moonless', label: 'None', glyph: <Moon phase="none" /> },
];

const SPEED_OPTIONS: readonly { value: TimeSpeed; label: string }[] = [
  { value: 'paused', label: 'Paused' },
  { value: 'real', label: 'Real' },
  { value: 'fast', label: 'Fast' },
];

const LIGHTS_OPTIONS: readonly { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

const label = 'w-16 shrink-0 text-xs text-text-muted';
const select =
  'h-7 min-w-0 flex-1 rounded border border-border-default bg-surface-1 px-1.5 text-xs text-text-primary focus:border-border-focus focus:outline-none';
const smallBtn =
  'h-6 shrink-0 whitespace-nowrap rounded border border-border-default bg-surface-2 px-2 text-[11.5px] text-text-secondary transition-colors duration-150 ease-out-quart hover:bg-surface-3 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-default disabled:opacity-40 disabled:hover:bg-surface-2 disabled:hover:text-text-secondary motion-reduce:transition-none';

/** Every placed light's switch, read off the map the table is drawing ('mixed' when they differ). */
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

export function WorldPanel() {
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const triggers = useModuleState<TriggersState>('triggers');
  const tokens = useModuleState<TokensState>('tokens');
  const roster = useSessionStore((s) => s.session?.players);
  // The active map's authored half — the palette the ribbon is painted from, the environment
  // that decides whether any of the sky applies here, and the defaults the live world sits on.
  const map = useStore((s) => s.mapSettings);
  const levels = useStore((s) => s.levels);
  const allLights = useAllLights();
  const dmLit = useDmLit();
  const darknessPreview = useDarknessPreview();

  const state: TriggersState = triggers ?? { byScene: {} };
  const world = worldOf(state);
  const scene = sceneId ? sceneTriggersOf(state, sceneId) : null;
  const confirmed: Required<Picks> = {
    clock: world.clock,
    nightSky: world.nightSky,
    timeSpeed: world.timeSpeed,
    weather: world.weather ?? map.weather ?? 'clear',
    darkness: world.darkness ?? null,
  };

  // Optimistic echo: a pick shows the instant it is clicked rather than after the broadcast
  // round-trips. One timer for the block rather than one per dial.
  const [pending, setPending] = useState<Picks>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    setPending((p) => {
      const stale = Object.keys(p).filter((k) => p[k as keyof Picks] === confirmed[k as keyof Picks]);
      if (stale.length === 0) return p;
      const next = { ...p };
      for (const key of stale) delete next[key as keyof Picks];
      return next;
    });
    // The wire caught up; which keys it caught up on is decided above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed.clock, confirmed.nightSky, confirmed.timeSpeed, confirmed.weather, confirmed.darkness]);
  // The released slider keeps the DM's view at its value until the wire confirms it.
  useEffect(() => {
    if (!('darkness' in pending)) setDarknessPreview(null);
  }, [pending]);

  const view = { ...confirmed, ...pending };

  const stage = (patch: Picks): void => {
    setPending((p) => ({ ...p, ...patch }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPending({}), PENDING_TIMEOUT_MS);
  };
  const send = (action: string, payload: unknown): void =>
    useSessionStore.getState().sendCommand('triggers', action, payload);
  const setWorld = (patch: Picks): void => {
    stage(patch);
    send('set-world', patch);
  };

  // The clock commits on release, not on every pixel of the drag (the editor's slider idiom).
  const [drag, setDrag] = useState<number | null>(null);
  const clock = drag ?? view.clock;
  const commitClock = (): void => {
    if (drag !== null && drag !== view.clock) setWorld({ clock: drag });
    setDrag(null);
  };

  // The darkness slider: following the sky it reads what the sky makes of the hour; a drag
  // previews on the DM's own view and the release lands one `set-world {darkness}`.
  const skyDarkness = worldSkyOf(map, { ...state, world: { ...world, clock, darkness: null } }).darkness;
  const following = view.darkness === null && darknessPreview === null;
  const darkness = darknessPreview ?? view.darkness ?? skyDarkness;
  const commitDarkness = (): void => {
    if (darknessPreview === null) return;
    if (darknessPreview !== view.darkness) setWorld({ darkness: darknessPreview });
    else setDarknessPreview(null);
  };

  const outdoor = environmentOf(map) === 'outdoor';
  const environment = environmentOf(map);
  const jump = nearestJump(clock);
  const skyNote = !outdoor
    ? environment === 'underground'
      ? 'This map is underground. It has no sky.'
      : 'This map is indoor. The hour tints it; the sky stays outside.'
    : null;

  const multiLevel = levels.length > 1;
  const firstLevel = levels[0]?.id ?? '';
  const dmLevel = scene?.dmLevelId ?? firstLevel;
  const claimed = tokensOf(tokens, sceneId);
  const seats = (roster ?? []).filter((p) => p.role !== 'dm');

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div
        className="relative h-[22px] overflow-hidden rounded-chip"
        style={{ backgroundImage: ribbonGradient(map, view.nightSky) }}
      >
        {/* The playhead is the input's own thumb — a solid blade, drawn by `.clock-ribbon`. */}
        <input
          type="range"
          min={0}
          max={DAY_MINUTES - BUCKET_MINUTES}
          step={BUCKET_MINUTES}
          value={clock}
          aria-label="World clock"
          aria-valuetext={hhmm(clock)}
          data-testid="world-clock"
          className="clock-ribbon absolute inset-0 m-0 h-full w-full"
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={commitClock}
          onKeyUp={commitClock}
          onBlur={commitClock}
        />
      </div>

      <div className="flex gap-1" data-testid="world-jumps">
        {JUMPS.map((j) => (
          <button
            key={j.key}
            type="button"
            // Where the clock stands, not a toggle that is on.
            aria-current={j.key === jump ? 'true' : undefined}
            data-value={j.key}
            onClick={() => setWorld({ clock: j.minutes })}
            className={`h-6 flex-1 truncate rounded border px-1 text-[11.5px] transition-colors duration-150 ease-out-quart focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none ${
              j.key === jump
                ? 'border-border-structure bg-surface-3 text-text-primary'
                : 'border-border-default bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary'
            }`}
          >
            {j.label}
          </button>
        ))}
      </div>

      <div>
        <Segmented
          label="Night sky"
          testId="world-sky"
          inline
          value={view.nightSky}
          options={SKY_OPTIONS}
          disabled={!outdoor}
          describedBy={skyNote ? 'world-sky-note' : undefined}
          onPick={(next) => next !== view.nightSky && setWorld({ nightSky: next })}
        />
        {skyNote && (
          <p id="world-sky-note" className="mt-1 text-xs text-text-secondary" data-testid="world-sky-note">
            {skyNote}
          </p>
        )}
      </div>

      <Segmented
        label="Speed"
        testId="world-speed"
        inline
        value={view.timeSpeed}
        options={SPEED_OPTIONS}
        onPick={(next) => next !== view.timeSpeed && setWorld({ timeSpeed: next })}
      />

      {sceneId ? (
        <>
          <div className="flex items-center gap-2" data-testid="world-darkness-row">
            <span id="world-darkness-label" className={label}>
              Darkness
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(darkness * 100)}
              aria-labelledby="world-darkness-label"
              aria-valuetext={following ? `${darkness.toFixed(2)}, following the sky` : darkness.toFixed(2)}
              data-testid="world-darkness"
              className="slider-minimal min-w-0 flex-1"
              style={{ '--slider-fill': `${Math.round(darkness * 100)}%` } as CSSProperties}
              onChange={(e) => setDarknessPreview(Number(e.target.value) / 100)}
              onPointerUp={commitDarkness}
              onKeyUp={commitDarkness}
              onBlur={commitDarkness}
            />
            <span className="w-[30px] shrink-0 text-right font-mono text-xs text-text-primary" data-testid="world-darkness-value">
              {darkness.toFixed(2)}
            </span>
            <button
              type="button"
              className={smallBtn}
              data-testid="world-follow-sky"
              aria-pressed={following}
              disabled={following}
              onClick={() => {
                setDarknessPreview(null);
                setWorld({ darkness: null });
              }}
            >
              Follow sky
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="world-weather" className={label}>
              Weather
            </label>
            <select
              id="world-weather"
              className={select}
              aria-label="Weather"
              data-testid="world-weather"
              value={view.weather}
              onChange={(e) => e.target.value !== view.weather && setWorld({ weather: e.target.value as Weather })}
            >
              {WEATHERS.map((w) => (
                <option key={w} value={w}>
                  {vocabLabel(w)}
                </option>
              ))}
            </select>
          </div>

          <Segmented
            label="All lights"
            testId="world-all-lights"
            inline
            value={allLights}
            options={LIGHTS_OPTIONS}
            onPick={(next) => send('set-lights-all', { on: next === 'on' })}
          />

          {multiLevel && (
            <div className="flex items-center gap-2">
              <label htmlFor="world-dm-level" className={label}>
                My level
              </label>
              <select
                id="world-dm-level"
                className={select}
                aria-label="Level you see"
                data-testid="world-dm-level"
                value={dmLevel}
                onChange={(e) => send('set-dm-level', { levelId: e.target.value })}
              >
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Switch testId="world-dm-lit" checked={dmLit} onToggle={() => setDmLit(!dmLit)}>
            Show me everything lit
          </Switch>

          {multiLevel && seats.length > 0 && (
            <div className="mt-0.5 flex flex-col gap-1 border-t border-border-default pt-2.5" data-testid="world-seats">
              <div className="flex justify-between px-0.5 pb-0.5 text-xs text-text-secondary">
                <span>Seats</span>
                <span className="text-text-muted">level shown</span>
              </div>
              <ul className="flex flex-col gap-1">
                {seats.map((p) => {
                  const pinned = scene?.seatLevel?.[p.identityId];
                  const character = claimed.find((t) => t.ownerId === p.identityId)?.name;
                  return (
                    <li key={p.identityId} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-text-secondary">
                      <span
                        aria-hidden
                        className={
                          p.connected
                            ? 'h-1.5 w-1.5 shrink-0 rounded-full bg-text-secondary'
                            : 'h-1.5 w-1.5 shrink-0 rounded-full border border-text-muted'
                        }
                      />
                      <span className="truncate">{p.name}</span>
                      {character && <span className="min-w-0 truncate text-xs text-text-muted">— {character}</span>}
                      <span className="relative ml-auto shrink-0">
                        <select
                          aria-label={`${p.name}'s level`}
                          data-testid={`world-seat-${p.identityId}`}
                          value={pinned ?? ''}
                          onChange={(e) => send('set-seat-level', { identity: p.identityId, levelId: e.target.value || null })}
                          className={`appearance-none rounded border py-px pl-1.5 pr-4 text-xs focus:border-border-focus focus:outline-none ${
                            pinned
                              ? 'border-border-structure bg-surface-3 font-medium text-text-primary'
                              : 'border-border-default bg-transparent text-text-muted'
                          }`}
                        >
                          <option value="">Auto</option>
                          {levels.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                        <svg
                          aria-hidden
                          viewBox="0 0 24 24"
                          width="10"
                          height="10"
                          className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-text-muted"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M6 9L12 15L18 9" />
                        </svg>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mx-0.5 mt-0.5 text-xs text-text-muted">Auto follows the seat&apos;s token. Pin a seat to show it another floor.</p>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-text-secondary">Activate a scene to set its darkness, weather and lights.</p>
      )}
    </div>
  );
}

/** The sky's three states as shapes, so the choice never rests on the word alone. */
function Moon({ phase }: { phase: 'full' | 'crescent' | 'none' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="shrink-0">
      {phase === 'full' && <circle cx="8" cy="8" r="6" fill="currentColor" />}
      {phase === 'crescent' && (
        <>
          <path d="M8 2a6 6 0 1 0 4.2 10.3A6.8 6.8 0 0 1 8 2Z" fill="currentColor" />
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".45" />
        </>
      )}
      {phase === 'none' && <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeDasharray="2 2" />}
    </svg>
  );
}

/** `${word} · hh:mm` off the same resolver the status bar reads — `Popover` calls this outside
 *  React, the way `doorsSubtitle` does. */
function worldSubtitle(): string {
  const session = useSessionStore.getState().session;
  const map = useStore.getState().mapSettings;
  const state: TriggersState = (session?.modules.triggers as TriggersState | undefined) ?? { byScene: {} };
  const light = worldLightOf(map, state);
  return `${vocabLabel(light.timeOfDay)} · ${hhmm(light.minutes)}`;
}

registerPanel({
  id: 'world',
  title: 'World',
  icon: 'world',
  key: 'W',
  group: 'prep',
  roles: ['dm'],
  order: 60,
  component: WorldPanel,
  subtitle: worldSubtitle,
  width: 320,
});
