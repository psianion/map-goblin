// src/shared/prep.ts
// Scene prep — DM-authored trigger definitions that ride inside the map document
// (`SerializedMapData.prep`) and are extracted into the server's scene library on
// publish. Definitions only: execution state (fired flags, prompts, logs) lives in
// the server's triggers module and never appears in this schema, so nothing here
// can leak to players through a saved file they were never sent.

/** The six D&D ability scores, as roll/save keys. */
export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
export type Weather = 'clear' | 'rain' | 'storm' | 'fog' | 'snow';

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
  /** Toggle an authored `LightChild` by uuid. A missing id marks the trigger inert. */
  | { kind: 'light'; lightId: string; on: boolean }
  /** `damage` is a dice formula, `NdM(+|-)K`. */
  | { kind: 'trap'; text: string; save?: TrapSave; damage?: string }
  | { kind: 'ability-check'; ability: Ability; dc: number; text: string }
  /** Saved and fired to the DM-only trigger log in v1; table UX is deferred. */
  | { kind: 'prompt'; prompt: 'initiative' | 'attack'; text?: string }
  | { kind: 'environment'; time?: TimeOfDay; weather?: Weather };
