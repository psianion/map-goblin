import { vocabLabel } from '@dnd/core/src/shared/prep';
import { timeKeyAt, type TimeKey } from '@dnd/core/src/shared/world';
import { useStore } from '@dnd/core/src/store/store';
import { worldOf, type TriggersState } from '@dnd/mechanics/triggers';
import { useModuleState } from '../../session/store';

const TIME_WORD: Record<TimeKey, string> = { dawn: 'Dawn', morning: 'Morning', noon: 'Noon', evening: 'Dusk', night: 'Night' };

/** "Dusk · Rain": the hour's word and the weather, as the world tab sets them. */
export function useWorldChip(): string {
  const triggers = useModuleState<TriggersState>('triggers');
  const mapWeather = useStore((s) => s.mapSettings.weather);
  const world = worldOf(triggers ?? { byScene: {} });
  const weather = world.weather ?? mapWeather ?? 'clear';
  return `${TIME_WORD[timeKeyAt(world.clock).key]} · ${vocabLabel(weather)}`;
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
