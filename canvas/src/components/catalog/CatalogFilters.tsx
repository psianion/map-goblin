import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

export interface CatalogFilterState {
  type: string;
  theme: string;
  material: string;
  query: string;
}

interface CatalogFiltersProps {
  filters: CatalogFilterState;
  onChange: (filters: CatalogFilterState) => void;
  availableThemes: string[];
  availableMaterials: string[];
}

const TYPE_OPTIONS = ['all', 'floor', 'wall', 'object', 'scatter', 'edge', 'pattern'];

export function CatalogFilters({ filters, onChange, availableThemes, availableMaterials }: CatalogFiltersProps) {
  const [searchInput, setSearchInput] = useState(filters.query);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      // Debounce search by 300ms
      const timeout = setTimeout(() => {
        onChange({ ...filters, query: value });
      }, 300);
      return () => clearTimeout(timeout);
    },
    [filters, onChange],
  );

  const selectClass = cn(
    'rounded bg-muted/50 border border-border px-1.5 py-1 text-[10px] text-foreground',
    'focus:outline-none focus:ring-1 focus:ring-ring',
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface-2 px-2 py-1.5 shrink-0">
      {/* Type */}
      <select
        value={filters.type}
        onChange={(e) => onChange({ ...filters, type: e.target.value })}
        className={selectClass}
      >
        {TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {t === 'all' ? 'All Types' : t.charAt(0).toUpperCase() + t.slice(1)}
          </option>
        ))}
      </select>

      {/* Theme */}
      <select
        value={filters.theme}
        onChange={(e) => onChange({ ...filters, theme: e.target.value })}
        className={selectClass}
      >
        <option value="">All Themes</option>
        {availableThemes.map((t) => (
          <option key={t} value={t}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </option>
        ))}
      </select>

      {/* Material */}
      <select
        value={filters.material}
        onChange={(e) => onChange({ ...filters, material: e.target.value })}
        className={selectClass}
      >
        <option value="">All Materials</option>
        {availableMaterials.map((m) => (
          <option key={m} value={m}>
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </option>
        ))}
      </select>

      {/* Search */}
      <input
        type="text"
        value={searchInput}
        onChange={(e) => handleSearchChange(e.target.value)}
        placeholder="Search…"
        className={cn(
          selectClass,
          'flex-1 min-w-[80px] placeholder:text-muted-foreground',
        )}
      />
    </div>
  );
}
