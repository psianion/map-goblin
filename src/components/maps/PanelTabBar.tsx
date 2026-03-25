import { Map, Clapperboard } from 'lucide-react';
import { cn } from '@/lib/utils';

type PanelTab = 'maps' | 'scenes';

interface PanelTabBarProps {
  activeTab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
}

const TABS: { id: PanelTab; label: string; icon: typeof Map; disabled?: boolean }[] = [
  { id: 'maps', label: 'Maps', icon: Map },
  { id: 'scenes', label: 'Scenes', icon: Clapperboard, disabled: true },
];

export function PanelTabBar({ activeTab, onTabChange }: PanelTabBarProps) {
  return (
    <div className="flex items-center border-b border-border-default bg-surface-0 shrink-0 h-9">
      {TABS.map(({ id, label, icon: Icon, disabled }) => (
        <button
          key={id}
          type="button"
          data-testid={`panel-tab-${id}`}
          disabled={disabled}
          onClick={() => !disabled && onTabChange(id)}
          title={disabled ? 'Coming soon' : undefined}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 h-full',
            'font-mono text-tab-label uppercase tracking-wider',
            'border-b-2 transition-colors',
            disabled && 'opacity-[0.35] cursor-not-allowed',
            !disabled && id === activeTab
              ? 'border-accent-active text-text-primary'
              : 'border-transparent text-text-muted hover:text-text-primary',
            disabled && 'border-transparent',
          )}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  );
}
