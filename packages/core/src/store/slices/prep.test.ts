import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import type { RoomNote, TriggerDef } from '../../shared/prep';

const TRIGGER: TriggerDef = {
  id: 't1',
  name: 'Trap',
  when: { kind: 'enter-region', zoneId: 'zone-1' },
  actions: [{ kind: 'show-text', text: 'A dart flies out!', toPlayers: true }],
  once: true,
  enabled: true,
};

const NOTE: RoomNote = {
  id: 'n1',
  zoneId: 'zone-1',
  title: 'Kitchens',
  body: 'The cook is a spy.',
  imageKeys: [],
  showOnReveal: false,
};

describe('prep slice', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('starts with prep null', () => {
    expect(useStore.getState().prep).toBeNull();
  });

  it('upsertTrigger lazily creates {version: 2, triggers: [], notes: []} then adds the trigger', () => {
    useStore.getState().upsertTrigger(TRIGGER);
    expect(useStore.getState().prep).toEqual({ version: 2, triggers: [TRIGGER], notes: [] });
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
    expect(useStore.getState().prep).toEqual({ version: 2, triggers: [], notes: [] });
  });

  it('removeTrigger on an unauthored prep is a no-op', () => {
    useStore.getState().removeTrigger('no-such-id');
    expect(useStore.getState().prep).toBeNull();
  });

  it('upsertNote lazily creates prep, updates in place by id, and removeNote keeps the block', () => {
    useStore.getState().upsertNote(NOTE);
    expect(useStore.getState().prep).toEqual({ version: 2, triggers: [], notes: [NOTE] });

    const updated: RoomNote = { ...NOTE, body: 'The cook is TWO spies.', showOnReveal: true };
    useStore.getState().upsertNote(updated);
    expect(useStore.getState().prep?.notes).toEqual([updated]);

    useStore.getState().removeNote(NOTE.id);
    expect(useStore.getState().prep).toEqual({ version: 2, triggers: [], notes: [] });
  });

  it('removeNote on an unauthored prep is a no-op', () => {
    useStore.getState().removeNote('no-such-id');
    expect(useStore.getState().prep).toBeNull();
  });
});
