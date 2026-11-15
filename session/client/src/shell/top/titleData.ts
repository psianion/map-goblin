import { vocabLabel } from '@dnd/core/src/shared/prep';
import { useStore } from '@dnd/core/src/store/store';
import { worldOf, type TriggersState } from '@dnd/mechanics/triggers';
import { useModuleState } from '../../session/store';

/** "Dusk": the time of day, as the Sky tab sets it. */
export function useWorldChip(): string {
  const triggers = useModuleState<TriggersState>('triggers');
  return vocabLabel(worldOf(triggers ?? { byScene: {} }).time);
}

/** The level this seat is looking at, "Level 1" from the ground up; null on a one-level map. */
export function useLevelLabel(): string | null {
  return useStore((s) => {
    if (s.levels.length < 2) return null;
    const i = s.levels.findIndex((l) => l.id === s.ui.activeLevelId);
    if (i < 0) return null;
    return s.levels[i]!.name || `Level ${s.levels.length - i}`;
  });
}
