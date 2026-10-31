import type { DungeonLayer, Layer } from '../store/types';
import type { LabelBinding, LabelStyleId, TextChild } from './types';
import { measureLabel } from '../engine/labelMetrics';
import { roomIndexOf } from './roomIndex';
import { resolveDoors, resolveWalls } from './wallResolve';

/**
 * Label presets: what a label of each style looks like when it lands, and what it binds to.
 *
 * One face for every style (the system stack the renderer uses); styles differ by size,
 * weight, backdrop, alignment, colour, default text and binding. "ink" is the layer's wall
 * colour, the colour a label takes when nobody picked one.
 */
export interface LabelStyle {
  /** Absent for Custom. */
  id: LabelStyleId | undefined;
  name: string;
  /** World units. */
  fontSize: number;
  weight?: 'bold';
  backdrop?: 'halo' | 'pill';
  align?: 'left' | 'right';
  /** The text a free label of this style lands with. */
  text: string;
  /** What the label follows when it is placed on one. */
  binds?: 'room' | 'door';
  color: 'ink' | string;
}

/** A GM note's muted grey: it reads as an aside next to the ink. */
export const GM_NOTE_GREY = '#6b6b6b';

export const CUSTOM_STYLE: LabelStyle = { id: undefined, name: 'Custom', fontSize: 0.8, text: 'Label', color: 'ink' };

export const LABEL_STYLES: readonly LabelStyle[] = [
  { id: 'room-name', name: 'Room name', fontSize: 0.8, weight: 'bold', backdrop: 'halo', text: 'Room', binds: 'room', color: 'ink' },
  { id: 'door-tag', name: 'Door tag', fontSize: 0.4, backdrop: 'pill', text: 'Door', binds: 'door', color: 'ink' },
  { id: 'gm-note', name: 'GM note', fontSize: 0.5, backdrop: 'pill', align: 'left', text: 'Note', color: GM_NOTE_GREY },
  { id: 'number-pin', name: 'Number pin', fontSize: 0.6, weight: 'bold', backdrop: 'pill', text: '#', binds: 'room', color: 'ink' },
  { id: 'callout', name: 'Callout', fontSize: 0.5, backdrop: 'halo', align: 'left', text: 'Callout', color: 'ink' },
  CUSTOM_STYLE,
];

export function labelStyle(id: LabelStyleId | undefined): LabelStyle {
  return LABEL_STYLES.find((s) => s.id === id) ?? CUSTOM_STYLE;
}

/** The style's colour on a layer: its own, or the layer's ink. */
export function styleColor(style: LabelStyle, ink: string): string {
  return style.color === 'ink' ? ink : style.color;
}

/**
 * The look fields a style writes, absent keys included as `undefined` so a patch built from
 * this clears what the previous style set.
 */
export function styleLook(style: LabelStyle, ink: string): Pick<TextChild, 'style' | 'fontSize' | 'weight' | 'backdrop' | 'align' | 'color'> {
  return {
    style: style.id,
    fontSize: style.fontSize,
    weight: style.weight,
    backdrop: style.backdrop,
    align: style.align,
    color: styleColor(style, ink),
  };
}

/** A room or a door a label can follow, as the label reads it. */
export interface BoundTarget {
  binding: LabelBinding;
  name: string;
  number?: number;
  /** World units: a room's anchor, a door's resolved position. */
  anchor: [number, number];
}

const isDungeon = (l: Layer): l is DungeonLayer => l.type === 'dungeon';

/** The text a bound label of `style` shows for `target`. */
export function boundText(style: LabelStyleId | undefined, target: BoundTarget): string {
  if (style === 'number-pin') return target.number !== undefined ? String(target.number) : labelStyle(style).text;
  return target.name || labelStyle(style).text;
}

/** The layers a placement looks for a target on: the label's own first, then the others shown on its level. */
function searchOrder(layers: readonly Layer[], layerId: string): DungeonLayer[] {
  const own = layers.find((l): l is DungeonLayer => l.id === layerId && isDungeon(l));
  const rest = layers
    .filter(isDungeon)
    .filter((l) => l.id !== layerId && l.visible !== false && (!own || l.levelId === own.levelId))
    .reverse();
  return own ? [own, ...rest] : rest;
}

/** How far from a door, in squares, a Door tag still takes it: the Door tool's own snap reach. */
export const DOOR_BIND_REACH = 1.5;

/**
 * What a label of kind `binds` placed at `point` follows: the room whose face holds the point
 * (the room test the Select pick uses), or the nearest door within `DOOR_BIND_REACH` of it.
 */
export function findBindTarget(
  binds: 'room' | 'door',
  point: { x: number; y: number },
  layers: readonly Layer[],
  layerId: string,
): BoundTarget | null {
  for (const layer of searchOrder(layers, layerId)) {
    if (binds === 'room') {
      const room = roomIndexOf(layer.rooms).roomAt(point.x, point.y);
      if (room) return { binding: { kind: 'room', id: room.id }, name: room.name, number: room.number, anchor: [...room.anchor] };
      continue;
    }
    let best: BoundTarget | null = null;
    let bestD = DOOR_BIND_REACH;
    for (const r of resolveDoors(layer, resolveWalls(layer))) {
      const d = Math.hypot(r.position[0] - point.x, r.position[1] - point.y);
      if (d <= bestD) {
        bestD = d;
        best = { binding: { kind: 'door', id: r.door.id }, name: r.door.name, anchor: [r.position[0], r.position[1]] };
      }
    }
    if (best) return best;
  }
  return null;
}

/** The binding fields for a label of `style` sitting at `at` over `target` (or none). */
export function bindingFields(
  style: LabelStyleId | undefined,
  at: { x: number; y: number },
  target: BoundTarget | null,
): Pick<TextChild, 'bound' | 'offset'> & { text?: string } {
  if (!target) return { bound: undefined, offset: undefined };
  return {
    bound: target.binding,
    offset: [at.x - target.anchor[0], at.y - target.anchor[1]],
    text: boundText(style, target),
  };
}

/**
 * A new label of `style` at `point` on `layerId`, before its id and name. `fontSize` and
 * `color` are the dock's overrides (null colour = the style's). Room name and Number pin
 * follow the room under the point, Door tag the door beside it; with nothing there it is a
 * free label of that style with its default text. A bound label lands where it was placed,
 * its offset from the target's anchor keeping it there as the target moves.
 */
export function labelFor(
  styleId: LabelStyleId | undefined,
  point: { x: number; y: number },
  layers: readonly Layer[],
  layerId: string,
  overrides: { fontSize?: number; color?: string | null } = {},
): Omit<TextChild, 'id' | 'name'> {
  const style = labelStyle(styleId);
  const layer = layers.find((l): l is DungeonLayer => l.id === layerId && isDungeon(l));
  const ink = layer?.style.wallColor ?? '#222222';
  const target = style.binds ? findBindTarget(style.binds, point, layers, layerId) : null;
  const bind = bindingFields(style.id, point, target);
  const text = bind.text ?? style.text;
  const fontSize = overrides.fontSize ?? style.fontSize;
  const look = { weight: style.weight, backdrop: style.backdrop };
  const child: Omit<TextChild, 'id' | 'name'> = {
    childType: 'text',
    visible: true,
    text,
    position: { x: point.x, y: point.y },
    rotation: 0,
    scale: 1,
    fontSize,
    color: overrides.color ?? styleColor(style, ink),
    ...measureLabel(text, fontSize, look),
  };
  // Absent keys stay absent: the file carries only what differs from the defaults.
  if (style.id) child.style = style.id;
  if (style.weight) child.weight = style.weight;
  if (style.backdrop) child.backdrop = style.backdrop;
  if (style.align) child.align = style.align;
  if (bind.bound) {
    child.bound = bind.bound;
    child.offset = bind.offset;
  }
  return child;
}
