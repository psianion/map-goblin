import { Assets, Texture, TilingSprite } from 'pixi.js';
import { useStore } from '@/store/store';
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
import { rebuildDungeonLayer, preloadLayerTextures } from './floorWallRenderer';
import { preloadWallTextures } from './wallTextureRenderer';
import type { DungeonLayer, LightChild, ShapeChild } from '@/store/types';
import { LightManager } from './lighting';
import { clipper2Engine } from '@/geometry/Clipper2Engine';
import type { Polygon } from '@/types/geometry';

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
      equalityFn: (a, b) =>
        a.length === b.length &&
        a.every((item, i) => item.id === b[i].id && item.opacity === b[i].opacity),
    },
  );
  unsubscribers.push(unsubOpacity);

  // ─── Shape/wall changes → mark render cache dirty ────
  const unsubShapes = useStore.subscribe(
    (state) =>
      state.layers
        .filter((l): l is DungeonLayer => l.type === 'dungeon')
        .map((l) => ({
          id: l.id,
          shapeCount: l.children.filter((c) => c.childType === 'shape').length,
          wallCount: l.standaloneWalls.length,
          // Track shape IDs + transforms to detect changes (NOT mergedFloor — we write that)
          shapeKeys: l.children
            .filter((c): c is ShapeChild => c.childType === 'shape')
            .map((c) => `${c.id}:${c.visible}:${c.contours.length}:${c.contours[0]?.length ?? 0}:${c.textureId ?? ''}:${c.textureScale ?? ''}:${c.textureTint ?? ''}:${c.textureOffsetX ?? 0}:${c.textureOffsetY ?? 0}:${c.textureFillRotation ?? 0}`)
            .join(','),
          // Track door changes (state, style, position affect rendering + lighting)
          doorSignature: l.children
            .filter((c) => c.childType === 'door')
            .map((c) => `${c.id}:${c.visible}:${(c as import('@/shared/types').DoorChild).state}:${(c as import('@/shared/types').DoorChild).style}:${(c as import('@/shared/types').DoorChild).width}`)
            .join(','),
          // Track wall type/direction changes for lighting
          wallSignature: l.standaloneWalls
            .map((w) => `${w.id}:${w.wallType}:${w.direction}`)
            .join(','),
        })),
    (dungeonLayers) => {
      for (const { id } of dungeonLayers) {
        markRenderCacheDirty(id);
        const entry = getLayerEntry(id);
        const layer = useStore.getState().layers.find((l) => l.id === id);
        if (entry && layer && layer.type === 'dungeon') {
          // Recompute mergedFloor from shape children via Clipper2
          const newFloor = computeMergedFloor(layer);
          // Write via setState — safe because the subscription equality fn
          // only compares shapeCount/wallCount/shapeKeys, not mergedFloor
          useStore.setState((s) => {
            const l = s.layers.find((la) => la.id === id);
            if (l && l.type === 'dungeon') l.mergedFloor = newFloor;
          });
          // Re-read layer after mergedFloor update
          const updatedLayer = useStore.getState().layers.find((l) => l.id === id);
          if (!updatedLayer || updatedLayer.type !== 'dungeon') continue;
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
        }
      }
      // Wall geometry changed — invalidate all light visibility polygons
      lightManager.invalidateAll();
    },
    {
      equalityFn: (a, b) =>
        a.length === b.length &&
        a.every((item, i) =>
          item.id === b[i].id &&
          item.shapeCount === b[i].shapeCount &&
          item.wallCount === b[i].wallCount &&
          item.shapeKeys === b[i].shapeKeys &&
          item.doorSignature === b[i].doorSignature &&
          item.wallSignature === b[i].wallSignature,
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
      useStore.getState().pushToast({
        id: `grid-toggle-${Date.now()}`,
        message: `Grid: ${visible ? 'ON' : 'OFF'}`,
        type: 'info',
        duration: 1500,
        createdAt: Date.now(),
      });
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
  );
  unsubscribers.push(unsubStyle);

  return () => {
    for (const unsub of unsubscribers) {
      unsub();
    }
  };
}
