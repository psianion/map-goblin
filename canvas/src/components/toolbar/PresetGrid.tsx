import type { MapStylePreset } from '@/store/presetRegistry';
import { cn } from '@/lib/utils';

interface PresetGridProps {
  presets: MapStylePreset[];
  activeId?: string;
  onSelect: (preset: MapStylePreset) => void;
}

export function PresetGrid({ presets, activeId, onSelect }: PresetGridProps) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {presets.map((preset) => {
        const s = preset.dungeonStyle;
        const isActive = preset.id === activeId;
        return (
          <button
            key={preset.id}
            type="button"
            title={preset.label}
            onClick={() => onSelect(preset)}
            className={cn(
              'aspect-square rounded overflow-hidden cursor-pointer transition-colors',
              isActive
                ? 'ring-2 ring-accent-active ring-offset-1 ring-offset-surface-1'
                : 'border border-border-default hover:border-border-focus',
            )}
          >
            {/* Floor color — top 65% */}
            <div
              className="w-full"
              style={{ height: '65%', backgroundColor: s.floorColor ?? '#c8b89a' }}
            />
            {/* Wall color — remaining bottom */}
            <div
              className="w-full"
              style={{ height: '35%', backgroundColor: s.wallColor ?? '#222' }}
            />
          </button>
        );
      })}
    </div>
  );
}
