// The Lights UI's writes into the map, all through core's light commands: one undo step per
// gesture. Kept in one file so the card, the dock and the overlay share them.
import { undoManager } from '@/store/undoManager';
import type { LightChild } from '@/store/types';
import { setLightFields, toggleDarkness, type LightPatch } from '@dnd/core/src/store/lightCommands';

export { LIGHT_PRESETS, LIGHT_RADIUS_FT, presetDefaults, type LightPreset, type LightPresetId } from '@dnd/core/src/store/lightPresets';

/**
 * Land a light edit as one undo step. `before` is what the light held for the same keys
 * before a live preview wrote over them; without one, what it holds now.
 */
export function commitLightFields(label: string, id: string, after: Partial<LightChild>, before?: Partial<LightChild>): void {
  const cmd = setLightFields(id, after as LightPatch, before as LightPatch | undefined, label);
  if (cmd) undoManager.execute(cmd);
}

/** Turn a light into a darkness source or back, as one undo step. */
export function toggleLightDarkness(id: string): void {
  const cmd = toggleDarkness(id);
  if (cmd) undoManager.execute(cmd);
}
