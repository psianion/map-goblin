import { describe, expect, it } from 'vitest';
import { normalizePrep, type ScenePrepV1, type ScenePrepV2, type StoredScenePrep, type TriggerDef } from './prep';

const trigger = (actions: unknown[], id = 't1'): TriggerDef =>
  ({ id, name: id, when: { kind: 'room-revealed', zoneId: 'z1' }, once: false, enabled: true, actions }) as unknown as TriggerDef;

const text = { kind: 'show-text', text: 'hello', toPlayers: true };
const environment = { kind: 'environment', time: 'night', weather: 'storm' };

describe('normalizePrep: the removed zone Environment action', () => {
  it('drops a saved environment action and keeps the others, in order', () => {
    const prep = { version: 3, triggers: [trigger([text, environment, text])], notes: [], rooms: [] } as StoredScenePrep;
    const out = normalizePrep(prep);
    expect(out.triggers[0].actions).toEqual([text, text]);
  });

  it('leaves a trigger that held only that action in place, with no actions', () => {
    const out = normalizePrep({ version: 3, triggers: [trigger([environment])], notes: [], rooms: [] });
    expect(out.triggers).toHaveLength(1);
    expect(out.triggers[0].actions).toEqual([]);
  });

  it('drops it from older prep versions while upgrading them', () => {
    const v2: ScenePrepV2 = { version: 2, triggers: [trigger([environment, text])], notes: [] };
    const v1: ScenePrepV1 = { version: 1, triggers: [trigger([environment, text])] };
    expect(normalizePrep(v2)).toMatchObject({ version: 3, rooms: [], triggers: [{ actions: [text] }] });
    expect(normalizePrep(v1)).toMatchObject({ version: 3, notes: [], rooms: [], triggers: [{ actions: [text] }] });
  });

  it('hands back the same prep when nothing needed dropping', () => {
    const prep = { version: 3, triggers: [trigger([text])], notes: [], rooms: [] } as StoredScenePrep;
    expect(normalizePrep(prep)).toBe(prep);
  });
});
