import { Assets, Texture, TilingSprite } from 'pixi.js';
import { useStore } from '../store/store';
import { notify } from '../shared/notify';
import type { SceneGraph } from './sceneGraph';
import {
  addLayerToScene,
  removeLayerFromScene,
  reorderLayers,
  getLayerEntries,
  getLayerEntry,
} from './sceneGraph';
import type { RenderEngine } from './RenderEngine';
import { markDirty as markRenderCacheDirty } from './renderCache';
import { rebuildDungeonLayer, redrawDoors, preloadLayerTextures } from './floorWallRenderer';
import { preloadWallTextures } from './wallNodeRenderer';
import type { DungeonLayer, LightChild, ShapeChild } from '../store/types';
import { LightManager } from './lighting';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { scheduleRoomSync } from '../store/roomSync';
import type { Polygon } from '../types/geometry';

/**
 * Recompute mergedFloor from shape children via Clipper2 boolean union.
 * Returns the merged polygons (or null if no shapes).
 * Does NOT call useStore.setState — the caller writes the result to avoid
 * infinite subscription loops.
 */
function applyTransformToPoints(pts: Polygon, t: { translate: [number, number]; rotate: number; scale: [number, number] }): Polygon {
  return pts.map(([x, y]) => {
    let px = x * t.scale[0];
    let py = y * t.scale[1];
    const cos = Math.cos(t.rotate);
    const sin = Math.sin(t.rotate);
    const rx = px * cos - py * sin;
    const ry = px * sin + py * cos;
    px = rx + t.translate[0];
    py = ry + t.translate[1];
    return [px, py] as [number, number];
  });
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
 */
function geometryDigest(shape: ShapeChild): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h ^= Math.round(v * 1e4) | 0;
    h = Math.imul(h, 0x01000193);
  };
  for (const ring of shape.contours) {
    mix(ring.length);
    for (const [x, y] of ring) {
      mix(x);
      mix(y);
    }
  }
  const t = shape.transform;
  if (t) {
    mix(t.translate[0]); mix(t.translate[1]);
    mix(t.rotate);
    mix(t.scale[0]); mix(t.scale[1]);
  }
  return h >>> 0;
}

function computeMergedFloor(layer: DungeonLayer): Polygon[] | null {
  const shapeChildren = layer.children.filter(
    (c): c is ShapeChild => c.childType === 'shape' && c.visible,
  );

  if (shapeChildren.length === 0) return null;

  // Collect outer rings and hole rings separately, applying transforms
  const outerPaths: Polygon[] = [];
  const holePaths: Polygon[] = [];

  for (const shape of shapeChildren) {
    for (let i = 0; i < shape.contours.length; i++) {
      let pts = shape.contours[i];
      if (shape.transform) {
        pts = applyTransformToPoints(pts, shape.transform);
      }
      if (i === 0) {
        outerPaths.push(pts); // outer boundary
      } else {
        holePaths.push(pts); // hole ring
      }
    }
  }

  // Union all outer rings
  let merged: Polygon[] = [outerPaths[0]];
  for (let i = 1; i < outerPaths.length; i++) {
    merged = clipper2Engine.union(merged, [outerPaths[i]]);
  }

  // Subtract all hole rings from the merged result
  if (holePaths.length > 0) {
    merged = clipper2Engine.difference(merged, holePaths);
  }

  return merged;
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
        if (!entries.has(layer.id)) {
          addLayerToScene(engine, sceneGraph, layer.id, layer.type, i);
        }
      }

      // Remove deleted layers
      for (const id of entries.keys()) {
        if (!currentIds.includes(id)) {
          removeLayerFromScene(sceneGraph, id);
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
  const unsubVisibility = useStore.subscribe(
    (state) => state.layers.map((l) => ({ id: l.id, visible: l.visible })),
    (layerVisibility) => {
      for (const { id, visible } of layerVisibility) {
        const entry = getLayerEntry(id);
        if (!entry) continue;
        const displayObj = entry.textureSprite ?? entry.container;
        displayObj.visible = visible;
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
  const unsubOpacity = useStore.subscribe(
    (state) => state.layers.map((l) => ({ id: l.id, opacity: l.opacity })),
    (layerOpacities) => {
      for (const { id, opacity } of layerOpacities) {
        const entry = getLayerEntry(id);
        if (!entry) continue;
        const displayObj = entry.textureSprite ?? entry.container;
        displayObj.alpha = opacity;
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

  const unsubShapes = useStore.subscribe(
    (state) =>
      state.layers
        .filter((l): l is DungeonLayer => l.type === 'dungeon')
        .map((l) => ({
          id: l.id,
          shapeCount: l.children.filter((c) => c.childType === 'shape').length,
          wallCount: l.standaloneWalls.length,
          // Track shape IDs + geometry to detect changes (NOT mergedFloor — we write that)
          shapeKeys: l.children
            .filter((c): c is ShapeChild => c.childType === 'shape')
            .map((c) => `${c.id}:${c.visible}:${geometryDigest(c)}:${c.textureId ?? ''}:${c.textureScale ?? ''}:${c.textureTint ?? ''}:${c.textureOffsetX ?? 0}:${c.textureOffsetY ?? 0}:${c.textureFillRotation ?? 0}`)
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
          // Door STATE (state/isSecret/style) — changes how a door looks and
          // whether it blocks light, but not wall geometry. Handled by a
          // doors-only redraw further down: no stone re-layout, no Clipper2.
          doorStateKey: l.children
            .filter((c): c is import('../shared/types').DoorChild => c.childType === 'door')
            .map((c) => `${c.id}:${c.state}:${c.isSecret}:${c.style}`)
            .join(','),
          // Track water body changes
          waterSignature: l.children
            .filter((c): c is import('../shared/types').WaterChild => c.childType === 'water')
            .map((c) => `${c.id}:${c.visible}:${c.contours.length}:${c.contours[0]?.length ?? 0}:${c.contours[0]?.[0] ?? ''}:${c.contours[0]?.at(-1) ?? ''}:${c.textureId}:${c.tint}:${c.opacity}:${c.bankTextureId}:${c.bankWidth}:${c.flowSpeed}:${c.flowAngle}`)
            .join(','),
          // Track wall type/direction changes for lighting
          wallSignature: l.standaloneWalls
            .map((w) => `${w.id}:${w.wallType}:${w.direction}`)
            .join(','),
        })),
    (dungeonLayers) => {
      let geometryChanged = false;
      for (const { id, shapeCount, shapeKeys, wallCount, wallSignature, waterSignature, doorGeometryKey, doorStateKey } of dungeonLayers) {
        const entry = getLayerEntry(id);
        const layer = useStore.getState().layers.find((l) => l.id === id);
        if (entry && layer && layer.type === 'dungeon') {
          // The union is a function of the shape children and nothing else, but
          // this subscription also fires for doors, walls and water. Toggling a
          // door open used to rebuild it anyway (#18): Clipper2 on a dressed map
          // is ~280ms, and the fresh mergedFloor array it wrote busted the wall
          // resolver memo on top, dragging the stones through a rebuild too.
          const floorKey = `${shapeCount}|${shapeKeys}`;
          const roomKey = `${floorKey}|${wallCount}|${wallSignature}`;
          // Everything that forces a full rebuild (stone re-layout): floor
          // and wall geometry, water, and door GEOMETRY — door geometry is
          // here (not just roomKey) because withoutDoorGaps needs it to cut
          // stone gaps. Door STATE is deliberately excluded: it is handled
          // by the doors-only redraw below and must never re-run this.
          const renderKey = `${roomKey}|${waterSignature}|${doorGeometryKey}`;
          const prev = prevGeometryKeys.get(id);
          if (prev?.room !== roomKey) geometryChanged = true;
          const renderChanged = prev?.render !== renderKey;
          const doorStateChanged = prev?.doorState !== doorStateKey;
          if (prev?.floor !== floorKey) {
            const newFloor = computeMergedFloor(layer);
            // Write via setState — safe because the subscription equality fn
            // only compares shapeCount/wallCount/shapeKeys, not mergedFloor
            useStore.setState((s) => {
              const l = s.layers.find((la) => la.id === id);
              if (l && l.type === 'dungeon') l.mergedFloor = newFloor;
            });
          }
          prevGeometryKeys.set(id, { floor: floorKey, room: roomKey, render: renderKey, doorState: doorStateKey });
          // Re-read layer after a possible mergedFloor update
          const updatedLayer = useStore.getState().layers.find((l) => l.id === id);
          if (!updatedLayer || updatedLayer.type !== 'dungeon') continue;

          if (renderChanged) {
            markRenderCacheDirty(id);
            // Immediate rebuild (solid color fallback for unloaded textures)
            rebuildDungeonLayer(updatedLayer, entry);
            // Async: preload textures, then re-rebuild once they're cached
            preloadLayerTextures(layer).then((loaded) => {
              if (!loaded) return;
              const fresh = useStore.getState().layers.find((l) => l.id === id);
              if (fresh && fresh.type === 'dungeon') {
                markRenderCacheDirty(id);
                rebuildDungeonLayer(fresh as DungeonLayer, entry);
              }
            });
          } else if (doorStateChanged) {
            // State-only flip: redraw the doors sublayer, skip stone re-layout
            // and the Clipper2 union entirely — this is the ~60ms→<50ms fix.
            markRenderCacheDirty(id);
            redrawDoors(updatedLayer, entry);
          }
        }
      }
      // Drop keys for layers that no longer exist, so the map does not grow for
      // the life of the session. Guarded because this handler now also fires per
      // pointermove while a door is dragged.
      if (prevGeometryKeys.size > dungeonLayers.length) {
        const liveIds = new Set(dungeonLayers.map((l) => l.id));
        for (const id of prevGeometryKeys.keys()) if (!liveIds.has(id)) prevGeometryKeys.delete(id);
      }
      // Unconditional: door state feeds occlusion, so an open door has to
      // re-sweep even though no geometry moved.
      lightManager.invalidateAll();
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
          item.waterSignature === b[i].waterSignature,
        ),
    },
  );
  unsubscribers.push(unsubShapes);

  // ─── Light changes → LightManager sync ───────────────────
  const unsubLights = useStore.subscribe(
    (state) =>
      state.layers
        .filter((l): l is DungeonLayer => l.type === 'dungeon')
        .flatMap((l) => l.children.filter((c): c is LightChild => c.childType === 'light')),
    (lights) => {
      lightManager.syncFromStore(lights);
    },
    { fireImmediately: true },
  );
  unsubscribers.push(unsubLights);

  // ─── Grid visibility changes ─────────────────────────
  const unsubGrid = useStore.subscribe(
    (state) => state.grid.visible,
    (visible) => {
      sceneGraph.gridRenderer.markDirty();
      notify.subtle(`Grid: ${visible ? 'ON' : 'OFF'}`, { icon: 'grid' });
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
      for (const { id, vis } of layerVis) {
        const entry = getLayerEntry(id);
        if (!entry?.sublayers) continue;
        entry.sublayers.floor.visible = vis.floor;
        entry.sublayers.grid.visible = vis.grid;
        entry.sublayers.hatching.visible = vis.hatching;
        entry.sublayers.walls.visible = vis.walls;
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
    () => {
      const dungeonLayers = useStore.getState().layers.filter(
        (l): l is DungeonLayer => l.type === 'dungeon',
      );
      for (const layer of dungeonLayers) {
        const entry = getLayerEntry(layer.id);
        if (entry) {
          rebuildDungeonLayer(layer, entry);
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
          rebuildDungeonLayer(layer, entry);
          preloadLayerTextures(layer).then((loaded) => {
            if (!loaded) return;
            const fresh = useStore.getState().layers.find((l) => l.id === id);
            if (fresh && fresh.type === 'dungeon') {
              markRenderCacheDirty(id);
              rebuildDungeonLayer(fresh as DungeonLayer, entry);
            }
          });
          preloadWallTextures(layer.style).then((loaded) => {
            if (!loaded) return;
            const fresh = useStore.getState().layers.find((l) => l.id === id);
            if (fresh && fresh.type === 'dungeon') {
              const freshEntry = getLayerEntry(id);
              if (freshEntry) {
                markRenderCacheDirty(id);
                rebuildDungeonLayer(fresh as DungeonLayer, freshEntry);
              }
            }
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
  };
}
