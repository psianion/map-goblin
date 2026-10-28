// P2/M3 — the World block. Three things live here: what the badge *says* about a resolver
// answer (the provenance/trace half, which is where a DM's trust in the coupling lives), the
// read-only line that reports what the map itself authored (`worldProvenance`), and the panel
// wiring that turns a click into a world command: clock, sky, speed, the darkness slider,
// weather, all lights, the DM's level and the seats' level pills.
//
// The coupling itself is not retested here — `resolveWorldLight` owns that, and this suite
// calls it rather than restating its table.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION, type SessionState } from '@dnd/core/src/shared/protocol';
import { resolveWorldLight, type MapEnvironment, type NightSky } from '@dnd/core/src/shared/world';
import { useStore } from '@dnd/core/src/store/store';
import type { TriggersState } from '@dnd/mechanics/triggers';
import { useSessionStore } from '../../session/store';
import { usePanels, usePanel } from '../../session/panels';
import { WorldPanel } from './WorldPanel';
import { DM_LIT_KEY, getDarknessPreview, dmLit, resetWorldPrefsForTests } from './worldPrefs';
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

describe('WorldPanel', () => {
  const send = () => vi.spyOn(useSessionStore.getState(), 'sendCommand').mockClear();
  const twoLevels = () =>
    useStore.setState({
      levels: [
        { id: 'lv1', name: 'Ground floor' },
        { id: 'lv2', name: 'Level 2' },
      ],
    });
  const players: SessionState['players'] = [
    { identityId: 'dm', name: 'Sam', role: 'dm', connected: true },
    { identityId: 'p1', name: 'Maya', role: 'player', connected: true },
    { identityId: 'p2', name: 'Tom', role: 'player', connected: true },
  ];

  beforeEach(() => {
    resetWorldPrefsForTests();
    localStorage.clear();
    useStore.setState({ levels: [{ id: 'lv1', name: 'Ground floor' }] });
  });

  it('is registered DM-only, so a player never gets the world dials at all', () => {
    expect(usePanels('dm').find((p) => p.id === 'world')?.roles).toEqual(['dm']);
    expect(usePanels('player').some((p) => p.id === 'world')).toBe(false);
  });

  it('carries the resolved word and hour in the header subtitle, off the same resolver', () => {
    const def = usePanel('world')!;
    expect(def.subtitle?.()).toBe('Day · 12:00');
    useSessionStore.setState({
      session: session('sc-1', { triggers: triggers({ clock: NIGHT }) }, [{ id: 'sc-1', name: 'Fieldstone Keep', mapId: 'm1' }]),
    });
    expect(def.subtitle?.()).toBe('Night · 22:10');
  });

  it('sends the clock, the sky and the speed as world commands', () => {
    render(<WorldPanel />);
    const spy = send();
    fireEvent.click(screen.getByText('Night'));
    expect(spy).toHaveBeenCalledWith('triggers', 'set-world', { clock: 0 });
    fireEvent.click(screen.getByTestId('world-sky').querySelector('[data-value="moonless"]')!);
    expect(spy).toHaveBeenCalledWith('triggers', 'set-world', { nightSky: 'moonless' });
    fireEvent.click(screen.getByTestId('world-speed').querySelector('[data-value="fast"]')!);
    expect(spy).toHaveBeenCalledWith('triggers', 'set-world', { timeSpeed: 'fast' });
  });

  it('the darkness slider previews on the DM view while dragged and commits once on release', () => {
    render(<WorldPanel />);
    const spy = send();
    const slider = screen.getByTestId('world-darkness');
    fireEvent.change(slider, { target: { value: '35' } });
    expect(getDarknessPreview()).toBe(0.35);
    expect(screen.getByTestId('world-darkness-value').textContent).toBe('0.35');
    fireEvent.change(slider, { target: { value: '60' } });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('triggers', 'set-world', { darkness: 0.6 });
  });

  it('following the sky, the slider reads what the sky makes of the hour and Follow sky is pressed', () => {
    useSessionStore.setState({
      session: session('sc-1', { triggers: triggers({ clock: NIGHT }) }, [{ id: 'sc-1', name: 'Fieldstone Keep', mapId: 'm1' }]),
    });
    render(<WorldPanel />);
    const follow = screen.getByTestId('world-follow-sky');
    expect(follow.getAttribute('aria-pressed')).toBe('true');
    expect(Number(screen.getByTestId('world-darkness-value').textContent)).toBeGreaterThan(0.5);
  });

  it('Follow sky hands the darkness back to the sky (null)', () => {
    useSessionStore.setState({
      session: session('sc-1', { triggers: triggers({ clock: 720, darkness: 0.8 }) }, [
        { id: 'sc-1', name: 'Fieldstone Keep', mapId: 'm1' },
      ]),
    });
    render(<WorldPanel />);
    expect(screen.getByTestId('world-darkness-value').textContent).toBe('0.80');
    const spy = send();
    fireEvent.click(screen.getByTestId('world-follow-sky'));
    expect(spy).toHaveBeenCalledWith('triggers', 'set-world', { darkness: null });
  });

  it('sends the weather as a world command, starting from the map default', () => {
    useStore.setState({ mapSettings: { ...useStore.getState().mapSettings, weather: 'fog' } });
    render(<WorldPanel />);
    const weather = screen.getByTestId('world-weather') as HTMLSelectElement;
    expect(weather.value).toBe('fog');
    const spy = send();
    fireEvent.change(weather, { target: { value: 'storm' } });
    expect(spy).toHaveBeenCalledWith('triggers', 'set-world', { weather: 'storm' });
    expect(weather.value).toBe('storm');
  });

  it('All lights switches every light at once', () => {
    render(<WorldPanel />);
    const spy = send();
    fireEvent.click(screen.getByTestId('world-all-lights').querySelector('[data-value="off"]')!);
    expect(spy).toHaveBeenCalledWith('triggers', 'set-lights-all', { on: false });
  });

  it('"Show me everything lit" is the DM’s own view, kept in this browser, sending nothing', () => {
    render(<WorldPanel />);
    const spy = send();
    fireEvent.click(screen.getByTestId('world-dm-lit'));
    expect(dmLit()).toBe(true);
    expect(localStorage.getItem(DM_LIT_KEY)).toBe('1');
    expect(spy).not.toHaveBeenCalled();
  });

  it('with one level there is no level picker and no seats list', () => {
    render(<WorldPanel />);
    expect(screen.queryByTestId('world-dm-level')).toBeNull();
    expect(screen.queryByTestId('world-seats')).toBeNull();
  });

  it('with two levels: My level sets the DM view, and each seat has a level pill (Auto or pinned)', () => {
    twoLevels();
    const t = triggers();
    t.byScene['sc-1'].seatLevel = { p2: 'lv2' };
    useSessionStore.setState({
      session: { ...session('sc-1', { triggers: t }, [{ id: 'sc-1', name: 'Fieldstone Keep', mapId: 'm1' }]), players },
    });
    render(<WorldPanel />);
    const spy = send();
    fireEvent.change(screen.getByTestId('world-dm-level'), { target: { value: 'lv2' } });
    expect(spy).toHaveBeenCalledWith('triggers', 'set-dm-level', { levelId: 'lv2' });
    const seats = screen.getByTestId('world-seats');
    expect(seats.textContent).toContain('level shown');
    expect(seats.textContent).not.toContain('Sam');
    const maya = screen.getByLabelText("Maya's level") as HTMLSelectElement;
    const tom = screen.getByLabelText("Tom's level") as HTMLSelectElement;
    expect([maya.value, tom.value]).toEqual(['', 'lv2']);
    expect(tom.className).toContain('font-medium');
    fireEvent.change(maya, { target: { value: 'lv2' } });
    expect(spy).toHaveBeenCalledWith('triggers', 'set-seat-level', { identity: 'p1', levelId: 'lv2' });
    fireEvent.change(tom, { target: { value: '' } });
    expect(spy).toHaveBeenCalledWith('triggers', 'set-seat-level', { identity: 'p2', levelId: null });
  });

  it('keeps the sky segmented on screen while outdoor, and notes why it is inapplicable underground', () => {
    const { unmount } = render(<WorldPanel />);
    expect(screen.queryByTestId('world-sky-note')).toBeNull();
    unmount();
    useStore.setState({ mapSettings: { ...useStore.getState().mapSettings, environment: 'underground' } });
    render(<WorldPanel />);
    expect(screen.getByTestId('world-sky-note')).toHaveProperty('textContent', 'This map is underground. It has no sky.');
    expect(screen.getByTestId('world-sky').getAttribute('aria-disabled')).toBe('true');
  });

  it('with no scene active keeps the campaign dials and drops the scene ones', () => {
    useSessionStore.setState({ session: session(null) });
    render(<WorldPanel />);
    expect(screen.getByText('Activate a scene to set its darkness, weather and lights.')).not.toBeNull();
    expect(screen.queryByTestId('world-darkness')).toBeNull();
    expect(screen.getByTestId('world-clock')).not.toBeNull();
  });

  it('no longer carries the old three-state override or the provenance badge', () => {
    render(<WorldPanel />);
    expect(screen.queryByTestId('world-override')).toBeNull();
    expect(screen.queryByTestId('world-badge')).toBeNull();
    expect(screen.queryByTestId('world-provenance')).toBeNull();
  });
});
