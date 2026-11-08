// P2/M3 — the World block. Three things live here: what the badge *says* about a resolver
// answer (the provenance/trace half, which is where a DM's trust in the coupling lives), the
// read-only line that reports what the map itself authored (`worldProvenance`), and the panel
// wiring that turns a click into a world command: clock, sky, speed, the darkness slider,
// weather, all lights, the DM's level and the seats' level pills.
//
// The coupling itself is not retested here — `resolveWorldLight` owns that, and this suite
// calls it rather than restating its table.

import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { PROTOCOL_VERSION, type SessionState } from '@dnd/core/src/shared/protocol';
import { resolveWorldLight, type MapEnvironment, type NightSky } from '@dnd/core/src/shared/world';
import { useStore } from '@dnd/core/src/store/store';
import type { TriggersState } from '@dnd/mechanics/triggers';
import { useSessionStore } from '../../session/store';
import { nearestJump, ribbonGradient, worldBadge, worldProvenance } from './world';

const NIGHT = 1330; // 22:10 — the mockup's night frame
const NOON = 740; //  12:20

/** The badge for one world, resolved the way both surfaces resolve it. */
function badgeFor(
  map: MapEnvironment,
  clockMinutes: number,
  nightSky: NightSky,
  override: 'daylight' | 'dusk' | 'darkness' | null = null,
) {
  return worldBadge(resolveWorldLight({ ...map, clockMinutes, nightSky, override }), map, nightSky);
}

const OUTDOOR: MapEnvironment = { environment: 'outdoor' };

function session(
  activeSceneId: string | null,
  modules: SessionState['modules'] = {},
  scenes: SessionState['scenes'] = [],
): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId,
    scenes,
    players: [],
    modules,
  };
}

function triggers(world?: Partial<{ clock: number; nightSky: NightSky; darkness: number | null }>, ambient?: string): TriggersState {
  return {
    byScene: {
      'sc-1': {
        fired: {},
        armed: {},
        disabled: {},
        lightOverrides: {},
        lightEdits: {},
        env: ambient ? { ambient } : {},
        prompts: [],
        log: [],
      },
    },
    ...(world ? { world: { clock: 720, nightSky: 'full-moon', timeSpeed: 'paused', ...world } } : {}),
  } as TriggersState;
}

beforeEach(() => {
  cleanup();
  useStore.setState({ mapSettings: { ...useStore.getState().mapSettings, environment: 'outdoor' } });
  useSessionStore.setState({
    session: session('sc-1', { triggers: triggers() }, [{ id: 'sc-1', name: 'Fieldstone Keep', mapId: 'm1' }]),
  });
});

describe('the badge reads its provenance off the resolver', () => {
  it('names the clock, and traces the row it took', () => {
    const badge = badgeFor(OUTDOOR, NOON, 'crescent');
    expect(badge.level).toBe('Daylight');
    expect(badge.provenance).toBe('Auto · clock');
    expect(badge.overridden).toBe(false);
    // Sky is inapplicable by daylight — said, never left blank.
    expect(badge.trace).toEqual(['Outdoor', 'Day', 'sky n/a']);
    expect(badge.traceOut).toBe('Daylight');
    expect(badge.overrideLine).toBeNull();
  });

  it('carries the sky into the trace once the clock is at night, and names the softened bite', () => {
    const badge = badgeFor(OUTDOOR, NIGHT, 'crescent');
    expect(badge.trace).toEqual(['Outdoor', 'Night', 'Crescent']);
    expect(badge.level).toBe('Darkness');
    expect(badge.bite).toBe('soft');
    expect(badge.consequence).toBe('Beyond torchlight players read shapes, not detail.');

    // …and the moonless night is the same gate one shade harder, which the words separate.
    const moonless = badgeFor(OUTDOOR, NIGHT, 'moonless');
    expect(moonless.trace).toEqual(['Outdoor', 'Night', 'Moonless']);
    expect(moonless.bite).toBe('full');
  });

  it('shows the full moon landing on dusk — the surprising row of the table', () => {
    const badge = badgeFor(OUTDOOR, NIGHT, 'full-moon');
    expect(badge.level).toBe('Dusk');
    expect(badge.bite).toBeNull();
    expect(badge.traceOut).toBe('Dusk');
  });

  it('locks to the override and keeps what the clock would have said', () => {
    const badge = badgeFor(OUTDOOR, NOON, 'crescent', 'darkness');
    expect(badge.provenance).toBe('Override · you');
    expect(badge.overridden).toBe(true);
    // The trace still traces the clock — struck through on screen, never deleted.
    expect(badge.traceOut).toBe('Daylight');
    expect(badge.overrideLine).toBe('You set Darkness. The clock would say Daylight.');
  });

  it('says a fixed map is fixed, at the time its DM placed the sun', () => {
    const badge = badgeFor({ environment: 'outdoor', timeMode: 'fixed', fixedTime: 1110 }, NOON, 'crescent');
    expect(badge.provenance).toBe('Fixed · 18:30');
    expect(badge.trace).toEqual(['Outdoor', 'Dusk — fixed 18:30', 'sky n/a']);
    expect(badge.level).toBe('Dusk');
  });

  it('reads an untouched indoor map as nobody having set a gate — not as daylight', () => {
    const badge = badgeFor({ environment: 'indoor' }, NIGHT, 'moonless');
    expect(badge.provenance).toBe('Manual · not set');
    expect(badge.trace).toEqual(['Indoor', 'Night — tint only', 'sky n/a']);
    expect(badge.traceOut).toBe('no auto gate');
    expect(badge.consequence).toBe('No gate set. The scene lights as its map was authored.');
  });

  it('takes the clock and the sky out of an underground map’s trace entirely', () => {
    const badge = badgeFor({ environment: 'underground' }, NOON, 'full-moon', 'darkness');
    expect(badge.trace).toEqual(['Underground', 'clock ignored', 'sky ignored']);
    expect(badge.overrideLine).toBe('You set Darkness. This map takes no auto gate.');
  });
});

describe('the status bar mirror keeps the boring state off the bar', () => {
  it('prints nothing at daylight on a clock nobody has taken over', () => {
    expect(badgeFor(OUTDOOR, NOON, 'crescent').mirror).toBeNull();
  });

  it('prints the hour, the sky and the level once the world is doing something', () => {
    expect(badgeFor(OUTDOOR, NIGHT, 'crescent').mirror).toBe('Night · Crescent · Darkness');
  });

  it('prints the override as an override', () => {
    expect(badgeFor(OUTDOOR, NOON, 'crescent', 'darkness').mirror).toBe('Darkness (override)');
  });

  it('leaves the hour off an underground map, which the clock says nothing about', () => {
    expect(badgeFor({ environment: 'underground' }, NIGHT, 'moonless').mirror).toBeNull();
  });
});

describe('the ribbon paints the map’s own day', () => {
  const MOOD = { ...OUTDOOR, ambientLight: '#2d2d44' };

  it('samples the composed grade across the clock, and answers the sky at the night end', () => {
    const full = ribbonGradient(MOOD, 'full-moon');
    expect(full.match(/#[0-9a-f]{6}/g)).toHaveLength(24);
    // Same map, one control moved: the night end darkens and the middle of the day does not.
    const moonless = ribbonGradient(MOOD, 'moonless');
    const stopAt = (gradient: string, i: number) => gradient.match(/#[0-9a-f]{6}/g)![i];
    expect(stopAt(moonless, 0)).not.toBe(stopAt(full, 0)); // midnight
    expect(stopAt(moonless, 12)).toBe(stopAt(full, 12)); // noon
  });

  it('goes flat underground, where the hour buys nothing (damping 0)', () => {
    const stops = ribbonGradient({ environment: 'underground', ambientLight: '#2d2d44' }, 'moonless')
      .match(/#[0-9a-f]{6}/g)!;
    expect(new Set(stops).size).toBe(1);
    expect(stops[0]).toBe('#2d2d44');
  });
});

describe('the quick jumps', () => {
  it('stand on the hour nearest the clock, around midnight as well as through it', () => {
    expect(nearestJump(740)).toBe('noon');
    expect(nearestJump(NIGHT)).toBe('night');
    expect(nearestJump(30)).toBe('night');
  });
});

describe('worldProvenance reports what the map authored, never a control', () => {
  it('reads an outdoor map on the clock, saying nothing about the default (M3 review finding 6)', () => {
    expect(worldProvenance({ environment: 'outdoor' }, 'Fieldstone Keep')).toBe('Fieldstone Keep · outdoor');
  });

  it('reads an indoor map pinned in the Editor', () => {
    expect(
      worldProvenance({ environment: 'indoor', timeMode: 'fixed', fixedTime: 1260 }, 'Lamplight Cell'),
    ).toBe('Lamplight Cell · indoor · pinned to 21:00 in the Editor');
  });

  it('reads underground as having no sky, regardless of time mode', () => {
    expect(worldProvenance({ environment: 'underground', timeMode: 'fixed', fixedTime: 0 }, 'Emberhold Crypt')).toBe(
      'Emberhold Crypt · underground · no sky',
    );
    expect(worldProvenance({ environment: 'underground' }, 'Emberhold Crypt')).toBe(
      'Emberhold Crypt · underground · no sky',
    );
  });

  it('appends the natural-light tell when a map casts a sun or moon', () => {
    expect(worldProvenance({ environment: 'outdoor', naturalLight: true }, 'Fieldstone Keep')).toBe(
      'Fieldstone Keep · outdoor · sun & moon',
    );
  });

  it('defaults an absent environment to indoor, same as the resolver', () => {
    expect(worldProvenance({}, 'Nameless Cell')).toBe('Nameless Cell · indoor');
  });
});

