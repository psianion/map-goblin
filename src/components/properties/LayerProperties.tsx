import { useState } from 'react'
import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import type { DungeonLayer, DungeonStyle } from '@/store/types'
import type { AnyChild } from '@/shared/types'
import { PropertyField } from './PropertyField'
import { ColorField } from '@/components/inputs/ColorField'
import { ColorChip } from '@/components/inputs/ColorChip'
import { SliderInput } from '@/components/inputs/SliderInput'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { Palette, Minus, Grid3x3, Waves, Blend, Sparkles, RotateCcw } from 'lucide-react'
import { getWallSetDefaults, type WallCategory } from '@/assets/textureManifest'
import { PresetStrip } from '@/components/shared/PresetStrip'
import { DUNGEON_STYLE_PRESETS } from '@/store/presetRegistry'
import { resolveStyle } from '@/engine/styleResolver'
import { ShapeStyleCommand, CompositeCommand } from '@/store/commands'
import { undoManager } from '@/store/undoManager'
import { selectActiveLayer, selectSelectedIds } from '@/store/selectors'

interface LayerPropertiesProps {
  layer: DungeonLayer
  openSections?: Set<string>
  onToggleSection?: (id: string) => void
}

const HATCHING_STYLES_ACTIVE = ['crosshatch', 'lines', 'horizontal'] as const

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
  const [activePresetId, setActivePresetId] = useState<string | undefined>()

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
    setActivePresetId(id)
    patch(preset.dungeonStyle as Partial<DungeonStyle>)
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
        hatchingStyle: getShapeValue('hatchingStyle') as DungeonStyle['hatchingStyle'] | typeof MIXED,
        hatchingBandWidth: getShapeValue('hatchingBandWidth') as number,
        hatchingLineSpacing: getShapeValue('hatchingLineSpacing') as number,
        hatchingLineThickness: getShapeValue('hatchingLineThickness') as number,
        hatchingAngle: getShapeValue('hatchingAngle') as number,
        hatchingInverted: getShapeValue('hatchingInverted') as boolean,
        showEdgeTransitions: getShapeValue('showEdgeTransitions') as boolean,
        edgeTransitionWidth: getShapeValue('edgeTransitionWidth') as number,
        roughnessAmplitude: getShapeValue('roughnessAmplitude') as number,
      }
    : layer.style

  const hatchingEnabled =
    hasSelection
      ? s.hatchingStyle !== 'none' && s.hatchingStyle !== MIXED
      : layer.style.hatchingStyle !== 'none'

  return (
    <div className="flex flex-col pt-2">
      {/* ── Shape Selection Banner ── */}
      {hasSelection && (
        <div className="mx-3 mb-2 px-2 py-1.5 bg-surface-2 border border-border-subtle rounded text-panel-label text-text-muted flex items-center justify-between">
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

          {(hasSelection ? layer.style.wallTextureSetId : layer.style.wallTextureSetId) &&
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
                    />
                  </PropertyField>
                </>
              )
            })()}
        </div>
      </CollapsibleSection>

      {/* ── Hatching ── */}
      <CollapsibleSection
        id="hatching"
        title="Hatching"
        icon={Grid3x3}
        defaultOpen={false}
        isOpen={openSections?.has('hatching')}
        onToggle={onToggleSection}
        headerExtra={
          <ToggleSwitch
            checked={hatchingEnabled}
            onChange={(v) => {
              const newStyle = v ? 'lines' : 'none'
              if (hasSelection) {
                applyShapeOverride('hatchingStyle', newStyle)
              } else {
                patch({ hatchingStyle: newStyle })
              }
            }}
            label="Enable hatching"
          />
        }
      >
        {hatchingEnabled ? (
          <div className="flex flex-col gap-2 pt-2">
            <PropertyField
              label={
                <span className="flex items-center">
                  Style
                  {hasSelection && hasOverride('hatchingStyle') && <OverrideDot />}
                </span>
              }
            >
              {s.hatchingStyle === MIXED ? (
                <div className="flex items-center h-7 px-2 text-panel-body text-text-muted italic">
                  Mixed
                </div>
              ) : (
                <select
                  value={s.hatchingStyle as string}
                  onChange={(e) => {
                    const newStyle = e.target.value as DungeonStyle['hatchingStyle']
                    if (hasSelection) {
                      applyShapeOverride('hatchingStyle', newStyle)
                    } else {
                      patch({ hatchingStyle: newStyle })
                    }
                  }}
                  className="w-full h-7 px-2 bg-surface-2 text-panel-body text-text-primary rounded border border-border-default focus:border-border-focus focus:outline-none"
                >
                  {HATCHING_STYLES_ACTIVE.map((style) => (
                    <option key={style} value={style}>
                      {style.charAt(0).toUpperCase() + style.slice(1)}
                    </option>
                  ))}
                </select>
              )}
            </PropertyField>
            <PropertyField
              label={
                <span className="flex items-center">
                  Band Width
                  {hasSelection && hasOverride('hatchingBandWidth') && <OverrideDot />}
                </span>
              }
            >
              <SliderInput
                value={s.hatchingBandWidth as number}
                onChange={(v) =>
                  hasSelection
                    ? applyShapeOverride('hatchingBandWidth', v)
                    : patch({ hatchingBandWidth: v })
                }
                min={0.1}
                max={2}
                step={0.1}
              />
            </PropertyField>
            <PropertyField
              label={
                <span className="flex items-center">
                  Line Spacing
                  {hasSelection && hasOverride('hatchingLineSpacing') && <OverrideDot />}
                </span>
              }
            >
              <SliderInput
                value={s.hatchingLineSpacing as number}
                onChange={(v) =>
                  hasSelection
                    ? applyShapeOverride('hatchingLineSpacing', v)
                    : patch({ hatchingLineSpacing: v })
                }
                min={0.05}
                max={1}
                step={0.05}
              />
            </PropertyField>
            <PropertyField
              label={
                <span className="flex items-center">
                  Line Thickness
                  {hasSelection && hasOverride('hatchingLineThickness') && <OverrideDot />}
                </span>
              }
            >
              <SliderInput
                value={s.hatchingLineThickness as number}
                onChange={(v) =>
                  hasSelection
                    ? applyShapeOverride('hatchingLineThickness', v)
                    : patch({ hatchingLineThickness: v })
                }
                min={0.01}
                max={0.2}
                step={0.01}
              />
            </PropertyField>
            <PropertyField
              label={
                <span className="flex items-center">
                  Angle
                  {hasSelection && hasOverride('hatchingAngle') && <OverrideDot />}
                </span>
              }
            >
              <SliderInput
                value={s.hatchingAngle as number}
                onChange={(v) =>
                  hasSelection
                    ? applyShapeOverride('hatchingAngle', v)
                    : patch({ hatchingAngle: v })
                }
                min={0}
                max={Math.PI}
                step={0.05}
              />
            </PropertyField>
            <PropertyField
              label={
                <span className="flex items-center">
                  Inverted
                  {hasSelection && hasOverride('hatchingInverted') && <OverrideDot />}
                </span>
              }
            >
              <ToggleSwitch
                checked={s.hatchingInverted as boolean}
                onChange={(v) =>
                  hasSelection
                    ? applyShapeOverride('hatchingInverted', v)
                    : patch({ hatchingInverted: v })
                }
                label="Invert hatching"
              />
            </PropertyField>
          </div>
        ) : (
          <p className="text-panel-label text-text-muted pt-2">Hatching is disabled.</p>
        )}
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
