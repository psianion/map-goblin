import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { toast } from 'sonner';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { handleShortcut } from './defaultShortcuts';
import type { DungeonLayer, ShapeChild } from '@/store/types';

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

function makeShape(): ShapeChild {
  return {
    id: 'shape-1',
    name: 'Polygon 1',
    childType: 'shape',
    visible: true,
    shapeType: 'polygon',
    contours: [[[0, 0], [1, 0], [1, 1]]],
    roughnessEnabled: false,
    roughnessAmplitude: 0,
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
  };
}

// ctrl+v used to build an AddChildCommand straight off ui.activeLayerId with
// no checks at all — a locked or hidden active layer, or one that no longer
// resolves, silently took the paste anyway (F5).
describe('ctrl+v paste — active-layer validation (F5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().setClipboard({ children: [makeShape()] });
  });

  it('pastes onto an unlocked, visible active layer', () => {
    handleShortcut('ctrl+v');
    expect(layer().children).toHaveLength(1);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('blocks the paste and warns when the active layer is locked', () => {
    useStore.getState().updateLayer(layer().id, { locked: true });
    handleShortcut('ctrl+v');
    expect(layer().children).toHaveLength(0);
    expect(toast.warning).toHaveBeenCalledWith('Layer is locked', expect.anything());
  });

  it('blocks the paste and warns when the active layer is hidden', () => {
    useStore.getState().updateLayer(layer().id, { visible: false });
    handleShortcut('ctrl+v');
    expect(layer().children).toHaveLength(0);
    expect(toast.warning).toHaveBeenCalledWith('Layer is hidden', expect.anything());
  });

  it('blocks the paste and warns when the active layer no longer resolves', () => {
    useStore.getState().setActiveLayerId('not-a-real-layer-id');
    handleShortcut('ctrl+v');
    expect(layer().children).toHaveLength(0);
    expect(toast.warning).toHaveBeenCalledWith('Select a layer first', expect.anything());
  });
});
