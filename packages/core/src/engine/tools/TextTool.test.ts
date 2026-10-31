import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import type { DoorChild, DungeonLayer, TextChild } from '../../store/types';
import {
  LABEL_MISS_MS,
  LABEL_SIZE_RANGE,
  TextTool,
  isFreshLabel,
  labelMiss,
  removeFreshLabel,
  subscribeLabelMiss,
  takeLabelFocus,
} from './TextTool';

const layer = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const labels = () => layer().children.filter((c): c is TextChild => c.childType === 'text');

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
  const l = layer();
  useStore.getState().setActiveLayerId(l.id);
});

describe('TextTool', () => {
  it('lands the label selected, as one undo step, and asks its card for focus once', () => {
    new TextTool().onPointerDown({ x: 2, y: 3 });
    const [c] = labels();
    expect(useStore.getState().selection.selectedIds).toEqual([c.id]);
    expect(undoManager.size()).toBe(1);
    expect(takeLabelFocus(c.id)).toBe(true);
    expect(takeLabelFocus(c.id)).toBe(false);
    // Undo hands back the selection from before; redo brings the label back selected.
    undoManager.undo();
    expect(useStore.getState().selection.selectedIds).toEqual([]);
    undoManager.redo();
    expect(useStore.getState().selection.selectedIds).toEqual([c.id]);
  });

  it('builds the label from the picked style, with the dock’s size and colour over it', () => {
    useStore.getState().updateToolSettings({ label: { style: 'callout', fontSize: 1.4, color: '#999999' } });
    new TextTool().onPointerDown({ x: 2, y: 3 });
    expect(labels()[0]).toMatchObject({ text: 'Callout', style: 'callout', backdrop: 'halo', align: 'left', fontSize: 1.4, color: '#999999' });
    useStore.getState().updateToolSettings({ label: { fontSize: 0.8, color: null } });
    new TextTool().onPointerDown({ x: 4, y: 3 });
    expect(labels()[1]).toMatchObject({ text: 'Label', fontSize: 0.8, color: layer().style.wallColor });
  });

  it('Esc takes back only the label just placed, untouched, while its place is the top step', () => {
    const tool = new TextTool();
    tool.onPointerDown({ x: 2, y: 3 });
    const first = labels()[0];
    tool.onPointerDown({ x: 6, y: 3 });
    const second = labels()[1];
    expect(isFreshLabel(first.id)).toBe(false);
    expect(removeFreshLabel(first)).toBe(false);
    // Typed into: not the placeholder any more.
    expect(removeFreshLabel({ ...second, text: 'Beware' })).toBe(false);
    expect(removeFreshLabel(second)).toBe(true);
    expect(labels().map((c) => c.id)).toEqual([first.id]);
    expect(undoManager.size()).toBe(1);
  });

  it('a binding style with nothing to follow places nothing and says why for 2 s', () => {
    vi.useFakeTimers();
    try {
      const seen: (string | null)[] = [];
      const stop = subscribeLabelMiss(() => seen.push(labelMiss()));
      useStore.getState().updateToolSettings({ label: { fontSize: 0.4, color: null, style: 'door-tag' } });
      new TextTool().onPointerDown({ x: 50, y: 50 });
      expect(labels()).toHaveLength(0);
      expect(undoManager.size()).toBe(0);
      expect(labelMiss()).toBe('Click on a door to tag it');
      useStore.getState().updateToolSettings({ label: { fontSize: 0.8, color: null, style: 'room-name' } });
      new TextTool().onPointerDown({ x: 50, y: 50 });
      expect(labelMiss()).toBe('Click inside a room to name it');
      vi.advanceTimersByTime(LABEL_MISS_MS - 1);
      expect(labelMiss()).toBe('Click inside a room to name it');
      vi.advanceTimersByTime(1);
      expect(labelMiss()).toBeNull();
      expect(seen).toEqual(['Click on a door to tag it', 'Click inside a room to name it', null]);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a Door tag 1.4 sq from a door binds to it', () => {
    const l = layer();
    useStore.getState().addChild(l.id, {
      id: 'd1', name: 'Gate', childType: 'door', visible: true, wallId: '', position: [10, 10], angle: 0, width: 1,
      style: 'single', state: 'closed', isSecret: false,
    } as DoorChild);
    useStore.getState().updateToolSettings({ label: { fontSize: 0.4, color: null, style: 'door-tag' } });
    new TextTool().onPointerDown({ x: 11.4, y: 10 });
    expect(labels()[0]).toMatchObject({ text: 'Gate', bound: { kind: 'door', id: 'd1' } });
    expect(labelMiss()).toBeNull();
  });

  it('offers one size range, 0.2 to 6, for the dock and the card', () => {
    expect(LABEL_SIZE_RANGE).toEqual({ min: 0.2, max: 6, step: 0.1 });
  });
});
