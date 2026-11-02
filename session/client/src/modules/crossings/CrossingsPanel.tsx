// The DM's Crossings popover (plan §7): which kinds refuse a player's move, switched live
// mid-session (`crossings.set-blocks`), and the hook that opens the on-map picker on a
// right-click over a cliff, a slope or an opening.

import { useStore } from '@dnd/core/src/store/store';
import { defaultCrossingKinds } from '@dnd/core/src/shared/crossingKinds';
import { sceneCrossings, type CrossingsState } from '@dnd/mechanics/crossings';
import { mountWhenEngineReady, worldPointOf } from '../../renderer/overlayLayer';
import { registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';
import { crossingTargetAt } from './crossings';
import { useCrossingMenu } from './menu';

export function CrossingsPanel() {
  const kinds = useStore((s) => s.mapSettings.crossingKinds) ?? defaultCrossingKinds();
  const state = useModuleState<CrossingsState>('crossings');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const live = sceneCrossings(state, sceneId);
  const setBlocks = (kindId: string, blocks: boolean) =>
    useSessionStore.getState().sendCommand('crossings', 'set-blocks', { kindId, blocks });

  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="crossings-panel">
      <p className="text-text-muted">
        A kind switched on refuses a player&apos;s move across it. Right-click a cliff or an opening to change its kind.
      </p>
      <ul className="flex flex-col gap-1">
        {kinds.map((k) => {
          const blocks = live.blocks[k.id] ?? k.blocks;
          return (
            <li key={k.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-text-primary">{k.name}</span>
              {k.note && <span className="min-w-0 flex-1 truncate text-text-muted">{k.note}</span>}
              <button
                type="button"
                role="switch"
                aria-checked={blocks}
                aria-label={`${k.name} refuses moves`}
                data-testid={`crossing-blocks-${k.id}`}
                onClick={() => setBlocks(k.id, !blocks)}
                className={`h-4 w-7 shrink-0 rounded-full border ${
                  blocks ? 'border-accent bg-accent' : 'border-border-default bg-surface-0'
                }`}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The DM's right-click over a raised edge or an opening opens the crossing picker there. */
function mountCrossingInput(): () => void {
  return mountWhenEngineReady((engine) => {
    const canvas = engine.canvas();
    const onContext = (e: MouseEvent) => {
      if (useSessionStore.getState().you?.role !== 'dm') return;
      const point = worldPointOf(engine, e as PointerEvent);
      if (!point) return;
      const target = crossingTargetAt(useStore.getState(), undefined, point.x, point.y);
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      useCrossingMenu.getState().open(target);
    };
    canvas.addEventListener('contextmenu', onContext);
    return () => canvas.removeEventListener('contextmenu', onContext);
  });
}

registerPanel({
  id: 'crossings',
  title: 'Crossings',
  icon: 'lock',
  key: 'X',
  group: 'play',
  roles: ['dm'],
  order: 32,
  component: CrossingsPanel,
  mount: mountCrossingInput,
});
