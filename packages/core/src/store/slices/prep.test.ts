import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import type { TriggerDef } from '../../shared/prep';

const TRIGGER: TriggerDef = {
  id: 't1',
  name: 'Trap',
  when: { kind: 'enter-region', zoneId: 'zone-1' },
  actions: [{ kind: 'show-text', text: 'A dart flies out!', toPlayers: true }],
  once: true,
  enabled: true,
};

describe('prep slice', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('starts with prep null', () => {
    expect(useStore.getState().prep).toBeNull();
  });

  it('upsertTrigger lazily creates {version: 1, triggers: []} then adds the trigger', () => {
    useStore.getState().upsertTrigger(TRIGGER);
    expect(useStore.getState().prep).toEqual({ version: 1, triggers: [TRIGGER] });
  });

  it('upsertTrigger updates an existing trigger in place by id, rather than appending', () => {
    useStore.getState().upsertTrigger(TRIGGER);
    const updated: TriggerDef = { ...TRIGGER, name: 'Bigger Trap', enabled: false };
    useStore.getState().upsertTrigger(updated);
    const prep = useStore.getState().prep;
    expect(prep?.triggers).toHaveLength(1);
    expect(prep?.triggers[0]).toEqual(updated);
  });

  it('removeTrigger drops the trigger but keeps the (now empty) prep block', () => {
    useStore.getState().upsertTrigger(TRIGGER);
    useStore.getState().removeTrigger(TRIGGER.id);
    // Explicit empty list, not null: an empty prep clears the server's stored
    // prep on republish, while absent (null) leaves it untouched.
    expect(useStore.getState().prep).toEqual({ version: 1, triggers: [] });
  });

  it('removeTrigger on an unauthored prep is a no-op', () => {
    useStore.getState().removeTrigger('no-such-id');
    expect(useStore.getState().prep).toBeNull();
  });
});
