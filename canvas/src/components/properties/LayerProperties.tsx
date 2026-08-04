import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/utils'
import type { DungeonLayer, DungeonStyle, SublayerVisibility } from '@/store/types'
import type { AnyChild } from '@/shared/types'
import { PropertyField } from './PropertyField'
import { ColorField } from '@/components/inputs/ColorField'
import { ColorChip } from '@/components/inputs/ColorChip'
import { SliderInput } from '@/components/inputs/SliderInput'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { Palette, Minus, Waves, Blend, Sparkles, RotateCcw, Layers, Eye } from 'lucide-react'
import { getWallSetDefaults, type WallCategory } from '@/assets/textureManifest'
import { PresetStrip } from '@/components/shared/PresetStrip'
import { DUNGEON_STYLE_PRESETS, matchPresetId } from '@/store/presetRegistry'
import { resolveStyle } from '@/engine/styleResolver'
import { ShapeStyleCommand, CompositeCommand, PresetApplyCommand, PropertyCommand } from '@/store/commands'
import { undoManager } from '@/store/undoManager'
import { selectActiveLayer, selectSelectedIds } from '@/store/selectors'
import { notify } from '@/lib/toast'

interface LayerPropertiesProps {
  layer: DungeonLayer
  openSections?: Set<string>
  onToggleSection?: (id: string) => void
}

const DUNGEON_PRESET_CHIPS = DUNGEON_STYLE_PRESETS.map((p) => ({
  id: p.id,
  label: p.label,
  color: p.dungeonStyle.floorColor ?? '#c8b89a',
}))

// ── Override indicator — small dot shown when a field has a per-shape override ──
function OverrideDot() {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full bg-accent ml-1 align-middle"
      title="Shape override (differs from layer default)"
    />
  )
}

// ── Mixed value indicator for multi-shape selection ──
const MIXED = '—'

function isMixed<T>(values: T[]): boolean {
  if (values.length === 0) return false
  const first = values[0]
  return values.some((v) => v !== first)
}

export function LayerProperties({ layer, openSections, onToggleSection }: LayerPropertiesProps) {
  const updateLayer = useStore((s) => s.updateLayer)
  // The per-layer grid toggle renders global && perLayer — muted here (not
  // disabled: still worth setting ahead of turning the global grid back on).
  const globalGridVisible = useStore((s) => s.grid.visible)
  // Derived, not remembered — a local copy would keep highlighting a preset
  // that undo had already taken back off the layer.
  const activePresetId = matchPresetId(layer.style)

  // Selection state
  const selectedIds = useStore(useShallow(selectSelectedIds))
  const activeLayer = useStore(useShallow(selectActiveLayer))

  // Layer-level patch (no undo, for layer style editing)
  function patch(partial: Partial<DungeonStyle>) {
    updateLayer(layer.id, { style: { ...layer.style, ...partial } } as Partial<DungeonLayer>)
  }

  const handleStylePreset = (id: string) => {
    const preset = DUNGEON_STYLE_PRESETS.find((p) => p.id === id)
    if (!preset) return
    const cmd = new PresetApplyCommand(
      `Apply preset: ${preset.label}`,
      layer.id,
      preset,
      structuredClone(layer.style),
    )
    undoManager.execute(cmd)
    notify.action(`Applied '${preset.label}'`, {
      label: 'Undo',
      onClick: () => undoManager.undo(),
      icon: 'palette',
    })
  }

  // ── Per-shape selection logic ──
  const isDungeonActive = activeLayer?.type === 'dungeon'
  const dungeonActiveLayer = isDungeonActive ? (activeLayer as DungeonLayer) : null

  // Find selected children (shapes only) in the active dungeon layer
  const selectedChildren: AnyChild[] =
    dungeonActiveLayer && selectedIds.length > 0
      ? selectedIds
          .map((id) => dungeonActiveLayer.children.find((c) => c.id === id))
          .filter((c): c is AnyChild => c !== undefined && c.childType === 'shape')
      : []

  const hasSelection = selectedChildren.length > 0

  // Resolved styles for selected shapes
  const resolvedStyles = selectedChildren.map((child) =>
    resolveStyle(layer.style, child.styleOverrides as Partial<DungeonStyle> | undefined),
  )

  // Helper: get display value for a field across selected shapes
  function getShapeValue<K extends keyof DungeonStyle>(field: K): DungeonStyle[K] | typeof MIXED {
    if (resolvedStyles.length === 0) return layer.style[field]
    const values = resolvedStyles.map((s) => s[field])
    if (isMixed(values)) return MIXED
    return values[0]
  }

  // Helper: check if a field has a per-shape override on any selected child
  function hasOverride(field: keyof DungeonStyle): boolean {
    return selectedChildren.some(
      (child) => child.styleOverrides != null && field in child.styleOverrides,
    )
  }

  // ── Apply style override to selected shapes ──
  function applyShapeOverride(field: keyof DungeonStyle, newValue: unknown) {
    if (!dungeonActiveLayer || selectedChildren.length === 0) return

    if (selectedChildren.length === 1) {
      const child = selectedChildren[0]
      const prevOverrides = child.styleOverrides
        ? (child.styleOverrides as Partial<DungeonStyle>)
        : undefined
      const newOverrides: Partial<DungeonStyle> = {
        ...(child.styleOverrides as Partial<DungeonStyle> | undefined),
        [field]: newValue,
      }
      const cmd = new ShapeStyleCommand(
        `Change ${field} on shape`,
        dungeonActiveLayer.id,
        child.id,
        prevOverrides,
        newOverrides,
      )
      undoManager.execute(cmd)
    } else {
      // Multi-shape: composite command
      const cmds = selectedChildren.map((child) => {
        const prevOverrides = child.styleOverrides
          ? (child.styleOverrides as Partial<DungeonStyle>)
          : undefined
        const newOverrides: Partial<DungeonStyle> = {
          ...(child.styleOverrides as Partial<DungeonStyle> | undefined),
          [field]: newValue,
        }
        return new ShapeStyleCommand(
          `Change ${field} on shape`,
          dungeonActiveLayer.id,
          child.id,
          prevOverrides,
          newOverrides,
        )
      })
      undoManager.execute(new CompositeCommand(`Change ${field} on ${cmds.length} shapes`, cmds))
    }
  }

  // ── Reset selected shapes to layer defaults ──
  function resetShapesToLayerDefaults() {
    if (!dungeonActiveLayer || selectedChildren.length === 0) return
    if (selectedChildren.length === 1) {
      const child = selectedChildren[0]
      const prevOverrides = child.styleOverrides
        ? (child.styleOverrides as Partial<DungeonStyle>)
        : undefined
      const cmd = new ShapeStyleCommand(
        'Reset to layer defaults',
        dungeonActiveLayer.id,
        child.id,
        prevOverrides,
        undefined,
      )
      undoManager.execute(cmd)
    } else {
      const cmds = selectedChildren.map((child) => {
        const prevOverrides = child.styleOverrides
          ? (child.styleOverrides as Partial<DungeonStyle>)
          : undefined
        return new ShapeStyleCommand(
          'Reset to layer defaults',
          dungeonActiveLayer.id,
          child.id,
          prevOverrides,
          undefined,
        )
      })
      undoManager.execute(new CompositeCommand('Reset shapes to layer defaults', cmds))
    }
  }

  // ── Whether any selected shape has overrides ──
  const anyShapeHasOverrides =
    hasSelection &&
    selectedChildren.some(
      (child) => child.styleOverrides != null && Object.keys(child.styleOverrides).length > 0,
    )

  // ── Style values to display in UI (shape resolved or layer style) ──
  const s = hasSelection
    ? {
        floorColor:
          getShapeValue('floorColor') === MIXED ? MIXED : (getShapeValue('floorColor') as string),
        wallTextureSetId: getShapeValue('wallTextureSetId') as string | undefined,
        wallWidth: getShapeValue('wallWidth') as number,
        wallTextureTint: getShapeValue('wallTextureTint') as string,
        showEdgeTransitions: getShapeValue('showEdgeTransitions') as boolean,
        edgeTransitionWidth: getShapeValue('edgeTransitionWidth') as number,
        roughnessAmplitude: getShapeValue('roughnessAmplitude') as number,
      }
    : layer.style

  // ── Opacity — live preview via the raw action, one undo entry on release ──
  const commitOpacity = (newPct: number, startPct: number) => {
    const newVal = newPct / 100
    const startVal = startPct / 100
    if (newVal === startVal) return
    undoManager.execute(new PropertyCommand(
      'Layer opacity',
      { type: 'layer', layerId: layer.id },
      { opacity: startVal },
      { opacity: newVal },
    ))
  }

  // ── Layer-style fields (Floor Color, Wall Width/Tint, Edge Transition
  // width, Roughness amplitude) — same live-patch/commit-on-release split as
  // opacity above. `patch()` keeps driving the live drag/picker preview;
  // this fires once when the drag/picker session ends, same PropertyCommand
  // vehicle as opacity (a `{ style: {...} }` patch is just Partial<Layer>),
  // so no new command class was needed. Per-shape override paths already go
  // through ShapeStyleCommand on every change and are untouched.
  function commitStyleField<K extends keyof DungeonStyle>(
    field: K,
    newValue: DungeonStyle[K],
    startValue: DungeonStyle[K],
  ) {
    if (newValue === startValue) return
    undoManager.execute(new PropertyCommand(
      `Layer ${field}`,
      { type: 'layer', layerId: layer.id },
      { style: { ...layer.style, [field]: startValue } },
      { style: { ...layer.style, [field]: newValue } },
    ))
  }

  return (
    <div className="flex flex-col pt-2">
      {/* ── Layer (opacity) ── */}
      <CollapsibleSection
        id="layer"
        title="Layer"
        icon={Layers}
        defaultOpen={true}
        isOpen={openSections?.has('layer')}
        onToggle={onToggleSection}
      >
        <div className="pt-2">
          <PropertyField label="Opacity">
            <SliderInput
              value={Math.round(layer.opacity * 100)}
              rawValue={layer.opacity * 100}
              min={0}
              max={100}
              step={1}
              onChange={(pct) => updateLayer(layer.id, { opacity: pct / 100 })}
              onChangeCommit={commitOpacity}
              unit="%"
            />
          </PropertyField>
        </div>
      </CollapsibleSection>

      {/* ── Sublayers ── */}
      <CollapsibleSection
        id="sublayers"
        title="Sublayers"
        icon={Eye}
        defaultOpen={false}
        isOpen={openSections?.has('sublayers')}
        onToggle={onToggleSection}
      >
        <div className="flex flex-col gap-2 pt-2">
          {(
            [
              ['floor', 'Floor'],
              ['grid', 'Grid'],
              ['walls', 'Walls & Doors'],
            ] as [keyof SublayerVisibility, string][]
          ).map(([key, label]) => {
            const globallyMuted = key === 'grid' && !globalGridVisible
            return (
              <div
                key={key}
                // opacity-80 + text-dim, not opacity-50 on text-muted — see
                // index.css's --text-dim comment (opacity-50 on text-muted
                // fails 4.5:1 in both themes).
                className={cn('flex items-center justify-between', globallyMuted && 'opacity-80')}
                title={globallyMuted ? 'Grid is off globally' : undefined}
              >
                <span
                  className={cn(
                    'font-mono text-panel-label uppercase',
                    globallyMuted ? 'text-text-dim' : 'text-text-muted',
                  )}
                >
                  {label}
                </span>
                <ToggleSwitch
                  checked={layer.sublayerVisibility[key]}
                  onChange={(v) =>
                    undoManager.execute(new PropertyCommand(
                      `${layer.sublayerVisibility[key] ? 'Hide' : 'Show'} ${label.toLowerCase()}`,
                      { type: 'layer', layerId: layer.id },
                      { sublayerVisibility: { ...layer.sublayerVisibility } },
                      { sublayerVisibility: { ...layer.sublayerVisibility, [key]: v } },
                    ))
                  }
                  label={label}
                />
              </div>
            )
          })}
        </div>
      </CollapsibleSection>

      {/* ── Shape Selection Banner ──
          Style Presets applies to the whole layer, not a shape selection, so
          the section itself just doesn't render below (quieter than showing
          it visible-but-disabled) — a one-line note here is what tells the
          user where it went instead. */}
      {hasSelection && (
        <div className="mx-3 mb-2 px-2 py-1.5 bg-surface-2 border border-border-subtle rounded text-panel-label text-text-muted flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span>
              {selectedChildren.length === 1 ? '1 shape selected' : `${selectedChildren.length} shapes selected`}
            </span>
            {anyShapeHasOverrides && (
              <button
                type="button"
                onClick={resetShapesToLayerDefaults}
                className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary transition-colors"
                title="Reset all overrides to layer defaults"
              >
                <RotateCcw size={10} />
                Reset
              </button>
            )}
          </div>
          <span className="text-[10px]">Presets apply to the whole layer.</span>
        </div>
      )}

      {/* ── Style Presets (layer-level only, hidden when shapes selected) ── */}
      {!hasSelection && (
        <CollapsibleSection
          id="style-presets"
          title="Style Presets"
          icon={Sparkles}
          defaultOpen={true}
          isOpen={openSections?.has('style-presets')}
          onToggle={onToggleSection}
        >
          <div className="pt-2">
            <PresetStrip
              presets={DUNGEON_PRESET_CHIPS}
              activeId={activePresetId}
              onSelect={handleStylePreset}
            />
          </div>
        </CollapsibleSection>
      )}

      {/* ── Colors ── */}
      <CollapsibleSection
        id="colors"
        title="Colors"
        icon={Palette}
        defaultOpen={true}
        isOpen={openSections?.has('colors')}
        onToggle={onToggleSection}
        preview={
          <div className="flex gap-2">
            <ColorChip
              color={
                s.floorColor === MIXED ? '#888888' : (s.floorColor as string)
              }
              size="preview"
            />
          </div>
        }
      >
        <div className="flex flex-col gap-2 pt-2">
          <PropertyField
            label={
              <span className="flex items-center">
                Floor Color
                {hasSelection && hasOverride('floorColor') && <OverrideDot />}
              </span>
            }
          >
            {s.floorColor === MIXED ? (
              <div className="flex items-center h-7 px-2 text-panel-body text-text-muted italic">
                Mixed
              </div>
            ) : (
              <ColorField
                value={s.floorColor as string}
                onChange={(c) =>
                  hasSelection ? applyShapeOverride('floorColor', c) : patch({ floorColor: c })
                }
                onChangeCommit={(c, start) => {
                  if (!hasSelection) commitStyleField('floorColor', c, start)
                }}
              />
            )}
          </PropertyField>
        </div>
      </CollapsibleSection>

      {/* ── Walls ── */}
      <CollapsibleSection
        id="walls"
        title="Walls"
        icon={Minus}
        defaultOpen={false}
        isOpen={openSections?.has('walls')}
        onToggle={onToggleSection}
      >
        <div className="flex flex-col gap-2 pt-2">
          {!hasSelection && (
            <PropertyField label="Wall Texture">
              <select
                value={layer.style.wallTextureSetId ?? 'none'}
                onChange={(e) => {
                  const val = e.target.value === 'none' ? undefined : e.target.value
                  if (val) {
                    const defaults = getWallSetDefaults(val as WallCategory)
                    patch({ wallTextureSetId: val, wallWidth: defaults.defaultWidth })
                  } else {
                    patch({ wallTextureSetId: val })
                  }
                }}
                className="w-full h-7 px-2 bg-surface-2 text-panel-body text-text-primary rounded border border-border-default focus:border-border-focus focus:outline-none"
              >
                <option value="none">None (Invisible)</option>
                <option value="stone-slate">Stone Slate</option>
                <option value="wood-ashen">Wood Ashen</option>
              </select>
            </PropertyField>
          )}

          {layer.style.wallTextureSetId &&
            (() => {
              const textureId = layer.style.wallTextureSetId
              if (!textureId) return null
              const wd = getWallSetDefaults(textureId as WallCategory)
              const wallWidthVal = s.wallWidth as number
              const wallTintVal =
                s.wallTextureTint === MIXED ? layer.style.wallTextureTint : (s.wallTextureTint as string)
              return (
                <>
                  <PropertyField
                    label={
                      <span className="flex items-center">
                        Wall Width
                        {hasSelection && hasOverride('wallWidth') && <OverrideDot />}
                      </span>
                    }
                  >
                    <SliderInput
                      value={wallWidthVal}
                      onChange={(v) =>
                        hasSelection ? applyShapeOverride('wallWidth', v) : patch({ wallWidth: v })
                      }
                      onChangeCommit={(v, start) => {
                        if (!hasSelection) commitStyleField('wallWidth', v, start)
                      }}
                      min={wd.minWidth}
                      max={wd.maxWidth}
                      step={0.05}
                    />
                  </PropertyField>
                  <PropertyField
                    label={
                      <span className="flex items-center">
                        Wall Tint
                        {hasSelection && hasOverride('wallTextureTint') && <OverrideDot />}
                      </span>
                    }
                  >
                    <ColorField
                      value={wallTintVal}
                      onChange={(c) =>
                        hasSelection
                          ? applyShapeOverride('wallTextureTint', c)
                          : patch({ wallTextureTint: c })
                      }
                      onChangeCommit={(c, start) => {
                        if (!hasSelection) commitStyleField('wallTextureTint', c, start)
                      }}
                    />
                  </PropertyField>
                </>
              )
            })()}
        </div>
      </CollapsibleSection>

      {/* ── Edge Transitions ── */}
      <CollapsibleSection
        id="edgeTransitions"
        title="Edge Transitions"
        icon={Blend}
        defaultOpen={false}
        isOpen={openSections?.has('edgeTransitions')}
        onToggle={onToggleSection}
        headerExtra={
          <ToggleSwitch
            checked={s.showEdgeTransitions as boolean}
            onChange={(v) => {
              if (hasSelection) {
                applyShapeOverride('showEdgeTransitions', v)
              } else {
                patch({ showEdgeTransitions: v })
              }
            }}
            label="Enable edge transitions"
          />
        }
      >
        {(hasSelection ? (s.showEdgeTransitions as boolean) : layer.style.showEdgeTransitions) ? (
          <div className="flex flex-col gap-2 pt-2">
            <PropertyField
              label={
                <span className="flex items-center">
                  Transition Width
                  {hasSelection && hasOverride('edgeTransitionWidth') && <OverrideDot />}
                </span>
              }
            >
              <SliderInput
                value={s.edgeTransitionWidth as number}
                onChange={(v) =>
                  hasSelection
                    ? applyShapeOverride('edgeTransitionWidth', v)
                    : patch({ edgeTransitionWidth: v })
                }
                onChangeCommit={(v, start) => {
                  if (!hasSelection) commitStyleField('edgeTransitionWidth', v, start)
                }}
                min={0.05}
                max={2}
                step={0.05}
              />
            </PropertyField>
          </div>
        ) : (
          <p className="text-panel-label text-text-muted pt-2">Edge transitions are disabled.</p>
        )}
      </CollapsibleSection>

      {/* ── Roughness ── */}
      <CollapsibleSection
        id="rough"
        title="Roughness"
        icon={Waves}
        defaultOpen={false}
        isOpen={openSections?.has('rough')}
        onToggle={onToggleSection}
      >
        <div className="flex flex-col gap-2 pt-2">
          <PropertyField
            label={
              <span className="flex items-center">
                Amplitude
                {hasSelection && hasOverride('roughnessAmplitude') && <OverrideDot />}
              </span>
            }
          >
            <SliderInput
              value={s.roughnessAmplitude as number}
              onChange={(v) =>
                hasSelection
                  ? applyShapeOverride('roughnessAmplitude', v)
                  : patch({ roughnessAmplitude: v })
              }
              onChangeCommit={(v, start) => {
                if (!hasSelection) commitStyleField('roughnessAmplitude', v, start)
              }}
              min={0}
              max={0.5}
              step={0.01}
            />
          </PropertyField>
        </div>
      </CollapsibleSection>
    </div>
  )
}
