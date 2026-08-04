import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface FakeText {
  label: string;
  zIndex: number;
  visible: boolean;
}

class MockContainer {
  children: FakeText[] = [];
  addChild(c: FakeText): FakeText {
    this.children.push(c);
    return c;
  }
  removeChild(c: FakeText): FakeText {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    return c;
  }
}

// Mock classes live inside the factory — vi.mock is hoisted above any
// top-level class declaration it would otherwise close over (TDZ).
vi.mock('pixi.js', () => {
  class MockTextStyle {
    fill: string;
    constructor(opts: { fill: string }) { this.fill = opts.fill; }
  }
  class MockText {
    text: string;
    style: MockTextStyle;
    position = { x: 0, y: 0, set(x: number, y: number): void { this.x = x; this.y = y; } };
    rotation = 0;
    visible = true;
    scale = { x: 1, y: 1, set(x: number, y?: number): void { this.x = x; this.y = y ?? x; } };
    anchor = { set: (): void => {} };
    label = '';
    zIndex = 0;
    constructor(opts: { text: string; style: MockTextStyle }) {
      this.text = opts.text;
      this.style = opts.style;
    }
    destroy(): void {}
  }
  return { Text: MockText, TextStyle: MockTextStyle };
});
vi.mock('./sceneGraph', () => ({ getLayerEntry: vi.fn() }));

import { subscribeToTextLabels } from './subscribeToTextLabels';
import { getLayerEntry } from './sceneGraph';
import { useStore } from '../store/store';
import type { DungeonLayer } from '../store/types';
import type { TextChild } from '../shared/types';

function label(id: string, text = id): TextChild {
  return {
    id,
    name: id,
    childType: 'text',
    visible: true,
    text,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: 1,
    fontSize: 1,
    color: '#ffffff',
    width: 1,
    height: 1,
  };
}

describe('subscribeToTextLabels', () => {
  let layerId: string;
  let labels: MockContainer;
  let unsub: (() => void) | null = null;

  beforeEach(() => {
    useStore.getState().resetToDefault();
    const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    layerId = layer.id;
    labels = new MockContainer();
    // All seven sublayers, not just the one this file cares about — a
    // regression that reads the wrong sublayer should fail loudly (undefined
    // access) instead of silently passing because the fake only had `labels`.
    vi.mocked(getLayerEntry).mockReturnValue({
      sublayers: {
        water: new MockContainer(),
        floor: new MockContainer(),
        grid: new MockContainer(),
        walls: new MockContainer(),
        doors: new MockContainer(),
        objects: new MockContainer(),
        labels,
      },
    } as never);
  });

  afterEach(() => {
    unsub?.();
    unsub = null;
  });

  it('lands labels in the labels sublayer', () => {
    useStore.getState().addChild(layerId, label('t1'));
    unsub = subscribeToTextLabels();
    expect(labels.children.length).toBe(1);
    expect(labels.children[0].label).toBe('label-t1');
  });

  it('assigns zIndex to match position in layer.children', () => {
    useStore.getState().addChild(layerId, label('t1'));
    useStore.getState().addChild(layerId, label('t2'));
    unsub = subscribeToTextLabels();
    expect(labels.children[0].zIndex).toBe(0);
    expect(labels.children[1].zIndex).toBe(1);
  });

  it('reorderChild updates zIndex to match the new order', () => {
    useStore.getState().addChild(layerId, label('t1'));
    useStore.getState().addChild(layerId, label('t2'));
    unsub = subscribeToTextLabels();

    useStore.getState().reorderChild(layerId, 0, 1); // t1 now draws after t2

    const t1 = labels.children.find((l) => l.label === 'label-t1')!;
    const t2 = labels.children.find((l) => l.label === 'label-t2')!;
    expect(t2.zIndex).toBe(0);
    expect(t1.zIndex).toBe(1);
  });
});
