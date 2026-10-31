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
    fontWeight?: string;
    align?: string;
    stroke?: { color: string; width: number };
    constructor(opts: { fill: string; fontWeight?: string; align?: string; stroke?: { color: string; width: number } }) {
      this.fill = opts.fill;
      this.fontWeight = opts.fontWeight;
      this.align = opts.align;
      this.stroke = opts.stroke;
    }
  }
  class MockGraphics {
    position = { x: 0, y: 0, set(x: number, y: number): void { this.x = x; this.y = y; } };
    scale = { x: 1, y: 1, set(x: number, y?: number): void { this.x = x; this.y = y ?? x; } };
    rotation = 0;
    visible = true;
    label = '';
    zIndex = 0;
    rects: number[][] = [];
    fills: { color: string; alpha: number }[] = [];
    clear(): this { this.rects = []; this.fills = []; return this; }
    roundRect(...a: number[]): this { this.rects.push(a); return this; }
    fill(f: { color: string; alpha: number }): this { this.fills.push(f); return this; }
    stroke(): this { return this; }
    destroy(): void {}
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
  return { Text: MockText, TextStyle: MockTextStyle, Graphics: MockGraphics };
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

  type Styled = FakeText & { style: { fontWeight?: string; align?: string; stroke?: { color: string; width: number } } };
  type Plate = FakeText & { rects: number[][]; fills: { color: string; alpha: number }[] };
  const text = (id: string) => labels.children.find((l) => l.label === `label-${id}`) as Styled;
  const pill = (id: string) => labels.children.find((l) => l.label === `label-pill-${id}`) as Plate | undefined;

  it('draws a bold label bold, and a regular one regular', () => {
    useStore.getState().addChild(layerId, { ...label('b'), weight: 'bold' });
    useStore.getState().addChild(layerId, label('r'));
    unsub = subscribeToTextLabels();
    expect(text('b').style.fontWeight).toBe('bold');
    expect(text('r').style.fontWeight).toBe('normal');
  });

  it('a halo is white under dark ink, a share of the raster size wide', () => {
    useStore.getState().addChild(layerId, { ...label('h'), color: '#1b1b1b', backdrop: 'halo' });
    unsub = subscribeToTextLabels();
    expect(text('h').style.stroke).toMatchObject({ color: '#ffffff', width: 12 });
  });

  it('a halo is black under light ink, and goes when the backdrop does', () => {
    useStore.getState().addChild(layerId, { ...label('h'), color: '#f0f0f0', backdrop: 'halo' });
    unsub = subscribeToTextLabels();
    expect(text('h').style.stroke).toMatchObject({ color: '#000000' });
    useStore.getState().updateChild(layerId, 'h', { backdrop: undefined });
    expect(text('h').style.stroke).toBeUndefined();
  });

  it('a pill is one plate behind its text, the size of the label’s box', () => {
    useStore.getState().addChild(layerId, { ...label('p'), color: '#1b1b1b', backdrop: 'pill', width: 3, height: 1.2 });
    unsub = subscribeToTextLabels();
    const plate = pill('p')!;
    expect(plate).toBeTruthy();
    expect(plate.zIndex).toBeLessThan(text('p').zIndex);
    expect(plate.rects[0].slice(0, 4)).toEqual([-1.5, -0.6, 3, 1.2]);
    expect(plate.fills[0]).toMatchObject({ color: '#ffffff', alpha: 0.85 });
    expect(pill('none')).toBeUndefined();
  });

  it('a hidden label hides its pill, and dropping the backdrop removes the plate', () => {
    useStore.getState().addChild(layerId, { ...label('p'), backdrop: 'pill' });
    unsub = subscribeToTextLabels();
    useStore.getState().updateChild(layerId, 'p', { visible: false });
    expect(text('p').visible).toBe(false);
    expect(pill('p')!.visible).toBe(false);
    useStore.getState().updateChild(layerId, 'p', { backdrop: undefined });
    expect(pill('p')).toBeUndefined();
    expect(labels.children.length).toBe(1);
  });

  it('lines up a multi-line label left, centre or right, its block centred on the position', () => {
    useStore.getState().addChild(layerId, { ...label('l', 'a\nbb'), align: 'left', position: { x: 4, y: 2 } });
    useStore.getState().addChild(layerId, { ...label('c', 'a\nbb') });
    useStore.getState().addChild(layerId, { ...label('r', 'a\nbb'), align: 'right' });
    unsub = subscribeToTextLabels();
    expect(text('l').style.align).toBe('left');
    expect(text('c').style.align).toBe('center');
    expect(text('r').style.align).toBe('right');
    expect((text('l') as unknown as { position: { x: number; y: number } }).position).toMatchObject({ x: 4, y: 2 });
  });
});
