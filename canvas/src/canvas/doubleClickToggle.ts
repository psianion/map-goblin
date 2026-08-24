import { hitTestAllLayers } from '@dnd/core/src/engine/hitTest';
import { UpdateChildCommand } from '@dnd/core/src/store/commands';
import { undoManager } from '@/store/undoManager';
import { useStore } from '@/store/store';
import type { Point } from '../types/geometry';
import type { DungeonLayer } from '@/store/types';

/**
 * Double-click over a fixture flips it: a light on or off, a door open or shut. Returns true
 * when the click belonged to one, so the caller stops there.
 *
 * Stopping matters as much as the flip. Double-click used to fall straight through to the node
 * editors, so double-clicking a light dropped the user into shape node editing — which dims the
 * rest of the view and suspends the very lighting preview they were double-clicking to check.
 *
 * The lock is already honoured upstream: `hitTestAllLayers` skips locked (and hidden) layers
 * outright, so a fixture on one never reaches this and the click falls through unchanged.
 */
export function toggleFixtureAt(world: Point, zoom: number): boolean {
  const state = useStore.getState();
  const layers = state.layers.filter((l): l is DungeonLayer => l.type === 'dungeon');
  const hit = hitTestAllLayers(layers, [world.x, world.y], { zoom });
  if (!hit) return false;
  const { child, layerId } = hit;

  if (child.childType === 'light') {
    // The authored `visible` flag is the switch: `LightManager` skips a hidden light, and the
    // shared `LightingRenderer` swaps its mark to the struck-out bulb.
    undoManager.execute(
      new UpdateChildCommand(
        'Toggle light',
        layerId,
        child.id,
        { visible: child.visible },
        { visible: !child.visible },
      ),
    );
    return true;
  }

  if (child.childType !== 'door') return false;
  // An archway has nothing to swing and a locked door needs a key, not a double-click — the
  // table refuses both. Inert, but still claimed: a door is not a shape to go editing nodes on.
  if (child.style === 'archway' || child.state === 'locked') return true;
  undoManager.execute(
    new UpdateChildCommand(
      'Toggle door',
      layerId,
      child.id,
      { state: child.state },
      { state: child.state === 'open' ? 'closed' : 'open' },
    ),
  );
  return true;
}
