import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/store/store';
import { useShallow } from 'zustand/react/shallow';
import { selectActiveLayer } from '@/store/selectors';
import type { ToolType, DungeonLayer, DungeonStyle, ScatterBrushSettings } from '@/store/types';
import type { DoorStyle } from '@/shared/types';
import { ColorField } from '@/components/inputs/ColorField';
import { SliderInput } from '@/components/inputs/SliderInput';
import { SelectInput } from '@/components/inputs/SelectInput';
import { DualRangeSlider } from '@/components/inputs/DualRangeSlider';
import { PropertyField } from '@/components/properties/PropertyField';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { showToolPreview, hideToolPreview } from '@/engine/toolPreview';
import type { PreviewSettings } from '@/engine/toolPreview';

interface ToolPopoverProps {
  tool: ToolType;
  anchorY: number;
  onClose: () => void;
}

export function ToolPopover({ tool, anchorY, onClose }: ToolPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Cleanup preview on unmount
  useEffect(() => {
    return () => hideToolPreview();
  }, []);

  // Build preview settings and trigger ghost shape
  const triggerPreview = useCallback(() => {
    const state = useStore.getState();
    const layer = state.layers.find(
      (l) => l.id === state.ui.activeLayerId && l.type === 'dungeon',
    ) as DungeonLayer | undefined;

    const settings: PreviewSettings = { tool };

    if (tool === 'rectangle' || tool === 'polygon' || tool === 'regularPolygon' || tool === 'path' || tool === 'wall') {
      if (layer) settings.style = layer.style;
      if (tool === 'regularPolygon') {
        settings.sides = state.tools.settings.regularPolygon.sides;
      }
    } else if (tool === 'light') {
      settings.lightDefaults = state.tools.settings.lightDefaults;
    }

    showToolPreview(settings);
  }, [tool]);

  // Click-outside dismiss
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (!panelRef.current) return;
      if (panelRef.current.contains(e.target as Node)) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-toolbar-button]')) return;
      onClose();
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [onClose]);

  // Escape key dismiss
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onClose]);

  // Close on active layer change
  const activeLayerId = useStore((s) => s.ui.activeLayerId);
  const prevLayerIdRef = useRef(activeLayerId);
  useEffect(() => {
    if (prevLayerIdRef.current !== activeLayerId) {
      prevLayerIdRef.current = activeLayerId;
      onClose();
    }
  }, [activeLayerId, onClose]);

  const isDrawingTool =
    tool === 'rectangle' || tool === 'polygon' || tool === 'regularPolygon' || tool === 'path';

  return (
    <div
      ref={panelRef}
      className="absolute z-50 w-[200px] bg-surface-1 border border-border-default rounded shadow-lg p-3"
      style={{ left: 52, top: anchorY }}
    >
      {isDrawingTool && <DrawingToolContent tool={tool} onValueChange={triggerPreview} />}
      {tool === 'wall' && <WallToolContent onValueChange={triggerPreview} />}
      {tool === 'door' && <DoorToolContent onValueChange={triggerPreview} />}
      {tool === 'light' && <LightToolContent onValueChange={triggerPreview} />}
      {tool === 'scatterBrush' && <ScatterBrushContent />}
    </div>
  );
}

// ─── Drawing Tools ───────────────────────────────

function DrawingToolContent({
  tool,
  onValueChange,
}: {
  tool: ToolType;
  onValueChange?: () => void;
}) {
  const layer = useStore(useShallow(selectActiveLayer)) as DungeonLayer | null;
  const updateLayer = useStore((s) => s.updateLayer);
  const polygonSides = useStore((s) => s.tools.settings.regularPolygon.sides);
  const updateToolSettings = useStore((s) => s.updateToolSettings);

  if (!layer || layer.type !== 'dungeon') {
    return <p className="text-xs text-text-muted">No dungeon layer selected</p>;
  }

  const s = layer.style;
  const patch = (partial: Partial<DungeonStyle>) => {
    updateLayer(layer.id, { style: { ...s, ...partial } } as Partial<DungeonLayer>);
    onValueChange?.();
  };

  const TOOL_LABELS: Record<string, string> = {
    rectangle: 'Rectangle',
    polygon: 'Polygon',
    regularPolygon: 'Regular Polygon',
    path: 'Path',
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-panel-heading uppercase text-text-muted">
        {TOOL_LABELS[tool] ?? tool}
      </span>

      {tool === 'regularPolygon' && (
        <PropertyField label="Sides">
          <div className="flex items-center gap-2">
            <button
              className="w-6 h-6 flex items-center justify-center rounded-sm border border-border-default hover:bg-surface-3 text-text-muted hover:text-text-primary transition-colors"
              onClick={() => {
                updateToolSettings({ regularPolygon: { sides: Math.max(3, polygonSides - 1) } });
                onValueChange?.();
              }}
            >
              <ChevronDown size={14} />
            </button>
            <span className="font-mono text-panel-body text-text-primary w-6 text-center tabular-nums">
              {polygonSides}
            </span>
            <button
              className="w-6 h-6 flex items-center justify-center rounded-sm border border-border-default hover:bg-surface-3 text-text-muted hover:text-text-primary transition-colors"
              onClick={() => {
                updateToolSettings({ regularPolygon: { sides: Math.min(32, polygonSides + 1) } });
                onValueChange?.();
              }}
            >
              <ChevronUp size={14} />
            </button>
          </div>
        </PropertyField>
      )}

      <PropertyField label="Floor Color">
        <ColorField value={s.floorColor} onChange={(c) => patch({ floorColor: c })} />
      </PropertyField>

      <PropertyField label="Wall Color">
        <ColorField value={s.wallColor} onChange={(c) => patch({ wallColor: c })} />
      </PropertyField>

      <PropertyField label="Wall Width">
        <SliderInput
          value={s.wallWidth}
          onChange={(v) => patch({ wallWidth: v })}
          min={0.05}
          max={1}
          step={0.05}
        />
      </PropertyField>

      <PropertyField label="Shadow">
        <ToggleSwitch
          checked={s.shadowEnabled}
          onChange={(v) => patch({ shadowEnabled: v })}
          label="Enable shadow"
        />
      </PropertyField>
    </div>
  );
}

// ─── Wall Tool ───────────────────────────────────

function WallToolContent({ onValueChange }: { onValueChange?: () => void }) {
  const layer = useStore(useShallow(selectActiveLayer)) as DungeonLayer | null;
  const updateLayer = useStore((s) => s.updateLayer);
  const wallType = useStore((s) => s.tools.settings.wallType);
  const wallDirection = useStore((s) => s.tools.settings.wallDirection);
  const updateToolSettings = useStore((s) => s.updateToolSettings);

  if (!layer || layer.type !== 'dungeon') {
    return <p className="text-xs text-text-muted">No dungeon layer selected</p>;
  }

  const s = layer.style;
  const patch = (partial: Partial<DungeonStyle>) => {
    updateLayer(layer.id, { style: { ...s, ...partial } } as Partial<DungeonLayer>);
    onValueChange?.();
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-panel-heading uppercase text-text-muted">Wall</span>

      <PropertyField label="Wall Color">
        <ColorField value={s.wallColor} onChange={(c) => patch({ wallColor: c })} />
      </PropertyField>

      <PropertyField label="Wall Width">
        <SliderInput
          value={s.wallWidth}
          onChange={(v) => patch({ wallWidth: v })}
          min={0.05}
          max={1}
          step={0.05}
        />
      </PropertyField>

      <PropertyField label="Wall Type">
        <SelectInput
          value={wallType}
          onChange={(v) => {
            updateToolSettings({ wallType: v as import('@/shared/types').WallType });
            onValueChange?.();
          }}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'terrain', label: 'Terrain' },
            { value: 'invisible', label: 'Invisible' },
            { value: 'ethereal', label: 'Ethereal' },
            { value: 'window', label: 'Window' },
          ]}
        />
      </PropertyField>

      <PropertyField label="Direction">
        <SelectInput
          value={wallDirection}
          onChange={(v) => {
            updateToolSettings({ wallDirection: v as import('@/shared/types').WallDirection });
            onValueChange?.();
          }}
          options={[
            { value: 'both', label: 'Both' },
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
          ]}
        />
      </PropertyField>
    </div>
  );
}

// ─── Light Tool ──────────────────────────────────

function LightToolContent({ onValueChange }: { onValueChange?: () => void }) {
  const defaults = useStore(useShallow((s) => s.tools.settings.lightDefaults));
  const updateLightDefaults = useStore((s) => s.updateLightDefaults);
  const cellScale = useStore((s) => s.mapSettings.cellScale);
  const ftPerCell = cellScale.value;

  const toFt = (worldUnits: number): string => `${Math.round(worldUnits * ftPerCell)} ft`;

  const patch = (p: Partial<typeof defaults>) => {
    updateLightDefaults(p);
    onValueChange?.();
  };

  const featherRadius = defaults.featherRadius ?? 0;
  const brightZonePct = defaults.radius > 0 ? Math.round((featherRadius / defaults.radius) * 100) : 0;

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-panel-heading uppercase text-text-muted">Light</span>

      <PropertyField label="Color">
        <ColorField value={defaults.color} onChange={(c) => patch({ color: c })} />
      </PropertyField>

      <PropertyField
        label={
          <span className="flex items-center justify-between w-full">
            <span>Radius</span>
            <span className="text-text-muted text-[10px] font-normal">{toFt(defaults.radius)}</span>
          </span>
        }
      >
        <SliderInput
          value={defaults.radius}
          onChange={(v) => {
            const updates: Partial<typeof defaults> = { radius: v };
            if (featherRadius > v) updates.featherRadius = v;
            patch(updates);
          }}
          min={5 / ftPerCell}
          max={300 / ftPerCell}
          step={5 / ftPerCell}
        />
      </PropertyField>

      <PropertyField
        label={
          <span className="flex items-center justify-between w-full">
            <span>Bright Zone</span>
            <span className="text-text-muted text-[10px] font-normal">{brightZonePct}%</span>
          </span>
        }
      >
        <SliderInput
          value={brightZonePct}
          onChange={(pct) => patch({ featherRadius: (pct / 100) * defaults.radius })}
          min={0}
          max={100}
          step={5}
        />
      </PropertyField>

      <PropertyField label="Intensity">
        <SliderInput
          value={defaults.intensity}
          onChange={(v) => patch({ intensity: v })}
          min={0}
          max={1}
          step={0.01}
        />
      </PropertyField>

      <PropertyField label="Falloff">
        <div className="flex gap-1">
          {(['linear', 'quadratic'] as const).map((f) => (
            <button
              key={f}
              className={cn(
                'flex-1 h-7 rounded-sm border font-body text-[11px] transition-colors capitalize',
                defaults.falloff === f
                  ? 'bg-surface-3 border-accent-active text-text-primary'
                  : 'bg-transparent border-border-default text-text-muted hover:text-text-primary',
              )}
              onClick={() => patch({ falloff: f })}
            >
              {f}
            </button>
          ))}
        </div>
      </PropertyField>
    </div>
  );
}

// ─── Door Tool ───────────────────────────────────

const DOOR_STYLES: { value: DoorStyle; label: string }[] = [
  { value: 'single', label: 'Single' },
  { value: 'double', label: 'Double' },
  { value: 'portcullis', label: 'Portcullis' },
  { value: 'archway', label: 'Archway' },
];

function DoorToolContent({ onValueChange }: { onValueChange?: () => void }) {
  const doorStyle = useStore((s) => s.tools.settings.doorStyle);
  const doorSecret = useStore((s) => s.tools.settings.doorSecret);
  const doorWidth = useStore((s) => s.tools.settings.doorWidth);
  const updateToolSettings = useStore((s) => s.updateToolSettings);

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-panel-heading uppercase text-text-muted">Door</span>

      <PropertyField label="Style">
        <div className="grid grid-cols-2 gap-1">
          {DOOR_STYLES.map(({ value, label }) => (
            <button
              key={value}
              className={cn(
                'h-7 rounded-sm border font-body text-[11px] transition-colors',
                doorStyle === value
                  ? 'bg-surface-3 border-accent-active text-text-primary'
                  : 'bg-transparent border-border-default text-text-muted hover:text-text-primary',
              )}
              onClick={() => {
                updateToolSettings({ doorStyle: value });
                onValueChange?.();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </PropertyField>

      <PropertyField label="Secret">
        <ToggleSwitch
          checked={doorSecret ?? false}
          onChange={(v) => {
            updateToolSettings({ doorSecret: v });
            onValueChange?.();
          }}
          label="Secret door"
        />
      </PropertyField>

      <PropertyField label="Width">
        <SliderInput
          value={doorWidth ?? 1}
          onChange={(v) => {
            updateToolSettings({ doorWidth: v });
            onValueChange?.();
          }}
          min={0.25}
          max={4}
          step={0.25}
        />
      </PropertyField>
    </div>
  );
}

// ─── Scatter Brush Tool ──────────────────────────

function ScatterBrushContent() {
  const settings = useStore(useShallow((s) => s.tools.settings.scatterBrush));
  const eraseMode = useStore((s) => s.tools.eraseMode);
  const continuousPlacement = useStore((s) => s.tools.settings.continuousPlacement);
  const updateSettings = useStore((s) => s.updateScatterBrushSettings);
  const updateToolSettings = useStore((s) => s.updateToolSettings);

  const patch = useCallback(
    (p: Partial<ScatterBrushSettings>) => {
      updateSettings(p);
    },
    [updateSettings],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs font-medium text-text-secondary uppercase tracking-wider">
        {eraseMode ? 'Erase Assets' : 'Stamp / Scatter'}
      </div>

      {/* Mode toggle */}
      {!eraseMode && (
        <div className="flex gap-1 bg-surface-2 rounded-lg p-0.5">
          <button
            className={cn(
              'flex-1 text-xs py-1.5 rounded-md transition-colors',
              settings.stampMode
                ? 'bg-accent text-white font-semibold'
                : 'text-text-secondary hover:text-text-primary',
            )}
            onClick={() => patch({ stampMode: true })}
          >
            Stamp
          </button>
          <button
            className={cn(
              'flex-1 text-xs py-1.5 rounded-md transition-colors',
              !settings.stampMode
                ? 'bg-accent text-white font-semibold'
                : 'text-text-secondary hover:text-text-primary',
            )}
            onClick={() => patch({ stampMode: false })}
          >
            Scatter
          </button>
        </div>
      )}

      {/* Scatter-only controls */}
      {!settings.stampMode && !eraseMode && (
        <>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[11px] text-text-secondary uppercase tracking-wider">Brush Radius</span>
              <span className="text-xs text-text-primary font-mono">{settings.brushRadius} cells</span>
            </div>
            <SliderInput value={settings.brushRadius} onChange={(v) => patch({ brushRadius: v })} min={1} max={10} step={0.5} />
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[11px] text-text-secondary uppercase tracking-wider">Count</span>
              <span className="text-xs text-text-primary font-mono">{settings.count}</span>
            </div>
            <SliderInput value={settings.count} onChange={(v) => patch({ count: Math.round(v) })} min={1} max={30} step={1} />
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[11px] text-text-secondary uppercase tracking-wider">Min Spacing</span>
              <span className="text-xs text-text-primary font-mono">{settings.minSpacing.toFixed(1)} cells</span>
            </div>
            <SliderInput value={settings.minSpacing} onChange={(v) => patch({ minSpacing: v })} min={0.2} max={5} step={0.1} />
          </div>
          <div>
            <div className="text-[11px] text-text-secondary uppercase tracking-wider mb-1">
              Scale Range
            </div>
            <DualRangeSlider
              min={0.3}
              max={2.0}
              step={0.05}
              value={settings.scaleRange}
              onChange={(v) => patch({ scaleRange: v })}
              formatValue={(v) => `${v.toFixed(2)}\u00d7`}
            />
          </div>
          <div>
            <div className="text-[11px] text-text-secondary uppercase tracking-wider mb-1">
              Rotation Range
            </div>
            <DualRangeSlider
              min={0}
              max={360}
              step={5}
              value={[
                (settings.rotationRange[0] * 180) / Math.PI,
                (settings.rotationRange[1] * 180) / Math.PI,
              ]}
              onChange={(v) =>
                patch({
                  rotationRange: [
                    (v[0] * Math.PI) / 180,
                    (v[1] * Math.PI) / 180,
                  ],
                })
              }
              formatValue={(v) => `${Math.round(v)}\u00b0`}
            />
          </div>
        </>
      )}

      {/* Brush radius for erase mode */}
      {eraseMode && !settings.stampMode && (
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[11px] text-text-secondary uppercase tracking-wider">Erase Radius</span>
            <span className="text-xs text-text-primary font-mono">{settings.brushRadius} cells</span>
          </div>
          <SliderInput value={settings.brushRadius} onChange={(v) => patch({ brushRadius: v })} min={1} max={10} step={0.5} />
        </div>
      )}

      {/* Stamp-only: continuous placement toggle */}
      {settings.stampMode && !eraseMode && (
        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={continuousPlacement}
            onChange={(e) =>
              updateToolSettings({
                continuousPlacement: e.target.checked,
              })
            }
            className="accent-accent"
          />
          Continuous placement
        </label>
      )}

      {/* Selected assets count */}
      <div className="text-[10px] text-text-tertiary mt-1">
        {settings.assetIds.length === 0
          ? 'Select assets in the browser panel \u2192'
          : `${settings.assetIds.length} asset${settings.assetIds.length > 1 ? 's' : ''} selected`}
      </div>
    </div>
  );
}
