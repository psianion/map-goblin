// The one clock, and who gets to say what it is.
//
// The bug this pins: two writers of `setGrade` — this loop, every frame, off the map's own
// clock, and the Table's fog rebuild, off the campaign's. The per-frame one always won, so a
// table at midnight was drawn at midday. There is one writer now, and this is the seam it
// reads.

import { describe, it, expect, afterEach } from 'vitest';
import { setTableWorld, worldFrame, worldGrade } from './worldOverride';
import { composeGrade, resolveWorldLight, type MapEnvironment } from '../shared/world';

const MAP: MapEnvironment & { ambientLight: string } = {
  environment: 'outdoor',
  naturalLight: true,
  ambientLight: '#8a8f7a',
};

const MIDNIGHT = 0;
const NOON = 720;

const campaign = (minutes: number): Parameters<typeof setTableWorld>[0] => ({
  minutes,
  sun: resolveWorldLight({ ...MAP, clockMinutes: minutes, nightSky: 'full-moon' }).sun,
});

afterEach(() => setTableWorld(null));

describe('worldOverride', () => {
  it('a Table-installed clock beats the map’s own in the composed grade', () => {
    setTableWorld(campaign(MIDNIGHT));
    // No scrub head and no fixed time, so the map's own answer would be midday — the exact
    // stomp the old two-writer race produced.
    expect(worldGrade(MAP, null)).toBe(composeGrade(MAP, MIDNIGHT));
    expect(worldGrade(MAP, null)).not.toBe(composeGrade(MAP, NOON));
    expect(worldFrame(MAP, null).minutes).toBe(MIDNIGHT);
  });

  it('…and beats the scrub head too, so a stale preview cannot leak onto a table', () => {
    setTableWorld(campaign(MIDNIGHT));
    expect(worldGrade(MAP, 300)).toBe(composeGrade(MAP, MIDNIGHT));
  });

  it('the Editor, with no override, follows the scrub head', () => {
    expect(worldGrade(MAP, 300)).toBe(composeGrade(MAP, 300));
    expect(worldFrame(MAP, 300).minutes).toBe(300);
  });

  it('…and a fixed map its pinned hour, an ordinary one midday', () => {
    const fixed = { ...MAP, timeMode: 'fixed' as const, fixedTime: 1020 };
    expect(worldFrame(fixed, null).minutes).toBe(1020);
    expect(worldFrame(MAP, null).minutes).toBe(NOON);
  });

  it('clearing the override hands the engine back to the surface', () => {
    setTableWorld(campaign(MIDNIGHT));
    setTableWorld(null);
    expect(worldGrade(MAP, null)).toBe(composeGrade(MAP, NOON));
  });

  it('the sun comes from the same clock as the grade — one hour per frame, not two', () => {
    setTableWorld(campaign(MIDNIGHT));
    const frame = worldFrame(MAP, 300);
    // Midnight under a full moon: the moon is casting, and it is the campaign's midnight —
    // not the dawn the scrub head asked for, and not the midday the map would have said.
    expect(frame.sun.kind).toBe('moon');
    expect(frame.minutes).toBe(MIDNIGHT);
    setTableWorld(null);
    expect(worldFrame(MAP, NOON).sun.kind).toBe('sun');
  });
});
