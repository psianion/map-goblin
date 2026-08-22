// M3 §World — the parity test between the Table's resolved light and the Editor's own
// preview, off one core resolver.
//
// Neither surface calls `resolveWorldLight` from a bespoke place. The Table resolves through
// `worldLightOf` (packages/mechanics/src/triggers/types.ts — the wrapper `WorldPanel` and
// `worldSync.ts` both use), a thin pass-through to `resolveWorldLight`
// (packages/core/src/shared/world.ts). The Editor never calls the resolver directly either:
// every frame its render loop draws goes through `worldFrame`
// (packages/core/src/engine/worldOverride.ts) — the same call the Table's engine takes once
// `setTableWorld` installs the campaign's own clock (`renderLoop.ts` calls `worldFrame`
// unconditionally; `worldFrame` returns the installed frame when one exists, else composes its
// own off the map). `worldFrame` is imported here because it is that real call — core, not
// `canvas/src` — never anything under `canvas/src` itself.
//
// A genuine divergence was found reading the two call sites, not assumed away: the Editor has
// no campaign to read a night sky from, so `worldFrame` always resolves against a hardcoded
// sky (`EDITOR_SKY = 'full-moon'`, private to `worldOverride.ts`) rather than whatever this
// matrix is testing. It is documented in `worldOverride.ts`'s own comment as a known limit, and
// this test proves exactly where it does and does not matter: `minutes` always agree; `sun`
// agrees whenever the sky cannot change it (daylight hours, indoor/underground, or the
// campaign's sky happening to be the Editor's own full-moon assumption) and provably disagrees
// the one place it can (an outdoor campaign night under a crescent or moonless sky) — reported
// below, not papered over. Neither surface currently previews `effectiveLevel` (the vision-gate
// half of `WorldLight`) against the other at all: the Editor's `worldFrame` never returns it
// (see the second `describe` below) because the vision gate is a Table-only dial by design
// (`EnvironmentSection`'s own "No auto-gate — light level is set at the Table" chip).

import { describe, expect, it } from 'vitest';
import {
  ENVIRONMENTS,
  NIGHT_SKIES,
  type Environment,
  type MapEnvironment,
  type NightSky,
} from '@dnd/core/src/shared/world';
import { worldFrame } from '@dnd/core/src/engine/worldOverride';
import { worldLightOf, type TriggersState } from '@dnd/mechanics/triggers';

/** The matrix cell: a map authored this way. `naturalLight: true` so the sun vector is ever
 *  non-zero to compare — without it `casts` is false on both sides and `.sun` trivially
 *  matches no matter what the sky is, which would prove nothing. */
function mapAt(environment: Environment, timeMode: 'clock' | 'fixed', minute: number): MapEnvironment {
  return {
    environment,
    naturalLight: true,
    ...(timeMode === 'fixed' ? { timeMode: 'fixed' as const, fixedTime: minute } : {}),
  };
}

/** The Table's own resolved light for a scene with no DM override — `worldLightOf`, the exact
 *  wrapper `WorldPanel` and `worldSync.ts` call. */
function tableLight(map: MapEnvironment, minute: number, sky: NightSky) {
  const state: TriggersState = {
    byScene: { s1: { fired: {}, armed: {}, disabled: {}, lightOverrides: {}, env: {}, prompts: [], log: [] } },
    world: { clock: minute, nightSky: sky, timeSpeed: 'paused' },
  };
  return worldLightOf(map, state, 's1');
}

/** `sunAt`'s own day/night split (`SUN_RISE`/`SUN_SET`, world.ts) — not the narration bands
 *  `timeOfDayAt` uses. The two are close but not identical; this is the one that decides
 *  whether the sky can touch the sun vector at all. */
const sunArcIsDay = (minute: number): boolean => minute >= 360 && minute < 1080;

const MINUTES = [360, 720, 1260, 0]; // dawn/sunrise, noon, night, midnight
const TIME_MODES = ['clock', 'fixed'] as const;

describe('the Table and the Editor resolve the same clock and sun off resolveWorldLight', () => {
  for (const environment of ENVIRONMENTS) {
    for (const timeMode of TIME_MODES) {
      for (const minute of MINUTES) {
        for (const sky of NIGHT_SKIES) {
          it(`${environment}/${timeMode}/${minute}min/${sky}`, () => {
            const map = mapAt(environment, timeMode, minute);
            const table = tableLight(map, minute, sky);

            // The Editor's own call: no scrub while fixed (so `mapClock` falls back to the
            // map's own pinned hour — the same default `resolveWorldLight` takes for a fixed
            // map), the same minute while on the clock (a DM previewing "this instant", the
            // only thing `previewClock` can mean when the Editor has no campaign clock).
            const frame = worldFrame(map, timeMode === 'fixed' ? null : minute);

            // Always true — `mapClock`/`resolveWorldLight`'s fixed-time default agree exactly
            // whenever a fixed map's `fixedTime` is set (it always is here; see `mapAt`).
            expect(frame.minutes).toBe(table.minutes);

            if (sky === 'full-moon' || environment !== 'outdoor' || sunArcIsDay(minute)) {
              // The sky cannot reach the sun vector here — daylight is full strength on both
              // sides regardless of sky, indoor/underground never cast at all, and a full-moon
              // campaign happens to match the Editor's own hardcoded assumption.
              expect(frame.sun).toEqual(table.sun);
            } else {
              // The one real divergence: an outdoor campaign night under crescent or moonless
              // skies casts dimmer (or no) moonlight at the Table, while the Editor's preview
              // of that same instant still assumes a full moon. Known, commented where it
              // lives (`worldOverride.ts`), not fixed by this test.
              expect(frame.sun).not.toEqual(table.sun);
            }
          });
        }
      }
    }
  }
});

describe('the one half of WorldLight the Editor never previews', () => {
  it('worldFrame returns only {minutes, sun} — no effectiveLevel to compare against the Table', () => {
    const frame = worldFrame({ environment: 'outdoor' }, 720);
    expect(Object.keys(frame).sort()).toEqual(['minutes', 'sun']);
  });
});
