import { useState, useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CatalogBrowser, type CatalogEntry, type CatalogMeta } from '@/engine/catalogBrowser';
import { cdnConfig } from '@/config/cdnConfig';
import { CatalogEntryCard } from './CatalogEntryCard';
import { CatalogFilters, type CatalogFilterState } from './CatalogFilters';
import { useStore } from '@/store/store';

const COLUMNS = 3;
const ROW_HEIGHT = 160; // estimated card height in px

const DEFAULT_FILTERS: CatalogFilterState = {
  type: 'all',
  theme: '',
  material: '',
  query: '',
};

export function CatalogBrowserPanel() {
  const [browser] = useState(() => new CatalogBrowser(`${cdnConfig.baseUrl}${cdnConfig.catalogPath}`));
  const [meta, setMeta] = useState<CatalogMeta | null>(null);
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [filters, setFilters] = useState<CatalogFilterState>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const installPack = useStore((s) => s.installPack);

  const loadMeta = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const m = await browser.loadMeta();
      setMeta(m);
      setInitialized(true);
    } catch {
      setError('Could not connect to catalog. Check your internet connection.');
    } finally {
      setLoading(false);
    }
  }, [browser]);

  const search = useCallback(
    async (f: CatalogFilterState) => {
      setFilters(f);
      setLoading(true);
      setError(null);
      try {
        const results = await browser.search({
          type: f.type === 'all' ? undefined : f.type,
          theme: f.theme || undefined,
          material: f.material || undefined,
          query: f.query || undefined,
        });
        setEntries(results);
      } catch {
        setError('Search failed. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [browser],
  );

  const handleFilterChange = useCallback(
    (newFilters: CatalogFilterState) => {
      search(newFilters);
    },
    [search],
  );

  const handleInstallPack = useCallback(
    (packId: string) => {
      installPack(packId).catch((err: Error) => {
        console.warn('[CatalogBrowser] Install failed:', err.message);
      });
    },
    [installPack],
  );

  // Chunk entries into rows of COLUMNS for virtual scrolling
  const rows = useMemo(() => {
    const result: CatalogEntry[][] = [];
    for (let i = 0; i < entries.length; i += COLUMNS) {
      result.push(entries.slice(i, i + COLUMNS));
    }
    return result;
  }, [entries]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 3,
  });

  // Extract available themes and materials from metadata
  const availableThemes = useMemo(() => {
    if (!meta) return [];
    return Object.keys(meta.invertedIndex.theme);
  }, [meta]);

  const availableMaterials = useMemo(() => {
    if (!meta) return [];
    return Object.keys(meta.invertedIndex.material);
  }, [meta]);

  // Initial state: show connect button
  if (!initialized) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
        <p className="text-xs text-muted-foreground text-center">
          Browse community texture packs from the online catalog.
        </p>
        <button
          onClick={loadMeta}
          disabled={loading}
          className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent/80 transition-colors disabled:opacity-50"
        >
          {loading ? 'Connecting…' : 'Browse Catalog'}
        </button>
        {error && (
          <p className="text-[10px] text-destructive text-center">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filters */}
      <CatalogFilters
        filters={filters}
        onChange={handleFilterChange}
        availableThemes={availableThemes}
        availableMaterials={availableMaterials}
      />

      {/* Results */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
        {loading && (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
        )}

        {error && (
          <p className="py-6 text-center text-xs text-destructive">{error}</p>
        )}

        {!loading && !error && entries.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No results. Try adjusting your filters.
          </p>
        )}

        {!loading && rows.length > 0 && (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={virtualRow.key}
                className="absolute left-0 right-0 grid grid-cols-3 gap-1.5"
                style={{
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {rows[virtualRow.index].map((entry) => (
                  <CatalogEntryCard
                    key={entry.entryId}
                    entry={entry}
                    onInstallPack={handleInstallPack}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {meta && (
        <div className="border-t border-border px-3 py-1.5 shrink-0">
          <p className="text-[10px] text-muted-foreground">
            {meta.totalEntries} entries in catalog · {entries.length} shown
          </p>
        </div>
      )}
    </div>
  );
}
