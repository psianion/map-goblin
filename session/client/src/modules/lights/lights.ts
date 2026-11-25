// M2 table UI (plan design decision 5) — the pure bits behind the DM's Lights mode, kept out
// of the Pixi/React files the same way `doors/doors.ts` keeps `doorAt` out of `DoorRenderer`:
// plain functions over `layers`/a screen point, easy to test without a mounted engine.

import type { AssetChild, Level, LightChild } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import type { LightEdit } from '@dnd/mechanics/triggers';
import { worldToScreen } from '../../renderer/camera';
import { isTokenLight, rememberAuthored, rememberPreviewed } from '../triggers/lightSync';
import { lightGroups, lightsOnProp, roomsWithLights, withGroupMates } from '@dnd/core/src/shared/lightSwitches';
import { useSessionStore } from '../../session/store';
import { levelOf } from '@dnd/core/src/shared/lookScope';

/** Screen px a pointer may sit from a light's icon and still count as a hit — B2's own fix on
 *  the canvas (plan doc), reused here since the table draws the same icon. */
export const LIGHT_HIT_PX = 12;

export interface LightHit {
  light: LightChild;
  layerId: string;
}

/** Every authored light on the loaded map. A token's own torch is session-carried (it already
 *  follows the token — `lightSync.tokenLights`), not something a DM reaches for here. */
export function mapLights(layers: readonly Layer[]): LightHit[] {
  const out: LightHit[] = [];
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const child of layer.children) {
      if (child.childType === 'light' && !isTokenLight(child.id)) {
        out.push({ light: child as LightChild, layerId: layer.id });
      }
    }
  }
  return out;
}

/** The nearest light icon to a screen point (CSS px local to the map element, `worldToScreen`'s
 *  own space), within `LIGHT_HIT_PX` — null off every icon. */
export function lightAt(layers: readonly Layer[], screen: { x: number; y: number }): LightHit | null {
  let best: LightHit | null = null;
  let bestDist = LIGHT_HIT_PX;
  for (const hit of mapLights(layers)) {
    const p = worldToScreen(hit.light.position.x, hit.light.position.y);
    if (!p) continue;
    const d = Math.hypot(p.x - screen.x, p.y - screen.y);
    if (d <= bestDist) {
      bestDist = d;
      best = hit;
    }
  }
  return best;
}

/** One light by id, wherever it lives — the popover re-reads this off the live store every
 *  render rather than holding its own copy, same reason `DoorMenu` re-reads `useLiveDoors()`. */
export function lightById(layers: readonly Layer[], id: string): LightChild | undefined {
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    const found = layer.children.find((c) => c.id === id && c.childType === 'light');
    if (found) return found as LightChild;
  }
  return undefined;
}

/**
 * The live-preview write: a drag or a slider patches the child directly, field by field (same
 * discipline `lightSync.ts` writes drift with — `position` gets a fresh object so it can never
 * alias the caller's), so the icon/pool on screen tracks the pointer immediately instead of
 * waiting a round trip. `set-light` still goes out on release/commit; `lightSync`'s own drift
 * check reconciles the store to the server's answer once it lands (`lightSync.ts` header).
 *
 * Because it writes ahead of that round trip it has to hand `lightSync` the authored values
 * first (`rememberAuthored`): otherwise the snapshot a later `reset-light` restores to would be
 * taken from this already-previewed child, and the first edit of a session would not revert.
 */
export function patchLightLocal(id: string, patch: LightEdit): void {
  patchLightsLocal([id], patch);
}

/** `patchLightLocal` for several lights in one store write: a group or a room of 30 lights is
 *  one notification, not 30 (each one re-syncs every prop's sprite). */
export function patchLightsLocal(ids: readonly string[], patch: LightEdit): void {
  const wanted = new Set(ids);
  if (wanted.size === 0) return;
  useStore.setState((state) => {
    for (const layer of state.layers) {
      if (layer.type !== 'dungeon') continue;
      for (const c of layer.children) {
        if (c.childType !== 'light' || !wanted.has(c.id)) continue;
        patchChild(c as LightChild, patch);
      }
    }
  });
}

/** One light child patched in place, inside a store write. */
function patchChild(child: LightChild, patch: LightEdit): void {
  rememberAuthored(child);
  if (patch.visible !== undefined) child.visible = patch.visible;
  if (patch.radius !== undefined) child.radius = patch.radius;
  if (patch.featherRadius !== undefined) child.featherRadius = patch.featherRadius;
  if (patch.intensity !== undefined) child.intensity = patch.intensity;
  if (patch.color !== undefined) child.color = patch.color;
  if (patch.falloff !== undefined) child.falloff = patch.falloff;
  if (patch.position !== undefined) child.position = { ...patch.position };
  if (patch.embers !== undefined) child.embers = patch.embers;
  // Mark the preview so lightSync's reconcile leaves it alone until the commit lands —
  // without this every preview write is snapped straight back (see lightSync.ts).
  rememberPreviewed(child);
}

// ─── Switches: groups, rooms and light props (prop lights pass) ─────────────────────────────

/** Whether a light can be switched by `set-lights`: an authored light, not a darkness source (the
 *  server's `lightIdsOf` leaves those out and would refuse the whole command). */
const switchable = (l: LightChild): boolean => !isTokenLight(l.id) && !l.darkness;

/** Locked lights, and lights on locked layers: never reached through another light (a group
 *  mate, a room), the same rule the editor's switches keep (`lightCommands.ts` `lockedOut`). */
function lockedIds(layers: readonly Layer[]): Set<string> {
  const out = new Set<string>();
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const c of layer.children) if (c.childType === 'light' && (c.locked || layer.locked)) out.add(c.id);
  }
  return out;
}

/** The ids one switch of `ids` sends: them and their group mates, unswitchable and locked mates left out. */
export function switchIdsOf(layers: readonly Layer[], ids: readonly string[]): string[] {
  const picked = new Set(ids);
  const locked = lockedIds(layers);
  const byId = new Map(mapLights(layers).map((h) => [h.light.id, h.light]));
  return withGroupMates(layers, ids).filter((id) => {
    const l = byId.get(id);
    return !!l && switchable(l) && (picked.has(id) || !locked.has(id));
  });
}

/** One row of the Lights family's Groups or Rooms list. */
export interface SwitchRowModel {
  key: string;
  name: string;
  ids: string[];
  total: number;
  on: number;
  /** "4 lights" while all agree, "2 of 4 on" while mixed. */
  count: string;
}

/**
 * One row. `counted` is what its count reads: a group counts every light in it, as the editor's
 * cards do; a room its own lights, darkness left out, as the room card does. The switch only
 * ever sends lights `set-lights` takes.
 */
function rowOf(key: string, name: string, lights: readonly LightChild[], layers: readonly Layer[], counted: readonly LightChild[] = lights.filter(switchable)): SwitchRowModel | null {
  const own = lights.filter(switchable);
  if (own.length === 0) return null;
  const locked = lockedIds(layers);
  const on = counted.filter((l) => l.visible !== false).length;
  const total = counted.length;
  const mixed = on > 0 && on < total;
  return {
    key,
    name,
    // A locked light keeps its state, as in the editor.
    ids: switchIdsOf(layers, own.filter((l) => !locked.has(l.id)).map((l) => l.id)),
    total,
    on,
    count: mixed ? `${on} of ${total} on` : `${total} ${total === 1 ? 'light' : 'lights'}`,
  };
}

/**
 * The map's light groups and the rooms that hold lights, as switch rows (the Map tab's Lights
 * family). With `levelId`, only that level's rooms: the DM switches the rooms of the level on show.
 */
export function lightSwitchRows(
  layers: readonly Layer[],
  levels: readonly Level[],
  levelId?: string,
): { groups: SwitchRowModel[]; rooms: SwitchRowModel[] } {
  const roomLevel = new Map<string, string>();
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const room of layer.rooms ?? []) roomLevel.set(room.id, levelOf(levels, layer).id);
  }
  const groups = lightGroups(layers)
    .map((g) => rowOf(`group:${g.name}`, g.name, g.lights, layers, g.lights.filter((l) => !isTokenLight(l.id))))
    .filter((r): r is SwitchRowModel => r !== null);
  const rooms = roomsWithLights({ layers, levels })
    .filter((r) => levelId === undefined || roomLevel.get(r.id) === levelId)
    .map((r) => rowOf(`room:${r.id}`, r.name || 'Room', r.lights, layers))
    .filter((r): r is SwitchRowModel => r !== null);
  return { groups, rooms };
}

/** The topmost prop with a switchable light attached under world point `p`, or null. */
export function lightPropAt(layers: readonly Layer[], p: { x: number; y: number }): AssetChild | null {
  let hit: AssetChild | null = null;
  for (const layer of layers) {
    if (layer.type !== 'dungeon' || !layer.visible) continue;
    for (const c of layer.children) {
      if (c.childType !== 'asset' || !c.visible) continue;
      const dx = p.x - c.position.x;
      const dy = p.y - c.position.y;
      const cos = Math.cos(-c.rotation);
      const sin = Math.sin(-c.rotation);
      const u = dx * cos - dy * sin;
      const v = dx * sin + dy * cos;
      if (Math.abs(u) > (c.width * c.scale) / 2 || Math.abs(v) > (c.height * c.scale) / 2) continue;
      if (lightsOnProp(layers, c.id).some(switchable)) hit = c;
    }
  }
  return hit;
}

/** What a double-click on prop `propId` sends: its lights (and their groups) all off when any
 *  burns, else all on. Null for a prop with no switchable light. */
export function propToggle(layers: readonly Layer[], propId: string): { ids: string[]; on: boolean } | null {
  const own = lightsOnProp(layers, propId).filter(switchable);
  if (own.length === 0) return null;
  return { ids: switchIdsOf(layers, own.map((l) => l.id)), on: !own.some((l) => l.visible !== false) };
}

/** Switch `ids` on the table: the pool and the prop pictures change at once on this screen, and
 *  one `set-lights` goes out (`lightSync` settles the store on the server's answer). */
export function sendSwitch(ids: readonly string[], on: boolean, embers?: boolean): void {
  if (ids.length === 0) return;
  patchLightsLocal(ids, { visible: on, ...(embers === undefined ? {} : { embers }) });
  useSessionStore.getState().sendCommand('triggers', 'set-lights', { ids, on, ...(embers === undefined ? {} : { embers }) });
}
