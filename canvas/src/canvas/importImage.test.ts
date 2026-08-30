import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/toast', () => ({
  notify: {
    subtle: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

import { notify } from '@/lib/toast';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';
import { handleImageImport } from './importImage';

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

function pngFile(): File {
  return new File(['not-really-a-png'], 'note.png', { type: 'image/png' });
}

// The guard refuses before the engine is ever touched — a bare stub proves it.
const engine = {} as RenderEngine;

// Drag-and-drop, clipboard paste and the Ctrl+I picker all funnel through
// handleImageImport, so this one guard is what stands between all three and a
// locked layer.
describe('handleImageImport — layer lock', () => {
  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    vi.clearAllMocks();
    useStore.getState().setActiveLayerId(layer().id);
  });

  it('refuses on a locked layer', async () => {
    useStore.getState().updateLayer(layer().id, { locked: true });

    await handleImageImport(pngFile(), engine);

    expect(notify.warning).toHaveBeenCalledWith('Layer is locked');
    expect(layer().children).toHaveLength(0);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('refuses on a hidden layer', async () => {
    useStore.getState().updateLayer(layer().id, { visible: false });

    await handleImageImport(pngFile(), engine);

    expect(notify.warning).toHaveBeenCalledWith('Layer is hidden');
    expect(layer().children).toHaveLength(0);
    expect(undoManager.canUndo()).toBe(false);
  });
});
