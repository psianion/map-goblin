// Background image layers (traces): a picture to draw over. They stay in the editor: a PNG
// export hides them (exportPipeline) and a publish sends the map without them.

import type { ImageLayer, Layer, SerializedMapData } from '../store/types';

export const isTraceLayer = (layer: Layer): layer is ImageLayer => layer.type === 'image';

/** The ids of the trace layers among `layers`. */
export function traceLayerIds(layers: readonly Layer[]): string[] {
  return layers.filter(isTraceLayer).map((l) => l.id);
}

/**
 * The map as a publish sends it: without its trace layers, and without the pictures only they
 * show (a placed image or a note that names the same picture keeps it). The map itself when
 * it has none.
 */
export function withoutTraceLayers(data: SerializedMapData): SerializedMapData {
  const traces = data.layers.filter(isTraceLayer);
  if (traces.length === 0) return data;
  const layers = data.layers.filter((l) => !isTraceLayer(l));
  const kept = new Set<string>();
  for (const l of layers) if (l.type === 'dungeon') for (const c of l.children) if (c.childType === 'asset') kept.add(c.assetId);
  for (const n of data.prep?.notes ?? []) for (const key of n.imageKeys) kept.add(key);
  const customImages = { ...data.customImages };
  for (const t of traces) if (!kept.has(t.imageKey)) delete customImages[t.imageKey];
  return { ...data, layers, customImages };
}
