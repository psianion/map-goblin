import { useState, useMemo, useCallback } from 'react';
import { useStore } from '@/store/store';
import { useShallow } from 'zustand/react/shallow';
import type { AssetEntry, AssetCategory, AssetManifest } from '@/store/types';
import { cn } from '@/lib/utils';
import { PackThumbnailCanvas } from '@/components/shared/PackThumbnailCanvas';
import { pickAssetForTool } from '@/v2/editor/assetStrip';
import { categoryToType, recentAssetsOfType, toolToTypeFilter, type AssetTypeFilter } from './assetTypeFilter';

export type { AssetTypeFilter } from './assetTypeFilter';

// ─── Type Filters ────────────────────────────────────────

const TYPE_FILTER_TABS: { id: AssetTypeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'floor', label: 'Floor' },
  { id: 'wall', label: 'Wall' },
  { id: 'object', label: 'Object' },
  { id: 'edge', label: 'Edge' },
  { id: 'path', label: 'Path' },
];

// ─── Asset Thumbnail ──────────────────────────────────────

interface AssetThumbnailProps {
  asset: AssetEntry;
  selected: boolean;
  onSelect: (id: string) => void;
}

function AssetThumbnail({ asset, selected, onSelect }: AssetThumbnailProps) {
  const isPackAsset = asset.id.includes(':');
  // Legacy thumbnail URLs point at /textures/ files that aren't shipped —
  // when the <img> 404s, fall back to drawing the pack texture.
  const [thumbFailed, setThumbFailed] = useState(false);

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
      {asset.thumbnailUrl && !thumbFailed ? (
        <img
          src={asset.thumbnailUrl}
          alt={asset.name}
          className="h-full w-full object-contain"
          loading="lazy"
          onError={() => setThumbFailed(true)}
        />
      ) : isPackAsset || thumbFailed ? (
        <PackThumbnailCanvas textureId={asset.id} />
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

/** `initialType` opens the browser on that type tab instead of the one the tool suggests. */
export function AssetBrowserPanel({
  initialType,
  hint,
  floorHint,
}: {
  initialType?: AssetTypeFilter;
  /** What a click does, when the host knows better than "stamp" (a pick that retextures floors). */
  hint?: string;
  /** What a click does on the Floor tab, where nothing is ever stamped. */
  floorHint?: string;
} = {}) {
  const { manifest, recentlyUsed } = useStore(useShallow(selectManifest));
  const activeTool = useStore((s) => s.tools.activeTool);

  // User override: null = follow tool, string = user's choice
  const [userTypeOverride, setUserTypeOverride] = useState<AssetTypeFilter | null>(initialType ?? null);
  const typeFilter: AssetTypeFilter = userTypeOverride ?? toolToTypeFilter(activeTool);
  const [activeCategory, setActiveCategory] = useState<string>('recent');
  const [search, setSearch] = useState('');

  const handleTypeFilterChange = useCallback((filter: AssetTypeFilter) => {
    setUserTypeOverride(filter);
    setActiveCategory('recent');
  }, []);

  const categories: AssetCategory[] = useMemo(
    () => manifest?.categories ?? [],
    [manifest],
  );

  // Filter categories by selected type
  const filteredCategories = useMemo(() => {
    if (typeFilter === 'all') return categories;
    return categories.filter((c) => categoryToType(c.id) === typeFilter);
  }, [categories, typeFilter]);

  // Recent follows the type tab too: a bush picked for the brush has no place under Floor.
  const recentAssets = useMemo(
    () => recentAssetsOfType(recentlyUsed, categories, typeFilter),
    [recentlyUsed, categories, typeFilter],
  );

  const currentAssets = useMemo(() => {
    let assets: AssetEntry[] =
      activeCategory === 'recent'
        ? recentAssets
        : (filteredCategories.find((c) => c.id === activeCategory)?.assets ?? []);

    if (search.trim()) {
      const q = search.toLowerCase();
      assets = assets.filter((a) => a.name.toLowerCase().includes(q));
    }
    return assets;
  }, [activeCategory, recentAssets, filteredCategories, search]);

  const scatterSettings = useStore(useShallow((s) => s.tools.settings.scatterBrush));

  const selectedIds = useMemo(
    () => new Set(scatterSettings.assetIds),
    [scatterSettings.assetIds],
  );

  // Floor textures go on the floors (the selected ones, else every floor on the layer) and
  // wall pieces to the wall tool; anything else is a prop (scatter mode
  // toggles it in the pool, otherwise it becomes the stamp). The dock's strips pick through
  // the same helpers, so the two never disagree.
  const handleSelect = useCallback((assetId: string) => pickAssetForTool(assetId), []);

  const categoryTabs = [
    { id: 'recent', label: 'Recent' },
    ...filteredCategories.map((c) => ({ id: c.id, label: c.label })),
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Type filter tabs */}
      <div className="flex gap-0.5 overflow-x-auto border-b border-border p-1.5 flex-shrink-0">
        {TYPE_FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTypeFilterChange(tab.id)}
            className={cn(
              'shrink-0 rounded px-2 py-1 text-xs transition-colors whitespace-nowrap',
              'font-display',
              typeFilter === tab.id
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Category sub-tabs */}
      <div className="flex gap-0.5 overflow-x-auto border-b border-border p-1.5 flex-shrink-0">
        {categoryTabs.map((tab) => (
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
        {categories.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No assets available.</p>
        ) : (
          <>
            {typeFilter === 'floor' ? (
              // Floor textures always go on floors (pickAssetForTool), never into the brush.
              <p className="px-2 py-1 text-[10px] text-accent" data-testid="asset-browser-hint">
                {floorHint ?? 'Click a texture to apply it to the floors'}
              </p>
            ) : activeTool === 'scatterBrush' && !scatterSettings.stampMode ? (
              <p className="px-2 py-1 text-[10px] text-accent">
                Click assets to add/remove from scatter pool
              </p>
            ) : (
              <p className="px-2 py-1 text-[10px] text-accent" data-testid="asset-browser-hint">
                {hint ?? 'Click an asset to stamp it'}
              </p>
            )}
            <AssetGrid assets={currentAssets} selectedIds={selectedIds} onSelect={handleSelect} />
          </>
        )}
      </div>
    </div>
  );
}
