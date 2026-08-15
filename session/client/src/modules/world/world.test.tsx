// P2 — the World block. Two halves: what the badge *says* about a resolver answer (the
// provenance/trace half, which is where a DM's trust in the coupling lives), and the panel
// wiring that turns a click into a world command.
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
import { usePanels } from '../../session/panels';
import { WorldPanel } from './WorldPanel';
import { nearestJump, ribbonGradient, worldBadge } from './world';

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

function session(activeSceneId: string | null, modules: SessionState['modules'] = {}): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId,
    scenes: [],
    players: [],
    modules,
  };
}

function triggers(world?: Partial<{ clock: number; nightSky: NightSky }>, ambient?: string): TriggersState {
  return {
    byScene: {
      'sc-1': {
        fired: {},
        armed: {},
        disabled: {},
        lightOverrides: {},
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
  useSessionStore.setState({ session: session('sc-1', { triggers: triggers() }) });
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

describe('WorldPanel', () => {
  it('is registered DM-only, so a player never gets the world dials at all', () => {
    expect(usePanels('dm').find((p) => p.id === 'world')?.roles).toEqual(['dm']);
    expect(usePanels('player').some((p) => p.id === 'world')).toBe(false);
  });

  it('sends the clock as a world command, and shows the jump before the wire confirms', () => {
    render(<WorldPanel />);
    const sendCommand = vi.spyOn(useSessionStore.getState(), 'sendCommand');

    fireEvent.click(screen.getByText('Night'));
    expect(sendCommand).toHaveBeenCalledWith('triggers', 'set-world', { clock: 0 });
    expect(screen.getByTestId('world-clock-readout')).toHaveProperty('textContent', '00:00');
  });

  it('sends the sky as a world command and the gate override as a scene command', () => {
    render(<WorldPanel />);
    const sendCommand = vi.spyOn(useSessionStore.getState(), 'sendCommand');

    fireEvent.click(screen.getByTestId('world-sky').querySelector('[data-value="moonless"]')!);
    expect(sendCommand).toHaveBeenCalledWith('triggers', 'set-world', { nightSky: 'moonless' });

    fireEvent.click(screen.getByTestId('world-override'));
    expect(sendCommand).toHaveBeenCalledWith('triggers', 'set-environment', { ambient: 'darkness' });
    // …and off again is the clear, not `daylight`: untouched and daylight are not one scene.
    fireEvent.click(screen.getByTestId('world-override'));
    expect(sendCommand).toHaveBeenCalledWith('triggers', 'set-environment', { ambient: null });
  });

  it('renders the override’s provenance and its replacement line from the wire state', () => {
    useSessionStore.setState({
      session: session('sc-1', { triggers: triggers({ clock: 720 }, 'darkness') }),
    });
    render(<WorldPanel />);

    expect(screen.getByTestId('world-provenance')).toHaveProperty('textContent', 'Override · you');
    expect(screen.getByTestId('world-trace')).toHaveProperty('textContent', 'Outdoor › Day › sky n/a → Daylight');
    expect(screen.getByTestId('world-override-line')).toHaveProperty(
      'textContent',
      'You set Darkness. The clock would say Daylight.',
    );
  });

  it('keeps the sky on screen when it is dormant, with the reason', () => {
    render(<WorldPanel />);
    expect(screen.getByTestId('world-sky-note')).toHaveProperty(
      'textContent',
      'Takes effect at night. Set it now if you like.',
    );
    expect(screen.getByTestId('world-sky').getAttribute('aria-disabled')).toBeNull();
  });

  it('spells out why the sky is inapplicable underground, and never hides the control', () => {
    useStore.setState({ mapSettings: { ...useStore.getState().mapSettings, environment: 'underground' } });
    render(<WorldPanel />);

    expect(screen.getByTestId('world-sky-note')).toHaveProperty(
      'textContent',
      'This map is underground. It has no sky and takes no auto gate.',
    );
    expect(screen.getByTestId('world-sky').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('world-auto-line')).toHaveProperty(
      'textContent',
      "Manual — this map doesn't follow the sky",
    );
  });

  it('says a fixed map ignores the clock, while the clock keeps running for the rest', () => {
    useStore.setState({
      mapSettings: { ...useStore.getState().mapSettings, environment: 'outdoor', timeMode: 'fixed', fixedTime: 1110 },
    });
    render(<WorldPanel />);

    expect(screen.getByTestId('world-fixed-note').textContent).toContain('pinned to 18:30');
    expect(screen.getByTestId('world-provenance')).toHaveProperty('textContent', 'Fixed · 18:30');
  });
});
