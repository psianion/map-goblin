import type { StateCreator } from 'zustand';
import type { MapBuilderStore, RoomNote, TriggerDef } from '../types';

export interface PrepActions {
  upsertTrigger: (trigger: TriggerDef) => void;
  removeTrigger: (triggerId: string) => void;
  upsertNote: (note: RoomNote) => void;
  removeNote: (noteId: string) => void;
}

const emptyPrep = () => ({ version: 2 as const, triggers: [], notes: [] });

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
      if (!state.prep) state.prep = emptyPrep();
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
  upsertNote: (note) =>
    set((state) => {
      if (!state.prep) state.prep = emptyPrep();
      const i = state.prep.notes.findIndex((n) => n.id === note.id);
      if (i === -1) state.prep.notes.push(note);
      else state.prep.notes[i] = note;
    }),
  removeNote: (noteId) =>
    set((state) => {
      if (!state.prep) return;
      state.prep.notes = state.prep.notes.filter((n) => n.id !== noteId);
    }),
});
