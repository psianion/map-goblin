import { useStore } from '@dnd/core/src/store/store';
import { defaultCrossingKinds } from '@dnd/core/src/shared/crossingKinds';
import { sceneCrossings, type CrossingsState } from '@dnd/mechanics/crossings';
import { Fold, SwitchRow } from '@dnd/ui';
import { useModuleState, useSessionStore } from '../../session/store';

/** Which crossing kinds refuse a player's move, switched live (`crossings.set-blocks`). */
export function CrossingsFold() {
  const kinds = useStore((s) => s.mapSettings.crossingKinds) ?? defaultCrossingKinds();
  const state = useModuleState<CrossingsState>('crossings');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const live = sceneCrossings(state, sceneId);
  return (
    <Fold title="Crossings" className="w-full">
      <p className="py-1 text-xs text-text-3">A kind switched on refuses a player's move across it. Right-click a cliff to change its kind.</p>
      {kinds.map((k) => (
        <SwitchRow
          key={k.id}
          label={`${k.name} refuses moves`}
          className="w-full"
          checked={live.blocks[k.id] ?? k.blocks}
          onCheckedChange={(blocks) => useSessionStore.getState().sendCommand('crossings', 'set-blocks', { kindId: k.id, blocks })}
        />
      ))}
    </Fold>
  );
}
