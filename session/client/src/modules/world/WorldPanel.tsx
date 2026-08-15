// P2 — the World block. One clock and one sky for the campaign, and the vision gate they
// resolve to, in the DM's own sidebar.
//
// The block reads in two halves on purpose (the mockup's chassis): *the world's look* — clock,
// sky, speed — and *the vision gate* — what the coupling resolved to, whether the DM took it
// over, and what that does to the players. An override takes the gate and never the grade, so
// the world still looks like the hour it is; the two halves being separate is what says so.
//
// Nothing here computes coupling. `resolveWorldLight` is the same rule the referee gates
// sight with and the table paints with (`worldLightOf`), called here with the DM's own
// un-round-tripped picks so the ribbon, the trace and the badge all move on the same click.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AMBIENTS, vocabLabel, type AmbientLevel } from '@dnd/core/src/shared/prep';
import { useStore } from '@dnd/core/src/store/store';
import {
  BUCKET_MINUTES,
  DAY_MINUTES,
  environmentOf,
  resolveWorldLight,
  type NightSky,
  type TimeSpeed,
} from '@dnd/core/src/shared/world';
import { sceneTriggersOf, worldOf, type TriggersState, type WorldState } from '@dnd/mechanics/triggers';
import { Segmented, Switch } from '../../components/controls';
import { registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';
import { JUMPS, hhmm, nearestJump, ribbonAt, ribbonGradient, worldBadge } from './world';

/** A pick the module state never confirms (dropped command, disconnect) must not show
 *  forever — the same window and the same reason as the environment dials' echo. */
const PENDING_TIMEOUT_MS = 4000;

/** Everything this panel sets, in one shape: the campaign's world plus the scene's own gate. */
type Picks = Partial<WorldState> & { override?: AmbientLevel | null };

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

const LEVEL_OPTIONS: readonly { value: AmbientLevel; label: string }[] = AMBIENTS.map((value) => ({
  value,
  label: vocabLabel(value),
}));

export function WorldPanel() {
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const triggers = useModuleState<TriggersState>('triggers');
  // The active map's authored half — the palette the ribbon is painted from and the
  // environment that decides whether any of the sky applies here.
  const map = useStore((s) => s.mapSettings);

  const state: TriggersState = triggers ?? { byScene: {} };
  const world = worldOf(state);
  const override = sceneId ? (sceneTriggersOf(state, sceneId).env.ambient ?? null) : null;
  const confirmed: Required<Picks> = { ...world, override };

  // Optimistic echo: a pick shows the instant it is clicked rather than after the broadcast
  // round-trips. One timer for the block rather than one per dial — a DM who moves two dials
  // in four seconds has simply extended the fallback window, which is what they'd want.
  const [pending, setPending] = useState<Picks>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    setPending((p) => {
      const stale = Object.keys(p).filter((k) => p[k as keyof Picks] === confirmed[k as keyof Picks]);
      if (stale.length === 0) return p; // unchanged reference — no wasted render
      const next = { ...p };
      for (const key of stale) delete next[key as keyof Picks];
      return next;
    });
    // The wire caught up; which keys it caught up on is decided above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed.clock, confirmed.nightSky, confirmed.timeSpeed, confirmed.override]);

  const view = { ...confirmed, ...pending };

  const stage = (patch: Picks): void => {
    setPending((p) => ({ ...p, ...patch }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPending({}), PENDING_TIMEOUT_MS);
  };
  const send = (action: string, payload: unknown): void =>
    useSessionStore.getState().sendCommand('triggers', action, payload);
  const setWorld = (patch: Partial<WorldState>): void => {
    stage(patch);
    send('set-world', patch);
  };
  const setOverride = (value: AmbientLevel | null): void => {
    stage({ override: value });
    send('set-environment', { ambient: value });
  };

  // The clock commits on release, not on every pixel of the drag (the editor's slider idiom):
  // one command and one broadcast per move, while the ribbon still follows the thumb.
  const [drag, setDrag] = useState<number | null>(null);
  const clock = drag ?? view.clock;
  const commitClock = (): void => {
    if (drag !== null && drag !== view.clock) setWorld({ clock: drag });
    setDrag(null);
  };

  const environment = environmentOf(map);
  const outdoor = environment === 'outdoor';
  const fixed = map.timeMode === 'fixed';
  const light = resolveWorldLight({
    ...map,
    clockMinutes: clock,
    nightSky: view.nightSky,
    override: view.override,
  });
  const badge = worldBadge(light, map, view.nightSky);
  const night = light.timeOfDay === 'night';
  // The sky is set once and takes effect when night comes: dormant is not disabled, so a DM
  // can still set tonight's moon at noon (zero setup, no re-visit). Inapplicable is a third
  // state again — the control stays on screen, unusable, with the reason spelled out.
  const skyDormant = outdoor && !night;
  const skyNote = outdoor
    ? skyDormant
      ? 'Takes effect at night. Set it now if you like.'
      : null
    : environment === 'underground'
      ? 'This map is underground. It has no sky and takes no auto gate.'
      : 'This map is indoor. The hour tints it; the sky never sets its light level.';
  const jump = nearestJump(clock);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <div
          className="relative h-6 overflow-hidden rounded-chip border border-black/50"
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
        <div className="relative mt-1 h-1.5" aria-hidden>
          {JUMPS.map((j) => (
            <i
              key={j.key}
              className="absolute top-0 block h-1.5 w-px bg-text-muted"
              style={{ left: ribbonAt(j.minutes) }}
            />
          ))}
        </div>
        <div className="mt-1 flex items-baseline gap-2 text-xs text-text-secondary">
          Clock
          <span className="ml-auto font-mono tabular-nums text-text-primary" data-testid="world-clock-readout">
            {hhmm(clock)}
          </span>
        </div>
        <div className="mt-1.5 grid grid-cols-6 gap-1" data-testid="world-jumps">
          {JUMPS.map((j, i) => (
            <button
              key={j.key}
              type="button"
              // Where the clock stands, not a toggle that is on: these five move the world,
              // they don't hold a state of their own.
              aria-current={j.key === jump ? 'true' : undefined}
              data-value={j.key}
              onClick={() => setWorld({ clock: j.minutes })}
              className={`truncate rounded border px-1 py-1.5 text-xs transition-colors duration-150 ease-out-quart focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none ${
                i > 2 ? 'col-span-3' : 'col-span-2'
              } ${
                j.key === jump
                  ? 'border-border-focus bg-surface-3 text-text-primary'
                  : 'border-border-default bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary'
              }`}
            >
              {j.label}
            </button>
          ))}
        </div>
        {/* ponytail: the ribbon and its playhead stay the *world clock's*, even here — the
            sentence carries the map's own hour rather than a second marker on the track.
            Draw the pinned hour on the ribbon the day a table runs several fixed maps. */}
        {fixed && (
          <p className="mt-2 text-xs text-text-secondary" data-testid="world-fixed-note">
            This map is pinned to {hhmm(light.minutes)}. The clock still runs for every other map.
          </p>
        )}
      </div>

      <div className={skyDormant ? 'opacity-60' : undefined}>
        <Segmented
          label="Night sky"
          testId="world-sky"
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
        label="Time speed"
        testId="world-speed"
        value={view.timeSpeed}
        options={SPEED_OPTIONS}
        onPick={(next) => next !== view.timeSpeed && setWorld({ timeSpeed: next })}
      />

      <div className="border-t border-border-default pt-2">
        <p className="mb-1 text-xs uppercase tracking-wide text-text-secondary">Vision gate</p>
        {sceneId ? (
          <>
            <div
              className={`rounded border p-2 ${
                view.override ? 'border-border-focus bg-surface-2' : 'border-border-default bg-surface-1'
              }`}
            >
              <p
                className={`text-xs text-text-secondary ${view.override ? 'line-through' : ''}`}
                data-testid="world-auto-line"
              >
                {outdoor
                  ? `Auto from clock · outdoor, ${light.timeOfDay}`
                  : "Manual — this map doesn't follow the sky"}
              </p>
              <Switch
                testId="world-override"
                checked={view.override !== null}
                onToggle={() => setOverride(view.override === null ? 'darkness' : null)}
              >
                Override the light level
              </Switch>
              {view.override !== null && (
                <div className="mt-1">
                  <Segmented
                    label="Level"
                    testId="world-override-level"
                    value={view.override}
                    options={LEVEL_OPTIONS}
                    onPick={(next) => next !== view.override && setOverride(next)}
                  />
                </div>
              )}
            </div>

            <div
              data-testid="world-badge"
              className={`mt-2 rounded border p-2 ${
                badge.overridden ? 'border-border-focus bg-surface-2' : 'border-border-default bg-surface-1'
              }`}
            >
              {/* Live on the level alone: a DM scrubbing the clock is not asking to hear the
                  trace re-read, but the gate turning over is worth saying out loud. */}
              <p
                aria-live="polite"
                className="flex items-baseline gap-2 text-sm font-semibold text-text-primary"
              >
                <span aria-hidden>{badge.glyph}</span>
                {badge.level}
                {badge.bite && (
                  <span className="ml-auto text-xs font-normal text-text-secondary">{badge.bite}</span>
                )}
              </p>
              <p
                data-testid="world-provenance"
                className={`mt-1.5 inline-flex items-center gap-1 text-xs ${
                  badge.overridden
                    ? 'rounded-chip border border-border-focus px-1.5 py-px font-semibold uppercase tracking-wide text-text-primary'
                    : 'text-text-secondary'
                }`}
              >
                {badge.overridden && <Lock />}
                {badge.provenance}
              </p>
              {/* Struck through, not dimmed away: what the clock wanted is still something the
                  DM reads, so it keeps the readable tier and the strike does the work. */}
              <p
                data-testid="world-trace"
                className={`mt-1.5 text-xs text-text-secondary ${badge.overridden ? 'line-through' : ''}`}
              >
                {badge.trace.join(' › ')} → {badge.traceOut}
              </p>
              {badge.overrideLine && (
                <p
                  data-testid="world-override-line"
                  className="mt-1 flex items-baseline gap-1.5 text-xs text-text-primary"
                >
                  <Lock />
                  {badge.overrideLine}
                </p>
              )}
              <p className="mt-1.5 text-xs text-text-secondary">{badge.consequence}</p>
            </div>
          </>
        ) : (
          <p className="text-sm text-text-secondary">Activate a scene to set its light level.</p>
        )}
      </div>
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
      {phase === 'none' && (
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeDasharray="2 2" />
      )}
    </svg>
  );
}

/** A padlock: the override's own tell, next to the word, never instead of it. */
function Lock() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden className="shrink-0 self-center">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

registerPanel({ id: 'world', title: 'World', roles: ['dm'], order: 5, component: WorldPanel });
