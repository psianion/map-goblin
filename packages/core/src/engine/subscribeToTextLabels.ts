import { Text, TextStyle } from 'pixi.js';
import { useStore } from '../store/store';
import { getLayerEntry } from './sceneGraph';
import type { DungeonLayer, TextChild } from '../store/types';

/**
 * Type face for map labels.
 *
 * A system stack, deliberately: it renders offline with no webfont and no CDN,
 * which the runner's no-network rule requires and the editor is moving to. The
 * shared self-hosted face is being settled in the chrome design work — when it
 * lands, this is the one place to change. Labels are map content rather than
 * chrome, so they may end up on a different face entirely.
 */
const LABEL_FONT_FAMILY =
  'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

/**
 * Resolution multiplier for the text bitmap. Labels are sized in world units
 * and the camera zooms well past 1:1, so rasterising at the nominal size gives
 * soft text the moment anyone zooms in.
 */
const TEXT_RESOLUTION = 4;

function styleFor(child: TextChild): TextStyle {
  return new TextStyle({
    fontFamily: LABEL_FONT_FAMILY,
    // Rasterise at a workable pixel size, then scale down into world units —
    // a font size of 0.8 world units would otherwise rasterise as 0.8px.
    fontSize: 100,
    fill: child.color,
    align: 'center',
  });
}

function syncLabel(label: Text, child: TextChild): void {
  if (label.text !== child.text) label.text = child.text;
  const style = label.style;
  if (style.fill !== child.color) style.fill = child.color;

  label.position.set(child.position.x, child.position.y);
  label.rotation = child.rotation;
  label.visible = child.visible;
  // 100px of raster maps to fontSize world units.
  label.scale.set((child.fontSize / 100) * child.scale);
}

/**
 * Keep one Pixi Text per text child in sync with the store.
 * Mirrors subscribeToAssets; called once from CanvasHost. Returns cleanup.
 */
export function subscribeToTextLabels(): () => void {
  const labelMaps = new Map<string, Map<string, Text>>();

  const unsub = useStore.subscribe(
    (state) =>
      state.layers
        .filter((l): l is DungeonLayer => l.type === 'dungeon')
        .map((l) => ({
          id: l.id,
          labels: l.children.filter((c): c is TextChild => c.childType === 'text'),
        })),
    (dungeonLayers) => {
      const currentLayerIds = new Set(dungeonLayers.map((l) => l.id));

      for (const [layerId, labelMap] of labelMaps.entries()) {
        if (!currentLayerIds.has(layerId)) {
          const entry = getLayerEntry(layerId);
          for (const label of labelMap.values()) {
            entry?.sublayers?.labels.removeChild(label);
            label.destroy();
          }
          labelMaps.delete(layerId);
        }
      }

      for (const layer of dungeonLayers) {
        const entry = getLayerEntry(layer.id);
        if (!entry?.sublayers) continue;
        const labelsLayer = entry.sublayers.labels;

        if (!labelMaps.has(layer.id)) labelMaps.set(layer.id, new Map());
        const labelMap = labelMaps.get(layer.id)!;
        const currentIds = new Set(layer.labels.map((l) => l.id));

        for (const [id, label] of labelMap.entries()) {
          if (!currentIds.has(id)) {
            labelsLayer.removeChild(label);
            label.destroy();
            labelMap.delete(id);
          }
        }

        // Index within `layer.labels` becomes zIndex — see subscribeToAssets.ts.
        for (let i = 0; i < layer.labels.length; i++) {
          const child = layer.labels[i];
          const existing = labelMap.get(child.id);
          if (existing) {
            syncLabel(existing, child);
            existing.zIndex = i;
          } else {
            const label = new Text({
              text: child.text,
              style: styleFor(child),
              resolution: TEXT_RESOLUTION,
            });
            label.anchor.set(0.5);
            label.label = 'label-' + child.id;
            syncLabel(label, child);
            label.zIndex = i;
            labelsLayer.addChild(label);
            labelMap.set(child.id, label);
          }
        }
      }
    },
    { fireImmediately: true },
  );

  return () => {
    unsub();
    for (const [layerId, labelMap] of labelMaps.entries()) {
      const entry = getLayerEntry(layerId);
      for (const label of labelMap.values()) {
        entry?.sublayers?.labels.removeChild(label);
        label.destroy();
      }
    }
    labelMaps.clear();
  };
}
