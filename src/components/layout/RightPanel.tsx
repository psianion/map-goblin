import { useState } from 'react';
import { LayerPanel } from '@/components/layers/LayerPanel';
import { PropertiesPanel } from '@/components/properties/PropertiesPanel';
import { AssetBrowserPanel } from '@/components/layers/AssetBrowserPanel';
import { cn } from '@/lib/utils';

type RightTab = 'layers' | 'assets';

export function RightPanel() {
  const [tab, setTab] = useState<RightTab>('layers');

  return (
    <div className="flex h-full flex-col border-l border-border bg-surface-1 overflow-hidden">
      {/* Tab switcher */}
      <div className="flex border-b border-border flex-shrink-0">
        {(['layers', 'assets'] as RightTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 py-2 text-xs font-medium capitalize transition-colors',
              tab === t
                ? 'border-b-2 border-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'layers' ? <LayerPanel /> : <AssetBrowserPanel />}
      </div>

      {/* Properties panel */}
      <div className="border-t border-border max-h-[45vh] overflow-y-auto">
        <PropertiesPanel />
      </div>
    </div>
  );
}
