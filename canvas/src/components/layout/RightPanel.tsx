import { useState, useCallback } from 'react';
import { Layers, Package, Archive, PanelRightClose } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/store';
import { LayerPanel } from '@/components/layers/LayerPanel';
import { PropertiesPanel } from '@/components/properties/PropertiesPanel';
import { AssetBrowserPanel } from '@/components/layers/AssetBrowserPanel';
import { PackListPanel } from '@/components/packs/PackListPanel';

type RightTab = 'layers' | 'assets' | 'packs';

const TABS: { id: RightTab; label: string; icon: typeof Layers }[] = [
  { id: 'layers', label: 'Layers', icon: Layers },
  { id: 'assets', label: 'Assets', icon: Package },
  { id: 'packs', label: 'Packs', icon: Archive },
];

const LS_KEY = 'rp-sections';
const LS_TAB_KEY = 'rp-tab';
const TAB_IDS: RightTab[] = ['layers', 'assets', 'packs'];

function loadTab(): RightTab {
  try {
    const saved = localStorage.getItem(LS_TAB_KEY);
    return (TAB_IDS as string[]).includes(saved ?? '') ? (saved as RightTab) : 'layers';
  } catch {
    return 'layers';
  }
}

// Sections whose `defaultOpen` should actually take effect on first load —
// CollapsibleSection treats a defined `openSections` set as controlled, so an
// id absent from here reads as closed regardless of its own `defaultOpen`.
const INITIALLY_OPEN = ['colors', 'layer', 'terrain', 'sublayers'];

function loadSections(): Set<string> {
  try {
    const saved = localStorage.getItem(LS_KEY);
    return saved ? new Set(JSON.parse(saved) as string[]) : new Set(INITIALLY_OPEN);
  } catch {
    return new Set(INITIALLY_OPEN);
  }
}

function persistSections(sections: Set<string>) {
  localStorage.setItem(LS_KEY, JSON.stringify([...sections]));
}

export function RightPanel() {
  const [tab, setTabState] = useState<RightTab>(loadTab);
  const setTab = useCallback((next: RightTab) => {
    setTabState(next);
    localStorage.setItem(LS_TAB_KEY, next);
  }, []);
  const togglePanel = useStore((s) => s.togglePanel);
  const hasUpdates = useStore((s) => s.packs.availableUpdates.length > 0);
  const [openSections, setOpenSections] = useState<Set<string>>(loadSections);

  const toggleSection = useCallback((id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistSections(next);
      return next;
    });
  }, []);

  return (
    <div className="gg-grain flex flex-col h-full bg-surface-1 border-l border-border-structure overflow-hidden">
      {/* Tab bar — 36px */}
      <div className="flex items-center border-b border-border-structure bg-surface-0 shrink-0 h-9">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 h-full',
              'font-display text-tab-label uppercase tracking-wider',
              'border-b-2 transition-colors',
              tab === id
                ? 'border-accent-active text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-primary',
            )}
          >
            <span className="relative">
              <Icon size={14} />
              {id === 'packs' && hasUpdates && tab !== 'packs' && (
                <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-accent" />
              )}
            </span>
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => togglePanel('right')}
          aria-label="Collapse panel"
          className="w-9 h-9 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors shrink-0"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      {/* Layers tab splits into two scroll regions: the tree is capped at
          half the panel so a big child list can never push the properties
          sections (or the pinned Terrain/Background rows) out of reach. */}
      {tab === 'layers' && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="shrink-0 max-h-[50%] flex flex-col min-h-0">
            <LayerPanel />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto border-t border-border-structure">
            <PropertiesPanel openSections={openSections} onToggleSection={toggleSection} />
          </div>
        </div>
      )}
      {tab !== 'layers' && (
        <div className="flex-1 overflow-y-auto min-h-0">
          {tab === 'assets' && <AssetBrowserPanel />}
          {tab === 'packs' && <PackListPanel />}
        </div>
      )}
    </div>
  );
}
