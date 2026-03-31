import type { MapStylePreset } from '@/store/presetRegistry';
import type { DungeonStyle } from '@/store/types';
import { cn } from '@/lib/utils';

interface PresetGridProps {
  presets: MapStylePreset[];
  activeId?: string;
  onSelect: (preset: MapStylePreset) => void;
}

/** Renders a CSS background for the hatching hint section of a swatch */
function hatchingBackground(style: Partial<DungeonStyle>): string {
  if (!style.hatchingStyle || style.hatchingStyle === 'none') {
    // Use shadow color as solid fill if shadow enabled, otherwise a subtle neutral
    return style.shadowEnabled ? (style.shadowColor ?? '#444') : '#1a1a1a';
  }
  const angle = style.hatchingAngle ?? 45;
  const spacing = Math.max(3, (style.hatchingLineSpacing ?? 0.3) * 12);
  const color = style.wallColor ?? '#333';
  if (style.hatchingStyle === 'crosshatch') {
    return [
      `repeating-linear-gradient(${angle}deg, ${color} 0px, ${color} 1px, transparent 1px, transparent ${spacing}px)`,
      `repeating-linear-gradient(${angle + 90}deg, ${color} 0px, ${color} 1px, transparent 1px, transparent ${spacing}px)`,
    ].join(', ');
  }
  // 'lines' or 'horizontal'
  const lineAngle = style.hatchingStyle === 'horizontal' ? 0 : angle;
  return `repeating-linear-gradient(${lineAngle}deg, ${color} 0px, ${color} 1px, transparent 1px, transparent ${spacing}px)`;
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
            {/* Hatching hint — remaining bottom */}
            <div
              className="w-full"
              style={{
                height: 'calc(40% - 4px)',
                background: hatchingBackground(s),
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
