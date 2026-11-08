import { describe, it, expect } from 'vitest';
import type { DungeonLayer, Layer, RoomNote, ScenePrep, TriggerDef, ZoneChild } from '@/store/types';
import {
  buildPrepGroups,
  centreStageOn,
  collectZones,
  noteInert,
  triggerInert,
  triggerSummary,
  zoneAnchor,
} from './prepModel';

const zone = (id: string, name: string, shape: unknown) =>
  ({ id, name, childType: 'zone', visible: true, shape }) as DungeonLayer['children'][number];

function layers(extra: DungeonLayer['children'] = []): Layer[] {
  return [
    {
      id: 'l1',
      type: 'dungeon',
      name: 'Dungeon',
      children: [
        zone('z-guard', 'Guard post', { kind: 'circle', position: { x: 10, y: 10 }, radius: 3 }),
        zone('z-shrine', 'Old shrine', { kind: 'point', position: { x: 50, y: 50 } }),
        zone('z-pin', 'Armoury', { kind: 'point', position: { x: 5, y: 5 } }),
        ...extra,
      ],
      // One room around the guard post only — the shrine pin sits outside every room.
      rooms: [{ id: 'r1', boundary: [[0, 0], [20, 0], [20, 20], [0, 20]] }],
    } as unknown as DungeonLayer,
  ];
}

const trigger = (over: Partial<TriggerDef> & Pick<TriggerDef, 'id' | 'when'>): TriggerDef => ({
  name: over.id,
  actions: [],
  once: true,
  enabled: true,
  ...over,
});

const note = (over: Partial<RoomNote> & Pick<RoomNote, 'id' | 'zoneId'>): RoomNote => ({
  title: 'Note',
  body: '',
  imageKeys: [],
  showOnReveal: false,
  ...over,
});

const prep = (triggers: TriggerDef[], notes: RoomNote[] = []): ScenePrep => ({ version: 3, triggers, notes, rooms: [] });

describe('triggerInert', () => {
  const zones = collectZones(layers([{ id: 'lamp', childType: 'light' } as unknown as DungeonLayer['children'][number]]));

  it('passes a well-formed trigger', () => {
    expect(triggerInert(trigger({ id: 't', when: { kind: 'enter-region', zoneId: 'z-guard' } }), zones)).toBeNull();
    expect(triggerInert(trigger({ id: 't', when: { kind: 'room-revealed', zoneId: 'z-pin' } }), zones)).toBeNull();
  });

  it('names why the table would never fire it', () => {
    const t = (when: TriggerDef['when'], actions: TriggerDef['actions'] = []) =>
      triggerInert(trigger({ id: 't', when, actions }), zones);
    expect(t({ kind: 'enter-region', zoneId: 'z-gone' })).toBe('zone deleted');
    expect(t({ kind: 'room-revealed', zoneId: 'z-guard' })).toBe('needs a point zone');
    expect(t({ kind: 'room-revealed', zoneId: 'z-shrine' })).toBe('pin not inside a room');
    expect(t({ kind: 'within-radius', zoneId: 'z-pin' })).toBe('zone has no area');
    const region = { kind: 'enter-region', zoneId: 'z-guard' } as const;
    expect(t(region, [{ kind: 'light', lightId: 'lamp', on: true }])).toBeNull();
    expect(t(region, [{ kind: 'light', lightId: 'nope', on: true }])).toBe('light missing');
    expect(t(region, [{ kind: 'trap', text: '', damage: 'lots' }])).toBe('bad damage formula');
    expect(
      t(region, [{ kind: 'encounter', name: 'E', spawn: true, seedInitiative: true, monsters: [] }]),
    ).toBe('encounter has no monsters');
    expect(
      t(region, [
        {
          kind: 'encounter',
          name: 'E',
          spawn: true,
          seedInitiative: true,
          monsters: [{ id: 'm', name: 'Orc', count: 1, hp: 'many' }],
        },
      ]),
    ).toBe('bad monster HP formula');
  });
});

describe('noteInert', () => {
  const zones = collectZones(layers());

  it('only checks the room of a note that pops', () => {
    expect(noteInert(note({ id: 'n', zoneId: 'z-shrine' }), zones)).toBeNull();
    expect(noteInert(note({ id: 'n', zoneId: 'z-shrine', showOnReveal: true }), zones)).toBe('pin not inside a room');
    expect(noteInert(note({ id: 'n', zoneId: 'z-pin', showOnReveal: true }), zones)).toBeNull();
    expect(noteInert(note({ id: 'n', zoneId: 'z-gone' }), zones)).toBe('zone deleted');
  });
});

describe('buildPrepGroups', () => {
  it('is empty without prep', () => {
    expect(buildPrepGroups(null, layers())).toEqual([]);
    expect(buildPrepGroups(prep([]), layers())).toEqual([]);
  });

  it('groups rows by zone, summarizes, and badges Pops and Inert', () => {
    const groups = buildPrepGroups(
      prep(
        [
          trigger({
            id: 't-trap',
            name: 'Bear trap',
            when: { kind: 'enter-region', zoneId: 'z-guard' },
            actions: [{ kind: 'trap', text: 'Snap!', save: { ability: 'dex', dc: 13 }, damage: '2d6' }],
          }),
          trigger({
            id: 't-ambush',
            name: 'Goblin ambush',
            when: { kind: 'enter-region', zoneId: 'z-guard' },
            once: false,
            enabled: false,
            actions: [
              {
                kind: 'encounter',
                name: 'Goblin ambush',
                spawn: true,
                seedInitiative: true,
                monsters: [
                  { id: 'm1', name: 'Skirmisher', count: 3 },
                  { id: 'm2', name: 'Warg', count: 1 },
                ],
              },
            ],
          }),
          trigger({ id: 't-orphan', name: 'Brazier lights', when: { kind: 'room-revealed', zoneId: 'z-shrine' } }),
          trigger({ id: 't-lost', name: 'Lost trigger', when: { kind: 'enter-region', zoneId: 'z-gone' } }),
        ],
        [note({ id: 'n1', zoneId: 'z-guard', title: 'Read-aloud: first sight', showOnReveal: true, imageKeys: ['k1'] })],
      ),
      layers(),
    );

    // Zone-name order, the deleted zone last.
    expect(groups.map((g) => g.zoneName)).toEqual(['Guard post', 'Old shrine', 'Deleted zone']);
    expect(groups[2].zone).toBeNull();

    const guard = groups[0].rows;
    expect(guard.map((r) => r.kind)).toEqual(['trigger', 'encounter', 'note']);
    expect(guard[0].summary).toBe('Enter region → Trap · DC 13 DEX · 2d6');
    expect(guard[0]).toMatchObject({ once: true, enabled: true, inert: null, pops: false });
    expect(guard[1].summary).toBe('Enter region → 3× Skirmisher, 1× Warg');
    expect(guard[1]).toMatchObject({ once: false, enabled: false });
    expect(guard[2]).toMatchObject({ name: 'Read-aloud: first sight', pops: true, summary: 'Note · DM only · 1 image' });
    expect(guard[2].once).toBeUndefined();

    expect(groups[1].rows[0].inert).toBe('pin not inside a room');
    expect(groups[2].rows[0].inert).toBe('zone deleted');
  });

  it('sorts zones by name, not by authoring order', () => {
    const groups = buildPrepGroups(
      prep([
        trigger({ id: 'a', when: { kind: 'enter-region', zoneId: 'z-guard' } }),
        trigger({ id: 'b', when: { kind: 'room-revealed', zoneId: 'z-pin' } }),
      ]),
      layers(),
    );
    expect(groups.map((g) => g.zoneName)).toEqual(['Armoury', 'Guard post']);
  });

  it('names an untitled note', () => {
    const [g] = buildPrepGroups(prep([], [note({ id: 'n', zoneId: 'z-guard', title: '' })]), layers());
    expect(g.rows[0].name).toBe('Untitled note');
  });
});

describe('triggerSummary', () => {
  it('says when a trigger does nothing', () => {
    expect(triggerSummary(trigger({ id: 't', when: { kind: 'within-radius', zoneId: 'z' } }))).toBe(
      'Within radius → no actions',
    );
  });
});

describe('camera target', () => {
  it('anchors on the rect centre or the point', () => {
    const rect = { shape: { kind: 'rect', x: 2, y: 4, width: 6, height: 2 } } as ZoneChild;
    const circle = { shape: { kind: 'circle', position: { x: 7, y: 9 }, radius: 3 } } as ZoneChild;
    expect(zoneAnchor(rect)).toEqual({ x: 5, y: 5 });
    expect(zoneAnchor(circle)).toEqual({ x: 7, y: 9 });
  });

  it('centres the point in the visible gap, not the window', () => {
    const gap = { left: 76, top: 100, right: 1000, bottom: 700 };
    const pos = centreStageOn({ x: 10, y: 20 }, 40, gap);
    // The world point lands at the middle of the gap on screen.
    expect(10 * 40 + pos.x).toBe(538);
    expect(20 * 40 + pos.y).toBe(400);
  });
});
