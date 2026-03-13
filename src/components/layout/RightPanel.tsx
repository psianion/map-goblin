import { useState } from 'react';
import { Layers, Package, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/store';
import { LayerPanel } from '@/components/layers/LayerPanel';
import { PropertiesPanel } from '@/components/properties/PropertiesPanel';
import { AssetBrowserPanel } from '@/components/layers/AssetBrowserPanel';

type RightTab = 'layers' | 'assets';

const TABS: { id: RightTab; label: string; icon: typeof Layers }[] = [
  { id: 'layers', label: 'Layers', icon: Layers },
  { id: 'assets', label: 'Assets', icon: Package },
];

export function RightPanel() {
  const [tab, setTab] = useState<RightTab>('layers');
  const togglePanel = useStore((s) => s.togglePanel);

  return (
    <div className="flex flex-col h-full bg-surface-1 border-l border-border-default overflow-hidden">
      {/* Tab bar — 36px */}
      <div className="flex items-center border-b border-border-default bg-surface-0 shrink-0 h-9">
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
            <Icon size={14} />
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => togglePanel('right')}
          aria-label="Collapse panel"
          className="w-9 h-9 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors shrink-0"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Unified scroll area */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {tab === 'layers' && (
          <>
            <LayerPanel />
            <PropertiesPanel />
          </>
        )}
        {tab === 'assets' && <AssetBrowserPanel />}
      </div>
    </div>
  );
}
