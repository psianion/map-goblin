import { useStore } from '@dnd/core/src/store/store';
import { mountWhenEngineReady, worldPointOf } from '../../renderer/overlayLayer';
import { useSessionStore } from '../../session/store';
import { crossingTargetAt } from './crossings';
import { useCrossingMenu } from './menu';

/** The DM's right-click over a raised edge opens the crossing picker there. */
export function mountCrossingInput(): () => void {
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
