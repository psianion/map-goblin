import { Map, NotebookPen } from 'lucide-react';
import { cn } from '@/lib/utils';

type PanelTab = 'maps' | 'prep';

interface PanelTabBarProps {
  activeTab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
}

const TABS: { id: PanelTab; label: string; icon: typeof Map }[] = [
  { id: 'maps', label: 'Maps', icon: Map },
  { id: 'prep', label: 'Prep', icon: NotebookPen },
];

export function PanelTabBar({ activeTab, onTabChange }: PanelTabBarProps) {
  return (
    <div className="flex items-center border-b border-border-structure bg-surface-0 shrink-0 h-9">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          data-testid={`panel-tab-${id}`}
          onClick={() => onTabChange(id)}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 h-full',
            'font-mono text-tab-label uppercase tracking-wider',
            'border-b-2 transition-colors',
            id === activeTab
              ? 'border-accent-active text-text-primary'
              : 'border-transparent text-text-muted hover:text-text-primary',
          )}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  );
}
