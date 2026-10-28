import { Container, Graphics, Text } from 'pixi.js';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { AcceptRoomsCommand } from '@/store/commands';
import type { DungeonLayer, MapBuilderStore, Room, ThresholdSegment } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';
import { isLayerEffectivelyVisible } from '@dnd/core/src/store/selectors';
import { faceSignature, roomBadgePoints, roomFace } from '@dnd/core/src/shared/roomUtils';
import { getEditorDesk } from '@dnd/core/src/engine/editorDesk';
import { clipper2Engine, isClipperReady } from '@dnd/core/src/geometry/Clipper2Engine';
import { dashSpine } from '@dnd/core/src/engine/wallNodeRenderer';
import { onAnchorPreview, type AnchorPreview } from '@dnd/core/src/engine/roomAnchorDrag';

/*
 * The v2 editor's room overlay: what makes the rooms visible while authoring. Rooms
 * have no art of their own (a room is an anchor on the floor; its face is derived), so
 * everything a DM sees of them is drawn here, in the editor only — this file lives in
 * the canvas package, so the table never draws or ships any of it.
 *
 * One pooled view per room, keyed by its permanent id: an outline Graphics in the
 * shapes layer and a label container (number badge, name chip, warning glyph) in the
 * labels layer, Text objects reused. The badge sits inside the face (`roomBadgePoints`),
 * not on the anchor, so two halves of a split never stack their labels on the divider.
 *
 * The whole overlay lives in the engine's screen-space overlay container, made to follow
 * the camera, and is kept the last thing drawn there: above the lighting composite (which
 * would otherwise darken it to nothing on a dark floor) and above the light and door
 * icons (which would otherwise cover a badge). Outlines carry a thin light halo under the
 * ink line so they read on a dark floor as well as on a light one. A view is retessellated only when its own key
 * moves — its face, the selection, the hover, the label mode, the zoom once it
 * settles — so a hover change redraws two rooms and a prop drag redraws none: the
 * store subscription below reads the rooms, areas and thresholds by identity only.
 * Nothing here runs per pointermove; a badge being dragged is moved, not redrawn.
 *
 * Driven entirely by the store, so the editor UI toggles it through state alone:
 *  - `ui.roomOverlayVisible`  the Outlines switch (selected rooms still show when off;
 *                             the Rooms tab tools force everything on);
 *  - `ui.roomLabels`          'off' | 'numbers' | 'both' (a selected room keeps its badge,
 *                             the handle its anchor is dragged by);
 *  - `selection.selectedIds`  room ids select rooms, an area id draws the area's extent;
 *  - `selection.hoveredId`, `ui.highlightedRoomId`  hover (canvas, rooms sheet);
 *  - `ui.roomSuggestions`     ghosts on the active layer, each with ✓ / ✕;
 *  - `tools.activeTool`       roomRect / roomPolygon / divide show the thresholds.
 * The level shown is `ui.activeLevelId`'s.
 */

/** Screen px the outline sits inside the face, so neighbouring rooms' outlines never touch. */
export const OUTLINE_INSET_PX = 6;
const OUTLINE_PX = 1.5;
const OUTLINE_ALPHA = 0.7;
/** A light line under every ink line, one px wider each side, so it reads on dark floors too. */
const HALO_PX = 1;
const HALO_COLOR = 0xffffff;
const HALO_ALPHA = 0.45;
const SELECT_PX = 2;
const SELECT_FILL = 0.1;
const HOVER_PX = 2;
/** The area's wash: ink reads on light floors, and the paper edge band below on dark ones (cave floors). */
export const AREA_FILL = 0.2;
const AREA_EDGE_PX = 6;
const AREA_EDGE_ALPHA = 0.22;
const DASH_PX = 5;
const GAP_PX = 4;
const BADGE_R = 10;
const CHIP_GAP = 4;
const GLYPH = 18;
/** Zoom must hold this long before the outlines are retessellated at it. */
const ZOOM_SETTLE_MS = 140;

const ROOM_TOOLS = new Set<string>(['roomRect', 'roomPolygon', 'divide']);

type Ring = [number, number][];

// ─── Model (pure) ──────────────────────────────────────────────────────────

export interface RoomItem {
  room: Room;
  layerId: string;
  face: Ring;
  /** Where the badge and chip sit: inside the face (the anchor when there is no face of its own). */
  at: [number, number];
  selected: boolean;
  hovered: boolean;
  /** Anchor on no face, or two rooms claiming one face: the warning glyph. */
  warn: boolean;
  /** Badge drawn (labels on, or the room selected). */
  badge: boolean;
  /** Name chip drawn. */
  chip: boolean;
  /** Changes exactly when the outline must be retessellated. */
  shapeKey: string;
  /** Changes exactly when the badge, chip or glyph must be redrawn. */
  labelKey: string;
}

export interface RoomOverlayModel {
  rooms: RoomItem[];
  /** Thresholds to draw as hairlines: only while a Rooms tab tool is in hand. */
  thresholds: ThresholdSegment[];
  /** Faces of the selected areas' rooms. */
  areaFaces: Ring[];
  /** Suggestions on the active layer, with that layer's id. */
  suggestions: { layerId: string; rooms: Room[] } | null;
}

const ids = new WeakMap<object, number>();
let nextId = 1;
/** A number per object identity, so a key can say "this face is a new array". */
function refId(obj: object | undefined): number {
  if (!obj) return 0;
  let id = ids.get(obj);
  if (id === undefined) ids.set(obj, (id = nextId++));
  return id;
}

/** Dungeon layers the overlay draws for: visible, on the level being shown. */
export function overlayLayers(state: MapBuilderStore): DungeonLayer[] {
  const level = state.ui.activeLevelId;
  return state.layers.filter(
    (l): l is DungeonLayer =>
      l.type === 'dungeon' && isLayerEffectivelyVisible(state, l) && (!level || !l.levelId || l.levelId === level),
  );
}

/**
 * What the overlay draws for `state`, at `zoomKey` (the settled zoom; anything that
 * changes per frame stays out of the keys). Pure: no Pixi, no engine.
 */
export function roomOverlayModel(state: MapBuilderStore, zoomKey: number, ink = ''): RoomOverlayModel {
  const tool = state.tools.activeTool;
  const roomTool = ROOM_TOOLS.has(tool);
  const showAll = state.ui.roomOverlayVisible || roomTool;
  const labels = state.ui.roomLabels;
  const selected = new Set(state.selection.selectedIds);
  const hovered = new Set([state.selection.hoveredId, state.ui.highlightedRoomId].filter((x): x is string => !!x));

  const rooms: RoomItem[] = [];
  const thresholds: ThresholdSegment[] = [];
  const areaFaces: Ring[] = [];
  for (const layer of overlayLayers(state)) {
    const list = layer.rooms ?? [];
    const shared = new Map<string, number>();
    for (const r of list) {
      if (r.orphaned) continue;
      const sig = faceSignature(roomFace(r));
      if (sig) shared.set(sig, (shared.get(sig) ?? 0) + 1);
    }
    const badgeAt = roomBadgePoints(list);
    const areaIds = new Set((layer.areas ?? []).filter((a) => selected.has(a.id)).map((a) => a.id));
    for (const room of list) {
      const face = roomFace(room);
      if (areaIds.size > 0 && room.areaId && areaIds.has(room.areaId) && face.length >= 3) areaFaces.push(face);
      const isSel = selected.has(room.id);
      if (!showAll && !isSel) continue;
      const isHov = hovered.has(room.id);
      const warn = !!room.orphaned || (shared.get(faceSignature(face)) ?? 0) > 1;
      const at = badgeAt.get(room.id) ?? room.anchor;
      const badge = labels !== 'off' || isSel;
      const chip = labels === 'both';
      rooms.push({
        room,
        layerId: layer.id,
        face,
        at,
        selected: isSel,
        hovered: isHov,
        warn,
        badge,
        chip,
        shapeKey: `${refId(face)}|${zoomKey}|${isSel ? 1 : 0}|${isHov ? 1 : 0}|${ink}`,
        labelKey: `${room.number ?? ''}|${room.name}|${badge ? 1 : 0}|${chip ? 1 : 0}|${isSel ? 1 : 0}|${warn ? 1 : 0}|${at[0]},${at[1]}|${ink}`,
      });
    }
    if (roomTool) thresholds.push(...(layer.thresholds ?? []));
  }

  // Ghosts are drawn for (and accepted onto) the layer they were made on, the same
  // layer Accept all writes to: the list carries it.
  const list = state.ui.roomSuggestions;
  const owner = list ? state.layers.find((l) => l.id === list.layerId) : undefined;
  const suggestions = list && list.rooms.length > 0 && owner?.type === 'dungeon' ? list : null;
  return { rooms, thresholds, areaFaces, suggestions };
}

// ─── Suggestions: accept / reject one ──────────────────────────────────────

/**
 * Accept one suggestion: it becomes a room on the layer the proposals were made on (one
 * undo step) and leaves the ghosts. `layerId` is the ghost's own; a ghost of some other
 * list is refused.
 */
export function acceptSuggestion(layerId: string, roomId: string): void {
  const s = useStore.getState();
  const list = s.ui.roomSuggestions;
  if (!list || list.layerId !== layerId) return;
  const room = list.rooms.find((r) => r.id === roomId);
  if (!room) return;
  s.setRoomSuggestions({ layerId, rooms: list.rooms.filter((r) => r.id !== roomId) });
  undoManager.execute(new AcceptRoomsCommand(layerId, [room]));
}

/** Reject one suggestion: it leaves the ghosts, nothing else changes. */
export function rejectSuggestion(roomId: string): void {
  const s = useStore.getState();
  const list = s.ui.roomSuggestions;
  if (!list) return;
  s.setRoomSuggestions({ layerId: list.layerId, rooms: list.rooms.filter((r) => r.id !== roomId) });
}

// ─── Drawing ───────────────────────────────────────────────────────────────

function hexToNum(hex: string | undefined, fallback: number): number {
  if (!hex) return fallback;
  const n = parseInt(hex.replace('#', ''), 16);
  return Number.isNaN(n) ? fallback : n;
}

interface Palette {
  ink: number;
  paper: number;
  key: string;
}

function palette(): Palette {
  const desk = getEditorDesk();
  const ink = desk?.ink ?? '#1b1b1b';
  const paper = desk?.sheet ?? '#fbfbfb';
  return { ink: hexToNum(ink, 0x1b1b1b), paper: hexToNum(paper, 0xfbfbfb), key: `${ink}${paper}` };
}

function tracePoly(g: Graphics, ring: readonly [number, number][]): void {
  g.moveTo(ring[0][0], ring[0][1]);
  for (let i = 1; i < ring.length; i++) g.lineTo(ring[i][0], ring[i][1]);
  g.closePath();
}

/** The face pulled in by `d` world units; the face itself when that leaves nothing. */
const insetCache = new WeakMap<Ring, { d: number; out: Ring[] }>();
function insetFace(face: Ring, d: number): Ring[] {
  if (face.length < 3) return [];
  if (!isClipperReady() || d <= 0) return [face];
  const hit = insetCache.get(face);
  if (hit && hit.d === d) return hit.out;
  const grown = clipper2Engine.inflate([face], -d).filter((r) => r.length >= 3) as Ring[];
  const out = grown.length > 0 ? grown : [face];
  insetCache.set(face, { d, out });
  return out;
}

function closed(ring: Ring): Ring {
  return ring.length > 0 ? [...ring, ring[0]] : ring;
}

interface RoomView {
  shape: Graphics;
  label: Container;
  badgeBg: Graphics;
  num: Text;
  chipBg: Graphics;
  name: Text;
  glyph: Graphics;
  shapeKey: string;
  labelKey: string;
}

interface GhostView {
  root: Container;
  outline: Graphics;
  label: Container;
  bg: Graphics;
  name: Text;
  /** Glyph boxes, screen px relative to the anchor. */
  accept: { x: number; y: number; w: number; h: number };
  reject: { x: number; y: number; w: number; h: number };
  room: Room;
  layerId: string;
  key: string;
}

function makeText(size: number, weight: 'normal' | 'bold' = 'normal'): Text {
  return new Text({ text: '', style: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: size, fontWeight: weight, fill: 0x000000 } });
}

/** What the overlay has cost so far: redraws (store or zoom driven) and the outlines retessellated. */
export interface RoomOverlayStats {
  redraws: number;
  /** Room outlines retessellated, summed over every redraw. */
  shapes: number;
  /** Wall-clock ms spent in redraws, summed. */
  ms: number;
}

/** Handle on a mounted overlay: tear it down, and offer it a canvas press first. */
export interface RoomOverlayHandle {
  destroy(): void;
  /** A press at canvas px (sx, sy): true when a suggestion's ✓ or ✕ took it. */
  pressAt(sx: number, sy: number): boolean;
  /** Counters for the performance contract (tests, the dev console). */
  stats(): RoomOverlayStats;
  /** A room's label (badge + chip) bounds in canvas px, or null when it has none drawn. */
  labelRect(roomId: string): { x: number; y: number; width: number; height: number } | null;
}

/** Strokes the ink line `px` wide over a light halo; `trace` lays the path down (called twice). */
function haloStroke(g: Graphics, trace: () => void, px: number, zoom: number, ink: number, alpha: number): void {
  trace();
  g.stroke({ color: HALO_COLOR, width: (px + 2 * HALO_PX) / zoom, alpha: HALO_ALPHA });
  trace();
  g.stroke({ color: ink, width: px / zoom, alpha });
}

/**
 * Children of the screen overlay that stay above the rooms: the map-switch fade (by its
 * z-index), and the cursor's own feedback while drawing (the snap mark, the size readout, the
 * tool's preview — a marquee among them).
 */
const ABOVE_ROOMS_Z = 9999;
const ABOVE_ROOMS_LABELS: ReadonlySet<string> = new Set(['snapIndicator', 'dimensionHud', 'toolPreview']);
const staysAbove = (c: Container): boolean => c.zIndex >= ABOVE_ROOMS_Z || ABOVE_ROOMS_LABELS.has(c.label);

/**
 * Mount the room overlay over the engine's world and keep it in step with the store.
 * Call once from the canvas host in the v2 editor; `destroy` on teardown.
 *
 * The overlay is drawn in world units, but lives in the screen-space overlay container
 * (`engine.overlay()`) with the world's camera copied onto it every frame, so it sits
 * above the lighting composite and the light icons rather than under them.
 */
export function mountRoomOverlay(engine: RenderEngine): RoomOverlayHandle {
  const root = new Container();
  root.label = 'roomOverlay';
  root.eventMode = 'none';
  const areaG = new Graphics();
  areaG.label = 'roomOverlay-area';
  const shapes = new Container();
  const thresholdG = new Graphics();
  const ghosts = new Container();
  const labels = new Container();
  root.addChild(areaG, shapes, thresholdG, ghosts, labels);
  const screen = engine.overlay();
  screen.addChild(root);
  const stats: RoomOverlayStats = { redraws: 0, shapes: 0, ms: 0 };

  /** Copy the camera, and stay the last thing the overlay draws (the map-switch fade aside). */
  const follow = (): void => {
    if (root.parent !== screen) return;
    const world = engine.stage();
    if (root.position.x !== world.position.x || root.position.y !== world.position.y) root.position.copyFrom(world.position);
    if (root.scale.x !== world.scale.x || root.scale.y !== world.scale.y) root.scale.copyFrom(world.scale);
    // Icons arrive after the overlay (a light added, a door bound), appended on top: put the
    // rooms back over them, with the fade (and anything else marked above) back over the rooms.
    const kids = screen.children;
    let top = kids.length - 1;
    while (top > 0 && staysAbove(kids[top])) top--;
    if (kids[top] === root) return;
    screen.setChildIndex(root, kids.length - 1);
    for (const above of kids.filter(staysAbove)) screen.setChildIndex(above, kids.length - 1);
  };
  follow();
  // On the render ticker, ahead of the render itself, so a pan never shows the overlay a
  // frame behind the map.
  const ticker = engine.ticker?.();
  ticker?.add(follow);

  const views = new Map<string, RoomView>();
  const ghostViews = new Map<string, GhostView>();
  let anchorPreview: AnchorPreview | null = null;

  const findRoom = (layerId: string, roomId: string): Room | null => {
    const layer = useStore.getState().layers.find((l) => l.id === layerId);
    return layer?.type === 'dungeon' ? (layer.rooms ?? []).find((r) => r.id === roomId) ?? null : null;
  };

  const zoomNow = (): number => engine.stage().scale.x || 20;
  let settledZoom = zoomNow();
  let lastZoom = settledZoom;
  let zoomMovedAt = 0;
  let dirty = true;
  let pal = palette();

  const viewFor = (id: string): RoomView => {
    let v = views.get(id);
    if (v) return v;
    const shape = new Graphics();
    const label = new Container();
    const badgeBg = new Graphics();
    const num = makeText(11, 'bold');
    num.anchor.set(0.5);
    const chipBg = new Graphics();
    const name = makeText(12);
    name.anchor.set(0.5, 0);
    const glyph = new Graphics();
    label.addChild(chipBg, name, badgeBg, num, glyph);
    shapes.addChild(shape);
    labels.addChild(label);
    v = { shape, label, badgeBg, num, chipBg, name, glyph, shapeKey: '', labelKey: '' };
    views.set(id, v);
    return v;
  };

  const dropView = (id: string): void => {
    const v = views.get(id);
    if (!v) return;
    v.shape.destroy();
    v.label.destroy({ children: true });
    views.delete(id);
  };

  const drawShape = (v: RoomView, item: RoomItem, zoom: number): void => {
    const g = v.shape;
    g.clear();
    stats.shapes++;
    const rings = insetFace(item.face, OUTLINE_INSET_PX / zoom);
    if (rings.length === 0) return;
    if (item.selected) {
      for (const r of rings) tracePoly(g, r);
      g.fill({ color: pal.ink, alpha: SELECT_FILL });
    }
    const px = item.selected ? SELECT_PX : item.hovered ? HOVER_PX : OUTLINE_PX;
    const alpha = item.selected || item.hovered ? 1 : OUTLINE_ALPHA;
    haloStroke(g, () => rings.forEach((r) => tracePoly(g, r)), px, zoom, pal.ink, alpha);
  };

  const drawLabel = (v: RoomView, item: RoomItem): void => {
    const { room } = item;
    v.label.position.set(item.at[0], item.at[1]);
    v.badgeBg.clear();
    v.chipBg.clear();
    v.glyph.clear();
    v.num.visible = item.badge;
    v.badgeBg.visible = item.badge;
    if (item.badge) {
      const text = room.number !== undefined ? String(room.number) : '';
      v.num.text = text;
      v.num.style.fill = pal.paper;
      const r = text.length > 2 ? BADGE_R + 3 : BADGE_R;
      v.badgeBg.circle(0, 0, text ? r : 4).fill({ color: pal.ink, alpha: 0.92 });
      if (item.selected) v.badgeBg.circle(0, 0, r + 2.5).stroke({ color: pal.ink, width: 1.5, alpha: 1 });
    }
    v.name.visible = item.chip;
    v.chipBg.visible = item.chip;
    if (item.chip) {
      v.name.text = room.name;
      v.name.style.fill = pal.ink;
      const top = (item.badge ? BADGE_R : 0) + CHIP_GAP;
      v.name.position.set(0, top + 2);
      const w = v.name.width + 10;
      const h = v.name.height + 4;
      v.chipBg
        .roundRect(-w / 2, top, w, h, 4)
        .fill({ color: pal.paper, alpha: 0.92 })
        .roundRect(-w / 2, top, w, h, 4)
        .stroke({ color: pal.ink, width: 1, alpha: item.selected ? 0.9 : 0.35 });
    }
    if (item.warn) {
      // A small "!" in a triangle at the badge's shoulder: anchor off every face, or
      // two rooms on one face (the DM merges or moves one).
      const ox = item.badge ? BADGE_R + 2 : 0;
      const oy = item.badge ? -BADGE_R - 2 : 0;
      v.glyph
        .poly([ox, oy - 7, ox + 7, oy + 5, ox - 7, oy + 5])
        .fill({ color: pal.paper, alpha: 1 })
        .poly([ox, oy - 7, ox + 7, oy + 5, ox - 7, oy + 5])
        .stroke({ color: pal.ink, width: 1.5, alpha: 1 })
        .moveTo(ox, oy - 2.5)
        .lineTo(ox, oy + 1)
        .stroke({ color: pal.ink, width: 1.6, alpha: 1 })
        .circle(ox, oy + 3, 0.9)
        .fill({ color: pal.ink, alpha: 1 });
    }
  };

  const drawGhost = (gv: GhostView, zoom: number): void => {
    const face = roomFace(gv.room);
    gv.outline.clear();
    const rings = insetFace(face, OUTLINE_INSET_PX / zoom);
    haloStroke(
      gv.outline,
      () => rings.forEach((r) => dashSpine(gv.outline, closed(r), DASH_PX / zoom, GAP_PX / zoom)),
      OUTLINE_PX,
      zoom,
      pal.ink,
      OUTLINE_ALPHA,
    );

    // Chip: "Room N  ✓ ✕", centred on the anchor, glyph boxes recorded for the press test.
    gv.label.position.set(gv.room.anchor[0], gv.room.anchor[1]);
    gv.name.text = gv.room.name;
    gv.name.style.fill = pal.ink;
    const tw = gv.name.width;
    const h = GLYPH + 6;
    const w = tw + 12 + 2 * (GLYPH + 4);
    const x0 = -w / 2;
    const y0 = -h / 2;
    gv.name.position.set(x0 + 6, 0);
    gv.accept = { x: x0 + 6 + tw + 6, y: -GLYPH / 2, w: GLYPH, h: GLYPH };
    gv.reject = { x: gv.accept.x + GLYPH + 4, y: -GLYPH / 2, w: GLYPH, h: GLYPH };
    const a = gv.accept;
    const r = gv.reject;
    gv.bg
      .clear()
      .roundRect(x0, y0, w, h, 5)
      .fill({ color: pal.paper, alpha: 0.95 })
      .roundRect(x0, y0, w, h, 5)
      .stroke({ color: pal.ink, width: 1, alpha: 0.5 });
    // Dashed edge to say "not a room yet".
    dashSpine(gv.bg, [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h], [x0, y0]], 3, 2);
    gv.bg.stroke({ color: pal.ink, width: 1, alpha: 0.6 });
    gv.bg
      .roundRect(a.x, a.y, a.w, a.h, 3)
      .fill({ color: pal.ink, alpha: 0.92 })
      .moveTo(a.x + 4.5, a.y + 9.5)
      .lineTo(a.x + 8, a.y + 13)
      .lineTo(a.x + 14, a.y + 5.5)
      .stroke({ color: pal.paper, width: 2, alpha: 1 })
      .roundRect(r.x, r.y, r.w, r.h, 3)
      .stroke({ color: pal.ink, width: 1.2, alpha: 0.8 })
      .moveTo(r.x + 5, r.y + 5)
      .lineTo(r.x + 13, r.y + 13)
      .moveTo(r.x + 13, r.y + 5)
      .lineTo(r.x + 5, r.y + 13)
      .stroke({ color: pal.ink, width: 1.8, alpha: 0.9 });
  };

  const scaleLabels = (zoom: number): void => {
    const s = 1 / zoom;
    for (const v of views.values()) v.label.scale.set(s);
    for (const gv of ghostViews.values()) gv.label.scale.set(s);
  };

  const redraw = (): void => {
    const started = performance.now();
    stats.redraws++;
    const state = useStore.getState();
    const zoom = settledZoom;
    pal = palette();
    const model = roomOverlayModel(state, zoom, pal.key);

    // Rooms: pooled by id, each redrawn only when its own key moved.
    const live = new Set<string>();
    for (const item of model.rooms) {
      live.add(item.room.id);
      const v = viewFor(item.room.id);
      if (v.shapeKey !== item.shapeKey) {
        drawShape(v, item, zoom);
        v.shapeKey = item.shapeKey;
      }
      if (v.labelKey !== item.labelKey) {
        drawLabel(v, item);
        v.labelKey = item.labelKey;
      }
    }
    for (const id of [...views.keys()]) if (!live.has(id)) dropView(id);

    // Selected areas' extent: an ink wash over each member face with a paper band along its edge (so it reads on dark floors), ringed by a dashed line.
    areaG.clear();
    if (model.areaFaces.length > 0) {
      for (const face of model.areaFaces) tracePoly(areaG, face);
      areaG.fill({ color: pal.ink, alpha: AREA_FILL });
      for (const face of model.areaFaces) tracePoly(areaG, face);
      areaG.stroke({ color: pal.paper, width: AREA_EDGE_PX / zoom, alpha: AREA_EDGE_ALPHA });
      haloStroke(
        areaG,
        () => model.areaFaces.forEach((face) => dashSpine(areaG, closed(face), DASH_PX / zoom, GAP_PX / zoom)),
        OUTLINE_PX,
        zoom,
        pal.ink,
        OUTLINE_ALPHA,
      );
    }

    // Thresholds: dashed hairlines, only with a Rooms tab tool in hand.
    thresholdG.clear();
    for (const t of model.thresholds) if (t.points.length >= 2) dashSpine(thresholdG, t.points, DASH_PX / zoom, GAP_PX / zoom);
    if (model.thresholds.length > 0) thresholdG.stroke({ color: pal.ink, width: 1 / zoom, alpha: OUTLINE_ALPHA });

    // Suggestions: ghosts with their own ✓ / ✕.
    const ghostLive = new Set<string>();
    for (const room of model.suggestions?.rooms ?? []) {
      ghostLive.add(room.id);
      let gv = ghostViews.get(room.id);
      if (!gv) {
        const groot = new Container();
        const outline = new Graphics();
        const label = new Container();
        const bg = new Graphics();
        const name = makeText(12);
        name.anchor.set(0, 0.5);
        label.addChild(bg, name);
        groot.addChild(outline);
        ghosts.addChild(groot);
        labels.addChild(label);
        const box = { x: 0, y: 0, w: 0, h: 0 };
        gv = { root: groot, outline, label, bg, name, accept: box, reject: box, room, layerId: '', key: '' };
        ghostViews.set(room.id, gv);
      }
      gv.room = room;
      gv.layerId = model.suggestions!.layerId;
      const key = `${refId(room)}|${zoom}|${pal.key}`;
      if (gv.key !== key) {
        drawGhost(gv, zoom);
        gv.key = key;
      }
    }
    for (const [id, gv] of [...ghostViews]) {
      if (ghostLive.has(id)) continue;
      gv.root.destroy({ children: true });
      gv.label.destroy({ children: true });
      ghostViews.delete(id);
    }

    scaleLabels(zoomNow());
    applyAnchorPreview();
    stats.ms += performance.now() - started;
  };

  const applyAnchorPreview = (): void => {
    if (!anchorPreview) return;
    const v = views.get(anchorPreview.roomId);
    if (v) v.label.position.set(anchorPreview.point[0], anchorPreview.point[1]);
  };

  const unsubPreview = onAnchorPreview((p) => {
    const was = anchorPreview;
    anchorPreview = p;
    if (p) applyAnchorPreview();
    else if (was) {
      // Released or abandoned: put the badge back where the store says (a commit
      // redraws it anyway through the rooms array).
      const v = views.get(was.roomId);
      const room = v ? findRoom(was.layerId, was.roomId) : null;
      if (v && room) {
        const layer = useStore.getState().layers.find((l) => l.id === was.layerId);
        const at = layer?.type === 'dungeon' ? roomBadgePoints(layer.rooms ?? []).get(room.id) : undefined;
        const [x, y] = at ?? room.anchor;
        v.label.position.set(x, y);
      }
    }
  });

  // Store → dirty. The selector reads rooms, areas and thresholds by identity (plus the
  // layer flags that hide them), never `layers` itself: a prop drag rewrites the layers
  // array on every move, and must not cost the overlay a thing.
  const selectKeys = (s: MapBuilderStore): unknown[] => {
    const out: unknown[] = [
      s.selection.selectedIds,
      s.selection.hoveredId,
      s.ui.highlightedRoomId,
      s.ui.roomOverlayVisible,
      s.ui.roomLabels,
      s.ui.roomSuggestions,
      s.tools.activeTool,
      s.ui.activeLevelId,
      s.ui.activeLayerId,
      s.ui.solo,
    ];
    for (const l of s.layers) {
      if (l.type !== 'dungeon') continue;
      out.push(l.id, l.visible, l.levelId, l.rooms, l.areas, l.thresholds);
    }
    return out;
  };
  const unsubscribe = useStore.subscribe(selectKeys, () => {
    dirty = true;
  }, {
    equalityFn: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  });

  let rafId = 0;
  let lastPal = pal.key;
  const tick = (): void => {
    rafId = requestAnimationFrame(tick);
    if (!ticker) follow();
    const zoom = zoomNow();
    const now = performance.now();
    if (zoom !== lastZoom) {
      // Mid-zoom: keep the badges and chips screen-sized (a scale, not a redraw) and
      // let the outlines ride the camera until it settles.
      lastZoom = zoom;
      zoomMovedAt = now;
      scaleLabels(zoom);
    } else if (zoom !== settledZoom && now - zoomMovedAt >= ZOOM_SETTLE_MS) {
      settledZoom = zoom;
      dirty = true;
    }
    const desk = getEditorDesk();
    const palKey = `${desk?.ink ?? '#1b1b1b'}${desk?.sheet ?? '#fbfbfb'}`;
    if (palKey !== lastPal) {
      lastPal = palKey;
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      redraw();
    }
  };
  tick();

  const inBox = (x: number, y: number, b: { x: number; y: number; w: number; h: number }): boolean =>
    x >= b.x - 2 && x <= b.x + b.w + 2 && y >= b.y - 2 && y <= b.y + b.h + 2;

  return {
    pressAt(sx, sy) {
      for (const gv of ghostViews.values()) {
        const at = engine.worldToScreen(gv.room.anchor[0], gv.room.anchor[1]);
        const x = sx - at.x;
        const y = sy - at.y;
        if (inBox(x, y, gv.accept)) {
          acceptSuggestion(gv.layerId, gv.room.id);
          return true;
        }
        if (inBox(x, y, gv.reject)) {
          rejectSuggestion(gv.room.id);
          return true;
        }
      }
      return false;
    },
    stats: () => ({ ...stats }),
    labelRect(roomId) {
      const v = views.get(roomId);
      if (!v || !v.label.visible || (!v.badgeBg.visible && !v.chipBg.visible)) return null;
      const b = v.label.getBounds();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    },
    destroy() {
      ticker?.remove(follow);
      cancelAnimationFrame(rafId);
      unsubscribe();
      unsubPreview();
      views.clear();
      ghostViews.clear();
      root.destroy({ children: true });
    },
  };
}
