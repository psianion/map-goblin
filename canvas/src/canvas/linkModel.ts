// The light group links as data: which other members a switch of one child reaches, split
// by the level on show (`linkModel`), and which child the overlay and the status hint speak for.
// Pure reads of the store's state; the overlay (`linkOverlay.ts`) draws them.

import type { AssetChild, DungeonLayer, Layer, LightChild, MapBuilderStore } from '@/store/types';
import { allLights, groupName } from '@dnd/core/src/shared/lightSwitches';
import { levelOf } from '@dnd/core/src/shared/lookScope';
import { shownLevelId } from '@dnd/core/src/store/selectors';
import { getChildBounds, getWallBounds, wallReach } from '@dnd/core/src/engine/hitTest';
import { roomFace } from '@dnd/core/src/shared/roomUtils';

/** One thing outlined: a prop by its turned box, or a free light by its marker. */
export type LinkOutline =
  | { kind: 'prop'; id: string; x: number; y: number; w: number; h: number; rotation: number }
  | { kind: 'light'; id: string; x: number; y: number };

export interface LinkModel {
  /** The group's name, and how many lights it switches (every member, any level). */
  group: string;
  lights: number;
  /** The other members on the level on show, each once (a prop for its attached lights). */
  shown: LinkOutline[];
  /** Members (props or free lights) on other levels, counted. */
  elsewhere: number;
}

/** The group a child belongs to: a light's own, or for a prop the first group among its attached lights. */
export function groupOfChild(layers: readonly Layer[], id: string): string | undefined {
  for (const l of allLights(layers)) {
    if ((l.id === id || l.attachedTo === id) && groupName(l.group)) return groupName(l.group);
  }
  return undefined;
}

/**
 * What a switch of child `id` reaches, laid out for the overlay: its group, the other members
 * (by the prop they are fixed to, or by themselves when free), split by the level on show.
 * Null for a child in no group.
 */
export function linkModel(state: Pick<MapBuilderStore, 'layers' | 'levels' | 'ui'>, id: string): LinkModel | null {
  const group = groupOfChild(state.layers, id);
  if (!group) return null;
  const levels = state.levels ?? [];
  const shown = shownLevelId(state);
  const where = new Map<string, { layer: DungeonLayer; child: AssetChild | LightChild }>();
  for (const layer of state.layers) {
    if (layer.type !== 'dungeon') continue;
    for (const c of layer.children) if (c.childType === 'asset' || c.childType === 'light') where.set(c.id, { layer, child: c });
  }
  const members = allLights(state.layers).filter((l) => groupName(l.group) === group);
  // The source itself, and the prop or light it is one fixture with, are not outlined.
  const self = new Set<string>([id]);
  const source = where.get(id)?.child;
  if (source?.childType === 'light' && source.attachedTo) self.add(source.attachedTo);
  const seen = new Set<string>();
  const out: LinkOutline[] = [];
  let elsewhere = 0;
  for (const light of members) {
    const host = light.attachedTo ? where.get(light.attachedTo) : undefined;
    const target = host && host.child.childType === 'asset' ? host : where.get(light.id);
    if (!target || self.has(target.child.id) || self.has(light.id) || seen.has(target.child.id)) continue;
    seen.add(target.child.id);
    if (levels.length > 1 && levelOf(levels, target.layer).id !== shown) {
      elsewhere++;
      continue;
    }
    const c = target.child;
    out.push(
      c.childType === 'asset'
        ? { kind: 'prop', id: c.id, x: c.position.x, y: c.position.y, w: c.width * c.scale, h: c.height * c.scale, rotation: c.rotation }
        : { kind: 'light', id: c.id, x: c.position.x, y: c.position.y },
    );
  }
  return { group, lights: members.length, shown: out, elsewhere };
}

/** "+2 on other levels", or nothing. */
export const elsewhereLabel = (n: number): string | null => (n > 0 ? `+${n} on other ${n === 1 ? 'level' : 'levels'}` : null);

/** The child the overlay speaks for: the one selected on its own, else the one hovered with Select. */
export function linkSource(state: Pick<MapBuilderStore, 'selection' | 'tools'>): { id: string; hover: boolean } | null {
  const sel = state.selection.selectedIds;
  if (sel.length === 1) return { id: sel[0]!, hover: false };
  const hovered = state.selection.hoveredId;
  if (hovered && state.tools.activeTool === 'select') return { id: hovered, hover: true };
  return null;
}


/**
 * What Select group picks for group `name`: the group's lights, every member, those fixed to a
 * prop included, on any level, so the light card edits them all together.
 */
export function groupSelectIds(layers: readonly Layer[], name: string): string[] {
  return allLights(layers)
    .filter((l) => groupName(l.group) === name)
    .map((l) => l.id);
}

/** The one group whose lights are exactly `ids` (every member and nothing else), or null. */
export function exactGroup(layers: readonly Layer[], ids: readonly string[]): string | null {
  if (ids.length === 0) return null;
  const lights = allLights(layers);
  const picked = new Set(ids);
  const first = lights.find((l) => l.id === ids[0]);
  const name = groupName(first?.group);
  if (!name) return null;
  const members = lights.filter((l) => groupName(l.group) === name);
  return members.length === picked.size && members.every((l) => picked.has(l.id)) ? name : null;
}

/**
 * The outline a "Pick from here" row draws on the canvas for object `id`, as closed rings of
 * world points: a prop by its turned box, a light by its marker, a wall by its band's box, a room
 * by its face, anything else by its box. Empty when there is no such object.
 */
export function pickOutline(state: Pick<MapBuilderStore, 'layers'>, id: string, pad: number): [number, number][][] {
  const box = (b: { x: number; y: number; width: number; height: number }): [number, number][] => [
    [b.x - pad, b.y - pad],
    [b.x + b.width + pad, b.y - pad],
    [b.x + b.width + pad, b.y + b.height + pad],
    [b.x - pad, b.y + b.height + pad],
    [b.x - pad, b.y - pad],
  ];
  for (const layer of state.layers) {
    if (layer.type !== 'dungeon') continue;
    const c = layer.children.find((x) => x.id === id);
    if (c) {
      if (c.childType === 'asset') return [outlineRing({ kind: 'prop', id, x: c.position.x, y: c.position.y, w: c.width * c.scale, h: c.height * c.scale, rotation: c.rotation }, pad)];
      if (c.childType === 'light') return [outlineRing({ kind: 'light', id, x: c.position.x, y: c.position.y }, pad)];
      return [box(getChildBounds(c))];
    }
    const wall = layer.standaloneWalls?.find((w) => w.id === id);
    if (wall) return [box(getWallBounds(wall, wallReach(wall, layer)))];
    const room = layer.rooms?.find((r) => r.id === id);
    if (room) {
      const face = roomFace(room);
      return face.length >= 3 ? [[...face, face[0]!]] : [];
    }
  }
  return [];
}

/** One link member's outline as a closed list of world points (a prop's turned box, a light's marker ring). */
export function outlineRing(o: LinkOutline, pad: number): [number, number][] {
  if (o.kind === 'light') {
    const r = 0.5 + pad;
    const pts: [number, number][] = [];
    for (let i = 0; i <= 48; i++) pts.push([o.x + r * Math.cos((i / 48) * Math.PI * 2), o.y + r * Math.sin((i / 48) * Math.PI * 2)]);
    return pts;
  }
  const hw = o.w / 2 + pad;
  const hh = o.h / 2 + pad;
  const c = Math.cos(o.rotation);
  const s = Math.sin(o.rotation);
  const corners: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
    [-hw, -hh],
  ];
  return corners.map(([u, v]) => [o.x + u * c - v * s, o.y + u * s + v * c]);
}
