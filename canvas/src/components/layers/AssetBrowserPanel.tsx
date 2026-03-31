import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useStore } from '@/store/store';
import { useShallow } from 'zustand/react/shallow';
import type { AssetEntry, AssetCategory, AssetManifest, ToolType } from '@/store/types';
import { cn } from '@/lib/utils';
import { resolveTexture } from '@/assets/textureLoader';

// ─── Type Filters ────────────────────────────────────────

type AssetTypeFilter = 'all' | 'floor' | 'wall' | 'object' | 'scatter' | 'edge' | 'path';

const TYPE_FILTER_TABS: { id: AssetTypeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'floor', label: 'Floor' },
  { id: 'wall', label: 'Wall' },
  { id: 'object', label: 'Object' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'edge', label: 'Edge' },
  { id: 'path', label: 'Path' },
];

/** Map category IDs to asset type for filtering */
function categoryToType(categoryId: string): AssetTypeFilter | null {
  // Pack categories use "packId:type" format
  if (categoryId.includes(':')) {
    const type = categoryId.split(':')[1] as AssetTypeFilter;
    if (TYPE_FILTER_TABS.some((t) => t.id === type)) return type;
    return null;
  }
  // Legacy categories
  if (categoryId === 'floors') return 'floor';
  if (categoryId === 'walls') return 'wall';
  if (categoryId === 'edges') return 'edge';
  if (categoryId === 'nature' || categoryId === 'miscellaneous') return 'object';
  if (categoryId === 'scatter') return 'scatter';
  return null;
}

/** Auto-select type filter based on active tool */
function toolToTypeFilter(tool: ToolType): AssetTypeFilter {
  switch (tool) {
    case 'rectangle':
    case 'polygon':
    case 'regularPolygon':
      return 'floor';
    case 'path':
      return 'path';
    case 'wall':
    case 'door':
      return 'wall';
    case 'assetPlacement':
      return 'object';
    case 'scatterBrush':
      return 'scatter';
    default:
      return 'all';
  }
}

// ─── Asset Thumbnail ──────────────────────────────────────

/** Renders a pack texture (atlas frame) to a canvas for thumbnail display. */
function PackThumbnailCanvas({ textureId }: { textureId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const tex = resolveTexture(textureId);
    if (!tex || tex.width <= 1) return;

    const source = tex.source?.resource as HTMLImageElement | ImageBitmap | undefined;
    if (!source) return;

    const frame = tex.frame;
    const size = Math.min(128, Math.max(frame.width, frame.height));
    const scale = size / Math.max(frame.width, frame.height);
    canvas.width = Math.round(frame.width * scale);
    canvas.height = Math.round(frame.height * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(
      source as CanvasImageSource,
      frame.x, frame.y, frame.width, frame.height,
      0, 0, canvas.width, canvas.height,
    );
  }, [textureId]);

  return <canvas ref={canvasRef} className="h-full w-full object-contain" />;
}

interface AssetThumbnailProps {
  asset: AssetEntry;
  selected: boolean;
  onSelect: (id: string) => void;
}

function AssetThumbnail({ asset, selected, onSelect }: AssetThumbnailProps) {
  const isPackAsset = asset.id.includes(':');

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
      ) : isPackAsset ? (
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

export function AssetBrowserPanel() {
  const { manifest, recentlyUsed } = useStore(useShallow(selectManifest));
  const trackRecentUse = useStore((s) => s.trackRecentUse);
  const activeTool = useStore((s) => s.tools.activeTool);

  // User override: null = follow tool, string = user's choice
  const [userTypeOverride, setUserTypeOverride] = useState<AssetTypeFilter | null>(null);
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

  const recentAssets = useMemo(() => {
    const allAssetsMap = new Map(categories.flatMap((c) => c.assets).map((a) => [a.id, a]));
    return recentlyUsed
      .map((id) => allAssetsMap.get(id))
      .filter((a): a is AssetEntry => a !== undefined);
  }, [recentlyUsed, categories]);

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
  const updateScatterBrushSettings = useStore((s) => s.updateScatterBrushSettings);
  const setActiveTool = useStore((s) => s.setActiveTool);

  const selectedIds = useMemo(
    () => new Set(scatterSettings.assetIds),
    [scatterSettings.assetIds],
  );

  const handleSelect = useCallback(
    (assetId: string) => {
      const store = useStore.getState();
      const settings = store.tools.settings.scatterBrush;
      const currentTool = store.tools.activeTool;

      if (currentTool === 'scatterBrush' && !settings.stampMode) {
        // Scatter mode: toggle asset in/out of pool
        const current = settings.assetIds;
        const next = current.includes(assetId)
          ? current.filter((id) => id !== assetId)
          : [...current, assetId];
        updateScatterBrushSettings({ assetIds: next });
      } else {
        // Stamp mode (or any other tool): set single asset + activate stamp
        updateScatterBrushSettings({ assetIds: [assetId], stampMode: true });
        setActiveTool('scatterBrush');
      }

      trackRecentUse(assetId);
    },
    [updateScatterBrushSettings, setActiveTool, trackRecentUse],
  );

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
              'font-[Cinzel,serif]',
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
            {activeTool === 'scatterBrush' && !scatterSettings.stampMode ? (
              <p className="px-2 py-1 text-[10px] text-accent">
                Click assets to add/remove from scatter pool
              </p>
            ) : (
              <p className="px-2 py-1 text-[10px] text-accent">
                Click an asset to stamp it
              </p>
            )}
            <AssetGrid assets={currentAssets} selectedIds={selectedIds} onSelect={handleSelect} />
          </>
        )}
      </div>
    </div>
  );
}
