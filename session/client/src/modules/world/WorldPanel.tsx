// P2/M3 — the World popover. One clock and one sky for the campaign, and the vision gate
// they resolve to, in 300px fixed content (M3 §World, the no-scroll ledger).
//
// The block still reads in two halves: *the world's look* — clock, sky, speed — and *the
// vision gate* — what the coupling resolved to, whether the DM took it over, and what that
// does to the players. World is campaign-global (plan decision); what a map authored in the
// Editor (`MapEnvironment`) is honoured and shown as read-only provenance, never re-authored
// here — that's `worldProvenance`, not a control.
//
// Nothing here computes coupling. `resolveWorldLight` is the same rule the referee gates
// sight with and the table paints with (`worldLightOf`), called here with the DM's own
// un-round-tripped picks so the ribbon and the badge move on the same click. `parity.test.ts`
// is the proof that the Editor's own preview call resolves the same clock/sun off the one
// core function.

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
import { Icon } from '../../shell/icons';
import { registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';
import { JUMPS, hhmm, nearestJump, ribbonGradient, worldBadge, worldProvenance } from './world';

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
  const sceneName = useSessionStore((s) => s.session?.scenes.find((sc) => sc.id === sceneId)?.name ?? '');
  const triggers = useModuleState<TriggersState>('triggers');
  // The active map's authored half — the palette the ribbon is painted from, the environment
  // that decides whether any of the sky applies here, and what `worldProvenance` reads.
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
  const light = resolveWorldLight({
    ...map,
    clockMinutes: clock,
    nightSky: view.nightSky,
    override: view.override,
  });
  const badge = worldBadge(light, map, view.nightSky);
  const jump = nearestJump(clock);
  // Dormant-but-outdoor (daylight, sky set for tonight) gets no note now — the row's job is
  // "why is this control unusable", and outdoor is never unusable, only waiting.
  const skyNote = !outdoor
    ? environment === 'underground'
      ? 'This map is underground. It has no sky and takes no auto gate.'
      : 'This map is indoor. The hour tints it; the sky never sets its light level.'
    : null;
  // The full trace/explainer today's card spelled out, folded into the badge row's own
  // tooltip rather than a permanent block — hover to read it, nothing lost.
  const badgeTitle = [`${badge.trace.join(' › ')} → ${badge.traceOut}`, badge.overrideLine, badge.consequence]
    .filter((line): line is string => Boolean(line))
    .join('\n');

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
            // Where the clock stands, not a toggle that is on: these five move the world,
            // they don't hold a state of their own.
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
          <p data-testid="world-provenance" className="flex items-start gap-1.5 text-xs text-text-muted">
            <Icon name="scene" size={12} className="mt-0.5 shrink-0" />
            <span className="line-clamp-2 min-w-0 flex-1" title={worldProvenance(map, sceneName || 'This scene')}>
              {worldProvenance(map, sceneName || 'This scene')}
            </span>
            {badge.overridden && (
              <span className="flex shrink-0 items-center gap-1 text-text-primary">
                <Icon name="lock" size={11} />
                override
              </span>
            )}
          </p>

          <div>
            <div
              data-testid="world-badge"
              title={badgeTitle}
              className="flex items-center gap-2 rounded border border-border-default px-2 py-1.5 text-xs"
            >
              <span aria-hidden className="shrink-0">
                {badge.glyph}
              </span>
              <span className="shrink-0 font-semibold text-text-primary">{badge.level}</span>
              {/* M3 review finding 5 — the trace wraps to a second line inside the row rather
                  than truncating to an unreadable sliver; the switch keeps its own column. */}
              <span className="min-w-0 flex-1 whitespace-normal text-text-secondary">{badge.trace.join(' › ')}</span>
              <span className="shrink-0">
                <Switch
                  testId="world-override"
                  checked={view.override !== null}
                  onToggle={() => setOverride(view.override === null ? 'darkness' : null)}
                >
                  Override the light level
                </Switch>
              </span>
            </div>
            {view.override !== null && (
              <div className="mt-1 rounded border border-border-default px-2 py-1.5">
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

          <p className="text-xs text-text-muted" data-testid="world-hint">
            {badge.consequence} Toggle to override the level.
          </p>
        </>
      ) : (
        <p className="text-sm text-text-secondary">Activate a scene to set its light level.</p>
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
      {phase === 'none' && (
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeDasharray="2 2" />
      )}
    </svg>
  );
}

/** `${word} · hh:mm` off the same resolver the badge reads — `Popover` calls this outside
 *  React, the way `doorsSubtitle` does. */
function worldSubtitle(): string {
  const session = useSessionStore.getState().session;
  const map = useStore.getState().mapSettings;
  const state: TriggersState = (session?.modules.triggers as TriggersState | undefined) ?? { byScene: {} };
  const world = worldOf(state);
  const sceneId = session?.activeSceneId ?? null;
  const override = sceneId ? (sceneTriggersOf(state, sceneId).env.ambient ?? null) : null;
  const light = resolveWorldLight({ ...map, clockMinutes: world.clock, nightSky: world.nightSky, override });
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
