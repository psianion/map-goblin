import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '@/store/store';
import type { AssetChild, DungeonLayer } from '@/store/types';
import { hintText } from './roomModel';
import { ERASE_HINT, SCATTER_HINT, STAMP_HINT, propHintFor, strokeText } from './propModel';

function dungeon(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('no dungeon layer');
  return l;
}

function prop(id: string, over: Partial<AssetChild> = {}): AssetChild {
  return {
    id,
    name: id,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'p:barrel',
    position: { x: 2, y: 2 },
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
    ...over,
  };
}

beforeEach(() => {
  useStore.getState().resetToDefault();
  useStore.getState().setActiveTool('select');
});

describe('propHintFor: the tool in hand', () => {
  it('names every stamp key, plain wheel rotating and Ctrl+wheel zooming', () => {
    useStore.getState().setActiveTool('scatterBrush');
    useStore.getState().updateScatterBrushSettings({ stampMode: true });
    const h = propHintFor(useStore.getState());
    expect(h).toBe(STAMP_HINT);
    const text = hintText(STAMP_HINT);
    for (const bit of ['click to place', 'Wheel', 'rotate 15°', 'Alt', 'Shift', 'right-click 90°', 'F', 'mirror', 'Ctrl', '+wheel zoom', 'Esc']) {
      expect(text).toContain(bit);
    }
  });

  it('says scatter paints with one undo, and while a stroke runs counts what it placed and skipped', () => {
    useStore.getState().setActiveTool('scatterBrush');
    useStore.getState().updateScatterBrushSettings({ stampMode: false });
    expect(propHintFor(useStore.getState())).toBe(SCATTER_HINT);
    const live = propHintFor(useStore.getState(), { placed: 12, skippedOverlap: 3, skippedFloor: 1, noFloor: false });
    expect(live && hintText(live)).toContain('12 placed · 4 skipped (overlap 3, off floor 1)');
  });

  it('says when a layer has no floor to stay on', () => {
    useStore.getState().setActiveTool('scatterBrush');
    useStore.getState().updateScatterBrushSettings({ stampMode: false });
    const h = propHintFor(useStore.getState(), { placed: 3, skippedOverlap: 0, skippedFloor: 0, noFloor: true });
    expect(h && hintText(h)).toContain('No floor on this layer: Stay on floors is off');
  });

  it('says what erase spares', () => {
    useStore.getState().setActiveTool('scatterBrush');
    useStore.setState((s) => {
      s.tools.eraseMode = true;
    });
    expect(propHintFor(useStore.getState())).toBe(ERASE_HINT);
    expect(hintText(ERASE_HINT)).toContain('images and cave rock are kept');
  });

  it('counts a stroke with nothing skipped plainly', () => {
    expect(strokeText({ placed: 5, skippedOverlap: 0, skippedFloor: 0, noFloor: false })).toBe('5 placed');
  });
});

describe('propHintFor: the selection', () => {
  it('gives a selected prop the order, mirror and delete keys, and a locked one the way to unlock', () => {
    useStore.getState().addChild(dungeon().id, prop('barrel 2'));
    useStore.getState().setSelectedIds(['barrel 2']);
    const h = propHintFor(useStore.getState());
    expect(h?.label).toBe('barrel 2');
    expect(h && hintText(h)).toContain('forward');
    expect(h && hintText(h)).toContain('mirror');

    useStore.getState().updateChild(dungeon().id, 'barrel 2', { locked: true } as Partial<AssetChild>);
    const locked = propHintFor(useStore.getState());
    expect(locked && hintText(locked)).toBe('Locked: right-click to unlock');
  });

  it('gives several props and a whole group their own lines', () => {
    const id = dungeon().id;
    useStore.getState().addChild(id, prop('a', { groupId: 'g' }));
    useStore.getState().addChild(id, prop('b', { groupId: 'g' }));
    useStore.getState().addChild(id, prop('c'));
    useStore.setState((s) => {
      (s.layers.find((l) => l.id === id) as DungeonLayer).groups = [{ id: 'g', name: 'Supply corner' }];
    });
    useStore.getState().setSelectedIds(['a', 'c']);
    expect(propHintFor(useStore.getState())?.label).toBe('2 props');
    useStore.getState().setSelectedIds(['a', 'b']);
    expect(propHintFor(useStore.getState())?.label).toBe('Supply corner · 2 props');
  });

  it('is null with nothing selected and the select tool in hand', () => {
    expect(propHintFor(useStore.getState())).toBeNull();
  });
});
