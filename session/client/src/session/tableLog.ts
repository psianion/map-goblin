// §2.4.3 — the door and fog lines of the table log, turned into sentences.
//
// The server sends ids and a verb; the words are this side's. That split is the trust
// boundary doing its job rather than a style choice: which doors and rooms a seat may name
// is already decided by the map redactor, so the only list that can safely name a line's
// target is the one this seat is holding — and a target it does not hold reads as "a door",
// never as a name it was not given. A line about something a seat may not know about at all
// never arrives: `doorsModule.redact` and `fogModule.redact` cut the log with the same rule
// they cut the facts.

import type { DoorsState } from '@dnd/mechanics/doors';
import type { FogState } from '@dnd/mechanics/fog';
import type { LogAction, LogEntry } from '@dnd/mechanics/log';
import { serverDoors, serverRooms } from '../modules/fog/fog';

/** One rendered line, in the shape GameLog's presence lines already use. */
export interface TableLogLine {
  key: string;
  at: number;
  /** The actor, as the server named them. */
  who: string;
  /** What they did, ready to print after the actor. */
  text: string;
}

const DOOR_ACTIONS: readonly LogAction[] = [
  'opened',
  'closed',
  'locked',
  'unlocked',
  'revealed-secret',
];

/**
 * The sentence for a line whose target this seat can name, or could not.
 *
 * `undefined` is not a failure state to hide — a player who has not been handed a door's
 * name still gets to know the door moved, which is the half of the fact they can see across
 * the table anyway.
 */
export function logSentence(action: LogAction, name: string | undefined): string {
  switch (action) {
    case 'opened':
      return name ? `opened ${name}` : 'opened a door';
    case 'closed':
      return name ? `closed ${name}` : 'closed a door';
    case 'locked':
      return name ? `locked ${name}` : 'locked a door';
    case 'unlocked':
      return name ? `unlocked ${name}` : 'unlocked a door';
    case 'revealed-secret':
      return name ? `revealed the secret door ${name}` : 'revealed a secret door';
    case 'revealed-room':
      return name ? `revealed ${name}` : 'revealed a room';
    case 'hid-room':
      return name ? `hid ${name}` : 'hid a room';
    case 'revealed-all':
      return 'revealed the whole map';
    case 'hid-all':
      return 'hid the whole map';
    case 'changed-fog':
      return 'changed what the map shows';
    case 'reset-fog':
      return 'reset the fog';
    default:
      // Wire data, so an action this build has no words for is possible; a blank line is
      // dropped by the caller rather than printed as a half-sentence.
      return '';
  }
}

/** Untrusted wire data: the log is read, never computed on, so this only shapes it. */
const entriesOf = (state: { log?: LogEntry[] } | undefined, sceneId: string): LogEntry[] =>
  (Array.isArray(state?.log) ? state.log : []).filter((e) => e?.sceneId === sceneId);

/**
 * The door and fog lines for the scene on the table now.
 *
 * Scene-scoped because a name is: module state remembers every scene the campaign has
 * touched, and an id from a scene this client has no map for could only ever read as "a
 * door". The lines that matter are the ones about what everybody is looking at.
 */
export function tableLogLines(
  doors: DoorsState | undefined,
  fog: FogState | undefined,
  mapData: unknown,
  sceneId: string | null,
): TableLogLine[] {
  if (!sceneId) return [];
  const doorEntries = entriesOf(doors, sceneId);
  const fogEntries = entriesOf(fog, sceneId);
  if (doorEntries.length === 0 && fogEntries.length === 0) return [];

  const doorNames = new Map(
    serverDoors(mapData, doors, sceneId).map(({ door }) => [door.id, door.name?.trim() || '']),
  );
  const roomNames = new Map(serverRooms(mapData).map((room) => [room.id, room.name?.trim() || '']));

  return [...doorEntries, ...fogEntries]
    .map((e) => {
      const names = DOOR_ACTIONS.includes(e.action) ? doorNames : roomNames;
      return {
        key: e.id,
        at: typeof e.at === 'number' ? e.at : 0,
        who: e.actor || 'Someone',
        text: logSentence(e.action, (e.targetId && names.get(e.targetId)) || undefined),
      };
    })
    .filter((line) => line.text !== '')
    .sort((a, b) => a.at - b.at);
}
