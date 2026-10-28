import { Assets, Texture, TilingSprite } from 'pixi.js';
import { useStore } from '../store/store';
import { notify } from '../shared/notify';
import type { SceneGraph, LayerEntry } from './sceneGraph';
import {
  addLayerToScene,
  removeLayerFromScene,
  reorderLayers,
  getLayerEntries,
  getLayerEntry,
} from './sceneGraph';
import type { RenderEngine } from './RenderEngine';
import { markDirty as markRenderCacheDirty } from './renderCache';
import { rebuildDungeonLayer, redrawDoors, redrawRoomFills, preloadLayerTextures } from './floorWallRenderer';
import { roomsPinWalls } from '../shared/wallLook';
import { preloadWallTextures } from './wallNodeRenderer';
import type { DungeonLayer, LightChild, RoomLook, ShapeChild } from '../store/types';
import { levelOf } from '../shared/lookScope';
import { layerDrawStyle } from './levelLook';
import { isLayerShown } from '../store/selectors';
import { propOccluderKey } from '../shared/propOcclusion';
import type { RingGeometry, ThresholdSegment, WallEdits, WallSegment } from '../shared/types';
import { LightManager } from './lighting';
import { computeMergedFloor } from './mergedFloor';
import { remapFloorWallEdits } from './ringEditRemap';
import { scheduleRoomSync } from '../store/roomRefresh';

/**
 * A number per object identity, for folding "this array is a new one" into a
 * string key. Immer hands out a new `rooms`/`areas` array exactly when one of
 * them changed, so the identity is the change signal.
 */
const refIds = new WeakMap<object, number>();
let nextRefId = 1;
function refId(obj: object | undefined): number {
  if (!obj) return 0;
  let id = refIds.get(obj);
  if (id === undefined) refIds.set(obj, (id = nextRefId++));
  return id;
}

/** The thresholds' geometry: they cut room faces, so they ride into the room key. */
function thresholdKeyOf(thresholds: readonly ThresholdSegment[] | undefined): string {
  return (thresholds ?? []).map((t) => `${t.id}:${t.points.map((p) => `${p[0]}_${p[1]}`).join(';')}`).join(',');
}

const digestCache = new WeakMap<RingGeometry & object, number>();
const wallDigestCache = new WeakMap<WallSegment, number>();
const editsDigestCache = new WeakMap<WallEdits, number>();

/**
 * One FNV-1a step, quantised to 1e-4 of a cell so float noise alone cannot
 * trigger a rebuild. Shared by both digests below.
 */
function mixInto(h: number, v: number): number {
  h ^= Math.round(v * 1e4) | 0;
  return Math.imul(h, 0x01000193);
}

/**
 * A shape's own style overrides as a stable string, so the floor bake re-runs
 * when one is set, changed or cleared. Sorted keys: the same overrides written
 * in a different order must not count as a change. Empty and absent agree.
 */
export function styleOverridesDigest(overrides: object | undefined): string {
  if (!overrides) return '';
  const keys = Object.keys(overrides).sort();
  if (keys.length === 0) return '';
  const o = overrides as Record<string, unknown>;
  return JSON.stringify(keys.map((k) => [k, o[k]]));
}

/**
 * Cheap fingerprint of a shape's actual geometry.
 *
 * This used to be ring count plus point count, which is blind to a point
 * *moving*: dragging, resizing or nudging a vertex left the key identical, so
 * mergedFloor was never recomputed and the floor and walls kept the old
 * outline while the store held the new one. The stored transform was missing
 * too, despite the comment claiming otherwise.
 *
 * Folded to a number rather than a string — this runs on every store change,
 * and a map's worth of coordinates is not worth allocating a string for.
 * Quantised to 1e-4 of a cell so float noise alone cannot trigger a rebuild.
 *
 * Memoised on the shape's own object reference: immer replaces a shape whenever
 * anything under it changes, so a stale entry is unreachable by construction and
 * the map never needs sweeping. Without it this walks every coordinate of every
 * shape on every store change, which during a drag is every pointermove.
 *
 * ponytail: a write that mutates a ShapeChild outside immer would keep the old
 * digest. Nothing does today — every write goes through useStore.setState. If
 * one appears, key the cache on a version counter instead.
 */
function geometryDigest(shape: RingGeometry & object): number {
  const cached = digestCache.get(shape);
  if (cached !== undefined) return cached;

  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h = mixInto(h, v);
  };
  for (const ring of shape.contours) {
    mix(ring.length);
    for (const [x, y] of ring) {
      mix(x);
      mix(y);
    }
  }
  // Curve handles reshape the flattened ring without moving any contour point,
  // so they must move the digest too — or bending an edge redraws nothing.
  for (const ring of shape.tangents ?? []) {
    mix(ring?.length ?? -1);
    for (const vt of ring ?? []) {
      mix(vt?.tin?.[0] ?? -1);
      mix(vt?.tin?.[1] ?? -1);
      mix(vt?.tout?.[0] ?? -1);
      mix(vt?.tout?.[1] ?? -1);
    }
  }
  const t = shape.transform;
  if (t) {
    mix(t.translate[0]); mix(t.translate[1]);
    mix(t.rotate);
    mix(t.scale[0]); mix(t.scale[1]);
  }
  const digest = h >>> 0;
  digestCache.set(shape, digest);
  return digest;
}

/**
 * The same fold, for a standalone wall's own geometry.
 *
 * `wallSignature` carried id, type and direction and nothing else, so moving a
 * wall's points moved no key at all: the stones kept the old layout, the rooms
 * were never re-detected, occlusion kept casting against the line the wall used
 * to be on, and a door anchored to that wall drew where the wall no longer was.
 * Width is in here too — it scales every stone on the run.
 *
 * Memoised on the segment's own reference, for the reason `geometryDigest` is:
 * immer replaces a wall whenever anything under it changes.
 */
function wallDigest(wall: WallSegment): number {
  const cached = wallDigestCache.get(wall);
  if (cached !== undefined) return cached;

  // An unpinned width follows the layer; the style change rebuilds the layer itself.
  let h = mixInto(0x811c9dc5, wall.width ?? -1);
  for (const [x, y] of wall.points) h = mixInto(mixInto(h, x), y);
  // The look pins a preset writes: an undo that only takes them back must still redraw.
  h = mixString(h, wall.textureSetId);
  h = mixString(h, wall.textureTint);
  const digest = h >>> 0;
  wallDigestCache.set(wall, digest);
  return digest;
}

/** Fold a string (a piece id, a ring key) into the same hash. */
function mixString(h: number, s: string | undefined): number {
  h = mixInto(h, s === undefined ? -1 : s.length);
  for (let i = 0; i < (s?.length ?? 0); i++) h = mixInto(h, (s as string).charCodeAt(i));
  return h;
}

/**
 * The same fold again, for the hand edits to a run's composed stones.
 *
 * Deliberately *not* part of `wallDigest`: that one rides into `roomKey`, and through it
 * into the room resync and every light's occlusion sweep. A nudged, swapped or removed
 * stone moves no room boundary and casts no new shadow — it is cosmetic layout — so this
 * belongs in `renderKey` alone, or a stone drag re-detects the rooms and re-sweeps every
 * light on every pointermove.
 *
 * Nothing carried these before: `renderNodeWalls` consumes `nodeEdits`/`spanEdits`/
 * `nodeInserts` and the layer's `floorWallEdits`, but no selector key mentioned them, so
 * `updateWall({ nodeEdits })` and `setFloorWallEdits(...)` wrote the store and redrew
 * nothing. The same hole the wall's own points had — both only ever worked through the
 * accidental universal rebuild the perf pass removed.
 *
 * Memoised on the edits object's own reference, for the reason the two above are: both
 * writes go through immer, which replaces the wall (and the layer's `floorWallEdits`
 * record) whenever anything under it changes.
 */
function editsDigest(edits: WallEdits): number {
  const cached = editsDigestCache.get(edits);
  if (cached !== undefined) return cached;

  let h = 0x811c9dc5;
  for (const e of edits.nodeEdits ?? []) {
    h = mixInto(h, e.t);
    h = mixInto(h, e.rotate ?? 0);
    h = mixInto(h, e.scale ?? 0);
    h = mixInto(h, e.dx ?? 0);
    h = mixInto(h, e.dy ?? 0);
    h = mixInto(h, e.removed ? 1 : 0);
    h = mixString(h, e.pieceId);
  }
  for (const s of edits.spanEdits ?? []) h = mixInto(mixInto(h, s.t), s.gap);
  for (const n of edits.nodeInserts ?? []) {
    h = mixInto(mixInto(mixInto(h, n.t), n.rotate ?? 0), n.scale ?? 0);
    h = mixString(h, n.pieceId);
  }
  const digest = h >>> 0;
  editsDigestCache.set(edits, digest);
  return digest;
}

/**
 * Every hand edit on a layer, standalone runs and floor rings alike, as one key.
 *
 * A standalone wall carries its edits on itself (`WallSegment extends WallEdits`); a floor
 * ring has no such object, so its edits live on the layer keyed by ring index. Both reach
 * `renderNodeWalls`, so both have to reach `renderKey`.
 */
function wallEditsKeyOf(layer: DungeonLayer): string {
  // The per-wall style pins ride along here rather than in `wallSignature`, for the
  // reason the stone edits do: a wall that changes texture set or tint moves no room
  // boundary and casts no new shadow, so it must re-lay its stones without dragging
  // room detection and every light's occlusion sweep along with it.
  const walls = layer.standaloneWalls
    .map((w) => `${editsDigest(w)}:${w.textureSetId ?? ''}:${w.textureTint ?? ''}`)
    .join(',');
  const rings = Object.entries(layer.floorWallEdits ?? {})
    .map(([ring, edits]) => `${ring}:${editsDigest(edits)}`)
    .join(',');
  return `${walls}|${rings}`;
}

// ─── Layer draws, coalesced to one per frame ──────────────────────────────
//
// A drag delivers several pointermove events between two frames and every one
// of them lands a store write, so the unbatched path ran 3-8 full stone
// rebuilds to draw a single frame. Pending layer ids collect in a set and the
// flush re-reads the layer, so the last write of the frame is the one drawn.
//
// A rebuild supersedes a doors-only redraw of the same layer: rebuildDungeonLayer
// redraws the doors sublayer anyway, so running both would draw them twice.

const pendingRebuild = new Set<string>();
const pendingRedraw = new Set<string>();
// Room, area and level look edits that move no floor: only the room fills redraw.
const pendingFills = new Set<string>();
// Layers whose containers outlive their store entry by one flush: a wholesale document
// swap (`loadFromFile` on a scene switch) replaces every layer id at once, and destroying
// the outgoing containers before the incoming layers have drawn leaves a frame of bare
// water and grid — the F1 wipe. The old scene stays on screen until the same flush that
// first draws the new one, then goes in one motion.
const pendingRemoval = new Set<string>();
// `flushLayerDraws` needs the scene graph to destroy parked containers, but is module-level
// for the tests' sake — captured here by `subscribeToStore`, which owns its lifetime.
let removalSceneGraph: SceneGraph | null = null;
let rafHandle: number | null = null;
let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
/** Counts flushes; see `layerDrawEpoch`. */
let drawEpoch = 0;

/**
 * Bumps on every flush of queued layer draws. The draws land a frame after the store change
 * that queued them, so the lighting's content mask (`LightingRenderer.setContent`) re-reads
 * the scene on this, not on the store.
 */
export function layerDrawEpoch(): number {
  return drawEpoch;
}

/**
 * Draw everything queued, now.
 *
 * Exported so unit tests stay synchronous — they drive the store directly and
 * never run a frame.
 */
export function flushLayerDraws(): void {
  if (rafHandle !== null) { cancelAnimationFrame(rafHandle); rafHandle = null; }
  if (timeoutHandle !== null) { clearTimeout(timeoutHandle); timeoutHandle = null; }

  const rebuilds = [...pendingRebuild];
  const redraws = [...pendingRedraw];
  const fills = [...pendingFills].filter((id) => !pendingRebuild.has(id));
  pendingRebuild.clear();
  pendingRedraw.clear();
  pendingFills.clear();

  for (const id of rebuilds) {
    const entry = getLayerEntry(id);
    const layer = useStore.getState().layers.find((l) => l.id === id);
    if (entry && layer && layer.type === 'dungeon') rebuildDungeonLayer(layer, entry);
  }
  for (const id of redraws) {
    const entry = getLayerEntry(id);
    const layer = useStore.getState().layers.find((l) => l.id === id);
    if (entry && layer && layer.type === 'dungeon') redrawDoors(layer, entry);
  }
  for (const id of fills) {
    const entry = getLayerEntry(id);
    const layer = useStore.getState().layers.find((l) => l.id === id);
    if (entry && layer && layer.type === 'dungeon') {
      markRenderCacheDirty(id);
      redrawRoomFills(layer, entry);
    }
  }

  // Parked containers go last, in the same synchronous flush that drew their
  // replacements: no frame ever renders the gap between the two scenes.
  if (pendingRemoval.size && removalSceneGraph) {
    const live = new Set(useStore.getState().layers.map((l) => l.id));
    for (const id of pendingRemoval) {
      if (!live.has(id)) removeLayerFromScene(removalSceneGraph, id);
    }
    pendingRemoval.clear();
  }
  drawEpoch++;
}

/**
 * Backstop for the rAF above. A backgrounded tab suspends rAF entirely, and the
 * E2E hooks force frames through `__pixiApp.render()` where it never runs — a
 * rebuild queued and never flushed is a blank map. One frame's worth of slack,
 * so the rAF still wins whenever the tab is drawing.
 */
const HIDDEN_TAB_FLUSH_MS = 32;

function armFlush(): void {
  if (rafHandle !== null || timeoutHandle !== null) return;
  rafHandle = requestAnimationFrame(flushLayerDraws);
  timeoutHandle = setTimeout(flushLayerDraws, HIDDEN_TAB_FLUSH_MS);
}

function scheduleRebuild(layerId: string): void {
  pendingRedraw.delete(layerId);
  pendingRebuild.add(layerId);
  armFlush();
}

function scheduleRedrawDoors(layerId: string): void {
  if (!pendingRebuild.has(layerId)) pendingRedraw.add(layerId);
  armFlush();
}

function scheduleRedrawFills(layerId: string): void {
  if (!pendingRebuild.has(layerId)) pendingFills.add(layerId);
  armFlush();
}

/**
 * Effective grid visibility is global × per-layer. Flips the container flag
 * directly — no stone re-layout, no redrawGrid call — so the toggle is O(1)
 * per layer instead of a full grid rebuild.
 */
function applyGridVisibility(entry: LayerEntry, perLayerGridVisible: boolean, globalVisible: boolean): void {
  if (!entry.sublayers) return;
  entry.sublayers.grid.visible = globalVisible && perLayerGridVisible;
}

/**
 * Subscribe to Zustand store changes and sync PixiJS scene graph.
 * This runs outside of React's render cycle.
 * Returns a cleanup function to unsubscribe.
 */
export function subscribeToStore(
  engine: RenderEngine,
  sceneGraph: SceneGraph,
  lightManager: LightManager,
): () => void {
  const unsubscribers: (() => void)[] = [];
  removalSceneGraph = sceneGraph;

  // ─── Layer list changes (add/remove/reorder) ──────────
  let prevLayerIds: string[] = [];

  const unsubLayers = useStore.subscribe(
    (state) => state.layers,
    (layers) => {
      const currentIds = layers.map((l) => l.id);
      const entries = getLayerEntries();

      // Add new layers
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        // Removed and re-added before the flush ran: the container never left.
        pendingRemoval.delete(layer.id);
        if (!entries.has(layer.id)) {
          addLayerToScene(engine, sceneGraph, layer.id, layer.type, i);
        }
      }

      // Remove deleted layers — parked until the flush that draws their replacements
      // (see pendingRemoval above). armFlush covers the no-rebuild case: a swap to a
      // document with nothing to draw must still take the old containers down.
      for (const id of entries.keys()) {
        if (!currentIds.includes(id)) {
          pendingRemoval.add(id);
          armFlush();
        }
      }

      // Reorder if order changed
      const idsChanged =
        currentIds.length !== prevLayerIds.length ||
        currentIds.some((id, i) => id !== prevLayerIds[i]);
      if (idsChanged) {
        reorderLayers(sceneGraph, currentIds);
      }

      prevLayerIds = currentIds;
    },
    { fireImmediately: true },
  );
  unsubscribers.push(unsubLayers);

  // ─── Layer visibility changes ─────────────────────────
  // Reads effective visibility (own flag narrowed by solo, and the shown level —
  // see isLayerShown), not the raw flag: soloing never writes
  // `layer.visible` (render-only override), so this is the only thing that
  // makes solo actually hide the other layers on screen. The selector's
  // output changes whenever solo does, even though `state.layers` itself
  // does not, which is what re-fires this on a solo toggle.
  const unsubVisibility = useStore.subscribe(
    (state) =>
      state.layers.map((l) => ({ id: l.id, type: l.type, visible: isLayerShown(state, l) })),
    (layerVisibility) => {
      for (const { id, type, visible } of layerVisibility) {
        const entry = getLayerEntry(id);
        if (entry) {
          const displayObj = entry.textureSprite ?? entry.container;
          displayObj.visible = visible;
        }
        // Background pixels render via bgFill/bgTilingSprite under
        // sceneGraph.backgroundLayer, not this layer's own entry container —
        // the entry above does nothing for the background layer.
        if (type === 'background') sceneGraph.backgroundLayer.visible = visible;
      }
    },
    {
      fireImmediately: true,
      equalityFn: (a, b) =>
        a.length === b.length &&
        a.every((item, i) => item.id === b[i].id && item.visible === b[i].visible),
    },
  );
  unsubscribers.push(unsubVisibility);

  // ─── Layer opacity changes ────────────────────────────
  // Opacity isn't affected by solo (only visibility is), so this still reads
  // the raw flag — but background still needs the same extra mirror as above.
  const unsubOpacity = useStore.subscribe(
    (state) => state.layers.map((l) => ({ id: l.id, type: l.type, opacity: l.opacity })),
    (layerOpacities) => {
      for (const { id, type, opacity } of layerOpacities) {
        const entry = getLayerEntry(id);
        if (entry) {
          const displayObj = entry.textureSprite ?? entry.container;
          displayObj.alpha = opacity;
        }
        if (type === 'background') sceneGraph.backgroundLayer.alpha = opacity;
      }
    },
    {
      fireImmediately: true,
      equalityFn: (a, b) =>
        a.length === b.length &&
        a.every((item, i) => item.id === b[i].id && item.opacity === b[i].opacity),
    },
  );
  unsubscribers.push(unsubOpacity);

  // ─── Shape/wall changes → mark render cache dirty ────
  // Last geometry seen per layer, so the handler can tell a floor edit from a
  // door toggle: both wake it, only one may touch the union or the rooms.
  const prevGeometryKeys = new Map<string, { floor: string; room: string; render: string; doorState: string }>();
  // Per layer: the rooms/areas identity last drawn, and whether any room or area pinned
  // a wall look then. A look edit redraws the room fills; one that pins (or drops) a
  // wall look re-lays the stones, since the edges it touches change kit.
  const prevRoomLooks = new Map<string, { key: string; wallPins: boolean }>();
  // Every layer's lighting-relevant key, joined — a layer appearing or leaving
  // moves it too, which is what a per-layer comparison would have missed.
  let prevLightingKey: string | null = null;

  const unsubShapes = useStore.subscribe(
    (state) =>
      state.layers
        .filter((l): l is DungeonLayer => l.type === 'dungeon')
        .map((l) => ({
          id: l.id,
          shapeCount: l.children.filter((c) => c.childType === 'shape').length,
          wallCount: l.standaloneWalls.length,
          // Bumped when a pack texture a floor bake needed lands after the bake
          // (armLateTextureRebuild) — rides into renderKey so the bake re-runs.
          floorTextureEpoch: state.floorTextureEpochs[l.id] ?? 0,
          // Track shape IDs + geometry to detect changes (NOT mergedFloor — we write that)
          shapeKeys: l.children
            .filter((c): c is ShapeChild => c.childType === 'shape')
            // styleOverrides too: a per-shape floor colour is painted by this bake,
            // and leaving it out meant setting one changed the store and nothing else.
            .map((c) => `${c.id}:${c.visible}:${geometryDigest(c)}:${c.textureId ?? ''}:${c.textureScale ?? ''}:${c.textureTint ?? ''}:${c.textureOffsetX ?? 0}:${c.textureOffsetY ?? 0}:${c.textureFillRotation ?? 0}:${styleOverridesDigest(c.styleOverrides)}`)
            .join(','),
          // The same shapes, geometry only. Everything above this line that is
          // dressing — texture, scale, tint, offset, fill rotation — moves no
          // outline, so the Clipper2 union and detectRooms must not see it:
          // nudging a texture offset used to re-union the map and re-detect
          // every room on every pointermove.
          shapeGeometryKeys: l.children
            .filter((c): c is ShapeChild => c.childType === 'shape')
            .map((c) => `${c.id}:${c.visible}:${geometryDigest(c)}`)
            .join(','),
          // Door GEOMETRY (id/visible/width/position/wallId) — a change here
          // still needs the full rebuild below because withoutDoorGaps
          // (wallNodeRenderer.ts) cuts stone gaps from this exact geometry.
          // Not angle — it is derived from the resolved wall, and authored
          // angle only moves with position/wallId anyway.
          doorGeometryKey: l.children
            .filter((c): c is import('../shared/types').DoorChild => c.childType === 'door')
            .map((c) => `${c.id}:${c.visible}:${c.width}:${c.position[0]}_${c.position[1]}:${c.wallId}`)
            .join(','),
          // Door STATE (state/isSecret/style, and how far and which way it
          // opens) — changes how a door looks and whether it blocks light, but
          // not wall geometry. Handled by a doors-only redraw further down: no
          // stone re-layout, no Clipper2.
          doorStateKey: l.children
            .filter((c): c is import('../shared/types').DoorChild => c.childType === 'door')
            .map((c) => `${c.id}:${c.state}:${c.isSecret}:${c.style}:${c.openAngle}:${c.hinge}:${c.swing}:${c.hinges}:${c.kit}`)
            .join(','),
          // Track water body changes
          waterSignature: l.children
            .filter((c): c is import('../shared/types').WaterChild => c.childType === 'water')
            .map((c) => `${c.id}:${c.visible}:${c.contours.length}:${c.contours[0]?.length ?? 0}:${c.contours[0]?.[0] ?? ''}:${c.contours[0]?.at(-1) ?? ''}:${c.textureId}:${c.tint}:${c.opacity}:${c.bankTextureId}:${c.bankWidth}`)
            .join(','),
          // Wall type/direction for lighting, plus the wall's own geometry —
          // see wallDigest. This rides into roomKey, and through it into
          // renderKey and lightingKey, so a wall that moves re-lays its stones,
          // re-detects the rooms and re-sweeps the lights, exactly once.
          wallSignature: l.standaloneWalls
            .map((w) => `${w.id}:${w.wallType}:${w.direction}:${wallDigest(w)}`)
            .join(','),
          // Hand stone edits, standalone runs and floor rings alike — see wallEditsKeyOf.
          // This rides into renderKey and nothing else: a nudged stone is cosmetic layout,
          // so it must not move a room boundary or re-sweep a light.
          wallEditsKey: wallEditsKeyOf(l),
          // Thresholds cut room faces and draw nothing, so they ride into roomKey
          // only. Their commands already refresh the rooms; this covers any write
          // that reaches the store without one.
          thresholdKey: thresholdKeyOf(l.thresholds),
          // The rooms and areas themselves, by identity: a room's look (and later
          // its mood) changes the lighting, so a new array re-sweeps the lights.
          // Not in roomKey — syncRooms writes `rooms`, and keying the refresh on
          // its own output would loop.
          roomsRef: refId(l.rooms),
          areasRef: refId(l.areas),
          // Props with "Blocks light and sight": moving, turning or resizing one re-sweeps.
          propOccluders: propOccluderKey(l.children),
        })),
    (dungeonLayers) => {
      let geometryChanged = false;
      const lightingKeys: string[] = [];
      for (const { id, shapeCount, shapeKeys, shapeGeometryKeys, wallCount, wallSignature, wallEditsKey, waterSignature, doorGeometryKey, doorStateKey, floorTextureEpoch, thresholdKey, roomsRef, areasRef, propOccluders } of dungeonLayers) {
        const entry = getLayerEntry(id);
        const layer = useStore.getState().layers.find((l) => l.id === id);
        if (entry && layer && layer.type === 'dungeon') {
          // The union is a function of the shape children and nothing else, but
          // this subscription also fires for doors, walls and water. Toggling a
          // door open used to rebuild it anyway (#18): Clipper2 on a dressed map
          // is ~280ms, and the fresh mergedFloor array it wrote busted the wall
          // resolver memo on top, dragging the stones through a rebuild too.
          // Geometry only — see shapeGeometryKeys above. A texture edit leaves
          // both of these identical and so touches neither Clipper2 nor rooms.
          const floorKey = `${shapeCount}|${shapeGeometryKeys}`;
          // What the walls are a function of, and so what the stones and the
          // lights are drawn against.
          const detectionKey = `${floorKey}|${wallCount}|${wallSignature}`;
          // What the room faces are a function of: the walls plus the thresholds.
          // A floor vertex drag reaches the store through UpdateChildCommand —
          // which carries no `affectsRooms` — so this debounce is what refreshes
          // the faces after it.
          const roomKey = `${detectionKey}|${thresholdKey}`;
          // Everything that forces a full rebuild (stone re-layout): floor
          // and wall geometry, the shapes' dressing, water, door GEOMETRY, and
          // the hand stone edits —
          // door geometry is here (not just roomKey) because withoutDoorGaps
          // needs it to cut stone gaps. Door STATE is deliberately excluded: it
          // is handled by the doors-only redraw below and must never re-run this.
          const renderKey = `${detectionKey}|${shapeKeys}|${waterSignature}|${doorGeometryKey}|${wallEditsKey}|${floorTextureEpoch}`;
          // What occlusion is a function of: the outlines light is cast against
          // (floor rings and walls) plus every door's geometry and state. A
          // texture edit is absent from all of it.
          const lightingKey = `${id}|${detectionKey}|${doorGeometryKey}|${doorStateKey}|${roomsRef}|${areasRef}|${propOccluders}`;
          lightingKeys.push(lightingKey);
          const prev = prevGeometryKeys.get(id);
          if (prev?.room !== roomKey) geometryChanged = true;
          const renderChanged = prev?.render !== renderKey;
          const doorStateChanged = prev?.doorState !== doorStateKey;
          // …or when the layer is holding no union at all. This key is only sound while
          // this subscriber is the only writer of `mergedFloor`, and `loadFromFile`
          // replaces `state.layers` wholesale: the map the session server sends a player
          // ships `mergedFloor: null` on purpose (one union across the layer cannot be cut
          // per room), so every reveal hands the store a layer with the floor stripped
          // out. A reveal that carries no floor geometry — `reveal-secret` hands over a
          // door child and nothing else — leaves `floorKey` byte-identical to the pass
          // before, and the key alone answered "nothing to do" while the store sat on a
          // null union: the floors and walls vanished, and `resolveWalls` (which reads the
          // rings) stopped resolving the floor-ring walls, so the doors glued to them drew
          // adrift of the room too. The key still guards the *recompute*; an empty union
          // overrides it, because the key is about change and this is about absence.
          if (prev?.floor !== floorKey || layer.mergedFloor == null) {
            const newFloor = computeMergedFloor(layer);
            // Write via setState — safe because the subscription equality fn
            // only compares shapeCount/wallCount/shapeKeys, not mergedFloor
            useStore.setState((s) => {
              const l = s.layers.find((la) => la.id === id);
              if (l && l.type === 'dungeon') {
                // Ring-index keys follow their ring across the recompute; see
                // ringEditRemap.ts. Old rings must be read BEFORE the write.
                if (l.floorWallEdits && l.mergedFloor && newFloor) {
                  l.floorWallEdits = remapFloorWallEdits(
                    l.mergedFloor,
                    newFloor,
                    l.floorWallEdits,
                  );
                }
                l.mergedFloor = newFloor;
              }
            });
          }
          prevGeometryKeys.set(id, { floor: floorKey, room: roomKey, render: renderKey, doorState: doorStateKey });

          if (renderChanged) {
            markRenderCacheDirty(id);
            // Queued for the frame (solid color fallback for unloaded textures)
            scheduleRebuild(id);
            // Async: preload textures, then re-rebuild once they're cached
            preloadLayerTextures(layer).then((loaded) => {
              if (!loaded) return;
              markRenderCacheDirty(id);
              scheduleRebuild(id);
            });
          } else if (doorStateChanged) {
            // State-only flip: redraw the doors sublayer, skip stone re-layout
            // and the Clipper2 union entirely — this is the ~60ms→<50ms fix.
            markRenderCacheDirty(id);
            scheduleRedrawDoors(id);
          }

          const roomLookKey = `${roomsRef}|${areasRef}`;
          const prevLooks = prevRoomLooks.get(id);
          if (prevLooks?.key !== roomLookKey) {
            const wallPins = roomsPinWalls(layer);
            prevRoomLooks.set(id, { key: roomLookKey, wallPins });
            if (prevLooks && !renderChanged) {
              if (wallPins || prevLooks.wallPins) {
                markRenderCacheDirty(id);
                scheduleRebuild(id);
              } else {
                scheduleRedrawFills(id);
              }
            }
          }
        }
      }
      // Drop keys for layers that no longer exist, so the map does not grow for
      // the life of the session. Guarded because this handler now also fires per
      // pointermove while a door is dragged.
      if (prevGeometryKeys.size > dungeonLayers.length) {
        const liveIds = new Set(dungeonLayers.map((l) => l.id));
        for (const id of prevGeometryKeys.keys()) if (!liveIds.has(id)) prevGeometryKeys.delete(id);
        for (const id of prevRoomLooks.keys()) if (!liveIds.has(id)) prevRoomLooks.delete(id);
      }
      // Door state feeds occlusion, so an open door has to re-sweep even though
      // no geometry moved — but a texture or tint edit does not, and this used
      // to fire on any render-key change, dragging every light's visibility
      // polygon through a full re-sweep per pointermove while a swatch was
      // being nudged. The key is every input `extractWallSegments` reads.
      const lightingKey = lightingKeys.join('||');
      if (lightingKey !== prevLightingKey) {
        prevLightingKey = lightingKey;
        lightManager.invalidateAll();
      }
      // Rooms are a function of floor + wall geometry only — a door opening
      // does not move a room boundary, and syncRooms rewrites every door's
      // roomA/roomB, which would churn the door children for nothing.
      // Debounced because this fires per node while a wall is being drawn. Also
      // covers load: layers are replaced wholesale, so a file without rooms
      // gets them here.
      if (geometryChanged) scheduleRoomSync();
    },
    {
      // fireImmediately: render shapes already in the store at subscribe time.
      // The map rehydrates from IndexedDB before the engine finishes booting,
      // so without an initial pass a reloaded map stays invisible until the
      // first mutation.
      fireImmediately: true,
      equalityFn: (a, b) =>
        a.length === b.length &&
        a.every((item, i) =>
          item.id === b[i].id &&
          item.shapeCount === b[i].shapeCount &&
          item.wallCount === b[i].wallCount &&
          item.shapeKeys === b[i].shapeKeys &&
          item.doorGeometryKey === b[i].doorGeometryKey &&
          item.doorStateKey === b[i].doorStateKey &&
          item.wallSignature === b[i].wallSignature &&
          item.wallEditsKey === b[i].wallEditsKey &&
          item.waterSignature === b[i].waterSignature &&
          item.thresholdKey === b[i].thresholdKey &&
          item.roomsRef === b[i].roomsRef &&
          item.areasRef === b[i].areasRef &&
          item.propOccluders === b[i].propOccluders,
        ),
    },
  );
  unsubscribers.push(unsubShapes);

  // ─── Level looks → the layers in each level ───────────────
  // A level's look reaches every layer of it by the rule in wallLook.ts (`levelStyle`):
  // its floor tint is a fill over the floor, so a tint-only edit redraws the fills; its
  // wall set, tint and width and its floor texture change what the floor and the stones
  // are drawn with, so those rebuild the layer (and load the set). Moving a layer to
  // another level is the same change seen from the layer.
  const prevLevelLooks = new Map<string, RoomLook | undefined>();
  const levelRebuildKeys = ['wallTextureSetId', 'wallTextureTint', 'wallWidth', 'floorTextureId'] as const;
  const unsubLevels = useStore.subscribe(
    (state) => ({ levels: state.levels, levelIds: state.layers.map((l) => `${l.id}:${l.levelId}`).join(',') }),
    () => {
      const state = useStore.getState();
      for (const l of state.layers) {
        if (l.type !== 'dungeon') continue;
        const look = levelOf(state.levels ?? [], l).look;
        const had = prevLevelLooks.has(l.id);
        const before = prevLevelLooks.get(l.id);
        prevLevelLooks.set(l.id, look);
        if (had && before === look) continue;
        if (levelRebuildKeys.some((k) => before?.[k] !== look?.[k])) {
          markRenderCacheDirty(l.id);
          scheduleRebuild(l.id);
          const layer = l as DungeonLayer;
          const rebuildWhenLoaded = (loaded: boolean) => {
            if (!loaded) return;
            markRenderCacheDirty(l.id);
            scheduleRebuild(l.id);
          };
          preloadWallTextures(layerDrawStyle(layer)).then(rebuildWhenLoaded);
          preloadLayerTextures(layer).then(rebuildWhenLoaded);
        } else {
          scheduleRedrawFills(l.id);
        }
      }
    },
    {
      equalityFn: (a, b) => a.levels === b.levels && a.levelIds === b.levelIds,
    },
  );
  unsubscribers.push(unsubLevels);

  // ─── Light changes → LightManager sync ───────────────────
  // Shown layers only (visible, narrowed by solo and by the shown level), so soloing one
  // layer, or switching level, excludes every other layer's lights the same way it excludes
  // their walls and floors.
  const unsubLights = useStore.subscribe(
    (state) =>
      state.layers
        .filter((l): l is DungeonLayer => l.type === 'dungeon' && isLayerShown(state, l))
        .flatMap((l) => l.children.filter((c): c is LightChild => c.childType === 'light')),
    (lights) => {
      lightManager.syncFromStore(lights);
    },
    {
      fireImmediately: true,
      // flatMap builds a fresh array every call, so the default Object.is check
      // never matches and this re-synced every light on every store mutation.
      // Immer keeps each light by reference until it actually changes, so
      // per-index identity is the whole test (same pattern as the layer
      // visibility and style selectors).
      equalityFn: (a, b) => a.length === b.length && a.every((l, i) => l === b[i]),
    },
  );
  unsubscribers.push(unsubLights);

  // ─── Shown level → re-sweep ───────────────────────────────
  // Another level's walls and props stop occluding (and its own start), so every light is
  // re-swept against the shown level's set.
  const unsubShownLevel = useStore.subscribe(
    (state) => state.ui.activeLevelId,
    () => lightManager.invalidateAll(),
  );
  unsubscribers.push(unsubShownLevel);

  // ─── Terrain appearance (visible/opacity) ─────────────
  // Absent settings.terrain (never painted) reads as visible=true, opacity=1 —
  // same defaults TerrainTool's paint-gate and the palette selector already
  // assume. O(1) flag flip on the renderer, no rebuild.
  const unsubTerrainAppearance = useStore.subscribe(
    (state) => ({
      visible: state.mapSettings.terrain?.visible ?? true,
      opacity: state.mapSettings.terrain?.opacity ?? 1,
    }),
    ({ visible, opacity }) => {
      sceneGraph.terrainRenderer.setAppearance(visible, opacity);
    },
    {
      fireImmediately: true,
      equalityFn: (a, b) => a.visible === b.visible && a.opacity === b.opacity,
    },
  );
  unsubscribers.push(unsubTerrainAppearance);

  // ─── Grid visibility changes ─────────────────────────
  const unsubGrid = useStore.subscribe(
    (state) => state.grid.visible,
    (visible) => {
      sceneGraph.gridRenderer.markDirty();
      notify.subtle(`Grid: ${visible ? 'ON' : 'OFF'}`);
    },
  );
  unsubscribers.push(unsubGrid);

  // ─── Background color changes ─────────────────────────
  const unsubBg = useStore.subscribe(
    (state) => {
      const bg = state.layers.find((l) => l.type === 'background');
      return bg && bg.type === 'background' ? bg.backgroundColor : null;
    },
    () => {
      // Mark background dirty — the render loop will re-draw
      const bgLayer = sceneGraph.backgroundLayer as typeof sceneGraph.backgroundLayer & {
        _markDirty?: () => void;
      };
      bgLayer._markDirty?.();
    },
  );
  unsubscribers.push(unsubBg);

  // ─── Sublayer visibility changes ──────────────────────
  const unsubSublayers = useStore.subscribe(
    (state) =>
      state.layers
        .filter((l): l is DungeonLayer => l.type === 'dungeon')
        .map((l) => ({ id: l.id, vis: l.sublayerVisibility })),
    (layerVis) => {
      const globalGridVisible = useStore.getState().grid.visible;
      for (const { id, vis } of layerVis) {
        const entry = getLayerEntry(id);
        if (!entry?.sublayers) continue;
        entry.sublayers.floor.visible = vis.floor;
        // Shadows fall on the floor, so they follow it: hiding the ground to look at what is
        // under it should not leave the sun's own pass floating over nothing.
        entry.sublayers.shadows.visible = vis.floor;
        applyGridVisibility(entry, vis.grid, globalGridVisible);
        entry.sublayers.walls.visible = vis.walls;
        entry.sublayers.wallMarks.visible = vis.walls;
        // Doors have their own sublayer now (see sceneGraph.ts) but still
        // follow the "walls" visibility toggle — same as when they lived
        // inside the walls container.
        entry.sublayers.doors.visible = vis.walls;
      }
    },
    { fireImmediately: true },
  );
  unsubscribers.push(unsubSublayers);

  // ─── Background texture (TilingSprite) ───────────────
  let bgTilingSprite: TilingSprite | null = null;

  const unsubBgTexture = useStore.subscribe(
    (state) => {
      const bg = state.layers.find((l) => l.type === 'background');
      return bg?.type === 'background'
        ? { url: bg.backgroundTexture, scale: bg.textureScale }
        : null;
    },
    (bgData) => {
      // Remove existing TilingSprite
      if (bgTilingSprite) {
        sceneGraph.backgroundLayer.removeChild(bgTilingSprite);
        bgTilingSprite.destroy();
        bgTilingSprite = null;
      }

      if (!bgData?.url) return;

      // Load texture from data URL / asset URL asynchronously
      Assets.load<Texture>(bgData.url)
        .then((texture) => {
          if (!texture) return;
          const WORLD_HALF = 5000;
          const sprite = new TilingSprite({
            texture,
            width: WORLD_HALF * 2,
            height: WORLD_HALF * 2,
          });
          sprite.position.set(-WORLD_HALF, -WORLD_HALF);
          sprite.tileScale.set(bgData.scale ?? 1);
          sprite.label = 'bgTexture';
          sceneGraph.backgroundLayer.addChild(sprite);
          bgTilingSprite = sprite;
        })
        .catch(() => {
          // Silently fail — solid color background remains
        });
    },
    {
      equalityFn: (a, b) =>
        a?.url === b?.url && a?.scale === b?.scale,
      fireImmediately: true,
    },
  );
  unsubscribers.push(unsubBgTexture);

  // ─── Grid config changes → rebuild dungeon grid sublayers ─
  const unsubGridVis = useStore.subscribe(
    (state) => state.grid.visible,
    (visible) => {
      const dungeonLayers = useStore.getState().layers.filter(
        (l): l is DungeonLayer => l.type === 'dungeon',
      );
      for (const layer of dungeonLayers) {
        const entry = getLayerEntry(layer.id);
        if (entry) {
          // Grid lines are their own sublayer and nothing else reads
          // grid.visible, so the toggle has no business re-laying every stone —
          // flip the container flag, geometry is already there.
          applyGridVisibility(entry, layer.sublayerVisibility.grid, visible);
          markRenderCacheDirty(layer.id);
        }
      }
    },
  );
  unsubscribers.push(unsubGridVis);

  // ─── Style changes → mark render cache dirty + rebuild ─
  const unsubStyle = useStore.subscribe(
    (state) =>
      state.layers
        .filter((l): l is DungeonLayer => l.type === 'dungeon')
        .map((l) => ({ id: l.id, style: l.style })),
    (dungeonLayers) => {
      for (const { id } of dungeonLayers) {
        markRenderCacheDirty(id);
        const entry = getLayerEntry(id);
        const layer = useStore.getState().layers.find((l) => l.id === id);
        if (entry && layer && layer.type === 'dungeon') {
          scheduleRebuild(id);
          preloadLayerTextures(layer).then((loaded) => {
            if (!loaded) return;
            markRenderCacheDirty(id);
            scheduleRebuild(id);
          });
          preloadWallTextures(layerDrawStyle(layer)).then((loaded) => {
            if (!loaded) return;
            markRenderCacheDirty(id);
            scheduleRebuild(id);
          });
        }
      }
    },
    {
      // Immer keeps `style` by reference when nothing under it changed, but
      // the selector maps a fresh array on every call, so without this the
      // default Object.is check on that fresh array never matches and this
      // fires — full rebuildDungeonLayer included — on every single store
      // mutation (any door toggle, any drag), not just an actual style edit.
      equalityFn: (a, b) =>
        a.length === b.length &&
        a.every((item, i) => item.id === b[i].id && item.style === b[i].style),
    },
  );
  unsubscribers.push(unsubStyle);

  return () => {
    for (const unsub of unsubscribers) {
      unsub();
    }
    // Engine teardown destroys everything wholesale (clearAllLayers); nothing parked may
    // survive into a next mount, where its ids would shadow a fresh document's layers.
    pendingRemoval.clear();
    removalSceneGraph = null;
  };
}
