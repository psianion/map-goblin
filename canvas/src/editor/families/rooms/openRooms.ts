// The Publish dialog's Suggest rooms: the Rooms tools come up (Outline in hand, so the
// panel with Suggest shows) and Suggest runs on the layer being drawn, or on the first map
// layer of the level that has floor when the active one is not a map layer.

import { useStore } from '@/store/store';
import type { DungeonLayer } from '@/store/types';
import { pickTool } from '@/editor/surfaces/hooks';
import { useShell } from '@/editor/shell/shellStore';
import { activeDungeon, suggestOnActiveLayer } from '@/editor/models/roomActions';
import { outlineTool } from './tools';

export function openRoomsAndSuggest(): void {
  const s = useStore.getState();
  if (!activeDungeon(s)) {
    const level = s.ui.activeLevelId;
    const withFloor = s.layers.find(
      (l): l is DungeonLayer => l.type === 'dungeon' && (!level || !l.levelId || l.levelId === level) && l.children.some((c) => c.childType === 'shape'),
    );
    if (withFloor) s.setActiveLayerId(withFloor.id);
  }
  useShell.getState().setFlyout(null);
  pickTool(outlineTool);
  suggestOnActiveLayer();
}
