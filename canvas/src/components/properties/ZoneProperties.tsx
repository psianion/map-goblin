import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@/store/store'
import { PropertyField } from './PropertyField'
import { SelectInput } from '@/components/inputs/SelectInput'
import { NumberInput } from '@/components/inputs/NumberInput'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { UpdateChildCommand } from '@/store/commands'
import { undoManager } from '@/store/undoManager'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import type {
  DungeonLayer,
  ZoneChild,
  ZoneShape,
  LightChild,
  TriggerDef,
  TriggerCondition,
  TriggerAction,
  Ability,
  TimeOfDay,
  Weather,
} from '@/store/types'

// Ray-casting point-in-polygon — a local copy rather than importing
// engine/hitTest.ts, which drags core's own store singleton into the
// properties bundle for one boolean check.
function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false
  const [px, py] = point
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function shapeReadout(shape: ZoneShape): string {
  switch (shape.kind) {
    case 'point':
      return `Point (${shape.position.x.toFixed(2)}, ${shape.position.y.toFixed(2)})`
    case 'circle':
      return `Circle (${shape.position.x.toFixed(2)}, ${shape.position.y.toFixed(2)}) r=${shape.radius.toFixed(2)}`
    case 'rect':
      return `Rect (${shape.x.toFixed(2)}, ${shape.y.toFixed(2)}) ${shape.width.toFixed(2)}×${shape.height.toFixed(2)}`
  }
}

const CONDITION_OPTIONS: Record<ZoneShape['kind'], { value: TriggerCondition['kind']; label: string }[]> = {
  point: [{ value: 'room-revealed', label: 'Room revealed' }],
  circle: [
    { value: 'enter-region', label: 'Enter region' },
    { value: 'within-radius', label: 'Within radius' },
  ],
  rect: [{ value: 'enter-region', label: 'Enter region' }],
}

const DEFAULT_CONDITION: Record<ZoneShape['kind'], TriggerCondition['kind']> = {
  point: 'room-revealed',
  circle: 'enter-region',
  rect: 'enter-region',
}

const ABILITY_OPTIONS: { value: Ability; label: string }[] = [
  { value: 'str', label: 'STR' },
  { value: 'dex', label: 'DEX' },
  { value: 'con', label: 'CON' },
  { value: 'int', label: 'INT' },
  { value: 'wis', label: 'WIS' },
  { value: 'cha', label: 'CHA' },
]

const ACTION_KIND_OPTIONS: { value: TriggerAction['kind']; label: string }[] = [
  { value: 'show-text', label: 'Show text' },
  { value: 'light', label: 'Light' },
  { value: 'trap', label: 'Trap' },
  { value: 'ability-check', label: 'Ability check' },
  { value: 'prompt', label: 'Prompt' },
  { value: 'environment', label: 'Environment' },
]

const TIME_OPTIONS: { value: TimeOfDay; label: string }[] = [
  { value: 'dawn', label: 'Dawn' },
  { value: 'day', label: 'Day' },
  { value: 'dusk', label: 'Dusk' },
  { value: 'night', label: 'Night' },
]

const WEATHER_OPTIONS: { value: Weather; label: string }[] = [
  { value: 'clear', label: 'Clear' },
  { value: 'rain', label: 'Rain' },
  { value: 'storm', label: 'Storm' },
  { value: 'fog', label: 'Fog' },
  { value: 'snow', label: 'Snow' },
]

// `NdM` or `NdM±K` — the format the schema's `damage` field documents.
const DICE_RE = /^\d+d\d+([+-]\d+)?$/i

function defaultAction(kind: TriggerAction['kind'], firstLightId: string): TriggerAction {
  switch (kind) {
    case 'show-text':
      return { kind, text: '', toPlayers: true }
    case 'light':
      return { kind, lightId: firstLightId, on: true }
    case 'trap':
      return { kind, text: '' }
    case 'ability-check':
      return { kind, ability: 'str', dc: 10, text: '' }
    case 'prompt':
      return { kind, prompt: 'initiative' }
    case 'environment':
      return { kind }
  }
}

const fieldInputClass =
  'min-w-0 w-full rounded border border-border-default bg-surface-1 px-1.5 py-1 text-panel-body text-text-primary outline-none focus:border-border-focus'

interface ZonePropertiesProps {
  layerId: string
  childId: string
}

export function ZoneProperties({ layerId, childId }: ZonePropertiesProps) {
  const { zone, layer } = useStore(
    useShallow((state) => {
      const l = state.layers.find((x) => x.id === layerId)
      if (!l || l.type !== 'dungeon') return { zone: null, layer: null }
      const child = (l as DungeonLayer).children.find((c) => c.id === childId)
      if (!child || child.childType !== 'zone') return { zone: null, layer: null }
      return { zone: child as ZoneChild, layer: l as DungeonLayer }
    }),
  )
  const zoneTriggers = useStore(
    useShallow((state) => (state.prep?.triggers ?? []).filter((t) => t.when.zoneId === childId)),
  )
  const upsertTrigger = useStore((s) => s.upsertTrigger)
  const removeTrigger = useStore((s) => s.removeTrigger)

  // `null` = not being edited, so the field follows the zone. Same idiom as
  // DoorProperties' name field.
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (!zone || !layer) return null

  const update = (before: Partial<ZoneChild>, after: Partial<ZoneChild>) => {
    undoManager.execute(new UpdateChildCommand('Update zone', layerId, childId, before, after))
  }

  const commitName = () => {
    const name = nameDraft?.trim()
    if (name && name !== zone.name) update({ name: zone.name }, { name })
    setNameDraft(null)
  }

  const shape = zone.shape
  const rooms = layer.rooms ?? []
  // Only a point zone binds to a room — a room-revealed trigger anchored to a
  // point that lands outside every detected room can never fire.
  const isOrphan =
    shape.kind === 'point' &&
    !rooms.some((r) => pointInPolygon([shape.position.x, shape.position.y], r.boundary))

  const addTrigger = () => {
    const trigger: TriggerDef = {
      id: crypto.randomUUID(),
      name: `Trigger ${zoneTriggers.length + 1}`,
      when: { kind: DEFAULT_CONDITION[shape.kind], zoneId: zone.id },
      actions: [],
      once: true,
      enabled: true,
    }
    upsertTrigger(trigger)
    setExpandedId(trigger.id)
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-panel-heading uppercase text-text-muted">Zone Properties</span>

      <PropertyField label="Name">
        <input
          type="text"
          aria-label="Zone name"
          value={nameDraft ?? zone.name}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setNameDraft(null)
          }}
          className={fieldInputClass}
        />
      </PropertyField>

      <PropertyField label="Shape">
        <div className="flex items-center gap-2">
          <span className="font-mono text-panel-body text-text-secondary">{shapeReadout(shape)}</span>
          {isOrphan && (
            <span className="shrink-0 rounded bg-warning/10 px-1 font-mono text-panel-label uppercase text-warning">
              Not inside a room
            </span>
          )}
        </div>
      </PropertyField>

      <div className="flex flex-col gap-1.5 pt-1">
        <div className="flex items-center justify-between">
          <span className="font-mono text-panel-label uppercase text-text-muted">Triggers</span>
          <button
            type="button"
            onClick={addTrigger}
            className="rounded border border-border-default px-1.5 py-0.5 text-panel-small text-text-secondary hover:bg-surface-3"
          >
            Add trigger
          </button>
        </div>

        {zoneTriggers.length === 0 ? (
          <p className="text-panel-body text-text-muted">No triggers on this zone.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {zoneTriggers.map((t) => (
              <div key={t.id} className="flex flex-col rounded border border-border-default">
                <div className="flex items-center gap-2 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                    className="min-w-0 flex-1 truncate text-left text-panel-body text-text-primary"
                  >
                    {t.name}
                  </button>
                  <span className="shrink-0 font-mono text-panel-label uppercase text-text-muted">
                    {t.when.kind}
                  </span>
                  <ToggleSwitch
                    checked={t.enabled}
                    onChange={(v) => upsertTrigger({ ...t, enabled: v })}
                    label={`Enable ${t.name}`}
                  />
                  <button
                    type="button"
                    aria-label={`Delete ${t.name}`}
                    onClick={() => removeTrigger(t.id)}
                    className="shrink-0 text-text-muted hover:text-danger"
                  >
                    <X size={12} />
                  </button>
                </div>
                {expandedId === t.id && (
                  <TriggerEditor trigger={t} shapeKind={shape.kind} layer={layer} onChange={upsertTrigger} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface TriggerEditorProps {
  trigger: TriggerDef
  shapeKind: ZoneShape['kind']
  layer: DungeonLayer
  onChange: (trigger: TriggerDef) => void
}

function TriggerEditor({ trigger, shapeKind, layer, onChange }: TriggerEditorProps) {
  const lights = layer.children.filter((c): c is LightChild => c.childType === 'light')
  const conditionOptions = CONDITION_OPTIONS[shapeKind]

  const patch = (p: Partial<TriggerDef>) => onChange({ ...trigger, ...p })

  const addAction = (kind: TriggerAction['kind'] | '') => {
    if (!kind) return
    patch({ actions: [...trigger.actions, defaultAction(kind, lights[0]?.id ?? '')] })
  }
  const updateAction = (i: number, action: TriggerAction) => {
    const actions = trigger.actions.slice()
    actions[i] = action
    patch({ actions })
  }
  const removeAction = (i: number) => {
    patch({ actions: trigger.actions.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border-default px-2 py-2">
      <PropertyField label="Name">
        <input
          type="text"
          value={trigger.name}
          onChange={(e) => patch({ name: e.target.value })}
          className={fieldInputClass}
        />
      </PropertyField>

      <PropertyField label="Condition">
        <SelectInput
          value={trigger.when.kind}
          options={conditionOptions}
          onChange={(v) =>
            patch({ when: { kind: v as TriggerCondition['kind'], zoneId: trigger.when.zoneId } })
          }
        />
      </PropertyField>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-panel-small text-text-muted">
          <ToggleSwitch checked={trigger.once} onChange={(v) => patch({ once: v })} label="Once" />
          Once
        </label>
        <label className="flex items-center gap-1.5 text-panel-small text-text-muted">
          <ToggleSwitch checked={trigger.enabled} onChange={(v) => patch({ enabled: v })} label="Enabled" />
          Enabled
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-panel-label uppercase text-text-muted">Actions</span>
        {trigger.actions.map((action, i) => (
          <ActionEditor
            key={i}
            action={action}
            lights={lights}
            onChange={(a) => updateAction(i, a)}
            onRemove={() => removeAction(i)}
          />
        ))}
        <SelectInput
          value=""
          options={[{ value: '', label: 'Add action…' }, ...ACTION_KIND_OPTIONS]}
          onChange={(v) => addAction(v as TriggerAction['kind'] | '')}
        />
      </div>
    </div>
  )
}

interface ActionEditorProps {
  action: TriggerAction
  lights: LightChild[]
  onChange: (action: TriggerAction) => void
  onRemove: () => void
}

function ActionEditor({ action, lights, onChange, onRemove }: ActionEditorProps) {
  return (
    <div className="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-1 px-2 py-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-panel-label uppercase text-text-muted">{action.kind}</span>
        <button
          type="button"
          aria-label="Remove action"
          onClick={onRemove}
          className="text-text-muted hover:text-danger"
        >
          <X size={12} />
        </button>
      </div>

      {action.kind === 'show-text' && (
        <>
          <textarea
            value={action.text}
            rows={2}
            aria-label="Text"
            onChange={(e) => onChange({ ...action, text: e.target.value })}
            className={cn(fieldInputClass, 'resize-y')}
          />
          <ToggleSwitch
            checked={action.toPlayers}
            onChange={(v) => onChange({ ...action, toPlayers: v })}
            label="Show to players"
          />
        </>
      )}

      {action.kind === 'light' && (
        <>
          <SelectInput
            value={action.lightId}
            options={
              lights.length > 0
                ? lights.map((l) => ({ value: l.id, label: l.name }))
                : [{ value: action.lightId, label: 'No lights on this layer' }]
            }
            onChange={(v) => onChange({ ...action, lightId: v })}
          />
          {action.lightId && !lights.some((l) => l.id === action.lightId) && (
            <span className="text-panel-small text-warning">Light not found — trigger is inert</span>
          )}
          <ToggleSwitch
            checked={action.on}
            onChange={(v) => onChange({ ...action, on: v })}
            label="Turn light on"
          />
        </>
      )}

      {action.kind === 'trap' && <TrapActionFields action={action} onChange={onChange} />}

      {action.kind === 'ability-check' && (
        <>
          <SelectInput
            value={action.ability}
            options={ABILITY_OPTIONS}
            onChange={(v) => onChange({ ...action, ability: v as Ability })}
          />
          <NumberInput value={action.dc} min={1} max={30} onChange={(v) => onChange({ ...action, dc: v })} />
          <textarea
            value={action.text}
            rows={2}
            aria-label="Text"
            onChange={(e) => onChange({ ...action, text: e.target.value })}
            className={cn(fieldInputClass, 'resize-y')}
          />
        </>
      )}

      {action.kind === 'prompt' && (
        <>
          <SelectInput
            value={action.prompt}
            options={[
              { value: 'initiative', label: 'Initiative' },
              { value: 'attack', label: 'Attack' },
            ]}
            onChange={(v) => onChange({ ...action, prompt: v as 'initiative' | 'attack' })}
          />
          <input
            type="text"
            value={action.text ?? ''}
            placeholder="Optional note"
            onChange={(e) => onChange({ ...action, text: e.target.value || undefined })}
            className={fieldInputClass}
          />
          <span className="text-panel-small text-text-muted">DM-log only — not shown at the table</span>
        </>
      )}

      {action.kind === 'environment' && (
        <>
          <SelectInput
            value={action.time ?? ''}
            options={[{ value: '', label: 'Time — unchanged' }, ...TIME_OPTIONS]}
            onChange={(v) => onChange({ ...action, time: (v || undefined) as TimeOfDay | undefined })}
          />
          <SelectInput
            value={action.weather ?? ''}
            options={[{ value: '', label: 'Weather — unchanged' }, ...WEATHER_OPTIONS]}
            onChange={(v) => onChange({ ...action, weather: (v || undefined) as Weather | undefined })}
          />
        </>
      )}
    </div>
  )
}

function TrapActionFields({
  action,
  onChange,
}: {
  action: Extract<TriggerAction, { kind: 'trap' }>
  onChange: (action: TriggerAction) => void
}) {
  const [damageDraft, setDamageDraft] = useState(action.damage ?? '')
  const damageValid = damageDraft.trim() === '' || DICE_RE.test(damageDraft.trim())

  return (
    <>
      <textarea
        value={action.text}
        rows={2}
        aria-label="Text"
        onChange={(e) => onChange({ ...action, text: e.target.value })}
        className={cn(fieldInputClass, 'resize-y')}
      />

      <label className="flex items-center gap-1.5 text-panel-small text-text-muted">
        <ToggleSwitch
          checked={!!action.save}
          onChange={(v) => onChange({ ...action, save: v ? { ability: 'str', dc: 10 } : undefined })}
          label="Save"
        />
        Save
      </label>
      {action.save && (
        <div className="flex items-center gap-1.5">
          <SelectInput
            value={action.save.ability}
            options={ABILITY_OPTIONS}
            onChange={(v) => onChange({ ...action, save: { ...action.save!, ability: v as Ability } })}
          />
          <NumberInput
            value={action.save.dc}
            min={1}
            max={30}
            onChange={(v) => onChange({ ...action, save: { ...action.save!, dc: v } })}
          />
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        <input
          type="text"
          value={damageDraft}
          placeholder="2d6+1"
          aria-label="Damage"
          onChange={(e) => setDamageDraft(e.target.value)}
          onBlur={() =>
            onChange({ ...action, damage: damageDraft.trim() === '' ? undefined : damageDraft.trim() })
          }
          className={cn(fieldInputClass, damageValid ? '' : 'border-danger')}
        />
        {!damageValid && (
          <span className="text-panel-small text-danger">Format: NdM or NdM±K, e.g. 2d6+1</span>
        )}
      </div>
    </>
  )
}
