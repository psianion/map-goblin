import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() }),
}));

// jsdom has no 2D canvas to measure text with: a Text that only remembers what it was given.
vi.mock('pixi.js', async (importOriginal) => {
  const pixi = await importOriginal<typeof import('pixi.js')>();
  class FakeText extends pixi.Container {
    text = '';
    style: { fill: unknown } = { fill: 0 };
    anchor = { set: () => {} };
    constructor(opts?: { text?: string }) {
      super();
      this.text = opts?.text ?? '';
    }
    override get width() {
      return this.text.length * 6;
    }
    override set width(_: number) {}
    override get height() {
      return 12;
    }
    override set height(_: number) {}
  }
  return { ...pixi, Text: FakeText };
});

import { Container, Graphics } from 'pixi.js';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer, Room } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';
import { interiorPoint } from '@dnd/core/src/shared/roomUtils';
import { roomBadgeAt } from '@dnd/core/src/engine/hitTest';
import {
  acceptSuggestion,
  mountRoomOverlay,
  rejectSuggestion,
  roomOverlayModel,
  type RoomItem,
  type RoomOverlayHandle,
} from './roomOverlay';

/*
 * The overlay's model: which rooms it draws, how, and the keys that decide when a room
 * is redrawn. The keys are the performance contract — a hover change redraws the rooms
 * it touches, a prop drag (a new layers array with the same rooms) redraws none.
 */

const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const west: Room = { id: 'west', name: 'West', number: 1, anchor: [5, 5], face: square(0, 0, 10, 10) };
const east: Room = { id: 'east', name: 'East', number: 2, anchor: [15, 5], face: square(10, 0, 20, 10) };

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('no dungeon layer');
  return l;
}

const model = (zoom = 20) => roomOverlayModel(useStore.getState(), zoom);
const byId = (items: RoomItem[]) => new Map(items.map((i) => [i.room.id, i]));

beforeEach(() => {
  undoManager.clear();
  useStore.getState().resetToDefault();
  useStore.getState().setActiveLayerId(layer().id);
  useStore.getState().setRooms(layer().id, [west, east]);
  useStore.getState().setRoomLabels('both');
  useStore.getState().setRoomOverlayVisible(true);
  useStore.getState().setActiveTool('select');
});

describe('roomOverlayModel', () => {
  it('draws every room on the shown level with its badge and name chip', () => {
    const m = model();
    expect(m.rooms.map((r) => r.room.id)).toEqual(['west', 'east']);
    expect(m.rooms.every((r) => r.badge && r.chip && !r.selected && !r.warn)).toBe(true);
  });

  it('labels follow ui.roomLabels; a selected room keeps its badge with labels off', () => {
    useStore.getState().setRoomLabels('numbers');
    expect(model().rooms.every((r) => r.badge && !r.chip)).toBe(true);
    useStore.getState().setRoomLabels('off');
    useStore.getState().setSelectedIds(['east']);
    const m = byId(model().rooms);
    expect(m.get('west')!.badge).toBe(false);
    expect(m.get('east')!.badge).toBe(true);
  });

  it('the Outlines switch hides the crowd but not the selection; the Rooms tools force it on', () => {
    useStore.getState().setRoomOverlayVisible(false);
    useStore.getState().setSelectedIds(['west']);
    expect(model().rooms.map((r) => r.room.id)).toEqual(['west']);
    useStore.getState().setActiveTool('roomRect');
    expect(model().rooms).toHaveLength(2);
  });

  it('a hover change moves only the hovered rooms’ outline keys', () => {
    const before = byId(model().rooms);
    useStore.getState().setHoveredId('east');
    const after = byId(model().rooms);
    expect(after.get('east')!.hovered).toBe(true);
    expect(after.get('east')!.shapeKey).not.toBe(before.get('east')!.shapeKey);
    expect(after.get('west')!.shapeKey).toBe(before.get('west')!.shapeKey);
    expect(after.get('west')!.labelKey).toBe(before.get('west')!.labelKey);
    // The rooms sheet's hover reads the same.
    useStore.getState().setHoveredId(null);
    useStore.getState().setHighlightedRoomId('west');
    expect(byId(model().rooms).get('west')!.hovered).toBe(true);
  });

  it('a prop drag (new layers, same rooms) leaves every key alone', () => {
    const before = model().rooms.map((r) => [r.shapeKey, r.labelKey]);
    useStore.getState().addChild(layer().id, {
      id: 'crate',
      name: 'Crate',
      childType: 'asset',
      visible: true,
      objectType: 'asset',
      assetId: 'crate',
      position: { x: 3, y: 3 },
      rotation: 0,
      scale: 1,
      width: 1,
      height: 1,
      tint: '#ffffff',
      flipX: false,
      flipY: false,
    } as never);
    useStore.getState().updateChild(layer().id, 'crate', { position: { x: 4, y: 4 } } as never);
    expect(model().rooms.map((r) => [r.shapeKey, r.labelKey])).toEqual(before);
  });

  it('the settled zoom is in the outline key (inset and stroke are screen px), not the label key', () => {
    const a = byId(model(20).rooms).get('west')!;
    const b = byId(model(40).rooms).get('west')!;
    expect(b.shapeKey).not.toBe(a.shapeKey);
    expect(b.labelKey).toBe(a.labelKey);
  });

  it('flags an orphan and two rooms sharing one face', () => {
    useStore.getState().setRooms(layer().id, [
      { ...west, orphaned: true },
      east,
      { id: 'twin', name: 'Twin', anchor: [16, 6], face: east.face },
    ]);
    const m = byId(model().rooms);
    expect(m.get('west')!.warn).toBe(true);
    expect(m.get('east')!.warn).toBe(true);
    expect(m.get('twin')!.warn).toBe(true);
  });

  it('thresholds show only with a Rooms tab tool in hand', () => {
    useStore.getState().setThresholds(layer().id, [{ id: 't', points: [[10, 0], [10, 10]] }]);
    expect(model().thresholds).toHaveLength(0);
    useStore.getState().setActiveTool('divide');
    expect(model().thresholds.map((t) => t.id)).toEqual(['t']);
  });

  it("a selected area draws its member rooms' faces", () => {
    useStore.getState().setRooms(layer().id, [{ ...west, areaId: 'wing' }, east]);
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.id === layer().id) as DungeonLayer;
      l.areas = [{ id: 'wing', name: 'Wing' }];
    });
    expect(model().areaFaces).toHaveLength(0);
    useStore.getState().setSelectedIds(['wing']);
    expect(model().areaFaces).toEqual([west.face]);
  });

  it('puts each badge inside its face, not on the anchor: the halves of a split keep their labels apart', () => {
    // A split hall: both halves' anchors sit a hair either side of the divider at x = 10.
    const left: Room = { id: 'left', name: 'Hall, west', number: 1, anchor: [9.8, 5], face: square(0, 0, 10, 10) };
    const right: Room = { id: 'right', name: 'Hall, east', number: 2, anchor: [10.2, 5], face: square(10, 0, 20, 10) };
    useStore.getState().setRooms(layer().id, [left, right]);
    const m = byId(model().rooms);
    expect(m.get('left')!.at).toEqual(interiorPoint(left.face!));
    expect(m.get('right')!.at).toEqual(interiorPoint(right.face!));
    expect(m.get('right')!.at[0] - m.get('left')!.at[0]).toBeCloseTo(10);
    // The badge is picked where it is drawn: at the face's middle, and no longer at the anchor.
    const l = layer();
    expect(roomBadgeAt(l, [5, 5], 20)?.id).toBe('left');
    expect(roomBadgeAt(l, [15, 5], 20)?.id).toBe('right');
    expect(roomBadgeAt(l, [9.8, 5], 20)).toBeNull();
    // An orphan, with no face of its own, keeps its badge on the anchor.
    useStore.getState().setRooms(layer().id, [{ ...left, orphaned: true }]);
    expect(model().rooms[0].at).toEqual(left.anchor);
  });

  it('rooms of another level are not drawn', () => {
    useStore.setState((s) => {
      s.ui.activeLevelId = 'elsewhere';
    });
    expect(model().rooms).toHaveLength(0);
  });
});

describe('suggestion ghosts', () => {
  const ghost: Room = { id: 'g1', name: 'Room 3', number: 3, anchor: [25, 5], face: square(20, 0, 30, 10) };
  const ghost2: Room = { id: 'g2', name: 'Room 4', number: 4, anchor: [35, 5], face: square(30, 0, 40, 10) };

  const suggest = (rooms: Room[], layerId = layer().id) => useStore.getState().setRoomSuggestions({ layerId, rooms });

  it('sit on the layer they were made on', () => {
    suggest([ghost, ghost2]);
    expect(model().suggestions).toEqual({ layerId: layer().id, rooms: [ghost, ghost2] });
  });

  it('keep their own layer when another becomes active, and ✓ adds onto that one', () => {
    const madeOn = layer().id;
    suggest([ghost, ghost2]);
    useStore.setState((s) => {
      s.ui.activeLayerId = 'some-other-layer';
    });
    expect(model().suggestions?.layerId).toBe(madeOn);
    acceptSuggestion(madeOn, 'g1');
    expect(layer().rooms!.map((r) => r.id)).toEqual(['west', 'east', 'g1']);
  });

  it('a ✓ naming another layer than the list is refused', () => {
    suggest([ghost, ghost2]);
    acceptSuggestion('some-other-layer', 'g1');
    expect(layer().rooms!.map((r) => r.id)).toEqual(['west', 'east']);
    expect(useStore.getState().ui.roomSuggestions!.rooms).toHaveLength(2);
  });

  it('are not drawn once their layer is gone', () => {
    suggest([ghost], 'gone');
    expect(model().suggestions).toBeNull();
  });

  it('✓ adds that one as a room (one undo step) and drops its ghost', () => {
    suggest([ghost, ghost2]);
    acceptSuggestion(layer().id, 'g1');
    expect(layer().rooms!.map((r) => r.id)).toEqual(['west', 'east', 'g1']);
    expect(useStore.getState().ui.roomSuggestions!.rooms.map((r) => r.id)).toEqual(['g2']);
    undoManager.undo();
    expect(layer().rooms!.map((r) => r.id)).toEqual(['west', 'east']);
  });

  it('✕ drops that ghost and changes nothing else', () => {
    suggest([ghost, ghost2]);
    rejectSuggestion('g2');
    expect(useStore.getState().ui.roomSuggestions!.rooms.map((r) => r.id)).toEqual(['g1']);
    expect(layer().rooms!.map((r) => r.id)).toEqual(['west', 'east']);
    expect(undoManager.canUndo()).toBe(false);
  });
});


// ─── Mounted: what a frame actually does ───────────────────────────────────

describe('mounted overlay', () => {
  let frame: (() => void) | null = null;
  let follow: (() => void) | null = null;
  let world: Container;
  let screen: Container;
  let overlay: RoomOverlayHandle;

  /** One display frame: the render ticker's camera follow, then the overlay's own tick. */
  const tick = () => {
    follow?.();
    const f = frame;
    frame = null;
    f?.();
  };

  const seven = (): Room[] =>
    Array.from({ length: 7 }, (_, i) => ({
      id: `r${i}`,
      name: `Room ${i + 1}`,
      number: i + 1,
      anchor: [i * 10 + 5, 5],
      face: square(i * 10, 0, i * 10 + 10, 10),
    }));

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      frame = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    world = new Container();
    world.scale.set(20);
    world.position.set(100, 50);
    screen = new Container();
    screen.addChild(new Graphics()); // the lighting composite stands first
    const engine = {
      stage: () => world,
      overlay: () => screen,
      ticker: () => ({
        add: (fn: () => void) => {
          follow = fn;
        },
        remove: () => {
          follow = null;
        },
      }),
      worldToScreen: (x: number, y: number) => ({ x: x * 20 + 100, y: y * 20 + 50 }),
    } as unknown as RenderEngine;
    overlay = mountRoomOverlay(engine);
  });

  afterEach(() => {
    overlay.destroy();
    vi.unstubAllGlobals();
  });

  const root = () => screen.children.find((c) => c.label === 'roomOverlay') as Container;
  const areaGraphics = () => root().children.find((c) => c.label === 'roomOverlay-area') as Graphics;

  it('lives in the screen overlay, follows the camera, and stays above icons added after it', () => {
    tick();
    expect(root().position.x).toBe(100);
    expect(root().scale.x).toBe(20);
    // A light icon and a door icon arrive later, on top; the next frame puts the rooms back over them.
    const bulb = new Container();
    bulb.label = 'light-icon-1';
    screen.addChild(bulb);
    const fade = new Graphics();
    fade.zIndex = 9999; // the map-switch fade stays above everything
    screen.addChild(fade);
    const snap = new Graphics();
    snap.label = 'snapIndicator'; // the cursor's snap mark stays over the rooms too
    screen.addChild(snap);
    screen.addChild(new Container());
    tick();
    const kids = screen.children;
    expect(kids.indexOf(root())).toBeGreaterThan(kids.indexOf(bulb));
    expect(kids.indexOf(root())).toBeLessThan(kids.indexOf(fade));
    expect(kids.indexOf(root())).toBeLessThan(kids.indexOf(snap));
    // A pan moves it with the map, no redraw.
    const before = overlay.stats().redraws;
    world.position.set(-40, 10);
    tick();
    expect(root().position.x).toBe(-40);
    expect(overlay.stats().redraws).toBe(before);
  });

  it('selecting an area redraws on that change alone and draws the extent over its member faces', () => {
    useStore.getState().setRooms(layer().id, [{ ...west, areaId: 'wing' }, east]);
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.id === layer().id) as DungeonLayer;
      l.areas = [{ id: 'wing', name: 'Wing' }];
    });
    tick();
    expect(areaGraphics().getLocalBounds().width).toBe(0);
    const before = overlay.stats().redraws;
    // As the sheet's header click does: the active layer, then the area id.
    useStore.getState().setSelectedIds(['wing']);
    tick();
    expect(overlay.stats().redraws).toBe(before + 1);
    const b = areaGraphics().getLocalBounds();
    // West's face, 0..10 square, give or take the stroke.
    expect(b.width).toBeGreaterThan(9.5);
    expect(b.width).toBeLessThan(11);
    expect(b.x).toBeLessThan(0.5);
    useStore.getState().setSelectedIds([]);
    tick();
    expect(areaGraphics().getLocalBounds().width).toBe(0);
  });

  it('draws the area wash strongly enough to read on a dark floor: an ink fill and a paper edge band', () => {
    useStore.getState().setRooms(layer().id, [{ ...west, areaId: 'wing' }, east]);
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.id === layer().id) as DungeonLayer;
      l.areas = [{ id: 'wing', name: 'Wing' }];
    });
    useStore.getState().setSelectedIds(['wing']);
    tick();
    const alphas = areaGraphics().context.instructions.map((i) => (i.data as { style?: { alpha?: number } }).style?.alpha ?? 0);
    expect(Math.max(alphas[0] ?? 0, 0)).toBeGreaterThanOrEqual(0.15);
    expect(alphas.filter((a) => a >= 0.15).length).toBeGreaterThanOrEqual(2);
  });

  it('a prop dragged through 50 pointermoves over seven rooms costs the overlay zero redraws', () => {
    useStore.getState().setRooms(layer().id, seven());
    useStore.getState().addChild(layer().id, {
      id: 'crate',
      name: 'Crate',
      childType: 'asset',
      visible: true,
      objectType: 'asset',
      assetId: 'crate',
      position: { x: 3, y: 3 },
      rotation: 0,
      scale: 1,
      width: 1,
      height: 1,
      tint: '#ffffff',
      flipX: false,
      flipY: false,
    } as never);
    // The press selects the prop: that one change is a redraw, before the drag starts.
    useStore.getState().setSelectedIds(['crate']);
    tick();
    const start = overlay.stats();
    expect(start.redraws).toBeGreaterThan(0);
    for (let i = 1; i <= 50; i++) {
      // What a drag writes per move: the prop's position, a new layers array, same rooms.
      useStore.getState().updateChild(layer().id, 'crate', { position: { x: 3 + i * 0.5, y: 3 + i * 0.1 } } as never);
      tick();
    }
    const end = overlay.stats();
    expect(end.redraws - start.redraws).toBe(0);
    expect(end.shapes - start.shapes).toBe(0);

    // For the record: one redraw with every room's outline retessellated, here.
    const ids = seven().map((r) => r.id);
    const s0 = overlay.stats();
    for (let i = 0; i < 20; i++) {
      useStore.getState().setSelectedIds(i % 2 === 0 ? ids : []);
      tick();
    }
    const s1 = overlay.stats();
    const n = s1.redraws - s0.redraws;
    expect(n).toBe(20);
    expect((s1.shapes - s0.shapes) / n).toBe(7);
    console.log(`[roomOverlay] ${((s1.ms - s0.ms) / n).toFixed(3)} ms per full redraw of 7 rooms (jsdom)`);
  });
});
