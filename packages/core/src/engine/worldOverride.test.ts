// The one sky, and who gets to say what it is.
//
// The bug this pins: two writers of `setGrade` — this loop, every frame, off the map's own
// time, and the Table's fog rebuild, off the campaign's. The per-frame one always won, so a
// table at midnight was drawn at midday. There is one writer now, and this is the seam it
// reads.

import { describe, it, expect, afterEach } from 'vitest';
import { setTableWorld, worldFrame } from './worldOverride';
import { type MapEnvironment } from '../shared/world';
import { skyFrame } from '../shared/sky';
import type { TimeOfDay } from '../shared/prep';

const MAP: MapEnvironment & { ambientLight: string } = {
  environment: 'outdoor',
  naturalLight: true,
  ambientLight: '#8a8f7a',
};

const MIDNIGHT = 0;
const NOON = 720;

const campaign = (time: TimeOfDay): Parameters<typeof setTableWorld>[0] => skyFrame({ ...MAP, time });

afterEach(() => setTableWorld(null));

describe('worldOverride', () => {
  it('a Table-installed time beats the map’s own', () => {
    setTableWorld(campaign('night'));
    // No preview, so the map's own answer would be midday — the exact stomp the old
    // two-writer race produced.
    expect(worldFrame(MAP, null).minutes).toBe(MIDNIGHT);
  });

  it('…and beats the preview too, so a stale preview cannot leak onto a table', () => {
    setTableWorld(campaign('night'));
    expect(worldFrame(MAP, 'dawn').minutes).toBe(MIDNIGHT);
  });

  it('the Editor, with no override, follows the preview, and Day without one', () => {
    expect(worldFrame(MAP, 'dusk')).toEqual(skyFrame({ ...MAP, time: 'dusk' }));
    expect(worldFrame(MAP, null).minutes).toBe(NOON);
  });

  it('clearing the override hands the engine back to the surface', () => {
    setTableWorld(campaign('night'));
    setTableWorld(null);
    expect(worldFrame(MAP, null).minutes).toBe(NOON);
  });

  it('the sun comes from the same time as the grade — one time per frame, not two', () => {
    setTableWorld(campaign('night'));
    const frame = worldFrame(MAP, 'dawn');
    // Night under a full moon: the moon is casting, and it is the campaign's night — not the
    // dawn the preview asked for, and not the midday the map would have said.
    expect(frame.sun.kind).toBe('moon');
    expect(frame.minutes).toBe(MIDNIGHT);
    setTableWorld(null);
    expect(worldFrame(MAP, 'day').sun.kind).toBe('sun');
  });
});
