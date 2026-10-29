import { resolveStyle } from '@dnd/core/src/engine/styleResolver';
import { WATER_BANK_TEXTURE_ID } from '@dnd/core/src/engine/water/waterTextures';
import { hasLiveTexture } from '@dnd/core/src/assets/packCatalog';
import { clampDoorWidth, doorStyleLabel, minDoorWidth, PLACEABLE_DOOR_STYLES } from '@dnd/core/src/engine/tools/DoorTool';
import { connectorKindForStyle, connectorStyle } from '@dnd/core/src/shared/authoredRooms';
import {
  DEFAULT_OPEN_ANGLE,
  DOOR_KIT_IDS,
  MAX_OPEN_ANGLE,
  doorKitById,
  doorKitFor,
  doorKitOf,
  isKitStyle,
  type DoorKitId,
} from '@dnd/core/src/assets/doorKits';
import { GROUP_WALL_TYPE, standaloneWallLook, wallTypeGroup, type WallTypeGroup } from '@dnd/core/src/shared/wallLook';
import { PROP_DEFAULTS, propField, type PropFieldKey } from '@dnd/core/src/shared/propFields';
import type {
  AnyChild,
  AssetChild,
  ChildGroupInfo,
  DungeonLayer,
  DungeonStyle,
  Layer,
  Level,
  Room,
  RoomArea,
  ShapeChild,
  WaterChild,
} from '@/store/types';
import type { ConnectorChild, DoorChild, DoorState, DoorStyle, WallSegment } from '@/shared/types';

/* What the selection card shows for floors, water, rooms, doors and props. Pure: no store reads.
 * The outside questions (whether a texture id names art that still exists, how long a
 * door's wall is) are parameters. */

export const MIXED = 'mixed' as const;
export type Mixed<T> = T | typeof MIXED;

/** What the swatch shows while the selection disagrees on a colour. */
export const MIXED_SWATCH = '#888888';

/** The renderer's own fallbacks for a shape missing a texture field. */
export const TEXTURE_DEFAULTS = {
  textureScale: 1,
  textureOffsetX: 0,
  textureOffsetY: 0,
  textureFillRotation: 0,
  textureTint: '#ffffff',
} as const;

/** The Scale slider's span. 1 is the art's own size (200px per cell), which new shapes start at. */
export const TEXTURE_SCALE_RANGE = { min: 0.25, max: 4, step: 0.05 } as const;

export type TextureNumberKey = 'textureScale' | 'textureOffsetX' | 'textureOffsetY' | 'textureFillRotation';

/** The one value every item agrees on, or `'mixed'`. `undefined` for an empty list. */
export function sameOrMixed<T>(values: readonly T[], eq: (a: T, b: T) => boolean = Object.is): Mixed<T> | undefined {
  if (values.length === 0) return undefined;
  const first = values[0];
  return values.every((v) => eq(v, first)) ? first : MIXED;
}

const sameColor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function isMixed<T>(v: Mixed<T> | undefined): v is typeof MIXED {
  return v === MIXED;
}

/** How many of the selected shapes carry a texture. */
export type Textured = 'all' | 'none' | 'some';

export interface ShapeFillModel {
  textured: Textured;
  /** The selected shapes the Colour row paints (no live texture), and the ones Tint paints. */
  plainIds: string[];
  texturedIds: string[];
  /** Read off the plain shapes only: a colour pinned under a texture shows nowhere. */
  floorColor: Mixed<string>;
  /** Any shape carrying its own floor colour, so "Reset" has something to undo. */
  hasOverrides: boolean;
  textureId: Mixed<string | undefined>;
  textureScale: Mixed<number>;
  textureOffsetX: Mixed<number>;
  textureOffsetY: Mixed<number>;
  textureFillRotation: Mixed<number>;
  textureTint: Mixed<string>;
}

export function textureValue(shape: ShapeChild, key: TextureNumberKey): number {
  const v = shape[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : TEXTURE_DEFAULTS[key];
}

export function tintValue(shape: ShapeChild): string {
  return shape.textureTint || TEXTURE_DEFAULTS.textureTint;
}

export function floorColorOf(shape: ShapeChild, style: DungeonStyle): string {
  return resolveStyle(style, shape.styleOverrides as Partial<DungeonStyle> | undefined).floorColor;
}

export function hasStyleOverrides(shape: ShapeChild): boolean {
  return !!shape.styleOverrides && Object.keys(shape.styleOverrides).length > 0;
}

/** True when any shape's fill (scale, offset, rotation, tint) is off its default. */
export function hasFillOverrides(shapes: readonly ShapeChild[]): boolean {
  return shapes.some(
    (s) =>
      textureValue(s, 'textureScale') !== TEXTURE_DEFAULTS.textureScale ||
      textureValue(s, 'textureOffsetX') !== TEXTURE_DEFAULTS.textureOffsetX ||
      textureValue(s, 'textureOffsetY') !== TEXTURE_DEFAULTS.textureOffsetY ||
      textureValue(s, 'textureFillRotation') !== TEXTURE_DEFAULTS.textureFillRotation ||
      tintValue(s).toLowerCase() !== TEXTURE_DEFAULTS.textureTint,
  );
}

/**
 * The floor fields of one or more shapes on one layer. Needs at least one shape.
 * `isLive` says whether a texture id names art that can be drawn: a shape carrying
 * a retired pack's id is painted its floor colour, so it counts as untextured here too.
 */
export function shapeFillModel(
  shapes: readonly ShapeChild[],
  style: DungeonStyle,
  isLive: (textureId: string | undefined) => boolean = hasLiveTexture,
): ShapeFillModel {
  const num = (key: TextureNumberKey) => sameOrMixed(shapes.map((s) => textureValue(s, key))) as Mixed<number>;
  const textured = shapes.filter((s) => isLive(s.textureId));
  const plain = shapes.filter((s) => !isLive(s.textureId));
  // Each colour row reads the shapes it paints, so a colour pinned under a texture
  // (or a tint left on a plain floor) cannot turn the row "Mixed" for nothing.
  const colourOf = plain.length > 0 ? plain : shapes;
  const tintOf = textured.length > 0 ? textured : shapes;
  return {
    textured: textured.length === 0 ? 'none' : plain.length === 0 ? 'all' : 'some',
    plainIds: plain.map((s) => s.id),
    texturedIds: textured.map((s) => s.id),
    floorColor: sameOrMixed(colourOf.map((s) => floorColorOf(s, style)), sameColor) as Mixed<string>,
    hasOverrides: shapes.some(hasStyleOverrides),
    textureId: sameOrMixed(shapes.map((s) => s.textureId || undefined)) as Mixed<string | undefined>,
    textureScale: num('textureScale'),
    textureOffsetX: num('textureOffsetX'),
    textureOffsetY: num('textureOffsetY'),
    textureFillRotation: num('textureFillRotation'),
    textureTint: sameOrMixed(tintOf.map(tintValue), sameColor) as Mixed<string>,
  };
}

/**
 * Which colour rows the floor card shows. The floor colour is only painted where a
 * shape has no texture, and the tint only where it has one, so each row appears
 * only when it would change something: Colour for untextured shapes, Tint (a top
 * row beside Texture) for textured ones, both for a mix. The Fill fold (scale,
 * rotate, offset) follows Tint: it only moves a texture.
 *
 * `pinned`: textured shapes still carrying their own style (a colour set before the
 * texture went on, or a preset's pins). It shows nowhere, but it would come back the
 * moment the texture came off, so the card keeps a quiet row whose Reset clears it.
 */
export function fieldsForFloor(
  textured: Textured,
  hasOverrides = false,
): { colour: boolean; tint: boolean; fill: boolean; pinned: boolean } {
  return {
    colour: textured !== 'all',
    tint: textured !== 'none',
    fill: textured !== 'none',
    pinned: textured === 'all' && hasOverrides,
  };
}

/** Radians as 0..360 degrees, the way the rotate slider shows them. */
export function radToDeg(rad: number): number {
  const deg = (rad * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** A texture id as a short name: the catalogue label when there is one, else the id tidied. */
export function shortTextureName(id: string, label?: string): string {
  if (label) return label;
  const tail = id.slice(id.lastIndexOf(':') + 1).replace(/[-_]+/g, ' ').trim();
  return tail ? tail[0].toUpperCase() + tail.slice(1) : id;
}

/* ── Water ──────────────────────────────────────────────── */

export const BANK_TEXTURE_ID = WATER_BANK_TEXTURE_ID;

export interface WaterModel {
  tint: Mixed<string>;
  opacity: Mixed<number>;
  banks: Mixed<boolean>;
}

export function waterModel(bodies: readonly WaterChild[]): WaterModel {
  return {
    tint: sameOrMixed(bodies.map((b) => b.tint), sameColor) as Mixed<string>,
    opacity: sameOrMixed(bodies.map((b) => b.opacity)) as Mixed<number>,
    banks: sameOrMixed(bodies.map((b) => !!b.bankTextureId)) as Mixed<boolean>,
  };
}

/* ── Rooms ──────────────────────────────────────────────── */

export interface RoomInfo {
  /** Floor area in squares, rounded; null until the room has been measured. */
  area: number | null;
  isPathway: boolean;
}

/** A drawn room's measured entry in `layer.rooms`, which shares the child's id. */
export function roomInfo(rooms: readonly Room[] | undefined, roomId: string): RoomInfo {
  const room = rooms?.find((r) => r.id === roomId);
  return { area: room?.area !== undefined ? Math.round(room.area) : null, isPathway: !!room?.isPathway };
}

/** A typed room name ready to commit, or null when it would leave the room nameless. */
export function cleanRoomName(raw: string): string | null {
  const t = raw.trim();
  return t ? t : null;
}

/* ── Which fields the card shows ───────────────────────── */

export type FieldsGroup =
  | { kind: 'shape'; layerId: string; ids: string[] }
  | { kind: 'water'; layerId: string; ids: string[] };

/**
 * Floors or water the card can edit together: every item that kind, all on one layer.
 * Anything else (a mix of kinds, two layers) gets no shared fields.
 */
export function fieldsGroup(children: readonly AnyChild[], layerIds: readonly (string | null)[]): FieldsGroup | null {
  if (children.length === 0) return null;
  const kind = children[0].childType;
  if (kind !== 'shape' && kind !== 'water') return null;
  const layerId = layerIds[0];
  if (!layerId) return null;
  if (!children.every((c, i) => c.childType === kind && layerIds[i] === layerId)) return null;
  return { kind, layerId, ids: children.map((c) => c.id) };
}


/* ── Doors ──────────────────────────────────────────────── */

/** A door on a wall, or a joint door drawn between two rooms. Both wear the door fields. */
export type DoorLike = DoorChild | ConnectorChild;

export const DOOR_STATES: { value: DoorState; label: string }[] = [
  { value: 'closed', label: 'Closed' },
  { value: 'open', label: 'Open' },
  { value: 'locked', label: 'Locked' },
];

/** Door widths step by a quarter cell; four cells is the widest a door gets. */
export const DOOR_WIDTH_STEP = 0.25;
export const DOOR_WIDTH_MAX = 4;

export interface DoorModel {
  style: DoorStyle;
  state: DoorState;
  secret: boolean;
  name: string;
  /** The styles the picker offers, the door's own always among them. */
  styles: { value: DoorStyle; label: string }[];
  /** An archway cannot be shut, so it shows no state. */
  showState: boolean;
  /** A wall door's width and the span it may take; null for a joint, whose size is drawn. */
  width: { value: number; min: number; max: number } | null;
  /** Which kit a single or double wall door is built from; null for every other door. */
  material: { value: DoorMaterial; options: { value: DoorMaterial; label: string }[] } | null;
  /** How a kit-built door hangs; null when the door is not built from a kit. */
  kit: DoorKitModel | null;
}

/** A door's kit pick as the card holds it: 'auto' follows the wall's set. */
export type DoorMaterial = 'auto' | DoorKitId;

const KIT_LABEL: Record<DoorKitId, string> = { stone: 'Stone', wood: 'Wood', cave: 'Cave' };

/**
 * The Material choices. Auto names what it comes to on this wall, so picking the kit the
 * wall already gives reads as no change; "plain" is a wall whose set has no door kit.
 */
export function doorMaterialOptions(wallSetId: string | undefined): { value: DoorMaterial; label: string }[] {
  const wallKit = doorKitFor(wallSetId);
  return [
    { value: 'auto', label: `Auto (${wallKit ? KIT_LABEL[wallKit.id] : 'plain'})` },
    ...DOOR_KIT_IDS.map((id) => ({ value: id, label: KIT_LABEL[id] })),
  ];
}

/** The stored field for a Material pick: Auto clears it. */
export function doorKitField(material: DoorMaterial): DoorKitId | undefined {
  return material === 'auto' ? undefined : material;
}

/**
 * The hanging of a single or double door built from a door kit (Fieldstone, Palisade,
 * Cave Ink), its wall's or its own pick: the art then shows a real leaf, so where it
 * opens to, which edge it hangs on and which way it swings all show. Every other door
 * keeps its own art.
 */
export interface DoorKitModel {
  /** Degrees the leaf stands open at, 0 to 180 (folded flat against the wall). */
  openAngle: number;
  /** The door is shut: the angle is the one it will open to, not where it stands. */
  opensLater: boolean;
  /** Which edge of the opening a single door hangs on; null for a double, which hangs on both. */
  hinge: 'start' | 'end' | null;
  swing: 1 | -1;
  /** Hinge straps drawn on the leaf. */
  hinges: boolean;
}

export const DOOR_HINGES: { value: 'start' | 'end'; label: string; tip: string }[] = [
  { value: 'start', label: 'Start', tip: 'Hung on the edge the wall was drawn from' },
  { value: 'end', label: 'End', tip: 'Hung on the far edge' },
];

/** Swing as the Seg control holds it: a string, since the stored values are numbers. */
export type SwingChoice = 'normal' | 'reversed';

export const DOOR_SWINGS: { value: SwingChoice; label: string; tip: string }[] = [
  { value: 'normal', label: 'Normal', tip: 'Opens to its usual side of the wall' },
  { value: 'reversed', label: 'Reversed', tip: 'Opens to the other side of the wall' },
];

export const swingChoice = (swing: 1 | -1): SwingChoice => (swing === -1 ? 'reversed' : 'normal');
export const swingValue = (choice: SwingChoice): 1 | -1 => (choice === 'reversed' ? -1 : 1);

/** The opening slider steps by 5 degrees, as the v1 panel does. */
export const OPEN_ANGLE_STEP = 5;

/**
 * The kit fields for a door, or null when it has none: a joint (drawn between rooms, never
 * built from a kit), a style a kit does not build, or a door with no kit of its own on a
 * wall whose set has none. `wallSetId` is the set the door's wall resolves to (see
 * `doorWallLook`).
 */
export function doorKitModel(door: DoorLike, wallSetId: string | undefined): DoorKitModel | null {
  if (door.childType !== 'door') return null;
  if (!doorKitOf(door, wallSetId)) return null;
  return {
    openAngle: Math.min(Math.max(0, door.openAngle ?? DEFAULT_OPEN_ANGLE), MAX_OPEN_ANGLE),
    opensLater: door.state !== 'open',
    hinge: door.style === 'single' ? (door.hinge ?? 'start') : null,
    swing: door.swing === -1 ? -1 : 1,
    hinges: door.hinges !== false,
  };
}

/** The style a door reads as: a joint's own read, for blobs saved before styles. */
export function doorStyleOf(door: DoorLike): DoorStyle {
  return door.childType === 'connector' ? connectorStyle(door) : door.style;
}

/**
 * What the card shows for a door. `room` is the widest the opening may get where the door
 * sits (`doorOpeningLimit`: its wall, or the straight run of walls it lies in), which caps
 * the width; `Infinity` for a detached door or a joint. `wallSetId` is the texture set the
 * door's wall resolves to, which decides the kit Auto builds it from.
 */
export function doorModel(door: DoorLike, room: number, wallSetId?: string): DoorModel {
  const style = doorStyleOf(door);
  // A wall door can also be a portal (it draws from pack art); the menu offers it too.
  const base: DoorStyle[] = door.childType === 'door' ? [...PLACEABLE_DOOR_STYLES, 'portal'] : [...PLACEABLE_DOOR_STYLES];
  if (!base.includes(style)) base.push(style);
  const min = minDoorWidth(style);
  return {
    style,
    state: door.state,
    secret: door.isSecret,
    name: door.name,
    styles: base.map((value) => ({ value, label: doorStyleLabel(value) })),
    showState: style !== 'archway',
    width:
      door.childType === 'door'
        ? { value: door.width, min, max: Math.max(min, Math.min(DOOR_WIDTH_MAX, room)) }
        : null,
    material:
      door.childType === 'door' && isKitStyle(door.style)
        ? {
            value: doorKitById(door.kit) ? (door.kit as DoorKitId) : 'auto',
            options: doorMaterialOptions(wallSetId),
          }
        : null,
    kit: doorKitModel(door, wallSetId),
  };
}

/** A width typed or dragged, held to the span the card offers, in hundredths of a cell. */
export function doorWidthValue(v: number, span: { min: number; max: number }): number {
  return Math.round(Math.min(span.max, Math.max(span.min, v)) * 100) / 100;
}

/**
 * The fields a style change writes, before and after, as one undo step.
 *
 * On a wall door the width follows both ways: up so a double has room for two leaves,
 * back down so a width only the old style needed cannot overhang the opening. On a joint
 * the style is the authored truth and `kind` follows it, and so does the state: an arch
 * is open, and a door that was an arch a moment ago reads shut. `room` is as `doorModel`'s.
 */
export function doorStyleChange(
  door: DoorLike,
  next: DoorStyle,
  room: number,
): { before: Partial<DoorLike>; after: Partial<DoorLike> } {
  if (door.childType === 'door') {
    return {
      before: { style: door.style, width: door.width },
      after: { style: next, width: clampDoorWidth(door.width, next, room) },
    };
  }
  const style = connectorStyle(door);
  const state: DoorState =
    next === 'archway' ? 'open' : style === 'archway' && door.state === 'open' ? 'closed' : door.state;
  return {
    before: { style: door.style, kind: door.kind, state: door.state },
    after: { style: next, kind: connectorKindForStyle(next), state },
  };
}

/** A typed door name ready to commit, or null to keep the old one (empty means "never mind"). */
export function cleanDoorName(raw: string, current: string): string | null {
  const t = raw.trim();
  return t && t !== current ? t : null;
}

/* ── Drawn walls ────────────────────────────────────────── */

/**
 * The wall types the engine tells apart, by what they block. Lighting and sight read only
 * whether a wall stops light, so the five stored types come down to these three; a wall
 * imported as terrain or ethereal keeps its type and shows here as the one it acts like.
 * The Walls dock and the selection card offer the same three.
 */
export const WALL_TYPE_CHOICES: { value: WallTypeGroup; label: string; tip: string }[] = [
  { value: 'solid', label: 'Solid', tip: 'Solid: blocks light and sight' },
  { value: 'window', label: 'Window', tip: 'Window: lets light and sight through, still drawn as a wall' },
  { value: 'open', label: 'Open', tip: 'Open: blocks nothing, drawn faint and dashed' },
];

export interface WallModel {
  type: WallTypeGroup;
  /** The set its stones or rock come from, its own pin or the layer's; null for a plain line. */
  setName: string | null;
}

/** What the card shows for a drawn wall. `setLabel` names a texture set (GG_Fieldstone reads Fieldstone). */
export function wallModel(wall: WallSegment, style: DungeonStyle, setLabel: (setId: string) => string): WallModel {
  const setId = standaloneWallLook(wall, style).setId;
  return { type: wallTypeGroup(wall.wallType), setName: setId ? setLabel(setId) : null };
}

/**
 * The fields a Type pick writes, before and after, or null when the wall already acts
 * that way: picking the group a stored type belongs to keeps that type, as in the dock.
 */
export function wallTypeChange(
  wall: WallSegment,
  next: WallTypeGroup,
): { before: Partial<WallSegment>; after: Partial<WallSegment> } | null {
  if (wallTypeGroup(wall.wallType) === next) return null;
  return { before: { wallType: wall.wallType }, after: { wallType: GROUP_WALL_TYPE[next] } };
}

/* ── Rooms, areas and levels ────────────────────────────── */

/**
 * What a selected id names when it is not a child or a wall: a room (picked on the map or
 * in the rooms sheet), an area (the sheet's group header) or a level (the level picker's
 * "Level settings"). The card, the dock, the status bar and delete all branch on `kind`.
 */
export type RoomTarget =
  | { kind: 'room'; room: Room; layer: DungeonLayer }
  | { kind: 'area'; area: RoomArea; layer: DungeonLayer }
  | { kind: 'level'; level: Level };

/** Resolve one selected id to a room, an area or a level; null for anything else. */
export function resolveRoomTarget(
  state: { layers: readonly Layer[]; levels?: readonly Level[] },
  id: string,
): RoomTarget | null {
  for (const layer of state.layers) {
    if (layer.type !== 'dungeon') continue;
    const dungeon = layer as DungeonLayer;
    const room = dungeon.rooms?.find((r) => r.id === id);
    if (room) return { kind: 'room', room, layer: dungeon };
    const area = dungeon.areas?.find((a) => a.id === id);
    if (area) return { kind: 'area', area, layer: dungeon };
  }
  const level = state.levels?.find((l) => l.id === id);
  return level ? { kind: 'level', level } : null;
}

/** The selection's room, area or level when it holds exactly that one thing, else null. */
export function soleRoomTarget(
  state: { layers: readonly Layer[]; levels?: readonly Level[] },
  selectedIds: readonly string[],
): RoomTarget | null {
  return selectedIds.length === 1 ? resolveRoomTarget(state, selectedIds[0]) : null;
}

/* ── Props ──────────────────────────────────────────────── */

/**
 * What a selection of props is: one prop, several (the card moves them as one box), or every
 * member of one group (the group card). The card, the status bar and the dock branch on `kind`.
 */
export type PropTarget =
  | { kind: 'prop'; child: AssetChild; layer: DungeonLayer }
  /** Two or more props, not one whole group; `layerIds[i]` holds `children[i]`. */
  | { kind: 'props'; children: AssetChild[]; layerIds: string[] }
  /** Every member of one group selected (members may include non-props). */
  | { kind: 'prop-group'; group: ChildGroupInfo; layer: DungeonLayer; members: AnyChild[] };

/**
 * Resolve the selected ids to a prop target, or null when the selection holds anything
 * that is not a prop (a mixed selection keeps the generic card). A whole group counts as
 * a group when it holds at least one prop.
 */
export function resolvePropTarget(state: { layers: readonly Layer[] }, ids: readonly string[]): PropTarget | null {
  if (ids.length === 0) return null;
  const found: { child: AnyChild; layer: DungeonLayer }[] = [];
  for (const id of ids) {
    let hit: { child: AnyChild; layer: DungeonLayer } | null = null;
    for (const layer of state.layers) {
      if (layer.type !== 'dungeon') continue;
      const child = (layer as DungeonLayer).children.find((c) => c.id === id);
      if (child) {
        hit = { child, layer: layer as DungeonLayer };
        break;
      }
    }
    if (!hit) return null;
    found.push(hit);
  }

  if (found.length > 1) {
    const { layer } = found[0];
    const groupId = found[0].child.groupId;
    const group = groupId ? layer.groups?.find((g) => g.id === groupId) : undefined;
    if (group && found.every((f) => f.layer === layer && f.child.groupId === groupId)) {
      const members = layer.children.filter((c) => c.groupId === groupId);
      if (members.length === found.length && members.some((c) => c.childType === 'asset')) {
        return { kind: 'prop-group', group, layer, members };
      }
    }
  }

  if (!found.every((f) => f.child.childType === 'asset')) return null;
  if (found.length === 1) return { kind: 'prop', child: found[0].child as AssetChild, layer: found[0].layer };
  return {
    kind: 'props',
    children: found.map((f) => f.child as AssetChild),
    layerIds: found.map((f) => f.layer.id),
  };
}

/** The size a prop is drawn at: its stored size times the legacy scale. */
export function propSize(child: Pick<AssetChild, 'width' | 'height' | 'scale'>): { w: number; h: number } {
  const s = Number.isFinite(child.scale) && child.scale > 0 ? child.scale : 1;
  return { w: child.width * s, h: child.height * s };
}

/** The world box around a prop as drawn (rotated), for the union of several. */
function propAabb(child: AssetChild): { minX: number; minY: number; maxX: number; maxY: number } {
  const { w, h } = propSize(child);
  const c = Math.abs(Math.cos(child.rotation));
  const s = Math.abs(Math.sin(child.rotation));
  const hw = (w * c + h * s) / 2;
  const hh = (w * s + h * c) / 2;
  return {
    minX: child.position.x - hw,
    minY: child.position.y - hh,
    maxX: child.position.x + hw,
    maxY: child.position.y + hh,
  };
}

export interface PropBoxModel {
  /** Centre, world units (cells). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians: the prop's own, or the shared one of several, else mixed. */
  angle: Mixed<number>;
}

/**
 * The box the Transform fields show. One prop: its centre, its own size and its rotation
 * (an oriented box). Several: the world box around all of them as drawn, with the angle
 * they share or Mixed.
 */
export function propBoxModel(children: readonly AssetChild[]): PropBoxModel {
  if (children.length === 1) {
    const c = children[0];
    const { w, h } = propSize(c);
    return { x: c.position.x, y: c.position.y, w, h, angle: c.rotation };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of children) {
    const b = propAabb(c);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
    angle: (sameOrMixed(children.map((c) => c.rotation), same) ?? 0) as Mixed<number>,
  };
}

export type PropFieldsModel = { [K in PropFieldKey]: Mixed<NonNullable<AssetChild[K]>> } & { tint: Mixed<string> };

/** Each per-prop field as the selection has it: the shared value, or Mixed. Absent fields read as their defaults. */
export function propFieldsModel(children: readonly AssetChild[]): PropFieldsModel {
  const keys = Object.keys(PROP_DEFAULTS) as PropFieldKey[];
  const out = {} as Record<string, unknown>;
  for (const k of keys) out[k] = sameOrMixed(children.map((c) => propField(c, k)));
  out.tint = sameOrMixed(children.map((c) => c.tint || '#ffffff'), sameColor);
  return out as PropFieldsModel;
}

/** How many of the props have a boolean field on: "Mixed: 1 of 3", "None locked", "All 4". */
export function propFieldCount(children: readonly AssetChild[], key: 'overhead' | 'locked'): number {
  return children.filter((c) => propField(c, key)).length;
}
