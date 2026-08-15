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
export const WEATHERS = ['clear', 'rain', 'storm', 'fog', 'snow'] as const;
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
 * version: encounters/monsters arrive as version 2 without a map migration.
 */
export interface ScenePrep {
  version: 1;
  triggers: TriggerDef[];
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
 * Conditions anchor to an authored `ZoneChild` id, never to a room id — room ids
 * are derived from wall geometry and change on republish. A room-scoped trigger
 * uses a point zone; the server resolves point → containing room at prep-load
 * time and persists nothing about the result.
 */
export type TriggerCondition =
  | { kind: 'room-revealed'; zoneId: string }
  | { kind: 'enter-region'; zoneId: string }
  | { kind: 'within-radius'; zoneId: string };

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
  | { kind: 'environment'; time?: TimeOfDay; weather?: Weather };
