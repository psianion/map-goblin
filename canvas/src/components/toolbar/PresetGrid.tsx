import type { MapStylePreset } from '@/store/presetRegistry';
import type { DungeonStyle } from '@/store/types';
import { cn } from '@/lib/utils';

interface PresetGridProps {
  presets: MapStylePreset[];
  activeId?: string;
  onSelect: (preset: MapStylePreset) => void;
}

/** Solid fill for the bottom hint section of a swatch — shadow color if enabled, else a neutral. */
function shadowBackground(style: Partial<DungeonStyle>): string {
  return style.shadowEnabled ? (style.shadowColor ?? '#444') : '#1a1a1a';
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
            {/* Floor color — top 60% */}
            <div
              className="w-full"
              style={{ height: '60%', backgroundColor: s.floorColor ?? '#c8b89a' }}
            />
            {/* Wall stripe — 4px */}
            <div
              className="w-full"
              style={{ height: '4px', backgroundColor: s.wallColor ?? '#222' }}
            />
            {/* Shadow hint — remaining bottom */}
            <div
              className="w-full"
              style={{
                height: 'calc(40% - 4px)',
                background: shadowBackground(s),
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
