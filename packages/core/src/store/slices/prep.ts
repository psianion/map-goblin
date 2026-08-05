import type { StateCreator } from 'zustand';
import type { MapBuilderStore, TriggerDef } from '../types';

export interface PrepActions {
  upsertTrigger: (trigger: TriggerDef) => void;
  removeTrigger: (triggerId: string) => void;
}

// ponytail: prep edits sit outside the Command/undo stack — a form edit in the
// Triggers panel is not a canvas gesture. Wrap these in Commands if a DM ever
// asks for ctrl-Z on trigger authoring.
export const createPrepSlice: StateCreator<
  MapBuilderStore,
  [['zustand/immer', never]],
  [],
  PrepActions
> = (set) => ({
  upsertTrigger: (trigger) =>
    set((state) => {
      if (!state.prep) state.prep = { version: 1, triggers: [] };
      const i = state.prep.triggers.findIndex((t) => t.id === trigger.id);
      if (i === -1) state.prep.triggers.push(trigger);
      else state.prep.triggers[i] = trigger;
    }),
  removeTrigger: (triggerId) =>
    set((state) => {
      if (!state.prep) return;
      state.prep.triggers = state.prep.triggers.filter((t) => t.id !== triggerId);
      // Keep the (now empty) prep block: an explicit empty list clears the
      // server's stored prep on republish, absent leaves it untouched.
    }),
});
