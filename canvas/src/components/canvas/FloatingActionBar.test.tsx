import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { AssetChild, DungeonLayer } from '@/store/types';
import { FloatingActionBar } from './FloatingActionBar';

vi.mock('@/engine/engineSingleton', () => ({ getEngineSingleton: () => null }));

function layer(): DungeonLayer {
  return useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
}

function prop(id: string, patch: Partial<AssetChild> = {}): AssetChild {
  return {
    id,
    name: id,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'crate',
    position: { x: 2, y: 2 },
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
    ...patch,
  };
}

// The bar is placed (and shown) per frame against the engine, which these tests leave out.
const bar = () => document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Selection actions"]')!;
const buttons = () => [...bar().querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));

describe('FloatingActionBar', () => {
  beforeEach(() => {
    cleanup();
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().setActiveTool('select');
  });
  afterEach(cleanup);

  it('offers a locked prop only Unlock, which unlocks it', () => {
    useStore.getState().addChild(layer().id, prop('rug', { locked: true }));
    useStore.getState().setSelectedIds(['rug']);
    render(<FloatingActionBar belowChrome />);
    expect(buttons()).toEqual(['Unlock']);
    fireEvent.click(bar().querySelector('button[aria-label="Unlock"]')!);
    expect((layer().children[0] as AssetChild).locked).toBe(false);
  });

  it('keeps the edit verbs for an unlocked prop', () => {
    useStore.getState().addChild(layer().id, prop('crate'));
    useStore.getState().setSelectedIds(['crate']);
    render(<FloatingActionBar belowChrome />);
    expect(buttons()).toEqual(
      expect.arrayContaining(['Flip horizontal', 'Rotate 90°', 'Duplicate', 'Lock', 'Delete']),
    );
    expect(buttons()).not.toContain('Unlock');
  });
});
