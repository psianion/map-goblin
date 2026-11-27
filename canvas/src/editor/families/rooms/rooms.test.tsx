import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ info: vi.fn(), warning: vi.fn(), subtle: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@dnd/ui/toast', () => ({ notify: toast }));

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '@dnd/core/src/geometry/Clipper2Engine';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { createDefaultState, createDungeonLayer } from '@/store/factories';
import type { DungeonLayer, Room, ShapeChild, ThresholdSegment } from '@/store/types';
import { suggestRooms } from '@dnd/core/src/shared/suggestRooms';
import { roomContextOf } from '@dnd/core/src/shared/roomFloor';
import { registry, type CardFieldDef, type SettingMeta } from '@/editor/registry';
import { validateRegistry } from '@/editor/registry/validate';
import { RAIL_TOOLS } from '@/editor/registry/rail';
import { SHARED_SETTINGS } from '@/editor/registry/shared';
import { createSettings } from '@/editor/registry/settings';
import { cards, families } from '@/editor/families';
import { registryShortcuts } from '@/shortcuts/registryShortcuts';
import {
  acceptAllSuggestions,
  acceptSuggestedRoom,
  rejectSuggestedRoom,
  removeSuggestedLine,
  startOutlineFor,
  suggestOnActiveLayer,
} from '@/editor/models/roomActions';
import { publishRoomsLine, ROOM_OPEN, roomIsOpen, SUGGEST_NOTHING } from '@/editor/models/roomModel';
import { OpenSpaceField } from '@/editor/families/text/RoomFields';
import { RoomsLine } from '@/editor/dialogs/PublishDialog';
import { rooms as roomsFamily } from './index';
import { SuggestPanel } from './RoomsControls';

/** jsdom cannot fetch the .wasm: hand it the bytes, as the core tests do. */
beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

const st = () => useStore.getState();
const settings = createSettings(registry, useStore);
const input = () => ({ rail: RAIL_TOOLS, families: [...families], shared: SHARED_SETTINGS, cards: [...cards] });

/** A 20 by 10 floor on the active layer, as a hall split nowhere yet. */
const HALL: [number, number][][] = [[[0, 0], [20, 0], [20, 10], [0, 10]]];
/** The line a Suggest would draw across it. */
const LINE: ThresholdSegment = { id: 'line-1', points: [[10, -0.3], [10, 10.3]] };

function seed(rooms: Room[] = [], floor = HALL): DungeonLayer {
  const levelId = st().ui.activeLevelId;
  const layer = { ...createDungeonLayer('Keep', levelId), id: 'd1', rooms, mergedFloor: floor } as DungeonLayer;
  useStore.setState((s) => {
    s.layers = [layer];
    s.ui.activeLayerId = 'd1';
  });
  return st().layers[0] as DungeonLayer;
}
const layer = () => st().layers[0] as DungeonLayer;

/** Proposals as Suggest leaves them when it found `LINE`. */
function proposeWithLine(): void {
  const l = layer();
  st().setRoomSuggestions({ layerId: l.id, rooms: suggestRooms(l, roomContextOf(st(), l), [LINE]), divides: [LINE], rejected: [] });
}

beforeEach(() => {
  undoManager.clear();
  st().resetToDefault();
  Object.values(toast).forEach((f) => f.mockReset());
});

afterEach(cleanup);

describe('the Rooms family', () => {
  it('sits on the rail under U, beside the others, and passes every registry rule', () => {
    expect(validateRegistry(input(), createDefaultState())).toEqual([]);
    expect(roomsFamily.key).toBe('U');
    expect(registry.families.map((f) => f.id)).toContain('rooms');
  });

  it('U puts Outline in hand with no flyout; every other family still opens its flyout', () => {
    const shell = { flyout: vi.fn(() => null), setFlyout: vi.fn(), pickTool: vi.fn(), activeTool: () => undefined, lastTool: () => undefined, card: () => null };
    const keys = registryShortcuts(registry, settings, shell);
    keys.find((k) => k.id === 'family.rooms')!.run();
    expect(shell.setFlyout).toHaveBeenCalledWith(null);
    expect(shell.pickTool).toHaveBeenCalledWith(roomsFamily.tools[0]);
    expect(registry.families.filter((f) => f.opensOnFirstTool).map((f) => f.id)).toEqual(['rooms']);
    shell.setFlyout.mockClear();
    shell.pickTool.mockClear();
    keys.find((k) => k.id === 'family.text')!.run();
    expect(shell.setFlyout).toHaveBeenCalledWith('text');
    expect(shell.pickTool).not.toHaveBeenCalled();
  });

  it('opens on Outline, then Divide and Draw room, each with its own key', () => {
    expect(roomsFamily.tools.map((t) => [t.label, t.key, t.engine.join(',')])).toEqual([
      ['Outline', 'L', 'outline'],
      ['Divide', 'K', 'divide'],
      ['Draw room', 'R', 'roomRect,roomPolygon'],
    ]);
  });

  it('carries Suggest, the outlines switch and the list in every tool’s panel', () => {
    for (const t of roomsFamily.tools) expect(t.panelExtra, t.id).toBeDefined();
    expect(new Set(roomsFamily.tools.map((t) => t.panelExtra)).size).toBe(1);
  });

  it('Draw room’s Shape row follows the engine tool in hand; Divide keeps its Divider', () => {
    st().setActiveTool('roomRect');
    expect(settings.getSetting('rooms.shape')).toBe('rect');
    settings.setSetting('rooms.shape', 'polygon');
    expect(st().tools.activeTool).toBe('roomPolygon');
    settings.setSetting('rooms.divider', 'wall');
    expect(st().ui.dividerMode).toBe('wall');
    expect(registry.settingsByHome('roomDraw', 'panel').map((s) => s.id)).toEqual(['rooms.walls']);
    expect(registry.settingsByHome('roomDivide', 'dock').map((s) => s.id)).toEqual(['rooms.divider']);
  });

  it('gives every tool a one-line hint, and Outline names the room it is drawing for', () => {
    for (const t of roomsFamily.tools) {
      const h = t.hint(st());
      expect(h.label, t.id).toBeTruthy();
      expect(h.segments.length, t.id).toBeGreaterThan(0);
    }
    const outline = registry.toolById('roomOutline')!;
    expect(outline.hint(st()).segments[0].text).toMatch(/^Drag a rectangle, or click the corners/);
    seed([{ id: 'r1', name: 'Crypt', number: 1, anchor: [3, 3] }]);
    startOutlineFor('r1', 'd1');
    expect(st().tools.activeTool).toBe('outline');
    expect(outline.hint(st()).segments[0].text).toMatch(/^Outline Crypt:/);
  });
});

describe('Suggest', () => {
  it('says why when it finds nothing, in the toast and in the panel', () => {
    seed([], []);
    expect(suggestOnActiveLayer()).toBe(0);
    expect(toast.info).toHaveBeenCalledWith(SUGGEST_NOTHING);
    const { getByTestId, queryByTestId } = render(<SuggestPanel />);
    expect(queryByTestId('rooms-suggest-nothing')).toBeNull();
    act(() => fireEvent.click(getByTestId('rooms-suggest-button')));
    expect(getByTestId('rooms-suggest-nothing').textContent).toBe(SUGGEST_NOTHING);
  });

  it('finds the ghosts again from the lines left when one is taken away', () => {
    seed();
    proposeWithLine();
    expect(st().ui.roomSuggestions!.rooms).toHaveLength(2);
    removeSuggestedLine('line-1');
    const list = st().ui.roomSuggestions!;
    expect(list.divides).toEqual([]);
    expect(list.rooms).toHaveLength(1);
    expect(list.rooms[0].face && Math.abs(list.rooms[0].face.length)).toBeGreaterThan(0);
  });

  it('leaves a ghost the DM took away out when the ghosts are found again', () => {
    seed();
    const l = layer();
    // Two lines: three ghosts. Take the left one away, then a line: the left space stays out.
    const second: ThresholdSegment = { id: 'line-2', points: [[5, -0.3], [5, 10.3]] };
    st().setRoomSuggestions({ layerId: l.id, rooms: suggestRooms(l, roomContextOf(st(), l), [LINE, second]), divides: [LINE, second], rejected: [] });
    expect(st().ui.roomSuggestions!.rooms).toHaveLength(3);
    const left = st().ui.roomSuggestions!.rooms.find((r) => r.anchor[0] < 5)!;
    rejectSuggestedRoom(left.id);
    removeSuggestedLine('line-1');
    // Without line 1 the right side is one space; the left (rejected) stays out.
    expect(st().ui.roomSuggestions!.rooms).toHaveLength(1);
    expect(st().ui.roomSuggestions!.rooms[0].anchor[0]).toBeGreaterThan(5);
  });

  it('accepts all as one undo step, the lines first, the rooms after, renumbering nothing', () => {
    seed([{ id: 'mine', name: 'Shrine', number: 7, anchor: [30, 30] }]);
    proposeWithLine();
    const ghosts = st().ui.roomSuggestions!.rooms.map((r) => r.number);
    expect(ghosts).toEqual([8, 9]);
    acceptAllSuggestions();
    expect(st().ui.roomSuggestions).toBeNull();
    expect(layer().thresholds?.map((t) => t.id)).toEqual(['line-1']);
    expect(layer().rooms!.map((r) => r.number)).toEqual([7, 8, 9]);
    undoManager.undo();
    expect(layer().thresholds ?? []).toEqual([]);
    expect(layer().rooms!.map((r) => r.id)).toEqual(['mine']);
  });

  it('keeps one ghost with the lines it was found with, the rest staying up', () => {
    seed();
    proposeWithLine();
    const [first] = st().ui.roomSuggestions!.rooms;
    acceptSuggestedRoom(first.id);
    expect(layer().thresholds?.map((t) => t.id)).toEqual(['line-1']);
    expect(layer().rooms!.map((r) => r.id)).toEqual([first.id]);
    expect(st().ui.roomSuggestions!.rooms).toHaveLength(1);
    expect(st().ui.roomSuggestions!.divides).toEqual([]);
  });
});

describe('a room that lost its floor', () => {
  const field = (id: string) => cards.find((c) => c.kind === 'room')!.fields.find((f) => f.id === id) as CardFieldDef<'room'>;

  it('says the space is open on its card, and Outline it puts the Outline tool in hand for it', () => {
    const open: Room = { id: 'r1', name: 'Crypt', number: 1, anchor: [50, 50], orphaned: true };
    seed([open]);
    expect(roomIsOpen(open)).toBe(true);
    expect(roomIsOpen({ area: 12 })).toBe(false);
    expect(field('card.room.open').visibleWhen!(open)).toBe(true);
    expect(field('card.room.open').visibleWhen!({ ...open, orphaned: false, area: 12 })).toBe(false);
    expect((field('card.room.size').read as (r: Room) => string)(open)).toMatch(/^Open/);
    const def = field('card.room.open') as unknown as SettingMeta<string>;
    const { getByTestId, getByRole } = render(<OpenSpaceField def={def} value="r1" onChange={() => {}} />);
    expect(getByTestId('room-open').textContent).toContain(ROOM_OPEN);
    act(() => fireEvent.click(getByRole('button', { name: /Outline it/ })));
    expect(st().tools.activeTool).toBe('outline');
    expect(st().ui.outlineRoomId).toBe('r1');
  });
});

describe('the Publish line', () => {
  const shape = (): ShapeChild =>
    ({ id: 's1', name: 'Floor', childType: 'shape', visible: true, shapeType: 'rectangle', contours: HALL }) as ShapeChild;

  it('counts the rooms, and offers Suggest only for a map with floor and no rooms', () => {
    seed([], []);
    expect(publishRoomsLine(st().layers)).toEqual({ count: 0, text: 'No rooms yet.', suggest: false });
    seed();
    expect(publishRoomsLine(st().layers).suggest).toBe(true);
    useStore.setState((s) => {
      (s.layers[0] as DungeonLayer).mergedFloor = null;
      (s.layers[0] as DungeonLayer).children = [shape()];
    });
    expect(publishRoomsLine(st().layers).suggest).toBe(true);
    seed([{ id: 'a', name: 'A', anchor: [1, 1] }, { id: 'b', name: 'B', anchor: [15, 5] }]);
    expect(publishRoomsLine(st().layers)).toEqual({ count: 2, text: '2 rooms.', suggest: false });
  });

  it('draws the count and the Suggest rooms link, which hands over to the editor', () => {
    seed();
    const onSuggest = vi.fn();
    const { getByTestId } = render(<RoomsLine onSuggest={onSuggest} />);
    expect(getByTestId('v2-publish-rooms').textContent).toContain('No rooms yet.');
    act(() => fireEvent.click(getByTestId('v2-publish-suggest-rooms')));
    expect(onSuggest).toHaveBeenCalledOnce();
  });
});
