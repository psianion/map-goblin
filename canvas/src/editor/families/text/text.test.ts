import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { createDefaultState, createDungeonLayer } from '@/store/factories';
import type { Room, TextChild, ZoneChild } from '@/store/types';
import { createRegistry } from '@/editor/registry';
import type { CardFieldDef, ObjectKind } from '@/editor/registry';
import { RAIL_TOOLS } from '@/editor/registry/rail';
import { SHARED_SETTINGS } from '@/editor/registry/shared';
import { validateRegistry } from '@/editor/registry/validate';
import { createSettings } from '@/editor/registry/settings';
import { cards, families } from '@/editor/families';
import { TEXT_CARDS, text } from './index';

const input = () => ({ rail: RAIL_TOOLS, families: [...families], shared: SHARED_SETTINGS, cards: [...cards] });
const reg = createRegistry(input());
const settings = createSettings(reg, useStore);
const st = () => useStore.getState();

const label = (over: Partial<TextChild> = {}): TextChild => ({
  id: 't1', name: 'Label 1', childType: 'text', visible: true, text: 'Hall', position: { x: 2, y: 2 }, rotation: 0, scale: 1,
  fontSize: 0.8, color: '#222222', width: 2, height: 1, ...over,
});
const zone = (): ZoneChild => ({ id: 'z1', name: 'Pit', childType: 'zone', visible: true, shape: { kind: 'circle', position: { x: 3, y: 3 }, radius: 1 } });
const room = (over: Partial<Room> = {}): Room => ({ id: 'r1', name: 'Hall', number: 1, anchor: [2, 2], ...over }) as Room;

function seed(children: (TextChild | ZoneChild)[], rooms: Room[] = [], picked: string[] = children.map((c) => c.id)) {
  const levelId = st().ui.activeLevelId;
  const layer = { ...createDungeonLayer('Keep', levelId), id: 'd1', children, rooms, areas: [{ id: 'a1', name: 'Wing' }] };
  useStore.setState((s) => {
    s.layers = [layer];
    s.ui.activeLayerId = 'd1';
    s.selection.selectedIds = picked;
  });
}

const layer = () => st().layers[0] as { children: (TextChild | ZoneChild)[]; rooms: Room[]; areas: { id: string; name: string }[] };
function field<K extends ObjectKind>(kind: K, id: string): CardFieldDef<K> {
  const f = TEXT_CARDS.find((c) => c.kind === kind)?.fields.find((x) => x.id === id);
  if (!f) throw new Error(id);
  return f as unknown as CardFieldDef<K>;
}

beforeEach(() => {
  localStorage.clear();
  undoManager.clear();
  st().resetToDefault();
});

describe('the Text family', () => {
  it('passes every registry rule beside the other families, bindings included', () => {
    expect(validateRegistry(input(), createDefaultState())).toEqual([]);
  });

  it('holds Label, Zone and one Rooms tool under X, Label off N', () => {
    expect(text.key).toBe('X');
    expect(text.tools.map((t) => [t.label, t.key])).toEqual([
      ['Label', 'A'],
      ['Zone', 'Z'],
      ['Rooms', 'R'],
    ]);
    expect(reg.toolById('rooms')!.engine).toEqual(['roomRect', 'roomPolygon', 'divide']);
  });

  it('keeps the room views out of the tools: they live in the View menu', () => {
    const ids = text.tools.flatMap((t) => t.settings.map((s) => s.id));
    expect(ids.some((id) => /outline|labels|mood/i.test(id))).toBe(false);
    expect(reg.settingsByHome('rooms', 'panel').map((s) => s.id)).toEqual(['rooms.walls']);
    expect(reg.settingsByHome('rooms', 'dock').map((s) => s.id)).toEqual(['rooms.mode', 'rooms.divider']);
    expect(reg.toolById('rooms')!.dock.map((c) => c.id)).toEqual(['rooms.floor']);
  });

  it('the Rooms tool’s Draw row follows the engine tool in hand and swaps Walls for Divider on Divide', () => {
    const visible = (id: string) => {
      const def = reg.settingById(id)!;
      return !def.visibleWhen || def.visibleWhen((x) => settings.getSetting(x));
    };
    const hint = () => reg.toolById('rooms')!.hint(st());
    st().setActiveTool('roomRect');
    expect(settings.getSetting('rooms.mode')).toBe('rect');
    expect([visible('rooms.walls'), visible('rooms.divider')]).toEqual([true, false]);
    expect(hint().label).toBe('Rooms');
    settings.setSetting('rooms.mode', 'polygon');
    expect(st().tools.activeTool).toBe('roomPolygon');
    settings.setSetting('rooms.mode', 'divide');
    expect(st().tools.activeTool).toBe('divide');
    expect([visible('rooms.walls'), visible('rooms.divider')]).toEqual([false, true]);
    expect(hint().segments[0].text).toContain('Drag across a floor');
  });

  it('carries no Mood on the room, area or level cards', () => {
    for (const kind of ['room', 'area', 'level'] as const) {
      const ids = TEXT_CARDS.find((c) => c.kind === kind)!.fields.map((f) => f.id);
      expect(ids.some((id) => /mood/i.test(id)), kind).toBe(false);
    }
  });

  it('writes the walls and divider views and the next label', () => {
    settings.setSetting('rooms.walls', 'none');
    settings.setSetting('rooms.divider', 'wall');
    expect(st().ui).toMatchObject({ roomWalls: 'none', dividerMode: 'wall' });
    settings.setSetting('label.size', 1.5);
    settings.setSetting('label.colour', '#aa0000');
    expect(st().tools.settings.label).toMatchObject({ fontSize: 1.5, color: '#aa0000' });
    settings.setSetting('zone.shape', 'rect');
    expect(st().tools.settings.zone.mode).toBe('rect');
  });

  it('hides every label from the View menu', () => {
    expect(st().ui.labelsHidden).toBe(false);
    st().setLabelsHidden(true);
    expect(st().ui.labelsHidden).toBe(true);
  });
});

describe('the label card', () => {
  it('re-measures the box as the size changes, and undoes', () => {
    seed([label()]);
    const t = () => layer().children[0] as TextChild;
    const w0 = t().width;
    field('text', 'card.label.size').write(useStore, ['t1'], 1.6);
    expect(t().fontSize).toBe(1.6);
    expect(t().width).toBeGreaterThan(w0);
    undoManager.undo();
    expect(t().fontSize).toBe(0.8);
  });

  it('sets weight, backdrop, align and visible to players', () => {
    seed([label()]);
    const t = () => layer().children[0] as TextChild;
    field('text', 'card.label.weight').write(useStore, ['t1'], 'bold');
    field('text', 'card.label.backdrop').write(useStore, ['t1'], 'pill');
    field('text', 'card.label.align').write(useStore, ['t1'], 'left');
    field('text', 'card.label.players').write(useStore, ['t1'], true);
    expect(t()).toMatchObject({ weight: 'bold', backdrop: 'pill', align: 'left', players: true });
    field('text', 'card.label.align').write(useStore, ['t1'], 'centre');
    expect(t().align).toBeUndefined();
  });

  it('takes a style, the GM note grey with it', () => {
    seed([label()]);
    field('text', 'card.label.style').write(useStore, ['t1'], 'gm-note');
    expect(layer().children[0]).toMatchObject({ style: 'gm-note', backdrop: 'pill', align: 'left' });
  });
});

describe('the zone card', () => {
  it('names the shape in a word and moves and sizes the zone, undoably', () => {
    seed([zone()]);
    const z = () => layer().children[0] as ZoneChild;
    expect(field('zone', 'card.zone.shape').read(z())).toBe('Circle');
    field('zone', 'card.zone.place').write(useStore, ['z1'], { kind: 'circle', position: { x: 5, y: 6 }, radius: 2 });
    expect(z().shape).toEqual({ kind: 'circle', position: { x: 5, y: 6 }, radius: 2 });
    undoManager.undo();
    expect(z().shape).toEqual(zone().shape);
    field('zone', 'card.zone.name').write(useStore, ['z1'], '  Trap ');
    expect(z().name).toBe('Trap');
  });
});

describe('the room, area and level cards', () => {
  it('renames and renumbers a room and puts it in an area, each undoably', () => {
    seed([], [room(), room({ id: 'r2', name: 'Cellar', number: 2 })], ['r1']);
    field('room', 'card.room.name').write(useStore, ['r1'], 'Great hall');
    expect(layer().rooms[0].name).toBe('Great hall');
    field('room', 'card.room.area').write(useStore, ['r1'], 'a1');
    expect(layer().rooms.find((r) => r.id === 'r1')!.areaId).toBe('a1');
    undoManager.undo();
    undoManager.undo();
    expect(layer().rooms.find((r) => r.id === 'r1')).toMatchObject({ name: 'Hall' });
  });

  it('renames an area and a level', () => {
    seed([], [room()], ['a1']);
    field('area', 'card.area.name').write(useStore, ['a1'], 'East wing');
    expect(layer().areas[0].name).toBe('East wing');
    const levelId = st().ui.activeLevelId;
    field('level', 'card.level.name').write(useStore, [levelId], 'Ground');
    expect(st().levels.find((l) => l.id === levelId)!.name).toBe('Ground');
  });
});
