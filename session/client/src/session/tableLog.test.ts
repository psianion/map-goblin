import { describe, expect, it } from 'vitest';
import type { DoorsState } from '@dnd/mechanics/doors';
import type { FogState } from '@dnd/mechanics/fog';
import type { LogEntry } from '@dnd/mechanics/log';
import { logSentence, tableLogLines } from './tableLog';

const SCENE = 'map-1';

/** A map document as the server redacts and sends it — the only place names come from. */
const MAP = {
  layers: [
    {
      type: 'dungeon',
      rooms: [
        { id: 'crypt', name: 'The Crypt', boundary: [], centroid: [0, 0], area: 1, isPathway: false },
      ],
      children: [
        {
          childType: 'door',
          id: 'oak',
          name: 'Hidden Pantry Door',
          visible: true,
          position: [1, 1],
          width: 1,
          isSecret: false,
          state: 'closed',
        },
        // Authored without a name, which is what the fallback is for.
        {
          childType: 'door',
          id: 'plain',
          visible: true,
          position: [2, 2],
          width: 1,
          isSecret: false,
          state: 'closed',
        },
      ],
    },
  ],
};

const entry = (over: Partial<LogEntry>): LogEntry => ({
  id: 'l1',
  at: 1,
  actor: 'Ilsa',
  action: 'opened',
  sceneId: SCENE,
  ...over,
});

const doorsWith = (...log: LogEntry[]): DoorsState => ({ byScene: {}, log });
const fogWith = (...log: LogEntry[]): FogState => ({ byScene: {}, log });

describe('tableLogLines', () => {
  it('names the actor and the door', () => {
    const [line] = tableLogLines(doorsWith(entry({ targetId: 'oak' })), undefined, MAP, SCENE);
    expect(line).toMatchObject({ who: 'Ilsa', text: 'opened Hidden Pantry Door' });
  });

  it('names the room a fog line is about', () => {
    const [line] = tableLogLines(
      undefined,
      fogWith(entry({ action: 'revealed-room', targetId: 'crypt' })),
      MAP,
      SCENE,
    );
    expect(line.text).toBe('revealed The Crypt');
  });

  // The seat's own map is the only naming authority: a target it does not hold is a target
  // it may not name, and the line still has to read as a sentence.
  it('falls back to a nameless sentence for a target this seat does not hold', () => {
    const [door] = tableLogLines(doorsWith(entry({ targetId: 'ghost' })), undefined, MAP, SCENE);
    expect(door.text).toBe('opened a door');
    const [unnamed] = tableLogLines(doorsWith(entry({ targetId: 'plain' })), undefined, MAP, SCENE);
    expect(unnamed.text).toBe('opened a door');
    const [room] = tableLogLines(
      undefined,
      fogWith(entry({ action: 'hid-room', targetId: 'nowhere' })),
      MAP,
      SCENE,
    );
    expect(room.text).toBe('hid a room');
  });

  it('merges both lanes oldest first, and only for the scene on the table', () => {
    const lines = tableLogLines(
      doorsWith(entry({ id: 'a', at: 20, targetId: 'oak', action: 'locked' })),
      fogWith(
        entry({ id: 'b', at: 10, action: 'revealed-all' }),
        entry({ id: 'c', at: 30, action: 'hid-all', sceneId: 'other-scene' }),
      ),
      MAP,
      SCENE,
    );
    expect(lines.map((l) => l.text)).toEqual(['revealed the whole map', 'locked Hidden Pantry Door']);
  });

  it('drops a line this build has no words for rather than half-printing it', () => {
    const lines = tableLogLines(
      doorsWith(entry({ action: 'teleported' as LogEntry['action'], targetId: 'oak' })),
      undefined,
      MAP,
      SCENE,
    );
    expect(lines).toEqual([]);
  });

  it('says nothing before a scene is on the table', () => {
    expect(tableLogLines(doorsWith(entry({ targetId: 'oak' })), undefined, MAP, null)).toEqual([]);
  });
});

describe('logSentence', () => {
  it('covers every action the modules can mint', () => {
    expect(logSentence('closed', 'Oak Door')).toBe('closed Oak Door');
    expect(logSentence('unlocked', 'Oak Door')).toBe('unlocked Oak Door');
    expect(logSentence('revealed-secret', 'Bookcase')).toBe('revealed the secret door Bookcase');
    expect(logSentence('revealed-secret', undefined)).toBe('revealed a secret door');
    expect(logSentence('hid-all', undefined)).toBe('hid the whole map');
    expect(logSentence('changed-fog', undefined)).toBe('changed what the map shows');
    expect(logSentence('reset-fog', undefined)).toBe('reset the fog');
  });
});
