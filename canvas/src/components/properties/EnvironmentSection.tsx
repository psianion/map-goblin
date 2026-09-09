import { useCallback, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Sun, Home, Mountain, Info, Eye, Lock, RotateCcw } from 'lucide-react'
import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import { SetAmbientLightCommand, SetEnvironmentSettingsCommand, SetFogLookCommand } from '@/store/commands'
import {
  BUCKET_MINUTES,
  DAY_MINUTES,
  DEFAULT_FOG_LOOK,
  DEFAULT_PALETTE,
  ENVIRONMENTS,
  FOG_LAYER_TYPES,
  FOG_LOOK_PRESETS,
  FOG_PRESETS,
  KEY_MINUTES,
  NIGHT_SKIES,
  TIME_KEYS,
  TIME_PALETTES,
  composeGrade,
  environmentOf,
  mapClock,
  paletteOf,
  timeColorAt,
  timeOfDayAt,
  type Environment,
  type FogLayer,
  type FogLayerType,
  type FogLook,
  type MapEnvironment,
  type NightSky,
  type TimeKey,
} from '@/store/types'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { ColorChip } from '@/components/inputs/ColorChip'
import { ColorField } from '@/components/inputs/ColorField'
import { SelectInput } from '@/components/inputs/SelectInput'
import { SliderInput } from '@/components/inputs/SliderInput'
import { OrientationCompass } from '@/components/inputs/OrientationCompass'
import { DayRibbon, RibbonHead } from '@/components/inputs/DayRibbon'
import { HATCH, offsetMinutes, ribbonOffset, ribbonX } from '@/lib/dayRibbon'
import { PropertyField } from './PropertyField'
import { cn } from '@/lib/utils'

/**
 * Quick day/night/color presets for the map's mood tint — "this world in neutral daylight",
 * the base every hour is composed on top of. Not exhaustive; the custom hex picker covers the
 * rest. Values are the same base the light FBO clears to (see LightingRenderer).
 */
const AMBIENT_PRESETS: readonly { label: string; color: string }[] = [
  { label: 'Day', color: '#e8e4d8' },
  { label: 'Overcast', color: '#9a9a9a' },
  { label: 'Dusk', color: '#6b5a7a' },
  { label: 'Dungeon', color: '#2d2d44' },
  { label: 'Night', color: '#1a1a2e' },
  { label: 'Moonless', color: '#0a0a0f' },
]

const ENV_LABEL: Record<Environment, string> = {
  outdoor: 'Outdoor',
  indoor: 'Indoor',
  underground: 'Under',
}
const ENV_ICON = { outdoor: Sun, indoor: Home, underground: Mountain } as const

/** The Table's own three (`NIGHT_SKIES`, shared/world.ts) — the sky the preview picker offers. */
const SKY_LABEL: Record<NightSky, string> = {
  'full-moon': 'Full moon',
  crescent: 'Crescent',
  moonless: 'Moonless',
}

const FOG_PRESET_LABEL: Record<(typeof FOG_LOOK_PRESETS)[number], string> = {
  cumulus: 'Cumulus',
  mist: 'Mist',
  smoke: 'Smoke',
  rolling: 'Rolling',
}

const FOG_LAYER_TYPE_OPTIONS = FOG_LAYER_TYPES.map((t) => ({
  value: t,
  label: t[0]!.toUpperCase() + t.slice(1),
}))

const KEY_LABEL: Record<TimeKey, string> = {
  dawn: 'Dawn',
  morning: 'Morning',
  noon: 'Noon',
  evening: 'Evening',
  night: 'Night',
}
/** The 7px tick strip has room for four characters, not for "morning". */
const KEY_TICK: Record<TimeKey, string> = {
  dawn: 'dawn',
  morning: 'morn',
  noon: 'noon',
  evening: 'eve',
  night: 'night',
}

const APPLIED_CAPTION: Record<Environment, string> = {
  outdoor: 'Applied — mood tint carrying the hour',
  indoor: 'Applied — damped toward the mood tint; the hearth still rules',
  underground: 'Applied — mood tint only, all day',
}

const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(Math.floor(minutes % 60)).padStart(2, '0')}`

const titleCase = (s: string): string => s[0]!.toUpperCase() + s.slice(1)

/**
 * A control this map cannot use. Dimmed and hatched, inert to pointer and keyboard, with the
 * reason beside it at full reading contrast — never a bare grey control, which reads as a bug,
 * and never removed, which loses the authored value the DM can still see sitting there.
 */
function Inapplicable({ reason, children }: { reason: string; children: ReactNode }) {
  return (
    <>
      <div className="relative opacity-40 grayscale" inert>
        {children}
        <span
          className="pointer-events-none absolute -inset-0.5 rounded-md"
          style={{ background: HATCH }}
          aria-hidden="true"
        />
      </div>
      <p className="mt-2 flex gap-1.5 text-panel-small text-text-secondary">
        <Info size={11} className="mt-px shrink-0" aria-hidden="true" />
        <span>{reason}</span>
      </p>
    </>
  )
}

/**
 * A one-of-N pill row. `role="radiogroup"` and not `aria-pressed` buttons, for the reason the
 * Table's own segmented control spells out: pressed says "this is on", which leaves a screen
 * reader hearing N independent toggles where the DM sees one either/or.
 */
function Segmented<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string
  /** Absent (no authored pick) leaves every pill unchecked rather than defaulting to the first. */
  value: T | undefined
  options: readonly (readonly [T, string])[]
  onPick: (value: T) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex w-full overflow-hidden rounded-md border border-border-default bg-surface-1"
    >
      {options.map(([option, text]) => {
        const active = option === value
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(option)}
            className={cn(
              'min-w-0 flex-1 truncate py-1.5 text-panel-body transition-colors duration-150 ease-settle',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-focus',
              active
                ? 'bg-surface-3 text-text-primary shadow-[inset_0_-2px_0_rgb(var(--accent-active))]'
                : 'text-text-secondary hover:bg-surface-3 hover:text-text-primary',
            )}
          >
            {text}
          </button>
        )
      })}
    </div>
  )
}

/** One cloud stratum's row: which noise, its tint, and the four dials that shape it. */
function LayerRow({
  index,
  layer,
  onType,
  onTint,
  onCommitTint,
  onField,
  onCommitField,
}: {
  index: number
  layer: FogLayer
  onType: (type: FogLayerType) => void
  onTint: (color: string) => void
  onCommitTint: (color: string, start: string) => void
  onField: (field: 'strength' | 'scale' | 'speed' | 'angle', value: number) => void
  onCommitField: (field: 'strength' | 'scale' | 'speed' | 'angle', value: number, start: number) => void
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border-default bg-surface-1 p-2">
      <div className="flex items-center gap-1.5">
        <span className="text-panel-small text-text-muted">Layer {index + 1}</span>
        <div className="flex-1">
          <SelectInput
            value={layer.type}
            onChange={(v) => onType(v as FogLayerType)}
            options={FOG_LAYER_TYPE_OPTIONS}
            aria-label={`Layer ${index + 1} type`}
          />
        </div>
        <ColorField
          value={layer.tint}
          onChange={onTint}
          onChangeCommit={onCommitTint}
          ariaLabel={`Layer ${index + 1} tint`}
        />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {(
          [
            ['strength', 'Strength', 0, 1, 0.01, ''],
            ['scale', 'Scale', 0.2, 8, 0.1, ''],
            ['speed', 'Speed', 0, 0.3, 0.005, ''],
            ['angle', 'Angle', 0, 360, 1, '°'],
          ] as const
        ).map(([field, label, min, max, step, unit]) => (
          <div key={field} className="flex flex-col gap-0.5">
            <span className="text-panel-small text-text-muted">{label}</span>
            <SliderInput
              value={layer[field]}
              min={min}
              max={max}
              step={step}
              unit={unit}
              ariaLabel={label}
              onChange={(v) => onField(field, v)}
              onChangeCommit={(v, start) => onCommitField(field, v, start)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/** A field label's aside: what this map does with the thing, in the label's own row. */
function Why({ children }: { children: ReactNode }) {
  return (
    <span className="ml-1 normal-case tracking-normal text-text-secondary">— {children}</span>
  )
}

/** Indoor and underground never auto-flip the vision gate — say so where the choice is made. */
function GateChip() {
  return (
    <span className="mt-2 inline-flex items-center gap-1.5 rounded-chip border border-border-default bg-surface-1 px-1.5 py-1 text-panel-small text-text-secondary">
      <Lock size={10} className="shrink-0" aria-hidden="true" />
      No auto-gate — light level is set at the Table
    </span>
  )
}

interface SectionControl {
  openSections?: Set<string>
  onToggleSection?: (id: string) => void
}

export function EnvironmentSection({ openSections, onToggleSection }: SectionControl) {
  const map = useStore(useShallow((s) => s.mapSettings))
  const previewClock = useStore((s) => s.ui.previewClock)
  const setPreviewClock = useStore((s) => s.setPreviewClock)
  const previewSky = useStore((s) => s.ui.previewSky)
  const setPreviewSky = useStore((s) => s.setPreviewSky)
  const [selectedKey, setSelectedKey] = useState<TimeKey>('noon')

  const environment = environmentOf(map)
  const outdoor = environment === 'outdoor'
  const clockReaches = environment !== 'underground'
  const fixed = map.timeMode === 'fixed'
  const clock = mapClock(map, previewClock)
  const keys = paletteOf(map.timePalette)
  const preset = map.timePalette?.preset ?? DEFAULT_PALETTE
  const overrides = map.timePalette?.keyframes ?? {}

  // The two ribbons read the engine's own colour functions, so neither can drift from what
  // the canvas renders: the palette ribbon is the authored day, the applied strip is that day
  // after environment damping and the mood tint — which is why underground goes flat by
  // itself, with no CSS trickery pretending the damping happened.
  const paletteAt = useCallback(
    (minutes: number) => timeColorAt(map.timePalette, minutes),
    [map.timePalette],
  )
  const appliedAt = useCallback((minutes: number) => composeGrade(map, minutes), [map])

  /**
   * One undo entry per authored change, same idiom as the mood tint below.
   *
   * `before` defaults to what the map holds now, which is right for a click. A live drag has
   * already written its steps to the store, so those callers pass the value the interaction
   * started at instead — otherwise undo would restore the last drag step.
   */
  const commitEnv = (patch: Partial<MapEnvironment>, before?: Partial<MapEnvironment>): void => {
    const prev =
      before ??
      (Object.fromEntries(
        Object.keys(patch).map((k) => [k, map[k as keyof MapEnvironment]]),
      ) as Partial<MapEnvironment>)
    undoManager.execute(new SetEnvironmentSettingsCommand(prev, patch))
  }

  const commitAmbient = (newColor: string, startColor: string): void => {
    if (newColor.toLowerCase() === startColor.toLowerCase()) return
    undoManager.execute(new SetAmbientLightCommand(startColor, newColor))
  }

  // A map that never authored a look shows the shipped default and reads it read-only until
  // the first edit — same "never authored" convention the mood tint and time palette use.
  // `map.fogLook` (possibly absent) is what SetFogLookCommand's `before` needs, so it's kept
  // separate from `look` rather than defaulted away.
  const fogLook = map.fogLook ?? DEFAULT_FOG_LOOK

  const writeLook = (next: FogLook): void => useStore.getState().setFogLook(next)

  const commitLook = (after: FogLook, before: FogLook): void => {
    if (JSON.stringify(after) === JSON.stringify(before)) return
    undoManager.execute(new SetFogLookCommand(map.fogLook, after))
  }

  const pickFogPreset = (name: (typeof FOG_LOOK_PRESETS)[number]): void => {
    const before = fogLook
    const after: FogLook = { ...fogLook, preset: name, layers: FOG_PRESETS[name] }
    writeLook(after)
    commitLook(after, before)
  }

  // ponytail: picking a layer field doesn't clear `preset` — it stays the last preset picked
  // so this button keeps working after a tweak, rather than one-shot disabling itself the
  // moment anything moves. The table only reads `preset` as a display hint (D7), nothing
  // downstream depends on it being exactly in sync with `layers`.
  const resetFogToPreset = (): void => {
    if (!fogLook.preset) return
    const before = fogLook
    const after: FogLook = { ...fogLook, layers: FOG_PRESETS[fogLook.preset] }
    writeLook(after)
    commitLook(after, before)
  }

  const setFogBase = (color: string): void => writeLook({ ...fogLook, base: color })
  const commitFogBase = (color: string, start: string): void =>
    commitLook({ ...fogLook, base: color }, { ...fogLook, base: start })

  const setFogField = (field: 'wind' | 'fade' | 'veil' | 'glow', value: number): void =>
    writeLook({ ...fogLook, [field]: value })
  const commitFogField = (field: 'wind' | 'fade' | 'veil' | 'glow', value: number, start: number): void =>
    commitLook({ ...fogLook, [field]: value }, { ...fogLook, [field]: start })

  const withLayer = (i: number, patch: Partial<FogLayer>): FogLook['layers'] =>
    fogLook.layers.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) as FogLook['layers']

  const setFogLayerType = (i: number, type: FogLayerType): void => {
    const after: FogLook = { ...fogLook, layers: withLayer(i, { type }) }
    writeLook(after)
    commitLook(after, fogLook)
  }
  const setFogLayerTint = (i: number, color: string): void =>
    writeLook({ ...fogLook, layers: withLayer(i, { tint: color }) })
  const commitFogLayerTint = (i: number, color: string, start: string): void =>
    commitLook({ ...fogLook, layers: withLayer(i, { tint: color }) }, { ...fogLook, layers: withLayer(i, { tint: start }) })
  const setFogLayerField = (
    i: number,
    field: 'strength' | 'scale' | 'speed' | 'angle',
    value: number,
  ): void => writeLook({ ...fogLook, layers: withLayer(i, { [field]: value }) })
  const commitFogLayerField = (
    i: number,
    field: 'strength' | 'scale' | 'speed' | 'angle',
    value: number,
    start: number,
  ): void =>
    commitLook(
      { ...fogLook, layers: withLayer(i, { [field]: value }) },
      { ...fogLook, layers: withLayer(i, { [field]: start }) },
    )

  // A map that never authored a palette gets the default preset spelled out the first time it
  // is touched. Same five colours either way, so undo restoring `{preset:'temperate'}` rather
  // than "absent" changes nothing anyone can see.
  const paletteWith = (keyframes: Partial<Record<TimeKey, string>>) => ({ preset, keyframes })

  const setKeyframe = (color: string): void => {
    useStore
      .getState()
      .setEnvironmentSettings({ timePalette: paletteWith({ ...overrides, [selectedKey]: color }) })
  }

  const commitKeyframe = (newColor: string, startColor: string): void => {
    if (newColor.toLowerCase() === startColor.toLowerCase()) return
    // ponytail: the pre-drag palette is reconstructed from the colour the picker opened on.
    // An override set to exactly the preset's own value is indistinguishable from no override
    // — and renders identically — so collapsing it back to "unset" is the honest undo.
    const restored = { ...overrides }
    if (startColor.toLowerCase() === TIME_PALETTES[preset]?.[selectedKey].toLowerCase())
      delete restored[selectedKey]
    else restored[selectedKey] = startColor
    commitEnv(
      { timePalette: paletteWith({ ...overrides, [selectedKey]: newColor }) },
      { timePalette: paletteWith(restored) },
    )
  }

  const resetKeyframe = (): void => {
    const next = { ...overrides }
    delete next[selectedKey]
    commitEnv({ timePalette: paletteWith(next) })
  }

  const scrubTo = (offset: number): void => setPreviewClock(offsetMinutes(Number(offset)))

  /** In fixed mode the scrub *is* the fixed-time picker: drag previews, release pins. */
  const endScrub = (offset: number): void => {
    if (!fixed) return
    const next = offsetMinutes(Number(offset))
    setPreviewClock(null)
    if (next !== map.fixedTime) commitEnv({ fixedTime: next })
  }

  const SectionIcon = ENV_ICON[environment]

  const ribbon = (
    <DayRibbon colorAt={paletteAt} height={26} muted={!clockReaches}>
      {/* One either/or — which hour the picker below is pointed at — so a radiogroup rather
          than five `aria-pressed` buttons a screen reader hears as five independent toggles. */}
      <span role="radiogroup" aria-label="Palette keyframes">
      {TIME_KEYS.map((key) => {
        const active = key === selectedKey
        const swatch = (
          <span
            className={cn(
              'block h-full w-full rounded-chip border-[1.5px] border-black/60',
              'shadow-[0_0_0_1.5px_rgba(255,255,255,.34)]',
            )}
            style={{ backgroundColor: keys[key] }}
          />
        )
        return clockReaches ? (
          <button
            key={key}
            type="button"
            role="radio"
            onClick={() => setSelectedKey(key)}
            aria-checked={active}
            aria-label={`${KEY_LABEL[key]} keyframe, ${keys[key].toUpperCase()}`}
            className={cn(
              'absolute top-1/2 z-10 h-[17px] w-[17px] -translate-x-1/2 -translate-y-1/2 rounded-chip',
              'transition-transform duration-150 ease-settle hover:scale-110',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus',
              active && 'ring-2 ring-accent-active',
            )}
            style={{ left: `${ribbonX(KEY_MINUTES[key])}%` }}
          >
            {swatch}
          </button>
        ) : (
          <span
            key={key}
            className="absolute top-1/2 z-10 h-[17px] w-[17px] -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${ribbonX(KEY_MINUTES[key])}%` }}
          >
            {swatch}
          </span>
        )
      })}
      </span>
      {clockReaches && <RibbonHead minutes={clock} committed={fixed} />}
    </DayRibbon>
  )

  const timePalette = (
    <div className="flex flex-col gap-2">
      <SelectInput
        value={preset}
        onChange={(v) => commitEnv({ timePalette: { preset: v } })}
        options={Object.keys(TIME_PALETTES).map((p) => ({ value: p, label: titleCase(p) }))}
        aria-label="Time palette preset"
      />
      {ribbon}
      <div className="relative h-2.5">
        {TIME_KEYS.map((key) => (
          <span
            key={key}
            className="absolute -translate-x-1/2 text-strip-label uppercase text-text-muted"
            style={{ left: `${ribbonX(KEY_MINUTES[key])}%` }}
          >
            {KEY_TICK[key]}
          </span>
        ))}
      </div>
      {clockReaches && (
        <div className="flex items-center gap-2">
          <span className="font-mono text-panel-label uppercase text-text-muted">
            {KEY_LABEL[selectedKey]} key
          </span>
          {overrides[selectedKey] && (
            <button
              type="button"
              onClick={resetKeyframe}
              title={`Reset ${KEY_LABEL[selectedKey].toLowerCase()} to the ${titleCase(preset)} palette`}
              aria-label={`Reset ${KEY_LABEL[selectedKey].toLowerCase()} keyframe`}
              className="rounded-sm p-0.5 text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
            >
              <RotateCcw size={11} />
            </button>
          )}
          <div className="ml-auto w-[104px]" data-testid="keyframe-color">
            <ColorField value={keys[selectedKey]} onChange={setKeyframe} onChangeCommit={commitKeyframe} />
          </div>
        </div>
      )}
    </div>
  )

  const naturalLight = (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <ToggleSwitch
          checked={map.naturalLight === true}
          onChange={(v) => commitEnv({ naturalLight: v })}
          label="Sun and moon shadows"
        />
        <span className="text-panel-body text-text-secondary">Sun &amp; moon shadows</span>
      </div>
      <div className="flex items-center gap-2.5">
        <OrientationCompass
          value={map.orientation ?? 0}
          onChange={(deg) => useStore.getState().setEnvironmentSettings({ orientation: deg })}
          onChangeCommit={(deg, start) => commitEnv({ orientation: deg }, { orientation: start })}
        />
        <span className="font-mono text-panel-body tabular-nums text-text-secondary">
          <b className="block font-semibold text-text-primary">E {map.orientation ?? 0}°</b>
          the sun rises here
        </span>
      </div>
    </div>
  )

  return (
    <CollapsibleSection
      id="environment"
      title="Environment"
      icon={SectionIcon}
      defaultOpen={false}
      isOpen={openSections?.has('environment')}
      onToggle={onToggleSection}
      preview={<ColorChip color={composeGrade(map, clock)} size="sm" circular />}
    >
      <div className="flex flex-col gap-3 pt-2">
        <PropertyField label="Type">
          <Segmented
            label="Environment type"
            value={environment}
            options={ENVIRONMENTS.map((env) => [env, ENV_LABEL[env]] as const)}
            onPick={(env) => commitEnv({ environment: env })}
          />
          {!outdoor && <GateChip />}
        </PropertyField>

        <PropertyField
          label={
            <>
              Mood tint
              {environment === 'underground' && <Why>the whole grade</Why>}
            </>
          }
        >
          <div className="flex gap-1.5" role="group" aria-label="Mood tint presets">
            {AMBIENT_PRESETS.map((p) => {
              const active = p.color.toLowerCase() === map.ambientLight.toLowerCase()
              return (
                <button
                  key={p.label}
                  type="button"
                  title={p.label}
                  aria-label={p.label}
                  aria-pressed={active}
                  onClick={() => commitAmbient(p.color, map.ambientLight)}
                  className={cn(
                    'h-6 w-6 shrink-0 rounded-full border-2 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus',
                    active ? 'border-accent-active' : 'border-border-default hover:border-text-secondary',
                  )}
                  style={{ backgroundColor: p.color }}
                />
              )
            })}
          </div>
          <div className="mt-1.5" data-testid="ambient-color-swatch">
            <ColorField
              value={map.ambientLight}
              onChange={(c) => useStore.getState().setAmbientLight(c)}
              onChangeCommit={commitAmbient}
            />
          </div>
        </PropertyField>

        <PropertyField label="Fog look">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <Segmented
                label="Fog preset"
                value={fogLook.preset}
                options={FOG_LOOK_PRESETS.map((p) => [p, FOG_PRESET_LABEL[p]] as const)}
                onPick={pickFogPreset}
              />
            </div>
            <button
              type="button"
              onClick={resetFogToPreset}
              disabled={!fogLook.preset}
              title="Reset layers to the picked preset"
              aria-label="Reset layers to the picked preset"
              className="shrink-0 rounded-sm p-1 text-text-muted transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
            >
              <RotateCcw size={11} />
            </button>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <span className="text-panel-small text-text-muted">Mist base</span>
            <div data-testid="fog-base-color-swatch">
              <ColorField value={fogLook.base} onChange={setFogBase} onChangeCommit={commitFogBase} ariaLabel="Mist base" />
            </div>
          </div>

          <div className="mt-2 flex flex-col gap-1.5">
            {fogLook.layers.map((layer, i) => (
              <LayerRow
                key={i}
                index={i}
                layer={layer}
                onType={(type) => setFogLayerType(i, type)}
                onTint={(c) => setFogLayerTint(i, c)}
                onCommitTint={(c, start) => commitFogLayerTint(i, c, start)}
                onField={(field, v) => setFogLayerField(i, field, v)}
                onCommitField={(field, v, start) => commitFogLayerField(i, field, v, start)}
              />
            ))}
          </div>

          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {(
              [
                ['wind', 'Wind', 0.5, 12, 0.1],
                ['fade', 'Fade', 1, 4, 0.1],
                ['veil', 'Veil', 0, 0.5, 0.01],
                ['glow', 'Glow', 0, 1, 0.01],
              ] as const
            ).map(([field, label, min, max, step]) => (
              <div key={field} className="flex flex-col gap-0.5">
                <span className="text-panel-small text-text-muted">{label}</span>
                <SliderInput
                  value={fogLook[field]}
                  min={min}
                  max={max}
                  step={step}
                  ariaLabel={label}
                  onChange={(v) => setFogField(field, v)}
                  onChangeCommit={(v, start) => commitFogField(field, v, start)}
                />
              </div>
            ))}
          </div>
        </PropertyField>

        <PropertyField
          label={
            <>
              Time palette
              {environment === 'indoor' && <Why>damped</Why>}
            </>
          }
        >
          {clockReaches ? (
            timePalette
          ) : (
            <Inapplicable reason="Underground ignores the clock. A torchlit crypt looks the same at noon — the palette is kept for if this map comes up for air.">
              {timePalette}
            </Inapplicable>
          )}
          <DayRibbon colorAt={appliedAt} height={11} className="mt-2.5" />
          <p className="mt-1 text-panel-small text-text-muted">{APPLIED_CAPTION[environment]}</p>
        </PropertyField>

        <PropertyField label="Time">
          {clockReaches ? (
            <>
              <Segmented
                label="Time mode"
                value={map.timeMode ?? 'clock'}
                options={[
                  ['clock', 'Follow clock'],
                  ['fixed', 'Fixed'],
                ]}
                onPick={(mode) => {
                  // Pinning takes the hour on screen — including one the DM scrubbed to,
                  // which is now authored, so the local preview steps back out of the way.
                  if (mode === 'fixed') setPreviewClock(null)
                  commitEnv(
                    mode === 'fixed' ? { timeMode: 'fixed', fixedTime: clock } : { timeMode: 'clock' },
                  )
                }}
              />

              {/* Dashed enclosure = a local instrument. In fixed mode the same scrub is the
                  authored picker, so the fence drops and the head becomes a solid blade. */}
              <div
                className={cn(
                  'mt-2 rounded-md border px-2.5 py-2',
                  fixed ? 'border-border-default bg-surface-1' : 'border-dashed border-border-structure bg-black/15',
                )}
              >
                <div className="mb-2.5 flex items-center gap-1.5">
                  {fixed ? (
                    <Lock size={11} className="text-text-secondary" aria-hidden="true" />
                  ) : (
                    <Eye size={11} className="text-text-secondary" aria-hidden="true" />
                  )}
                  <span className="text-panel-label uppercase tracking-[0.1em] text-text-secondary">
                    {fixed ? 'Fixed time' : 'Preview clock'}
                  </span>
                  <span className="ml-auto font-mono text-panel-body tabular-nums text-text-primary">
                    {hhmm(clock)}
                  </span>
                  <span className="font-mono text-panel-small text-text-muted">
                    {timeOfDayAt(clock)}
                  </span>
                  {!fixed && previewClock !== null && (
                    <button
                      type="button"
                      onClick={() => setPreviewClock(null)}
                      title="Stop previewing"
                      aria-label="Stop previewing"
                      className="rounded-sm p-0.5 text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
                    >
                      <RotateCcw size={11} />
                    </button>
                  )}
                </div>
                <DayRibbon colorAt={appliedAt} height={14}>
                  <RibbonHead minutes={clock} committed={fixed} />
                  <input
                    type="range"
                    className="ribbon-scrub absolute inset-x-0 -top-1.5 -bottom-1.5 z-30 w-full"
                    min={0}
                    max={DAY_MINUTES - BUCKET_MINUTES}
                    step={BUCKET_MINUTES}
                    value={ribbonOffset(clock)}
                    aria-label={fixed ? 'Fixed time' : 'Preview clock'}
                    aria-valuetext={hhmm(clock)}
                    onChange={(e) => scrubTo(Number(e.target.value))}
                    onPointerUp={(e) => endScrub(Number((e.target as HTMLInputElement).value))}
                    onBlur={(e) => endScrub(Number(e.target.value))}
                  />
                </DayRibbon>
                <p className="mt-2 text-panel-small text-text-muted">
                  {fixed
                    ? 'This map is pinned here. The world clock and time speed pass it by.'
                    : 'Local to this window. Does not touch the session clock — the Table keeps its own time.'}
                </p>
              </div>

              {/* The sky is a campaign value, not this map's own — only worth previewing where
                  it can reach the sun at all (indoor/underground never see it). */}
              {outdoor && (
                <div className="mt-3">
                  <p className="mb-1.5 text-panel-label uppercase tracking-[0.1em] text-text-secondary">
                    Preview sky
                  </p>
                  <Segmented
                    label="Preview sky"
                    value={previewSky ?? 'full-moon'}
                    options={NIGHT_SKIES.map((sky) => [sky, SKY_LABEL[sky]] as const)}
                    onPick={(sky) => setPreviewSky(sky === 'full-moon' ? null : sky)}
                  />
                </div>
              )}
            </>
          ) : (
            <Inapplicable reason="There is no hour to pin underground — the clock never reaches this map.">
              <Segmented
                label="Time mode"
                value={map.timeMode ?? 'clock'}
                options={[
                  ['clock', 'Follow clock'],
                  ['fixed', 'Fixed'],
                ]}
                onPick={() => {}}
              />
            </Inapplicable>
          )}
        </PropertyField>

        <PropertyField label="Natural light">
          {outdoor ? (
            naturalLight
          ) : (
            <Inapplicable
              reason={
                environment === 'indoor'
                  ? 'Not applicable indoors — no sky to cast from. The orientation is kept for if this map becomes outdoor.'
                  : 'No sky underground. Torches and authored lights are the entire scene.'
              }
            >
              {naturalLight}
            </Inapplicable>
          )}
        </PropertyField>
      </div>
    </CollapsibleSection>
  )
}
