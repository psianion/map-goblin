import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { undoManager } from './undoManager';
import { createDungeonLayer } from './factories';
import { compareLayerIds } from './selectors';
import { CloneLevelCommand } from './layerCommands';
import type { AnyChild, DungeonLayer, WallSegment } from './types';
import type { ScenePrep } from '../shared/prep';

const child = (id: string, childType: string, extra: Record<string, unknown> = {}): AnyChild =>
  ({ id, name: id, childType, visible: true, ...extra }) as unknown as AnyChild;

const wall = (id: string): WallSegment =>
  ({ id, points: [[0, 0], [4, 0]], wallType: 'normal', direction: 'both', color: '#000000', roughness: 0 }) as WallSegment;

const dungeons = () => useStore.getState().layers.filter((l): l is DungeonLayer => l.type === 'dungeon');

/** The default map's level with its one layer holding a room, a zone, a door, a light and labels, plus prep on them. */
function seed(): { levelId: string; layerId: string } {
  const s = useStore.getState();
  const levelId = s.levels[0].id;
  const layerId = dungeons()[0].id;
  useStore.setState((st) => {
    st.levels[0].name = 'Cellars';
    const l = st.layers.find((x) => x.id === layerId) as DungeonLayer;
    l.standaloneWalls = [wall('w1')];
    l.children = [
      child('z1', 'zone', { shape: { kind: 'point', x: 1, y: 1 } }),
      child('d1', 'door', { wallId: 'w1', position: [2, 0], angle: 0, width: 1, style: 'wooden', state: 'closed', isSecret: false }),
      child('l1', 'light', { color: '#fff', radius: 2, featherRadius: 1, intensity: 1, falloff: 'linear', position: { x: 1, y: 1 } }),
      child('t1', 'text', { text: 'Hall', position: { x: 1, y: 1 }, rotation: 0, scale: 1, fontSize: 1, bound: { kind: 'room', id: 'r1' } }),
      child('t2', 'text', { text: 'Door', position: { x: 2, y: 0 }, rotation: 0, scale: 1, fontSize: 1, bound: { kind: 'door', id: 'd1' } }),
    ];
    l.rooms = [{ id: 'r1', name: 'Hall', number: 1, anchor: [1, 1] }];
    l.materials = [{ id: 'm1', material: 'GG_Cave_Ink', rings: [], smooth: false, border: true }];
    const prep: ScenePrep = {
      version: 3,
      rooms: [{ roomId: 'r1', readAloud: 'Dust', notes: '', treasure: '', traps: [], checks: [] }],
      notes: [
        { id: 'n1', zoneId: 'z1', title: 'Zone note', body: '', imageKeys: [], showOnReveal: false },
        { id: 'n2', zoneId: '', roomId: 'r1', title: 'Room note', body: '', imageKeys: [], showOnReveal: false },
        { id: 'n3', zoneId: 'elsewhere', title: 'Other', body: '', imageKeys: [], showOnReveal: false },
      ],
      triggers: [
        { id: 'tr1', name: 'Enter', when: { kind: 'enter-region', zoneId: 'z1' }, actions: [{ kind: 'light', lightId: 'l1', on: true }], once: true, enabled: true },
        { id: 'tr2', name: 'Seen', when: { kind: 'room-revealed', roomId: 'r1' }, actions: [], once: true, enabled: true },
        { id: 'tr3', name: 'Away', when: { kind: 'enter-region', zoneId: 'elsewhere' }, actions: [], once: true, enabled: true },
      ],
    };
    st.prep = prep;
  });
  return { levelId, layerId };
}

const clone = (levelId: string) => {
  const cmd = new CloneLevelCommand(levelId);
  undoManager.execute(cmd);
  return cmd;
};

describe('CloneLevelCommand', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('adds "<name> copy" directly above the source with a copy of each of its layers', () => {
    const { levelId } = seed();
    const cmd = clone(levelId);
    const { levels } = useStore.getState();
    expect(levels.map((l) => l.id)).toEqual([cmd.newId, levelId]);
    expect(levels[0].name).toBe('Cellars copy');
    const copies = dungeons().filter((l) => l.levelId === cmd.newId);
    expect(copies).toHaveLength(1);
    expect(copies[0].children).toHaveLength(5);
  });

  it('gives every layer, child, wall, room and patch a new id', () => {
    const { levelId, layerId } = seed();
    const cmd = clone(levelId);
    const copy = dungeons().find((l) => l.levelId === cmd.newId)!;
    expect(copy.id).not.toBe(layerId);
    const old = new Set(['z1', 'd1', 'l1', 't1', 't2', 'w1', 'r1', 'm1']);
    const ids = [...copy.children.map((c) => c.id), ...copy.standaloneWalls.map((w) => w.id), ...copy.rooms!.map((r) => r.id), ...copy.materials!.map((p) => p.id)];
    expect(ids).toHaveLength(8);
    expect(ids.some((id) => old.has(id))).toBe(false);
  });

  it("points the copy's door and bound labels at the copy's own wall, room and door", () => {
    const { levelId } = seed();
    const cmd = clone(levelId);
    const copy = dungeons().find((l) => l.levelId === cmd.newId)!;
    const door = copy.children.find((c) => c.childType === 'door') as AnyChild & { wallId: string };
    expect(door.wallId).toBe(copy.standaloneWalls[0].id);
    const bound = (name: string) => (copy.children.find((c) => c.name === name) as AnyChild & { bound: { id: string } }).bound.id;
    expect(bound('t1')).toBe(copy.rooms![0].id);
    expect(bound('t2')).toBe(door.id);
  });

  it("copies the prep anchored on the level onto the clone's room, zone and light", () => {
    const { levelId } = seed();
    const cmd = clone(levelId);
    const copy = dungeons().find((l) => l.levelId === cmd.newId)!;
    const roomId = copy.rooms![0].id;
    const zoneId = copy.children.find((c) => c.childType === 'zone')!.id;
    const lightId = copy.children.find((c) => c.childType === 'light')!.id;
    const prep = useStore.getState().prep!;
    expect(prep.rooms.map((k) => k.roomId)).toEqual(['r1', roomId]);
    expect(prep.rooms[1].readAloud).toBe('Dust');
    const notes = prep.notes.slice(3);
    expect(notes.map((n) => [n.title, n.zoneId, n.roomId])).toEqual([
      ['Zone note', zoneId, undefined],
      ['Room note', '', roomId],
    ]);
    expect(notes.every((n) => !['n1', 'n2'].includes(n.id))).toBe(true);
    const triggers = prep.triggers.slice(3);
    expect(triggers.map((t) => t.when)).toEqual([
      { kind: 'enter-region', zoneId },
      { kind: 'room-revealed', roomId },
    ]);
    expect(triggers[0].actions).toEqual([{ kind: 'light', lightId, on: true }]);
    expect(triggers.every((t) => !['tr1', 'tr2'].includes(t.id))).toBe(true);
  });

  it('undoes as one step: the level, its layers and the copied prep go, the source untouched', () => {
    const { levelId, layerId } = seed();
    const before = structuredClone(useStore.getState().prep);
    const layersBefore = useStore.getState().layers.length;
    clone(levelId);
    undoManager.undo();
    const s = useStore.getState();
    expect(s.levels.map((l) => l.id)).toEqual([levelId]);
    expect(s.layers).toHaveLength(layersBefore);
    expect(s.prep).toEqual(before);
    expect(dungeons().find((l) => l.id === layerId)!.children).toHaveLength(5);
    undoManager.redo();
    expect(useStore.getState().levels).toHaveLength(2);
    expect(useStore.getState().prep!.triggers).toHaveLength(5);
  });

  it('leaves a prep-less map prep-less after undo', () => {
    const levelId = useStore.getState().levels[0].id;
    expect(useStore.getState().prep).toBeNull();
    clone(levelId);
    undoManager.undo();
    expect(useStore.getState().prep).toBeNull();
  });
});

describe('compareLayerIds', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  /** Two levels: the default one on show, and "Ground" with two layers, the second hidden. */
  function twoLevels() {
    const s = useStore.getState();
    const shown = s.levels[0].id;
    s.addLevel({ id: 'ground', name: 'Ground' });
    const a = createDungeonLayer('A', 'ground');
    const b = { ...createDungeonLayer('B', 'ground'), visible: false };
    useStore.getState().addLayer(a);
    useStore.getState().addLayer(b);
    useStore.getState().setActiveLevelId(shown);
    return { shown, a, b };
  }

  it('is empty when nothing is compared', () => {
    twoLevels();
    expect(compareLayerIds(useStore.getState())).toEqual([]);
  });

  it("draws the compared level's visible dungeon layers only, never the background", () => {
    const { a } = twoLevels();
    useStore.getState().setCompare({ levelId: 'ground', opacity: 0.4 });
    expect(compareLayerIds(useStore.getState())).toEqual([a.id]);
  });

  it('draws nothing when the compared level is the one on show or is gone', () => {
    twoLevels();
    useStore.getState().setCompare({ levelId: 'ground', opacity: 0.4 });
    useStore.getState().setActiveLevelId('ground');
    expect(compareLayerIds(useStore.getState())).toEqual([]);
    useStore.getState().setCompare({ levelId: 'nowhere', opacity: 0.4 });
    expect(compareLayerIds(useStore.getState())).toEqual([]);
  });

  it('is view state: never in the saved map, and a loaded map starts without it', () => {
    twoLevels();
    useStore.getState().setCompare({ levelId: 'ground', opacity: 0.4 });
    const saved = useStore.getState().getSerializableState();
    expect(JSON.stringify(saved)).not.toContain('compare');
    useStore.getState().loadFromFile(saved);
    expect(useStore.getState().ui.compare).toBeNull();
  });
});
