// src/shared/prep.ts
// Scene prep — DM-authored trigger definitions that ride inside the map document
// (`SerializedMapData.prep`) and are extracted into the server's scene library on
// publish. Definitions only: execution state (fired flags, prompts, logs) lives in
// the server's triggers module and never appears in this schema, so nothing here
// can leak to players through a saved file they were never sent.

/** The six D&D ability scores, as roll/save keys. */
export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

/** The one authoritative member list — validation and UI option lists derive from it. */
export const TIMES = ['dawn', 'day', 'dusk', 'night'] as const;
export const WEATHERS = ['clear', 'overcast', 'rain', 'storm', 'fog', 'snow'] as const;
/**
 * How much light the scene itself gives (S3 P3 §1) — the *gate* normal vision is measured
 * against, not the tint (`mapSettings.ambientLight` stays the tint).
 *
 * Three words rather than a slider because only one distinction is mechanical: in `darkness`
 * a normal eye sees only what a light source covers, and in the other two the whole sweep
 * counts as lit. `dusk` differs from `daylight` in presentation alone.
 *
 * Deliberately independent of `TIMES`: the time of day is narration, and a torchlit crypt at
 * noon is the ordinary case. Coupling the two belongs to scene presets, not here.
 */
export const AMBIENTS = ['daylight', 'dusk', 'darkness'] as const;

export type TimeOfDay = (typeof TIMES)[number];
export type Weather = (typeof WEATHERS)[number];
export type AmbientLevel = (typeof AMBIENTS)[number];

/** Display label for a TIMES/WEATHERS/AMBIENTS value — the vocab is lowercase, the UI wants Title case. */
export const vocabLabel = (v: TimeOfDay | Weather | AmbientLevel): string =>
  v[0]!.toUpperCase() + v.slice(1);

/**
 * Everything a DM authors against a map beyond its geometry.
 *
 * `version` is the prep schema's own revision, independent of the map file
 * version. v2 added `notes` and the `encounter` action; v3 added `rooms`, the
 * room key. Older blobs (older files, older server rows) are upgraded in place
 * by `normalizePrep` at every boundary where stored prep is read — nothing ever
 * writes v1 or v2 again.
 */
export interface ScenePrep {
  version: 3;
  triggers: TriggerDef[];
  notes: RoomNote[];
  /** One key per keyed room, by `Room.id`. A room with no entry has no key. */
  rooms: RoomKey[];
}

/** The shape v2 wrote — accepted on read, never written. */
export interface ScenePrepV2 {
  version: 2;
  triggers: TriggerDef[];
  notes: RoomNote[];
}

/** The shape v1 wrote — accepted on read, never written. */
export interface ScenePrepV1 {
  version: 1;
  triggers: TriggerDef[];
}

/** Any prep a file or a stored row may hold. */
export type StoredScenePrep = ScenePrep | ScenePrepV2 | ScenePrepV1;

/** v1 → v2 → v3: each step adds its own empty collection and nothing else moves. */
export function normalizePrep(prep: StoredScenePrep): ScenePrep {
  if (prep.version === 3) return prep;
  const v2: ScenePrepV2 =
    prep.version === 2 ? prep : { version: 2, triggers: prep.triggers, notes: [] };
  return { version: 3, triggers: v2.triggers, notes: v2.notes, rooms: [] };
}

/**
 * The DM's key for one room: the classic module room entry. It lives in prep, so
 * it is stripped from every player-bound document by the same path as triggers
 * and notes. Nothing here reaches a player except what the DM deliberately
 * shares at the table (the read-aloud, through the Journal).
 *
 * `roomId` is the permanent `Room.id` (a uuid, or a detected room's frozen
 * hash): rooms are anchored now, so the id survives reshape, split (the keeper
 * half) and republish.
 */
export interface RoomKey {
  roomId: string;
  /** Boxed text. Share at the table sends exactly this to the player Journal. */
  readAloud: string;
  /** DM only, never shared. */
  notes: string;
  /** Spawn at the table runs the triggers module's encounter runner with the
   *  room's face as the spawn region. */
  encounter?: { name: string; monsters: MonsterEntry[] };
  treasure: string;
  traps: TrapEntry[];
  checks: CheckEntry[];
}

/** A room key's encounter block. */
export type RoomKeyEncounter = NonNullable<RoomKey['encounter']>;

/** A trap in a room key: the `trap` trigger action's fields, as a listed entry. */
export interface TrapEntry {
  id: string;
  text: string;
  save?: TrapSave;
  /** Dice formula, `NdM(+|-)K`. */
  damage?: string;
}

/** An ability check in a room key: the `ability-check` action's fields, as a listed entry. */
export interface CheckEntry {
  id: string;
  ability: Ability;
  dc: number;
  text: string;
}

/** A key with nothing written in it yet, which is what an editor starts from. */
export function emptyRoomKey(roomId: string): RoomKey {
  return { roomId, readAloud: '', notes: '', treasure: '', traps: [], checks: [] };
}

/**
 * How a room is named wherever the table speaks of it (the DM's prep list, the log, a Journal
 * card): `N · name`, or the bare name when the room has no number. Structural so the server,
 * the table and the bot can all pass whatever room record they hold.
 */
export function roomLabel(room: { name?: string; number?: number }): string {
  const name = room.name?.trim() ?? '';
  if (room.number === undefined) return name;
  return name ? `${room.number} · ${name}` : String(room.number);
}

/** The key for one room, or undefined when the room has none. */
export function roomKeyOf(
  prep: Pick<ScenePrep, 'rooms'> | null | undefined,
  roomId: string,
): RoomKey | undefined {
  return prep?.rooms.find((k) => k.roomId === roomId);
}

/**
 * A DM's room note: reference text anchored to a zone or a room, readable at the
 * table any time. Notes are prep: stripped from every player-bound document, same
 * as triggers.
 */
export interface RoomNote {
  id: string;
  /** Anchor `ZoneChild` id. Ignored (write '') when `roomId` is set. */
  zoneId: string;
  /**
   * Anchor room, by permanent `Room.id`. Set means the note belongs to that room
   * directly and the server resolves it without a zone probe.
   */
  roomId?: string;
  title: string;
  body: string;
  /** Keys into the map document's `customImages` — handout art, references. */
  imageKeys: string[];
  /**
   * Surface the note as a DM toast when its room is revealed (a `roomId` anchor
   * is that room; a point zone resolves to its containing room server-side,
   * like room-revealed triggers). Off = browse-only.
   */
  showOnReveal: boolean;
}

export interface TriggerDef {
  id: string;
  name: string;
  when: TriggerCondition;
  actions: TriggerAction[];
  /** Fire once and stay spent. (`fog.reset` re-arms room-revealed triggers only.) */
  once: boolean;
  enabled: boolean;
}

/**
 * What arms a trigger. Zone-anchored conditions name an authored `ZoneChild`; for
 * a point zone the server resolves the containing room at prep-load time and
 * persists nothing about the result. Room ids are permanent (rooms are anchored,
 * never re-detected), so a room-revealed trigger may also name its room outright:
 * the `roomId` form needs no zone at all.
 */
export type TriggerCondition =
  | { kind: 'room-revealed'; zoneId: string }
  | { kind: 'room-revealed'; roomId: string }
  | { kind: 'enter-region'; zoneId: string }
  | { kind: 'within-radius'; zoneId: string };

/** The zone a condition hangs on, or null for a room-anchored one. */
export function conditionZoneId(when: TriggerCondition): string | null {
  return 'zoneId' in when ? when.zoneId : null;
}

export interface TrapSave {
  ability: Ability;
  dc: number;
}

export type TriggerAction =
  /** Narration. `toPlayers: false` keeps it on the DM's trigger log. */
  | { kind: 'show-text'; text: string; toPlayers: boolean }
  /**
   * Toggle an authored `LightChild` by uuid. A missing id marks the trigger inert.
   * `toPlayers` (default true) narrates the change at the table like `show-text`;
   * off keeps the log line on the DM's record while the map still relights.
   */
  | { kind: 'light'; lightId: string; on: boolean; toPlayers?: boolean }
  /** `damage` is a dice formula, `NdM(+|-)K`. */
  | { kind: 'trap'; text: string; save?: TrapSave; damage?: string }
  | { kind: 'ability-check'; ability: Ability; dc: number; text: string }
  /** Saved and fired to the DM-only trigger log in v1; table UX is deferred. */
  | { kind: 'prompt'; prompt: 'initiative' | 'attack'; text?: string }
  | { kind: 'environment'; time?: TimeOfDay; weather?: Weather }
  /**
   * v2 — a prepped token setup. On fire: DM log narration; `spawn` places the
   * roster's tokens inside the anchor zone; `seedInitiative` adds them to the
   * initiative tracker with rolled HP (NPC HP stays DM-only via the tracker's
   * existing redaction).
   */
  | { kind: 'encounter'; name: string; monsters: MonsterEntry[]; spawn: boolean; seedInitiative: boolean };

export interface MonsterEntry {
  id: string;
  name: string;
  /** How many of this monster; spawned tokens are named `Name 1..N` when count > 1. */
  count: number;
  /** Dice formula (`NdM(+|-)K`), rolled per monster at fire time. Absent = no HP tracked. */
  hp?: string;
  /** Same vocabulary as the tokens module's TokenSize (core cannot import mechanics). */
  size?: 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
  /** Pack-sourced token art; absent = placeholder disc with the name's initial. */
  tokenRef?: { packId: string; assetId: string };
}
