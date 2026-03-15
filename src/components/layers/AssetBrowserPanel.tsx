import { useState, useMemo, useEffect } from 'react';
import { useStore } from '@/store/store';
import { useShallow } from 'zustand/react/shallow';
import type { AssetEntry, AssetCategory, AssetManifest } from '@/store/types';
import { cn } from '@/lib/utils';
import {
  getPendingPlacementAssetId,
  setPendingPlacementAssetId,
  subscribeToPlacementId,
} from './pendingPlacement';

function usePendingAssetId(): string | null {
  const [id, setId] = useState<string | null>(getPendingPlacementAssetId);
  useEffect(() => {
    return subscribeToPlacementId(() => setId(getPendingPlacementAssetId()));
  }, []);
  return id;
}

// ─── Asset Thumbnail ──────────────────────────────────────

interface AssetThumbnailProps {
  asset: AssetEntry;
  selected: boolean;
  onSelect: (id: string) => void;
}

function AssetThumbnail({ asset, selected, onSelect }: AssetThumbnailProps) {
  return (
    <button
      onClick={() => onSelect(asset.id)}
      title={asset.name}
      className={cn(
        'aspect-square rounded border p-1 transition-colors',
        'flex items-center justify-center overflow-hidden',
        selected
          ? 'border-accent bg-accent/20'
          : 'border-border bg-muted/30 hover:border-accent/50 hover:bg-muted/60',
      )}
    >
      {asset.thumbnailUrl ? (
        <img
          src={asset.thumbnailUrl}
          alt={asset.name}
          className="h-full w-full object-contain"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground text-center leading-tight px-1">
          {asset.name}
        </div>
      )}
    </button>
  );
}

// ─── Asset Grid ───────────────────────────────────────────

interface AssetGridProps {
  assets: AssetEntry[];
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
}

function AssetGrid({ assets, selectedIds, onSelect }: AssetGridProps) {
  if (assets.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">No assets in this category.</p>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-1.5 p-2">
      {assets.map((asset) => (
        <AssetThumbnail
          key={asset.id}
          asset={asset}
          selected={selectedIds.has(asset.id)}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

// ─── Search Input ─────────────────────────────────────────

interface AssetSearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

function AssetSearchInput({ value, onChange }: AssetSearchInputProps) {
  return (
    <div className="relative px-2 py-1.5 border-b border-border">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search assets…"
        className={cn(
          'w-full rounded bg-muted/50 border border-border px-2.5 py-1 text-xs text-foreground',
          'placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
        )}
      />
    </div>
  );
}

// ─── Asset Browser Panel ──────────────────────────────────

const selectManifest = (s: { assets: { manifest: AssetManifest | null; recentlyUsed: string[] } }) => ({
  manifest: s.assets.manifest,
  recentlyUsed: s.assets.recentlyUsed,
});

export function AssetBrowserPanel() {
  const { manifest, recentlyUsed } = useStore(useShallow(selectManifest));
  const trackRecentUse = useStore((s) => s.trackRecentUse);

  const [activeCategory, setActiveCategory] = useState<string>('recent');
  const [search, setSearch] = useState('');
  const pendingId = usePendingAssetId();

  const categories: AssetCategory[] = useMemo(
    () => manifest?.categories ?? [],
    [manifest],
  );

  const allAssets = useMemo(
    () => categories.flatMap((c) => c.assets),
    [categories],
  );

  const recentAssets = useMemo(
    () =>
      recentlyUsed
        .map((id) => allAssets.find((a) => a.id === id))
        .filter((a): a is AssetEntry => a !== undefined),
    [recentlyUsed, allAssets],
  );

  const currentAssets = useMemo(() => {
    let assets: AssetEntry[] =
      activeCategory === 'recent'
        ? recentAssets
        : (categories.find((c) => c.id === activeCategory)?.assets ?? []);

    if (search.trim()) {
      const q = search.toLowerCase();
      assets = assets.filter((a) => a.name.toLowerCase().includes(q));
    }
    return assets;
  }, [activeCategory, recentAssets, categories, search]);

  const activeTool = useStore((s) => s.tools.activeTool);
  const updateToolSettings = useStore((s) => s.updateToolSettings);
  const scatterAssetIds = useStore(useShallow((s) => s.tools.settings.scatterBrush.assetIds));

  const selectedIds = useMemo(() => {
    if (activeTool === 'scatterBrush') {
      return new Set(scatterAssetIds);
    }
    return new Set(pendingId ? [pendingId] : []);
  }, [activeTool, scatterAssetIds, pendingId]);

  const handleSelect = (id: string) => {
    trackRecentUse(id);

    if (activeTool === 'scatterBrush') {
      // Route to scatter brush assetIds instead of single-click placement
      const current = useStore.getState().tools.settings.scatterBrush;
      const alreadySelected = current.assetIds.includes(id);
      const newIds = alreadySelected
        ? current.assetIds.filter((a) => a !== id)
        : [...current.assetIds, id];
      updateToolSettings({ scatterBrush: { ...current, assetIds: newIds } });
    } else {
      if (pendingId === id) {
        setPendingPlacementAssetId(null);
      } else {
        setPendingPlacementAssetId(id);
      }
    }
  };

  const tabs = [{ id: 'recent', label: 'Recent' }, ...categories.map((c) => ({ id: c.id, label: c.label }))];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Category tabs */}
      <div className="flex gap-0.5 overflow-x-auto border-b border-border p-1.5 flex-shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveCategory(tab.id)}
            className={cn(
              'shrink-0 rounded px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap',
              activeCategory === tab.id
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <AssetSearchInput value={search} onChange={setSearch} />

      {/* Grid */}
      <div className="flex-1 overflow-y-auto">
        {activeTool === 'scatterBrush' ? (
          <p className="px-2 py-1 text-[10px] text-accent">
            Select assets for scatter brush • Click to toggle
          </p>
        ) : pendingId ? (
          <p className="px-2 py-1 text-[10px] text-accent">
            Click canvas to place • Click asset again to cancel
          </p>
        ) : null}
        <AssetGrid assets={currentAssets} selectedIds={selectedIds} onSelect={handleSelect} />
      </div>
    </div>
  );
}
