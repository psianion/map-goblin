// The Sprint 3 gate map is a measurement instrument: every acceptance number (reveal
// latency, fps, redaction) is only meaningful if the map still carries the load it was
// authored to carry. This walks `emberhold-crypt.mapbuilder` through the two real loader
// paths — the server's `.mapbuilder` validator and the client's player-side redaction —
// and then re-derives its room ids, door bindings and occlusion with the same core
// functions the editor and the runner use, so a drifted fixture fails here and not
// halfway through a browser gate.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AnyChild, AssetChild, DoorChild, LightChild, Room, WaterChild } from '@dnd/core/src/shared/types';
import type { DungeonLayer } from '@dnd/core/src/store/types';
import { computeStableRoomId } from '@dnd/core/src/shared/roomUtils';
import { bindDoorToRooms } from '@dnd/core/src/shared/roomBinding';
import { buildOcclusionSegments } from '@dnd/core/src/shared/occlusion';
import { pointInPolygon } from '@dnd/core/src/engine/hitTest';
import { validateMapData } from '../../../server/src/mapImport';
import { withoutSecretDoors } from './loadSceneMap';

/** World units are grid cells — the same constant `roomSync` detects rooms with. */
const GRID_SIZE = 1;

export const GATE_MAP = join(import.meta.dirname, '../../../testdata/emberhold-crypt.mapbuilder');

const raw = readFileSync(GATE_MAP, 'utf8');
const imported = validateMapData(JSON.parse(raw));
if (!imported.ok) throw new Error(`gate map failed import: ${imported.error}`);
const map = imported.data;

const layer = map.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const rooms: Room[] = layer.rooms ?? [];
const kids = <T extends AnyChild>(t: AnyChild['childType']) =>
  layer.children.filter((c): c is T => c.childType === t);
const doors = kids<DoorChild>('door');
const roomById = new Map(rooms.map((r) => [r.id, r]));

/** Rooms reachable from `start` through the doors left in `graph`. */
function reachable(start: string, usable: DoorChild[]): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const at = queue.shift()!;
    for (const d of usable) {
      const next = d.roomA === at ? d.roomB : d.roomB === at ? d.roomA : null;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

const roomAt = (p: [number, number]) => rooms.find((r) => pointInPolygon(p, r.boundary)) ?? null;
/** The stair corridor the party walks in through — the entry node of every walkthrough. */
const ENTRY = roomAt([9, 5])!;

describe('sprint 3 gate map — Emberhold Crypt', () => {
  it('imports through the server validator with the authored name', () => {
    expect(imported.name).toBe('Emberhold Crypt');
    expect(map.version).toBe('3.0');
  });

  it('carries the acceptance-row content budget', () => {
    expect(layer.standaloneWalls.length).toBeGreaterThanOrEqual(200);
    expect(kids<LightChild>('light')).toHaveLength(4);
    expect(kids<WaterChild>('water').length).toBeGreaterThan(0);
    expect(kids<AssetChild>('asset').length).toBeGreaterThan(20);
    // Terrain: a palette plus both splat bitmaps, not an empty stub.
    expect(map.mapSettings.terrain?.palette.filter(Boolean).length).toBeGreaterThan(0);
    expect(map.customImages['__terrain-splat-0__']).toMatch(/^data:image\/png;base64,/);
    expect(map.customImages['__terrain-splat-1__']).toMatch(/^data:image\/png;base64,/);
  });

  it('zones both rooms and corridors, with room ids core will re-derive unchanged', () => {
    expect(rooms.filter((r) => !r.isPathway).length).toBeGreaterThanOrEqual(5);
    expect(rooms.filter((r) => r.isPathway).length).toBeGreaterThanOrEqual(5);
    expect(new Set(rooms.map((r) => r.id)).size).toBe(rooms.length);
    for (const r of rooms) {
      expect(r.boundary.length).toBeGreaterThanOrEqual(3);
      // Re-detection must not renumber a room out from under its fog state (D1).
      expect(r.id).toBe(computeStableRoomId(r.centroid, GRID_SIZE));
      expect(layer.roomNameOverrides?.[r.id]).toBe(r.name);
    }
    // The perf gate stands 20 tokens in the torchlit chamber.
    const biggest = Math.max(...rooms.filter((r) => !r.isPathway).map((r) => r.area));
    expect(biggest).toBeGreaterThanOrEqual(20 * 4);
  });

  it('binds every door to a real wall and the two rooms core computes', () => {
    const wallIds = new Set(layer.standaloneWalls.map((w) => w.id));
    for (const d of doors) {
      expect(wallIds.has(d.wallId)).toBe(true);
      const bound = bindDoorToRooms(d, layer.standaloneWalls, rooms);
      expect({ id: d.id, ...bound }).toEqual({ id: d.id, roomA: d.roomA, roomB: d.roomB });
      expect(roomById.has(d.roomA!)).toBe(true);
      expect(roomById.has(d.roomB!)).toBe(true);
    }
  });

  it('has a secret door and a locked door on the walkthrough path', () => {
    const secret = doors.filter((d) => d.isSecret);
    const locked = doors.filter((d) => d.state === 'locked');
    expect(secret.length).toBeGreaterThanOrEqual(1);
    expect(locked.length).toBeGreaterThanOrEqual(1);

    // Every room is reachable from the entry stair, so a walkthrough can visit all of them.
    expect(reachable(ENTRY.id, doors).size).toBe(rooms.length);

    // …and each of those doors is the only way on, so the party has to deal with it
    // rather than walking around it.
    for (const gate of [...secret, ...locked]) {
      const without = reachable(ENTRY.id, doors.filter((d) => d.id !== gate.id));
      expect(without.size).toBeLessThan(rooms.length);
    }
  });

  it('feeds the lighting pass door-aware occlusion', () => {
    const segs = buildOcclusionSegments(layer.standaloneWalls, doors);
    for (const d of doors) {
      const seg = segs.find((s) => s.sourceType === 'door' && s.sourceId === d.id);
      expect(seg, `no occlusion segment for ${d.id}`).toBeDefined();
      const shut = d.style !== 'archway' && d.state !== 'open';
      expect(seg!.blocksLight).toBe(shut);
      expect(seg!.blocksVision).toBe(shut);
    }
    expect(segs.some((s) => s.sourceType === 'wall' && s.blocksLight)).toBe(true);
  });

  it('leaves map area unzoned, so D6 has an unrevealable case to reject', () => {
    const stranded = kids<AssetChild>('asset').filter(
      (a) => roomAt([a.position.x, a.position.y]) === null,
    );
    expect(stranded.length).toBeGreaterThan(0);
  });

  it('survives the client player-side redaction with its secret doors stripped', () => {
    const redacted = withoutSecretDoors(map);
    const survivors = redacted.layers
      .filter((l): l is DungeonLayer => l.type === 'dungeon')
      .flatMap((l) => l.children.filter((c): c is DoorChild => c.childType === 'door'));
    expect(survivors.some((d) => d.isSecret)).toBe(false);
    expect(survivors).toHaveLength(doors.length - doors.filter((d) => d.isSecret).length);
  });
});
