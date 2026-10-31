import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { createDungeonLayer } from '@/store/factories';
import type { DungeonLayer, Room } from '@/store/types';
import { DOCK_TABS, tabForTool } from './dockTabs';
import { RoomSettings, RoomsDockTail, SuggestBar } from './RoomsDock';
import { SelectionCard } from './SelectionCard';
import { RoomsSheet } from './RoomsSheet';
import { SplitDialog } from './SplitDialog';
import { acceptAllSuggestions } from './roomActions';
import { Filmstrip } from './Filmstrip';
import { buildPrepGroups } from './prepModel';
import { pickFloorTexture } from './assetStrip';
import { ToolSettings, ToolSwatches } from './DockControls';
import { resolveRoomLook, roomChain } from '@dnd/core/src/shared/lookScope';
import { initRoomPrefs, loadRoomPrefs, resetViewPrefsForTests, ROOM_PREFS_KEY } from '../viewPrefs';

vi.mock('@/components/shared/PackThumbnailCanvas', () => ({
  PackThumbnailCanvas: ({ textureId }: { textureId: string }) => <i data-testid={`thumb-${textureId}`} />,
}));
vi.mock('./layerThumbRender', () => ({ renderLayerThumb: vi.fn(() => undefined), disposeLayerThumbRenderer: vi.fn() }));
vi.mock('@/lib/toast', () => ({
  notify: { subtle: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn(), action: vi.fn() },
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function () {};
});

const square = (x: number, y: number, s = 4): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];

const room = (id: string, name: string, number: number, x: number, over: Partial<Room> = {}): Room => ({
  id,
  name,
  number,
  anchor: [x + 2, 2],
  face: square(x, 0),
  area: 16,
  ...over,
});

/** One dungeon layer on the store's one level, holding three rooms. */
function seed(over: Partial<DungeonLayer> = {}): DungeonLayer {
  const levelId = useStore.getState().levels[0].id;
  const base = createDungeonLayer('Dungeon', levelId);
  const layer = {
    ...base,
    rooms: [room('r1', 'Entry cave', 1, 0), room('r2', 'Warren hall', 2, 10), room('r3', 'Guard post', 3, 20)],
    ...over,
  } as DungeonLayer;
  useStore.setState({ layers: [layer] });
  useStore.getState().setActiveLayerId(layer.id);
  return layer;
}

const live = () => useStore.getState().layers[0] as DungeonLayer;
const suggest = (rooms: Room[]) => useStore.getState().setRoomSuggestions({ layerId: live().id, rooms });
const roomOf = (id: string) => live().rooms!.find((r) => r.id === id)!;
const select = (ids: string[]) => act(() => useStore.getState().setSelectedIds(ids));

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  useStore.getState().resetToDefault();
  undoManager.clear();
});

afterEach(cleanup);

describe('dock tabs', () => {
  it('puts Rooms between Walls and Props with Rectangle room, Polygon room and Divide on R, P and X', () => {
    expect(DOCK_TABS.map((t) => t.id).slice(0, 4)).toEqual(['floors', 'walls', 'rooms', 'props']);
    const rooms = DOCK_TABS.find((t) => t.id === 'rooms')!;
    expect(rooms.tools.map((t) => [t.tool, t.label, t.shortcut])).toEqual([
      ['roomRect', 'Rectangle room', 'R'],
      ['roomPolygon', 'Polygon room', 'P'],
      ['divide', 'Divide', 'X'],
    ]);
    expect(tabForTool('divide')).toBe('rooms');
  });
});

describe('Rooms tab settings', () => {
  it('drawing shows Outlines, Labels and Walls; Divide trades Walls for Divider', () => {
    const { rerender } = render(<RoomSettings tool="roomRect" />);
    expect(screen.getByRole('switch', { name: 'Outlines' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Labels' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Walls' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Divider' })).toBeNull();
    rerender(<RoomSettings tool="divide" />);
    expect(screen.getByRole('group', { name: 'Divider' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Walls' })).toBeNull();
  });

  it('writes the view settings to the UI slice, none of them undoable', () => {
    render(<RoomSettings tool="divide" />);
    const outlines = useStore.getState().ui.roomOverlayVisible;
    fireEvent.click(screen.getByRole('switch', { name: 'Outlines' }));
    expect(useStore.getState().ui.roomOverlayVisible).toBe(!outlines);
    fireEvent.click(within(screen.getByRole('group', { name: 'Labels' })).getByRole('button', { name: 'Numbers' }));
    expect(useStore.getState().ui.roomLabels).toBe('numbers');
    fireEvent.click(within(screen.getByRole('group', { name: 'Divider' })).getByRole('button', { name: 'Wall' }));
    expect(useStore.getState().ui.dividerMode).toBe('wall');
    expect(undoManager.canUndo()).toBe(false);
  });

  it('counts the level’s rooms and the proposals, and toggles the rooms list', () => {
    seed();
    render(<RoomsDockTail />);
    expect(screen.getByTestId('v2-room-count').textContent).toBe('3 rooms');
    act(() => suggest([room('s1', 'Room 4', 4, 30), room('s2', 'Room 5', 5, 40)]));
    expect(screen.getByTestId('v2-room-count').textContent).toBe('3 rooms · 2 suggested');
    fireEvent.click(screen.getByRole('button', { name: 'Open rooms list' }));
    expect(useStore.getState().ui.roomsSheetOpen).toBe(true);
    expect(screen.getByRole('button', { name: 'Close rooms list' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Suggest bar', () => {
  it('says how many and keeps the rest; Accept all adds them as one undo step', () => {
    seed();
    render(<SuggestBar />);
    expect(screen.queryByTestId('v2-suggest-bar')).toBeNull();
    act(() => suggest([room('s1', 'Room 4', 4, 30), room('s2', 'Room 5', 5, 40)]));
    expect(screen.getByTestId('v2-suggest-bar').textContent).toContain('2 rooms suggested');
    expect(screen.getByTestId('v2-suggest-bar').textContent).toContain('Your 3 rooms stay as they are');
    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }));
    expect(live().rooms).toHaveLength(5);
    expect(useStore.getState().ui.roomSuggestions).toBeNull();
    act(() => undoManager.undo());
    expect(live().rooms).toHaveLength(3);
  });

  it('Enter accepts all and Escape dismisses, from anywhere but a field', () => {
    seed();
    render(<SuggestBar />);
    act(() => suggest([room('s1', 'Room 4', 4, 30)]));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useStore.getState().ui.roomSuggestions).toBeNull();
    act(() => suggest([room('s1', 'Room 4', 4, 30)]));
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(live().rooms).toHaveLength(4);
  });

  it('Accept all writes to the layer the proposals were made on, and picking another layer dismisses them', () => {
    const made = seed();
    const levelId = useStore.getState().levels[0].id;
    const other = { ...createDungeonLayer('Other', levelId), rooms: [] } as DungeonLayer;
    useStore.setState((s) => {
      s.layers.push(other);
    });
    render(<SuggestBar />);
    act(() => suggest([room('s1', 'Room 4', 4, 30)]));
    // The list names its layer; Accept all reads it from there, not from whatever is active.
    useStore.setState((s) => {
      s.ui.activeLayerId = other.id;
    });
    act(() => acceptAllSuggestions());
    expect((useStore.getState().layers.find((l) => l.id === made.id) as DungeonLayer).rooms).toHaveLength(4);
    expect((useStore.getState().layers.find((l) => l.id === other.id) as DungeonLayer).rooms).toHaveLength(0);

    act(() => useStore.getState().setActiveLayerId(made.id));
    act(() => suggest([room('s2', 'Room 5', 5, 40)]));
    act(() => useStore.getState().setActiveLayerId(other.id));
    expect(useStore.getState().ui.roomSuggestions).toBeNull();
  });
});

describe('Room card', () => {
  it('stays on screen beside the rooms sheet instead of hiding under it', () => {
    seed();
    act(() => useStore.getState().setRoomsSheetOpen(false));
    select(['r2']);
    render(<SelectionCard />);
    const card = screen.getByTestId('v2-selection-card');
    expect(card.getAttribute('data-beside-sheet')).toBeNull();
    act(() => useStore.getState().setRoomsSheetOpen(true));
    expect(screen.getByTestId('v2-selection-card').getAttribute('data-beside-sheet')).toBe('true');
    act(() => useStore.getState().setRoomsSheetOpen(false));
  });

  it('shows number, name, size, doors and area, and renames as one undo step', () => {
    seed();
    select(['r2']);
    render(<SelectionCard />);
    const card = screen.getByTestId('v2-selection-card');
    expect(card.getAttribute('data-room-kind')).toBe('room');
    expect(card.textContent).toContain('Room');
    expect(card.textContent).toContain('of 3');
    expect(card.textContent).toContain('16 sq');
    expect(card.textContent).toContain('0 doors');
    const name = screen.getByLabelText('Room name');
    fireEvent.change(name, { target: { value: 'Great hall' } });
    fireEvent.blur(name);
    expect(roomOf('r2').name).toBe('Great hall');
    act(() => undoManager.undo());
    expect(roomOf('r2').name).toBe('Warren hall');
  });

  it('sets the number, and puts the room in a new area from the Area select', () => {
    seed();
    select(['r2']);
    render(<SelectionCard />);
    const num = screen.getByLabelText('Room number');
    fireEvent.change(num, { target: { value: '7' } });
    fireEvent.blur(num);
    expect(roomOf('r2').number).toBe(7);
    fireEvent.change(screen.getByLabelText('Area'), { target: { value: '__new' } });
    expect(live().areas).toHaveLength(1);
    expect(roomOf('r2').areaId).toBe(live().areas![0].id);
  });

  it('labels Floor and Walls by where they come from, pins and resets them', () => {
    seed({ areas: [{ id: 'ar', name: 'Lower dens', look: { wallTextureTint: '#ff0000' } }] });
    act(() => useStore.getState().updateLevel(useStore.getState().levels[0].id, { name: 'Upper warren' }));
    useStore.setState((s) => {
      (s.layers[0] as DungeonLayer).rooms![1].areaId = 'ar';
    });
    select(['r2']);
    render(<SelectionCard />);
    // The layer's style answers the walls' width; the area's tint is nearer.
    expect(screen.getByTestId('v2-look-walls-source').textContent).toBe('Inherits Lower dens');
    fireEvent.change(screen.getByLabelText('Wall set'), { target: { value: '' } });
    expect(roomOf('r2').look).toEqual({ wallTextureSetId: '' });
    expect(screen.getByTestId('v2-look-walls-source').textContent).toBe('Pinned');
    fireEvent.click(within(screen.getByTestId('v2-look-walls')).getByRole('button', { name: 'Reset' }));
    expect(roomOf('r2').look).toBeUndefined();
    expect(screen.getByTestId('v2-look-walls-source').textContent).toBe('Inherits Lower dens');
  });

  it('shows Mood live: Darkness Inherit/Lit/Dim/Dark, the tint, and Dark hides from sight', () => {
    seed();
    select(['r1']);
    render(<SelectionCard />);
    const mood = screen.getByTestId('v2-look-mood');
    expect(mood.className).not.toContain('v2-rsec--greyed');
    expect(mood.textContent).not.toContain('Lighting pass');
    const buttons = within(within(mood).getByRole('group', { name: 'Darkness' })).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Inherit', 'Lit', 'Dim', 'Dark']);
    expect(buttons.some((b) => (b as HTMLButtonElement).disabled)).toBe(false);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(within(mood).getByRole('button', { name: /^Tint colour/ })).toBeTruthy();
    expect(within(mood).getByRole('switch', { name: 'Dark hides from sight' }).getAttribute('aria-checked')).toBe('true');
  });

  it('an unpinned room reads "Inherits Map" for Mood; a level mood reads "Inherits <level>"', () => {
    seed();
    select(['r1']);
    const { unmount } = render(<SelectionCard />);
    expect(screen.getByTestId('v2-look-mood-source').textContent).toBe('Inherits Map');
    unmount();
    const level = useStore.getState().levels[0];
    act(() => useStore.getState().updateLevel(level.id, { name: 'Upper warren', look: { mood: 'dim' } }));
    render(<SelectionCard />);
    expect(screen.getByTestId('v2-look-mood-source').textContent).toBe('Inherits Upper warren');
  });

  it('a Darkness pick pins the mood as one undo step, and Inherit takes it off', () => {
    seed();
    select(['r1']);
    render(<SelectionCard />);
    const group = () => within(screen.getByTestId('v2-look-mood')).getByRole('group', { name: 'Darkness' });
    fireEvent.click(within(group()).getByRole('button', { name: 'Dark' }));
    expect(roomOf('r1').look).toEqual({ mood: 'dark' });
    expect(screen.getByTestId('v2-look-mood-source').textContent).toBe('Pinned');
    fireEvent.click(within(group()).getByRole('button', { name: 'Inherit' }));
    expect(roomOf('r1').look?.mood).toBeUndefined();
    act(() => undoManager.undo());
    expect(roomOf('r1').look).toEqual({ mood: 'dark' });
    act(() => undoManager.undo());
    expect(roomOf('r1').look).toBeUndefined();
  });

  it('"Dark hides from sight" pins moodVision visible and back, one step each', () => {
    seed();
    select(['r1']);
    render(<SelectionCard />);
    const sw = () => within(screen.getByTestId('v2-look-mood')).getByRole('switch', { name: 'Dark hides from sight' });
    fireEvent.click(sw());
    expect(roomOf('r1').look).toEqual({ moodVision: 'visible' });
    expect(sw().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw());
    expect(roomOf('r1').look).toEqual({ moodVision: 'darkness' });
    act(() => undoManager.undo());
    expect(roomOf('r1').look).toEqual({ moodVision: 'visible' });
  });

  it('Reset on Mood drops the mood, tint and sight pins together', () => {
    seed();
    useStore.setState((s) => {
      (s.layers[0] as DungeonLayer).rooms![0].look = { mood: 'dark', moodTint: '#223344', moodVision: 'visible', floorTint: '#ff0000' };
    });
    select(['r1']);
    render(<SelectionCard />);
    fireEvent.click(within(screen.getByTestId('v2-look-mood')).getByRole('button', { name: 'Reset' }));
    expect(roomOf('r1').look).toEqual({ floorTint: '#ff0000' });
  });

  it('the area card writes its own mood', () => {
    seed({ areas: [{ id: 'ar', name: 'Lower dens' }] });
    act(() => useStore.getState().setSelectedIds(['ar']));
    render(<SelectionCard />);
    const mood = screen.getByTestId('v2-look-mood');
    fireEvent.click(within(within(mood).getByRole('group', { name: 'Darkness' })).getByRole('button', { name: 'Dim' }));
    expect(live().areas![0].look).toEqual({ mood: 'dim' });
  });

  it('sums up the key and opens it in the rooms sheet', () => {
    seed();
    act(() =>
      useStore.getState().setRoomKey('r1', { roomId: 'r1', readAloud: 'Smoke hangs low.', notes: '', treasure: '', traps: [], checks: [] }),
    );
    select(['r1']);
    render(<SelectionCard />);
    expect(screen.getByTestId('v2-room-key-summary').textContent).toContain('Smoke hangs low.');
    fireEvent.click(screen.getByRole('button', { name: 'Open room key' }));
    expect(useStore.getState().ui.roomsSheetOpen).toBe(true);
    expect(useStore.getState().ui.roomsSheetRoomId).toBe('r1');
  });
});

describe('Area and Level cards', () => {
  it('an area card names the area and its rooms; a pin on it shows on the room as inherited', () => {
    seed({ areas: [{ id: 'ar', name: 'Upper warren' }] });
    useStore.setState((s) => {
      (s.layers[0] as DungeonLayer).rooms![0].areaId = 'ar';
    });
    select(['ar']);
    render(<SelectionCard />);
    const card = screen.getByTestId('v2-selection-card');
    expect(card.getAttribute('data-room-kind')).toBe('area');
    expect(card.textContent).toContain('Area');
    const name = screen.getByLabelText('Area name');
    fireEvent.change(name, { target: { value: 'Top warren' } });
    fireEvent.blur(name);
    expect(live().areas![0].name).toBe('Top warren');
    fireEvent.change(screen.getByLabelText('Wall set'), { target: { value: '' } });
    expect(live().areas![0].look).toEqual({ wallTextureSetId: '' });
    select(['r1']);
    expect(screen.getByTestId('v2-look-walls-source').textContent).toBe('Inherits Top warren');
  });

  it('a level card lists its layers and rooms, renames, and adds a layer to the level', () => {
    seed({ areas: [{ id: 'ar', name: 'A' }] });
    const levelId = useStore.getState().levels[0].id;
    select([levelId]);
    render(<SelectionCard />);
    const card = screen.getByTestId('v2-selection-card');
    expect(card.getAttribute('data-room-kind')).toBe('level');
    expect(card.textContent).toContain('Dungeon');
    expect(card.textContent).toContain('3 in 1 area');
    expect(screen.getByTestId('v2-look-floor-source').textContent).toBe('Inherits Map');
    const name = screen.getByLabelText('Level name');
    fireEvent.change(name, { target: { value: 'Upper warren' } });
    fireEvent.blur(name);
    expect(useStore.getState().levels[0].name).toBe('Upper warren');
    fireEvent.click(screen.getByRole('button', { name: 'Add layer' }));
    expect(useStore.getState().layers.filter((l) => l.levelId === levelId)).toHaveLength(2);
  });
});

describe('Rooms sheet', () => {
  const open = () => act(() => useStore.getState().setRoomsSheetOpen(true));
  const rows = () => screen.getAllByTestId('v2-room-row').map((r) => r.getAttribute('data-room-id'));

  it('lists the rooms by number and filters by name, number or key text', () => {
    seed();
    act(() =>
      useStore.getState().setRoomKey('r3', { roomId: 'r3', readAloud: '', notes: 'a tripwire', treasure: '', traps: [], checks: [] }),
    );
    open();
    render(<RoomsSheet />);
    expect(rows()).toEqual(['r1', 'r2', 'r3']);
    expect(screen.getByRole('heading', { name: /Rooms/ }).textContent).toBe('Rooms 3');
    const filter = screen.getByLabelText('Filter rooms');
    fireEvent.change(filter, { target: { value: 'warren' } });
    expect(rows()).toEqual(['r2']);
    fireEvent.change(filter, { target: { value: '3' } });
    expect(rows()).toEqual(['r3']);
    fireEvent.change(filter, { target: { value: 'tripwire' } });
    expect(rows()).toEqual(['r3']);
  });

  it('click selects the room; double-click renames it inline', () => {
    seed();
    open();
    render(<RoomsSheet />);
    fireEvent.click(screen.getAllByTestId('v2-room-row')[1]);
    expect(useStore.getState().selection.selectedIds).toEqual(['r2']);
    fireEvent.doubleClick(screen.getAllByTestId('v2-room-row')[1]);
    const input = screen.getByLabelText('Room name');
    fireEvent.change(input, { target: { value: 'Great hall' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(roomOf('r2').name).toBe('Great hall');
  });

  /** A pointer drag of `row` onto `target`: press, travel past the pick-up distance, release. */
  const pointerDrag = (row: HTMLElement, target: HTMLElement, at = { clientX: 0, clientY: -100 }) => {
    fireEvent.pointerDown(row, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(target, at);
    fireEvent.pointerUp(target, at);
  };

  it('drag reorders the numbers, as one undo step', () => {
    seed();
    open();
    render(<RoomsSheet />);
    const [first, , third] = screen.getAllByTestId('v2-room-row');
    pointerDrag(third, first.closest('li')!);
    expect([roomOf('r3').number, roomOf('r1').number, roomOf('r2').number]).toEqual([1, 2, 3]);
    act(() => undoManager.undo());
    expect([roomOf('r1').number, roomOf('r2').number, roomOf('r3').number]).toEqual([1, 2, 3]);
  });

  it('a press that never travels is a click, not a drag; the click after a real drag does not select', () => {
    seed();
    open();
    render(<RoomsSheet />);
    const [first, second] = screen.getAllByTestId('v2-room-row');
    // A press and a release in place: nothing moves.
    fireEvent.pointerDown(first, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(first.closest('li')!, { clientX: 1, clientY: 1 });
    fireEvent.pointerUp(first.closest('li')!, { clientX: 1, clientY: 1 });
    fireEvent.click(first);
    expect(useStore.getState().selection.selectedIds).toEqual(['r1']);
    expect(undoManager.canUndo()).toBe(false);
    // A drag that ends back on its own row: the click the release makes is swallowed.
    act(() => useStore.getState().setSelectedIds([]));
    fireEvent.pointerDown(second, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(second.closest('li')!, { clientX: 0, clientY: 30 });
    fireEvent.pointerUp(second.closest('li')!, { clientX: 0, clientY: 30 });
    fireEvent.click(second);
    expect(useStore.getState().selection.selectedIds).toEqual([]);
  });

  it('a drop on a row of an area group moves the room into that area, as one undo step', () => {
    seed({ areas: [{ id: 'ar', name: 'Upper warren' }] });
    useStore.setState((s) => {
      (s.layers[0] as DungeonLayer).rooms![0].areaId = 'ar';
    });
    open();
    render(<RoomsSheet />);
    const row = (id: string) => screen.getAllByTestId('v2-room-row').find((r) => r.getAttribute('data-room-id') === id)!;
    // r3 (no area) dropped on r1's row, inside "Upper warren".
    pointerDrag(row('r3'), row('r1').closest('li')!, { clientX: 0, clientY: 50 });
    expect(roomOf('r3').areaId).toBe('ar');
    expect(within(screen.getByTestId('v2-area-head')).getByText('2')).toBeTruthy();
    act(() => undoManager.undo());
    expect(roomOf('r3').areaId).toBeUndefined();
    // And back out: a drop on the "No area" header clears it.
    pointerDrag(row('r1'), screen.getByTestId('v2-area-none'), { clientX: 0, clientY: 50 });
    expect(roomOf('r1').areaId).toBeUndefined();
  });

  it('Shift-click selects the run of rows from the last click; Ctrl-click adds or drops one row', () => {
    seed({ rooms: [room('r1', 'A', 1, 0), room('r2', 'B', 2, 10), room('r3', 'C', 3, 20), room('r4', 'D', 4, 30)] });
    open();
    render(<RoomsSheet />);
    const rowsEl = () => screen.getAllByTestId('v2-room-row');
    fireEvent.click(rowsEl()[0]);
    expect(useStore.getState().selection.selectedIds).toEqual(['r1']);
    fireEvent.click(rowsEl()[2], { shiftKey: true });
    expect([...useStore.getState().selection.selectedIds].sort()).toEqual(['r1', 'r2', 'r3']);
    fireEvent.click(rowsEl()[1], { ctrlKey: true });
    expect([...useStore.getState().selection.selectedIds].sort()).toEqual(['r1', 'r3']);
    fireEvent.click(rowsEl()[3], { metaKey: true });
    expect([...useStore.getState().selection.selectedIds].sort()).toEqual(['r1', 'r3', 'r4']);
    expect(rowsEl().map((r) => r.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'true', 'true']);
    // The run reads up as well as down, from the last plain or Ctrl click (r4).
    fireEvent.click(rowsEl()[1], { shiftKey: true });
    expect([...useStore.getState().selection.selectedIds].sort()).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(screen.getByTestId('v2-rsheet-selected').textContent).toContain('4 selected');
    // A plain click is back to one room; New area from selection takes the lot.
    fireEvent.click(rowsEl()[3]);
    expect(useStore.getState().selection.selectedIds).toEqual(['r4']);
    expect(screen.queryByTestId('v2-rsheet-selected')).toBeNull();
    fireEvent.click(rowsEl()[0], { shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'New area from selection' }));
    expect(live().rooms!.every((r) => r.areaId === live().areas![0].id)).toBe(true);
  });

  it('the key icon opens that room’s key, written or not', () => {
    seed();
    act(() =>
      useStore.getState().setRoomKey('r1', { roomId: 'r1', readAloud: 'Smoke.', notes: '', treasure: '', traps: [], checks: [] }),
    );
    open();
    render(<RoomsSheet />);
    const keys = screen.getAllByTestId('v2-room-key-open');
    expect(keys.map((k) => k.getAttribute('data-keyed'))).toEqual(['true', 'false', 'false']);
    // No key yet on Warren hall: the icon still opens its (empty) key, ready to write.
    fireEvent.click(screen.getByRole('button', { name: 'Write a key for Warren hall' }));
    expect(useStore.getState().ui.roomsSheetRoomId).toBe('r2');
    expect(screen.getByRole('heading', { name: 'Warren hall' })).toBeTruthy();
    expect(screen.getByTestId('v2-room-key')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to rooms' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open the key of Entry cave' }));
    expect(useStore.getState().ui.roomsSheetRoomId).toBe('r1');
    expect((screen.getByLabelText('Read-aloud') as HTMLTextAreaElement).value).toBe('Smoke.');
    // Opening a key selects nothing and writes nothing.
    expect(useStore.getState().selection.selectedIds).toEqual([]);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('groups by area; a drop on an area header moves the room there; the header selects the area', () => {
    seed({ areas: [{ id: 'ar', name: 'Upper warren' }] });
    useStore.setState((s) => {
      (s.layers[0] as DungeonLayer).rooms![0].areaId = 'ar';
    });
    open();
    render(<RoomsSheet />);
    expect(screen.getByRole('heading', { name: /Rooms/ }).textContent).toBe('Rooms 3 in 1 area');
    const head = screen.getByTestId('v2-area-head');
    expect(head.textContent).toContain('Upper warren');
    expect(head.textContent).toContain('Inherits level');
    expect(screen.getByTestId('v2-area-none').textContent).toContain('No area');
    pointerDrag(screen.getAllByTestId('v2-room-row')[2], head, { clientX: 0, clientY: 50 });
    expect(roomOf('r3').areaId).toBe('ar');
    fireEvent.click(within(head).getByRole('button', { name: 'Upper warren' }));
    expect(useStore.getState().selection.selectedIds).toEqual(['ar']);
  });

  it('makes a new area from the selected rooms; the area menu removes it', () => {
    seed();
    select(['r1', 'r2']);
    open();
    render(<RoomsSheet />);
    fireEvent.click(screen.getByRole('button', { name: 'New area from selection' }));
    expect(live().areas).toHaveLength(1);
    expect([roomOf('r1').areaId, roomOf('r2').areaId, roomOf('r3').areaId]).toEqual([live().areas![0].id, live().areas![0].id, undefined]);
    // The new area's name is up for editing.
    const input = screen.getByLabelText('Area name');
    fireEvent.change(input, { target: { value: 'Upper warren' } });
    fireEvent.blur(input);
    expect(live().areas![0].name).toBe('Upper warren');
    fireEvent.click(screen.getByRole('button', { name: 'Area menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove area' }));
    expect(live().areas ?? []).toHaveLength(0);
    expect(roomOf('r1').areaId).toBeUndefined();
  });

  it('renumbers by reading order, and starts the table in a room from its menu', () => {
    seed({ rooms: [room('r1', 'Right', 1, 20), room('r2', 'Left', 2, 0)] });
    open();
    render(<RoomsSheet />);
    fireEvent.click(screen.getByRole('button', { name: 'Renumber by reading order' }));
    expect([roomOf('r2').number, roomOf('r1').number]).toEqual([1, 2]);
    fireEvent.contextMenu(screen.getAllByTestId('v2-room-row')[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start the table here' }));
    expect(useStore.getState().mapSettings.startingRoomId).toBe('r2');
    act(() => undoManager.undo());
    expect(useStore.getState().mapSettings.startingRoomId).toBeUndefined();
  });

  it('the key page writes each field on blur as its own undo step, and goes back to the list', () => {
    seed();
    act(() => useStore.getState().setRoomsSheetRoomId('r2'));
    open();
    render(<RoomsSheet />);
    expect(screen.getByRole('heading', { name: 'Warren hall' })).toBeTruthy();
    const read = screen.getByLabelText('Read-aloud');
    fireEvent.focus(read);
    fireEvent.change(read, { target: { value: 'A low, smoky hall.' } });
    fireEvent.blur(read);
    const notes = screen.getByLabelText('DM notes');
    fireEvent.focus(notes);
    fireEvent.change(notes, { target: { value: 'Drunk goblins.' } });
    fireEvent.blur(notes);
    fireEvent.click(screen.getByRole('button', { name: 'Add monster' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add trap' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add check' }));
    const key = () => useStore.getState().prep!.rooms.find((k) => k.roomId === 'r2')!;
    expect(key()).toMatchObject({ readAloud: 'A low, smoky hall.', notes: 'Drunk goblins.' });
    expect(key().encounter!.monsters).toHaveLength(1);
    expect(key().traps).toHaveLength(1);
    expect(key().checks).toHaveLength(1);
    act(() => undoManager.undo());
    act(() => undoManager.undo());
    act(() => undoManager.undo());
    expect(key()).toMatchObject({ notes: 'Drunk goblins.', traps: [], checks: [] });
    expect(key().encounter).toBeUndefined();
    act(() => undoManager.undo());
    expect(key().notes).toBe('');
    act(() => undoManager.undo());
    expect(useStore.getState().prep!.rooms.find((k) => k.roomId === 'r2')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Back to rooms' }));
    expect(useStore.getState().ui.roomsSheetRoomId).toBeNull();
    expect(screen.getAllByTestId('v2-room-row')).toHaveLength(3);
  });

  it('a new row starts empty, its purpose in the placeholder: typing a monster name gives exactly that name', () => {
    seed();
    act(() => useStore.getState().setRoomsSheetRoomId('r2'));
    open();
    render(<RoomsSheet />);
    fireEvent.click(screen.getByRole('button', { name: 'Add monster' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add trap' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add check' }));
    const name = screen.getByLabelText('Monster name') as HTMLInputElement;
    expect(name.value).toBe('');
    expect(name.placeholder).toBe('Monster');
    fireEvent.focus(name);
    fireEvent.change(name, { target: { value: 'Goblin' } });
    fireEvent.blur(name);
    const key = () => useStore.getState().prep!.rooms.find((k) => k.roomId === 'r2')!;
    expect(key().encounter!.monsters[0].name).toBe('Goblin');

    // Every text field of a fresh row, and the encounter's name, is empty with a placeholder.
    for (const label of ['Encounter name', 'HP formula', 'Trap', 'Save DC', 'Damage', 'Check']) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect([label, input.value]).toEqual([label, '']);
      expect(input.placeholder).not.toBe('');
    }
    expect(key().traps[0].text).toBe('');
    expect(key().checks[0].text).toBe('');

    // The number fields hold a value; focus selects it whole, so typing replaces it.
    for (const label of ['Count', 'Check DC']) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      fireEvent.focus(input);
      expect([label, input.selectionStart, input.selectionEnd]).toEqual([label, 0, input.value.length]);
      fireEvent.blur(input);
    }
  });
});

describe('Split dialog', () => {
  const west = square(10, 0, 4).map(([x, y]) => [x, y] as [number, number]);
  const pending = (halves: [[number, number][], [number, number][]]) =>
    act(() =>
      useStore.getState().setPendingSplit({
        layerId: live().id,
        roomId: 'r2',
        threshold: { id: 't1', points: [[12, -1], [12, 5]] },
        halves,
      }),
    );

  it('defaults to the larger half keeping the room and names the other by where it lies', () => {
    seed();
    const big: [number, number][] = [[10, 0], [13, 0], [13, 4], [10, 4]];
    const small: [number, number][] = [[13, 0], [14, 0], [14, 4], [13, 4]];
    pending([big, small]);
    render(<SplitDialog />);
    expect(screen.getByText('Split Warren hall')).toBeTruthy();
    expect(screen.getByTestId('v2-split-half-0').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('v2-split-half-0').textContent).toContain('West half');
    expect((screen.getByLabelText('The other half becomes') as HTMLInputElement).value).toBe('Warren hall, east');
    expect(screen.getByText(/next free number, 4/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('v2-split-half-1'));
    expect((screen.getByLabelText('The other half becomes') as HTMLInputElement).value).toBe('Warren hall, west');
  });

  it('Split adds the other half with the next number and copied fog, and moves the keeper into its half', () => {
    seed();
    const left: [number, number][] = [[10, 0], [11.5, 0], [11.5, 4], [10, 4]];
    const right: [number, number][] = [[11.5, 0], [14, 0], [14, 4], [11.5, 4]];
    pending([right, left]);
    render(<SplitDialog />);
    // Keep the left half, where the anchor (12, 2) is not.
    fireEvent.click(screen.getByTestId('v2-split-half-1'));
    fireEvent.click(screen.getByTestId('v2-split-commit'));
    expect(useStore.getState().ui.pendingSplit).toBeNull();
    const rooms = live().rooms!;
    expect(rooms).toHaveLength(4);
    const other = rooms.find((r) => !['r1', 'r2', 'r3'].includes(r.id))!;
    expect(other).toMatchObject({ name: 'Warren hall, east', number: 4, derivedFrom: 'r2' });
    expect(roomOf('r2').anchor[0]).toBeLessThan(11.5);
    expect(live().thresholds).toHaveLength(1);
    act(() => undoManager.undo());
    expect(live().rooms).toHaveLength(3);
  });

  it('Start hidden leaves no fog lineage; Cancel adds nothing', () => {
    seed();
    pending([west, square(14, 0, 2)]);
    const { unmount } = render(<SplitDialog />);
    fireEvent.click(screen.getByRole('radio', { name: 'Start hidden' }));
    fireEvent.click(screen.getByTestId('v2-split-commit'));
    expect(live().rooms!.find((r) => r.number === 4)?.derivedFrom).toBeUndefined();
    unmount();
    pending([west, square(14, 0, 2)]);
    render(<SplitDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useStore.getState().ui.pendingSplit).toBeNull();
    expect(live().rooms).toHaveLength(4);
  });
});

describe('Level picker', () => {
  it('shows the level on show, switches, adds a level with its first layer, and opens Level settings', () => {
    seed();
    render(<Filmstrip onOpenLayers={() => {}} onOpenLayerSettings={() => {}} />);
    expect(screen.getByTestId('v2-level-picker').textContent).toContain('1 of 1 level');
    fireEvent.click(screen.getByTestId('v2-level-button'));
    expect(screen.getByRole('menu', { name: 'Levels' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'New level' }));
    const s = useStore.getState();
    expect(s.levels).toHaveLength(2);
    expect(s.ui.activeLevelId).toBe(s.levels[1].id);
    expect(screen.getByTestId('v2-level-picker').textContent).toContain('2 of 2 levels');
    // The strip shows the new level's one layer, not the old level's.
    expect(screen.queryByRole('button', { name: 'Draw on Dungeon' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Draw on Layer/ })).toHaveLength(1);

    fireEvent.click(screen.getByTestId('v2-level-button'));
    fireEvent.click(screen.getAllByRole('menuitemradio')[0]);
    expect(screen.getByRole('button', { name: 'Draw on Dungeon' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('v2-level-button'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Level settings' }));
    expect(useStore.getState().selection.selectedIds).toEqual([useStore.getState().levels[0].id]);

    act(() => undoManager.undo());
    expect(useStore.getState().levels).toHaveLength(1);
  });

  it('moves the active layer to another level and renames the level on show', () => {
    seed();
    const s0 = useStore.getState();
    act(() => s0.addLevel({ id: 'lv2', name: 'Lower dens' }));
    // A level never ends up empty: the level on show keeps a second layer.
    act(() => s0.addLayer(createDungeonLayer('Second', s0.levels[0].id)));
    render(<Filmstrip onOpenLayers={() => {}} onOpenLayerSettings={() => {}} />);
    fireEvent.click(screen.getByTestId('v2-level-button'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move layer to level…' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Lower dens/ }));
    expect(live().levelId).toBe('lv2');
    fireEvent.click(screen.getByTestId('v2-level-button'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename level' }));
    const input = screen.getByLabelText('Level name');
    fireEvent.change(input, { target: { value: 'Upper warren' } });
    fireEvent.blur(input);
    expect(useStore.getState().levels[0].name).toBe('Upper warren');
  });
});

describe('room view preferences', () => {
  beforeEach(() => resetViewPrefsForTests());
  afterEach(() => resetViewPrefsForTests());

  it('remembers labels, divider, room walls and the sheet, and ignores junk', () => {
    localStorage.setItem(ROOM_PREFS_KEY, JSON.stringify({ roomLabels: 'numbers', dividerMode: 'nope', roomWalls: 'none' }));
    expect(loadRoomPrefs()).toEqual({ roomLabels: 'numbers', roomWalls: 'none' });
    act(() => {
      const s = useStore.getState();
      s.setDividerMode('threshold');
      s.setRoomsSheetOpen(false);
    });
    initRoomPrefs();
    expect(useStore.getState().ui.roomLabels).toBe('numbers');
    expect(useStore.getState().ui.roomWalls).toBe('none');
    act(() => useStore.getState().setDividerMode('wall'));
    act(() => useStore.getState().setRoomsSheetOpen(true));
    expect(JSON.parse(localStorage.getItem(ROOM_PREFS_KEY)!)).toEqual({
      roomLabels: 'numbers',
      dividerMode: 'wall',
      roomWalls: 'none',
      roomsSheetOpen: true,
    });
  });
});

describe('prep overview rows anchored on rooms', () => {
  it('names the room as "N · name", and marks one whose room is gone', () => {
    const layer = seed();
    const groups = buildPrepGroups(
      {
        version: 3,
        rooms: [],
        triggers: [
          { id: 't1', name: 'Ambush', when: { kind: 'room-revealed', roomId: 'r2' }, actions: [], once: true, enabled: true },
          { id: 't2', name: 'Lost', when: { kind: 'room-revealed', roomId: 'gone' }, actions: [], once: true, enabled: true },
        ],
        notes: [{ id: 'n1', zoneId: '', roomId: 'r2', title: 'Smell', body: '', imageKeys: [], showOnReveal: true }],
      },
      [layer],
    );
    expect(groups.map((g) => g.zoneName)).toEqual(['2 · Warren hall', 'Deleted room']);
    expect(groups[0].room?.room.id).toBe('r2');
    expect(groups[0].rows.map((r) => [r.name, r.inert])).toEqual([
      ['Ambush', null],
      ['Smell', null],
    ]);
    expect(groups[1].rows[0].inert).toBe('room deleted');
  });
});

describe('the dock with a room, area or level selected', () => {
  /** Every room's resolved look on the layer, as one string: "byte-identical" is string equality. */
  const resolvedLooks = (ids: string[]) =>
    JSON.stringify(ids.map((id) => resolveRoomLook(roomChain(useStore.getState(), live(), roomOf(id)))));

  it('pinning a wall set on a room from the card and the dock, then Reset, leaves the layer and every other room alone', () => {
    // The warren's walls: the cave ink kit with its blue tint, set on the layer.
    seed();
    useStore.setState((s) => {
      const l = s.layers[0] as DungeonLayer;
      l.style = { ...l.style, wallTextureSetId: 'GG_Cave_Ink', wallTextureTint: '#a5b9ff' };
    });
    const layerBefore = JSON.stringify(live().style);
    const othersBefore = resolvedLooks(['r1', 'r3']);
    select(['r2']);
    render(
      <>
        <SelectionCard />
        <ToolSwatches tool="wall" tab="walls" onTab={() => {}} onOpenAssets={() => {}} />
        <ToolSettings tool="wall" />
      </>,
    );
    const walls = screen.getByTestId('v2-look-walls');

    // The card's Set pins on the room.
    fireEvent.change(within(walls).getByLabelText('Wall set'), { target: { value: '' } });
    expect(roomOf('r2').look).toEqual({ wallTextureSetId: '' });
    // A style preset in the Walls tab, picked while the room is selected, pins the preset's
    // wall look on the room (this is the click that used to restyle the whole layer).
    fireEvent.click(screen.getByRole('button', { name: 'Fieldstone Keep' }));
    expect(roomOf('r2').look).toMatchObject({ wallTextureSetId: 'GG_Fieldstone', wallTextureTint: '#b09878' });
    expect(screen.getByRole('button', { name: 'Fieldstone Keep' }).getAttribute('aria-pressed')).toBe('true');
    expect(JSON.stringify(live().style)).toBe(layerBefore);
    expect(resolvedLooks(['r1', 'r3'])).toBe(othersBefore);
    expect(within(walls).getByTestId('v2-look-walls-source').textContent).toBe('Pinned');

    // Reset: the room inherits again, and inherits what the layer had all along.
    fireEvent.click(within(walls).getByRole('button', { name: 'Reset' }));
    expect(roomOf('r2').look).toBeUndefined();
    expect(JSON.stringify(live().style)).toBe(layerBefore);
    expect(resolvedLooks(['r1', 'r3'])).toBe(othersBefore);
    const r2 = resolveRoomLook(roomChain(useStore.getState(), live(), roomOf('r2')));
    expect([r2.wallTextureSetId, r2.wallTextureTint]).toEqual(['GG_Cave_Ink', '#a5b9ff']);
    expect(within(walls).getByTestId('v2-look-walls-source').textContent).toBe('Inherits Dungeon');

    // With nothing selected the same preset is the layer's, as before.
    select([]);
    fireEvent.click(screen.getByRole('button', { name: 'Fieldstone Keep' }));
    expect(live().style.wallTextureSetId).toBe('GG_Fieldstone');
  });

  it('a style preset with an area or a level selected pins on that scope, never on the layer', () => {
    seed({ areas: [{ id: 'ar', name: 'Lower dens' }] });
    const layerBefore = JSON.stringify(live().style);
    const levelId = useStore.getState().levels[0].id;
    render(<ToolSwatches tool="wall" tab="walls" onTab={() => {}} onOpenAssets={() => {}} />);
    select(['ar']);
    fireEvent.click(screen.getByRole('button', { name: 'Timber Palisade' }));
    expect(live().areas![0].look).toMatchObject({ wallTextureSetId: 'GG_Palisade' });
    select([levelId]);
    fireEvent.click(screen.getByRole('button', { name: 'Timber Palisade' }));
    expect(useStore.getState().levels[0].look).toMatchObject({ wallTextureSetId: 'GG_Palisade' });
    expect(JSON.stringify(live().style)).toBe(layerBefore);
    act(() => undoManager.undo());
    act(() => undoManager.undo());
    expect(live().areas![0].look).toBeUndefined();
    expect(useStore.getState().levels[0].look).toBeUndefined();
  });

  it('a floor texture pick pins on the selected room, not on the floors', () => {
    seed();
    select(['r2']);
    pickFloorTexture('pack:moss');
    expect(roomOf('r2').look).toEqual({ floorTextureId: 'pack:moss' });
    act(() => undoManager.undo());
    expect(roomOf('r2').look).toBeUndefined();
  });

  it('the Walls tab width edits the selected level, one undo step per drag', () => {
    seed();
    const levelId = useStore.getState().levels[0].id;
    select([levelId]);
    render(<ToolSettings tool="wall" />);
    const width = screen.getByRole('slider', { name: 'Width' });
    fireEvent.pointerDown(width);
    fireEvent.change(width, { target: { value: '0.3' } });
    fireEvent.change(width, { target: { value: '0.25' } });
    fireEvent.pointerUp(width, { target: { value: '0.25' } });
    expect(useStore.getState().levels[0].look).toEqual({ wallWidth: 0.25 });
    act(() => undoManager.undo());
    expect(useStore.getState().levels[0].look).toBeUndefined();
    expect(undoManager.canUndo()).toBe(false);
  });
});
