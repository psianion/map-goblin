import type { MapBuilderStore } from './types';

type PickStore = Pick<MapBuilderStore, 'tools' | 'updateScatterBrushSettings' | 'setActiveTool' | 'trackRecentUse'>;

/**
 * Pick a prop for the brush, the same from the asset browser and the dock. With the
 * scatter brush in hand and stamping off, the prop toggles in and out of the scatter
 * pool; anything else stamps that one prop, taking up the brush to do it, square to
 * the grid again (a new pick starts unrotated).
 */
export function pickAsset(store: PickStore, assetId: string): void {
  const settings = store.tools.settings.scatterBrush;
  if (store.tools.activeTool === 'scatterBrush' && !settings.stampMode) {
    const current = settings.assetIds;
    const next = current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId];
    store.updateScatterBrushSettings({ assetIds: next });
  } else {
    store.updateScatterBrushSettings({ assetIds: [assetId], stampMode: true, stampRotation: 0 });
    store.setActiveTool('scatterBrush');
  }
  store.trackRecentUse(assetId);
}
