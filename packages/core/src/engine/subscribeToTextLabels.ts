import { Graphics, Text, TextStyle } from 'pixi.js';
import { useStore } from '../store/store';
import { getLayerEntry } from './sceneGraph';
import { LABEL_FONT_FAMILY } from './labelMetrics';
import type { DungeonLayer, TextChild } from '../store/types';

/**
 * Resolution multiplier for the text bitmap. Labels are sized in world units
 * and the camera zooms well past 1:1, so rasterising at the nominal size gives
 * soft text the moment anyone zooms in.
 */
const TEXT_RESOLUTION = 4;

/** Raster px the type is drawn at before it is scaled into world units. */
const RASTER_SIZE = 100;
/** A halo's stroke, as a share of the raster size (half of it shows outside the letters). */
const HALO_WIDTH = 0.12;
/** The pill plate's fill opacity, and its hairline in world units. */
const PILL_ALPHA = 0.85;
const PILL_LINE = 0.03;

/** Relative luminance of a `#rrggbb` colour, 0..1. Anything unreadable counts as dark. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** What sits behind a label's letters: white under dark ink, black under light. */
export function contrastOf(color: string): string {
  return luminance(color) > 0.5 ? '#000000' : '#ffffff';
}

/** Everything the text style depends on; a change rebuilds the style. */
function styleKey(child: TextChild): string {
  return `${child.color}|${child.weight ?? ''}|${child.backdrop ?? ''}|${child.align ?? ''}`;
}

function styleFor(child: TextChild): TextStyle {
  return new TextStyle({
    fontFamily: LABEL_FONT_FAMILY,
    // Rasterise at a workable pixel size, then scale down into world units —
    // a font size of 0.8 world units would otherwise rasterise as 0.8px.
    fontSize: RASTER_SIZE,
    fontWeight: child.weight === 'bold' ? 'bold' : 'normal',
    fill: child.color,
    // The lines of a multi-line label line up with each other; the block stays centred on
    // `position`, which is the centre of the box hit testing and the gizmo read.
    align: child.align ?? 'center',
    ...(child.backdrop === 'halo'
      ? { stroke: { color: contrastOf(child.color), width: HALO_WIDTH * RASTER_SIZE, join: 'round' as const } }
      : {}),
  });
}

/** One label on the canvas: its text, and the pill plate behind it when it has one. */
interface Drawn {
  text: Text;
  pill: Graphics | null;
  key: string;
  /** What the pill was last drawn for. */
  pillKey: string;
}

function drawPill(g: Graphics, child: TextChild): void {
  // The plate is the label's box (`measureLabel` pads it), so what shows is what picks.
  const w = child.width;
  const h = child.height;
  g.clear();
  g.roundRect(-w / 2, -h / 2, w, h, Math.min(h / 2, child.fontSize * 0.35));
  g.fill({ color: contrastOf(child.color), alpha: PILL_ALPHA });
  g.stroke({ color: child.color, width: PILL_LINE, alignment: 0.5 });
}

function syncLabel(d: Drawn, child: TextChild, zIndex: number): void {
  const label = d.text;
  if (label.text !== child.text) label.text = child.text;
  const key = styleKey(child);
  if (d.key !== key) {
    label.style = styleFor(child);
    d.key = key;
  }

  label.position.set(child.position.x, child.position.y);
  label.rotation = child.rotation;
  label.visible = child.visible;
  // 100px of raster maps to fontSize world units.
  label.scale.set((child.fontSize / RASTER_SIZE) * child.scale);
  label.zIndex = zIndex;

  const pill = d.pill;
  if (pill) {
    const pillKey = `${child.width}|${child.height}|${child.fontSize}|${child.color}`;
    if (d.pillKey !== pillKey) {
      drawPill(pill, child);
      d.pillKey = pillKey;
    }
    pill.position.set(child.position.x, child.position.y);
    pill.rotation = child.rotation;
    pill.scale.set(child.scale);
    pill.visible = child.visible;
    // Behind its own text, above the label before it.
    pill.zIndex = zIndex - 0.5;
  }
}

/**
 * Keep one Pixi Text per text child in sync with the store (and, for a pill label, one
 * Graphics plate behind it). Mirrors subscribeToAssets; called once from CanvasHost and
 * from the table's GameRenderer. Returns cleanup.
 */
export function subscribeToTextLabels(): () => void {
  const labelMaps = new Map<string, Map<string, Drawn>>();

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
          for (const d of labelMap.values()) removeDrawn(entry?.sublayers?.labels, d);
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

        for (const [id, d] of labelMap.entries()) {
          if (!currentIds.has(id)) {
            removeDrawn(labelsLayer, d);
            labelMap.delete(id);
          }
        }

        // Index within `layer.labels` becomes zIndex — see subscribeToAssets.ts.
        for (let i = 0; i < layer.labels.length; i++) {
          const child = layer.labels[i];
          let d = labelMap.get(child.id);
          if (!d) {
            const label = new Text({
              text: child.text,
              style: styleFor(child),
              resolution: TEXT_RESOLUTION,
            });
            label.anchor.set(0.5);
            label.label = 'label-' + child.id;
            labelsLayer.addChild(label);
            d = { text: label, pill: null, key: styleKey(child), pillKey: '' };
            labelMap.set(child.id, d);
          }
          // The plate comes and goes with the backdrop, in the same sublayer as the text.
          if (child.backdrop === 'pill' && !d.pill) {
            d.pill = new Graphics();
            d.pill.label = 'label-pill-' + child.id;
            d.pillKey = '';
            labelsLayer.addChild(d.pill);
          } else if (child.backdrop !== 'pill' && d.pill) {
            labelsLayer.removeChild(d.pill);
            d.pill.destroy();
            d.pill = null;
          }
          syncLabel(d, child, i);
        }
      }
    },
    { fireImmediately: true },
  );

  return () => {
    unsub();
    for (const [layerId, labelMap] of labelMaps.entries()) {
      const entry = getLayerEntry(layerId);
      for (const d of labelMap.values()) removeDrawn(entry?.sublayers?.labels, d);
    }
    labelMaps.clear();
  };
}

function removeDrawn(layer: { removeChild(c: Text | Graphics): unknown } | undefined, d: Drawn): void {
  layer?.removeChild(d.text);
  d.text.destroy();
  if (d.pill) {
    layer?.removeChild(d.pill);
    d.pill.destroy();
  }
}
